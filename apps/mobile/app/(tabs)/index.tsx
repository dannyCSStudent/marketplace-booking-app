import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCurrency, formatLocation } from '@/lib/api';
import {
  clearBuyerBrowseResumeFilters,
  getBuyerBrowseFilters,
  getBuyerBrowseResumeFilters,
  getBuyerRecentListings,
  getBuyerRecentTransactionReceipts,
  setBuyerBrowseFilters,
  setBuyerBrowseResumeFilters,
  setBuyerRecentListings,
} from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

const typeColors = {
  product: '#7c3a10',
  service: '#0f5f62',
  hybrid: '#6f4a09',
} as const;

function getListingTypeColor(type: string) {
  if (type === 'product' || type === 'service' || type === 'hybrid') {
    return typeColors[type];
  }

  return '#4d4338';
}

function getListingSignals(listing: {
  requires_booking?: boolean;
  pickup_enabled?: boolean;
  meetup_enabled?: boolean;
  delivery_enabled?: boolean;
  shipping_enabled?: boolean;
}) {
  const fulfillmentCount = [
    listing.pickup_enabled,
    listing.meetup_enabled,
    listing.delivery_enabled,
    listing.shipping_enabled,
  ].filter(Boolean).length;

  return {
    booking: listing.requires_booking ? 'Booking ready' : 'Order ready',
    fulfillment:
      fulfillmentCount > 0
        ? `${fulfillmentCount} fulfillment option${fulfillmentCount === 1 ? '' : 's'}`
        : 'Fulfillment pending',
  };
}

function getLocationLabel(parts: (string | null | undefined)[]) {
  const label = parts.filter(Boolean).join(', ');
  return label || 'Location pending';
}

function getListingSearchScore(
  listing: {
    title: string;
    slug: string;
    description?: string | null;
    category?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    type: string;
  },
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return 0;
  }

  const title = listing.title.toLowerCase();
  const slug = listing.slug.toLowerCase();
  const description = listing.description?.toLowerCase() ?? '';
  const category = listing.category?.toLowerCase() ?? '';
  const location = [listing.city, listing.state, listing.country]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const type = listing.type.toLowerCase();

  let score = 0;
  if (title === normalizedQuery) {
    score += 120;
  } else if (title.startsWith(normalizedQuery)) {
    score += 80;
  } else if (title.includes(normalizedQuery)) {
    score += 60;
  }
  if (slug.startsWith(normalizedQuery)) {
    score += 50;
  } else if (slug.includes(normalizedQuery)) {
    score += 30;
  }
  if (location.startsWith(normalizedQuery)) {
    score += 35;
  } else if (location.includes(normalizedQuery)) {
    score += 20;
  }
  if (type === normalizedQuery) {
    score += 18;
  } else if (type.includes(normalizedQuery)) {
    score += 10;
  }
  if (category === normalizedQuery) {
    score += 22;
  } else if (category.includes(normalizedQuery)) {
    score += 12;
  }
  if (description.includes(normalizedQuery)) {
    score += 8;
  }

  return score;
}

function getSuggestedSearches(
  listings: {
    title: string;
    category?: string | null;
    city?: string | null;
    state?: string | null;
    type: string;
  }[],
  normalizedQuery: string,
) {
  const suggestions = new Map<string, number>();

  const pushSuggestion = (label: string | null | undefined, weight: number) => {
    const normalized = label?.trim();
    if (!normalized) {
      return;
    }

    if (normalizedQuery && normalized.toLowerCase().includes(normalizedQuery)) {
      return;
    }

    suggestions.set(normalized, (suggestions.get(normalized) ?? 0) + weight);
  };

  listings.forEach((listing) => {
    pushSuggestion(listing.city ?? null, 3);
    pushSuggestion(listing.state ?? null, 2);
    pushSuggestion(listing.category ?? null, 3);
    pushSuggestion(formatTypeFilter(listing.type), 2);

    const titleTokens = listing.title.match(/[A-Za-z0-9&'-]{4,}/g) ?? [];
    titleTokens.slice(0, 3).forEach((token) => {
      pushSuggestion(token, 1);
    });
  });

  return [...suggestions.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([label]) => label);
}

function getCategoryOptions(listings: { category?: string | null }[]) {
  const counts = new Map<string, number>();

  listings.forEach((listing) => {
    const label = listing.category?.trim();
    if (!label) {
      return;
    }

    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => ({ label, count }));
}

function formatTypeFilter(typeFilter: string) {
  if (typeFilter === 'all') {
    return 'All Listings';
  }

  if (typeFilter === 'product') {
    return 'Products';
  }

  if (typeFilter === 'service') {
    return 'Services';
  }

  if (typeFilter === 'hybrid') {
    return 'Hybrid';
  }

  return typeFilter
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatSortMode(sortMode: 'newest' | 'price-low' | 'price-high') {
  if (sortMode === 'price-low') {
    return 'Lowest Price';
  }

  if (sortMode === 'price-high') {
    return 'Highest Price';
  }

  return 'Newest';
}

function getLocationSummary(
  listings: { city?: string | null; state?: string | null; country?: string | null }[],
) {
  const counts = new Map<string, number>();

  listings.forEach((listing) => {
    const label = [listing.city, listing.state].filter(Boolean).join(', ');
    if (!label) {
      return;
    }

    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

type BuyerBrowseSnapshot = {
  searchQuery?: string;
  categoryFilter?: string;
  typeFilter?: 'all' | 'product' | 'service' | 'hybrid';
  sortMode?: 'newest' | 'price-low' | 'price-high';
  localOnly?: boolean;
  availableToday?: boolean;
  popularOnly?: boolean;
};

function applyBuyerBrowseSnapshot(
  snapshot: BuyerBrowseSnapshot,
  setters: {
    setSearchQuery: (value: string) => void;
    setCategoryFilter: (value: string) => void;
    setTypeFilter: (value: 'all' | 'product' | 'service' | 'hybrid') => void;
    setSortMode: (value: 'newest' | 'price-low' | 'price-high') => void;
    setLocalOnly: (value: boolean) => void;
    setAvailableToday: (value: boolean) => void;
    setPopularOnly: (value: boolean) => void;
  },
) {
  setters.setSearchQuery(snapshot.searchQuery ?? '');
  setters.setCategoryFilter(snapshot.categoryFilter ?? '');
  setters.setTypeFilter(snapshot.typeFilter ?? 'all');
  setters.setSortMode(snapshot.sortMode ?? 'newest');
  setters.setLocalOnly(snapshot.localOnly ?? false);
  setters.setAvailableToday(snapshot.availableToday ?? false);
  setters.setPopularOnly(snapshot.popularOnly ?? false);
}

function getBrowseSliceSummary(snapshot: BuyerBrowseSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  const parts = [
    formatTypeFilter(snapshot.typeFilter ?? 'all'),
    snapshot.categoryFilter?.trim() || null,
    formatSortMode(snapshot.sortMode ?? 'newest'),
    snapshot.localOnly ? 'Local only' : null,
    snapshot.availableToday ? 'Available today' : null,
    snapshot.popularOnly ? 'Popular near you' : null,
    snapshot.searchQuery?.trim() ? `Search: ${snapshot.searchQuery.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function getBrowseSnapshotKey(snapshot: BuyerBrowseSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  return JSON.stringify({
    searchQuery: snapshot.searchQuery?.trim() || '',
    categoryFilter: snapshot.categoryFilter?.trim() || '',
    typeFilter: snapshot.typeFilter ?? 'all',
    sortMode: snapshot.sortMode ?? 'newest',
    localOnly: snapshot.localOnly ?? false,
    availableToday: snapshot.availableToday ?? false,
    popularOnly: snapshot.popularOnly ?? false,
  });
}

function getPrimaryImageUrl(listing: { images?: { image_url: string }[] | null }) {
  return listing.images?.[0]?.image_url ?? null;
}

function getRecommendedBrowsePreset(input: {
  listings: {
    id: string;
    type: string;
    is_local_only?: boolean | null;
  }[];
  orders: {
    items?: { listing_id: string }[] | null;
  }[];
  bookings: {
    listing_id: string;
    listing_type?: string | null;
  }[];
}) {
  const productScore = input.orders.reduce((count, order) => {
    const matchingListings = (order.items ?? [])
      .map((item) => input.listings.find((listing) => listing.id === item.listing_id))
      .filter((listing): listing is (typeof input.listings)[number] => Boolean(listing));

    return (
      count +
      matchingListings.filter(
        (listing) => listing.type === 'product' || listing.type === 'hybrid',
      ).length
    );
  }, 0);

  const serviceScore = input.bookings.filter(
    (booking) => booking.listing_type === 'service' || booking.listing_type === 'hybrid',
  ).length;

  const localScore =
    input.orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (listing) => listing.id === item.listing_id && listing.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) =>
      input.listings.some(
        (listing) => listing.id === booking.listing_id && listing.is_local_only,
      ),
    ).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (listing) => listing.id === item.listing_id && listing.type === 'hybrid',
        ),
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) => booking.listing_type === 'hybrid').length;

  if (localScore >= Math.max(productScore, serviceScore, hybridScore) && localScore > 0) {
    return { type: 'all' as const, localOnly: true, label: 'Local-First' };
  }

  if (serviceScore >= Math.max(productScore, hybridScore) && serviceScore > 0) {
    return { type: 'service' as const, localOnly: false, label: 'Services' };
  }

  if (hybridScore >= Math.max(productScore, serviceScore) && hybridScore > 0) {
    return { type: 'hybrid' as const, localOnly: false, label: 'Hybrid' };
  }

  if (productScore > 0) {
    return { type: 'product' as const, localOnly: false, label: 'Products' };
  }

  return null;
}

function getRecommendationBadge(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: string } | null,
) {
  if (!preset) {
    return null;
  }

  if (preset.label === 'Local-First' && listing.is_local_only) {
    return { text: 'Recommended for local activity', tone: 'local' as const };
  }

  if (
    preset.label === 'Services' &&
    (listing.type === 'service' || listing.type === 'hybrid')
  ) {
    return { text: 'Matches your service activity', tone: 'service' as const };
  }

  if (preset.label === 'Products' && (listing.type === 'product' || listing.type === 'hybrid')) {
    return { text: 'Matches your product activity', tone: 'product' as const };
  }

  if (preset.label === 'Hybrid' && listing.type === 'hybrid') {
    return { text: 'Matches your hybrid activity', tone: 'hybrid' as const };
  }

  return null;
}

function getRecommendationScore(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: string } | null,
) {
  if (!preset) {
    return 0;
  }

  if (preset.label === 'Local-First' && listing.is_local_only) {
    return 3;
  }

  if (
    preset.label === 'Services' &&
    (listing.type === 'service' || listing.type === 'hybrid')
  ) {
    return listing.type === 'service' ? 3 : 2;
  }

  if (preset.label === 'Products' && (listing.type === 'product' || listing.type === 'hybrid')) {
    return listing.type === 'product' ? 3 : 2;
  }

  if (preset.label === 'Hybrid' && listing.type === 'hybrid') {
    return 3;
  }

  return 0;
}

export default function BrowseScreen() {
  const {
    listings,
    orders,
    bookings,
    refreshMarketplace,
    loadMoreListings,
    hasMoreListings,
    loadingMoreListings,
    refreshing,
    error,
  } = useBuyerSession();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'service' | 'hybrid'>('all');
  const [sortMode, setSortMode] = useState<'newest' | 'price-low' | 'price-high'>('newest');
  const [localOnly, setLocalOnly] = useState(false);
  const [availableToday, setAvailableToday] = useState(false);
  const [popularOnly, setPopularOnly] = useState(false);
  const [filtersRestored, setFiltersRestored] = useState(false);
  const [resumeBrowseFilters, setResumeBrowseFiltersState] = useState<BuyerBrowseSnapshot | null>(null);
  const [resumeFiltersRestored, setResumeFiltersRestored] = useState(false);
  const [recentListingIds, setRecentListingIds] = useState<string[]>([]);
  const [recentTransactionReceiptIds, setRecentTransactionReceiptIds] = useState<string[]>([]);
  const hasActiveBrowseFilters =
    searchQuery.trim().length > 0 ||
    categoryFilter.trim().length > 0 ||
    typeFilter !== 'all' ||
    sortMode !== 'newest' ||
    localOnly ||
    availableToday ||
    popularOnly;

  useEffect(() => {
    void refreshMarketplace();
  }, [refreshMarketplace]);

  useEffect(() => {
    void (async () => {
      const storedValue = await getBuyerRecentListings();
      if (!storedValue) {
        return;
      }

      try {
        const storedRecentListings = JSON.parse(storedValue) as string[];
        if (Array.isArray(storedRecentListings)) {
          setRecentListingIds(storedRecentListings.filter((item) => typeof item === 'string'));
        }
      } catch {
        // Ignore corrupted recent listing state.
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const storedValue = await getBuyerRecentTransactionReceipts();
      if (!storedValue) {
        return;
      }

      try {
        const storedRecentReceipts = JSON.parse(storedValue) as string[];
        if (Array.isArray(storedRecentReceipts)) {
          setRecentTransactionReceiptIds(
            storedRecentReceipts.filter((item) => typeof item === 'string'),
          );
        }
      } catch {
        // Ignore corrupted recent-receipt state.
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const storedValue = await getBuyerBrowseFilters();
      if (!storedValue) {
        setFiltersRestored(true);
        return;
      }

      try {
        const storedFilters = JSON.parse(storedValue) as {
          searchQuery?: string;
          categoryFilter?: string;
          typeFilter?: 'all' | 'product' | 'service' | 'hybrid';
          sortMode?: 'newest' | 'price-low' | 'price-high';
          localOnly?: boolean;
          availableToday?: boolean;
          popularOnly?: boolean;
        };

        setSearchQuery(storedFilters.searchQuery ?? '');
        setCategoryFilter(storedFilters.categoryFilter ?? '');
        setTypeFilter(storedFilters.typeFilter ?? 'all');
        setSortMode(storedFilters.sortMode ?? 'newest');
        setLocalOnly(storedFilters.localOnly ?? false);
        setAvailableToday(storedFilters.availableToday ?? false);
        setPopularOnly(storedFilters.popularOnly ?? false);
      } catch {
        // Ignore corrupted local filter state and fall back to defaults.
      } finally {
        setFiltersRestored(true);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const storedValue = await getBuyerBrowseResumeFilters();
      if (!storedValue) {
        setResumeFiltersRestored(true);
        return;
      }

      try {
        const storedFilters = JSON.parse(storedValue) as BuyerBrowseSnapshot;
        setResumeBrowseFiltersState(storedFilters);
      } catch {
        // Ignore corrupted resume state and fall back to no saved slice.
      } finally {
        setResumeFiltersRestored(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!filtersRestored) {
      return;
    }

    const snapshot: BuyerBrowseSnapshot = {
      searchQuery,
      categoryFilter,
      typeFilter,
      sortMode,
      localOnly,
      availableToday,
      popularOnly,
    };

    void setBuyerBrowseFilters(JSON.stringify(snapshot));

    if (
      searchQuery.trim().length > 0 ||
      categoryFilter.trim().length > 0 ||
      typeFilter !== 'all' ||
      sortMode !== 'newest' ||
      localOnly ||
      availableToday ||
      popularOnly
    ) {
      void setBuyerBrowseResumeFilters(JSON.stringify(snapshot));
      if (resumeBrowseFilters?.searchQuery !== snapshot.searchQuery) {
        setResumeBrowseFiltersState(snapshot);
      }
    }
  }, [
    filtersRestored,
    localOnly,
    searchQuery,
    categoryFilter,
    sortMode,
    typeFilter,
    availableToday,
    popularOnly,
    resumeBrowseFilters,
  ]);
  const recommendedPreset = useMemo(
    () => getRecommendedBrowsePreset({ listings, orders, bookings }),
    [bookings, listings, orders],
  );
  const baseLocationLabel = useMemo(() => getLocationSummary(listings), [listings]);
  const categoryOptions = useMemo(() => getCategoryOptions(listings), [listings]);

  const filteredListings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const nextListings = listings.filter((listing) => {
      if (typeFilter !== 'all' && listing.type !== typeFilter) {
        return false;
      }

      if (localOnly && !listing.is_local_only) {
        return false;
      }

      if (categoryFilter && listing.category !== categoryFilter) {
        return false;
      }

      if (availableToday && !(listing.available_today ?? false)) {
        return false;
      }

      if (popularOnly) {
        const popularityThreshold = 3;
        const listingLabel = getLocationLabel([listing.city, listing.state]);
        if (
          !baseLocationLabel ||
          listingLabel !== baseLocationLabel ||
          (listing.recent_transaction_count ?? 0) < popularityThreshold
        ) {
          return false;
        }
      }

      if (!query) {
        return true;
      }

      const haystack = [
        listing.title,
        listing.description,
        listing.category,
        listing.city,
        listing.state,
        listing.country,
        listing.type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });

    nextListings.sort((left, right) => {
      if (sortMode === 'price-low') {
        return (left.price_cents ?? 0) - (right.price_cents ?? 0);
      }

      if (sortMode === 'price-high') {
        return (right.price_cents ?? 0) - (left.price_cents ?? 0);
      }

      const rightSearchScore = getListingSearchScore(right, query);
      const leftSearchScore = getListingSearchScore(left, query);
      if (rightSearchScore !== leftSearchScore) {
        return rightSearchScore - leftSearchScore;
      }

      const rightRecommendationScore = getRecommendationScore(right, recommendedPreset);
      const leftRecommendationScore = getRecommendationScore(left, recommendedPreset);
      if (rightRecommendationScore !== leftRecommendationScore) {
        return rightRecommendationScore - leftRecommendationScore;
      }

      const rightPopularity = right.recent_transaction_count ?? 0;
      const leftPopularity = left.recent_transaction_count ?? 0;
      if (rightPopularity !== leftPopularity) {
        return rightPopularity - leftPopularity;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

    return nextListings;
  }, [
    listings,
    localOnly,
    categoryFilter,
    recommendedPreset,
    searchQuery,
    sortMode,
    typeFilter,
    availableToday,
    popularOnly,
    baseLocationLabel,
  ]);
  const recentlyViewedListings = useMemo(
    () =>
      recentListingIds
        .map((listingId) => listings.find((listing) => listing.id === listingId))
        .filter((listing): listing is (typeof listings)[number] => Boolean(listing)),
    [listings, recentListingIds],
  );
  const recentTransactionReceipts = useMemo(
    () =>
      recentTransactionReceiptIds
        .map((itemKey) => {
          const [itemKind, itemId] = itemKey.split(':');
          const matchingOrder = itemKind === 'order' ? orders.find((item) => item.id === itemId) : null;
          const matchingBooking =
            itemKind === 'booking' ? bookings.find((item) => item.id === itemId) : null;

          if (matchingOrder) {
            return {
              kind: 'order' as const,
              id: matchingOrder.id,
              label: 'Order',
              meta: matchingOrder.status,
            };
          }

          if (matchingBooking) {
            return {
              kind: 'booking' as const,
              id: matchingBooking.id,
              label: 'Booking',
              meta: matchingBooking.status,
            };
          }

          return null;
        })
        .filter(
          (item): item is { kind: 'order' | 'booking'; id: string; label: string; meta: string } =>
            Boolean(item),
        ),
    [bookings, orders, recentTransactionReceiptIds],
  );
  const dominantLocation = useMemo(
    () => getLocationSummary(filteredListings),
    [filteredListings],
  );
  const recommendedPresetActive = Boolean(
    recommendedPreset &&
      typeFilter === recommendedPreset.type &&
      localOnly === recommendedPreset.localOnly,
  );
  const summaryText = [
    formatTypeFilter(typeFilter),
    categoryFilter || null,
    formatSortMode(sortMode),
    availableToday ? 'Available today' : null,
    popularOnly ? 'Popular near you' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const suggestedSearches = useMemo(
    () => getSuggestedSearches(filteredListings.length > 0 ? filteredListings : listings, normalizedSearchQuery),
    [filteredListings, listings, normalizedSearchQuery],
  );
  const resumeBrowseSummary = useMemo(
    () => getBrowseSliceSummary(resumeBrowseFilters),
    [resumeBrowseFilters],
  );
  const currentBrowseSnapshot = useMemo(
    () =>
      ({
        searchQuery,
        categoryFilter,
        typeFilter,
        sortMode,
        localOnly,
        availableToday,
        popularOnly,
      }) satisfies BuyerBrowseSnapshot,
    [searchQuery, categoryFilter, typeFilter, sortMode, localOnly, availableToday, popularOnly],
  );
  const savedSliceIsDifferent =
    resumeFiltersRestored &&
    Boolean(resumeBrowseFilters) &&
    getBrowseSnapshotKey(resumeBrowseFilters) !== getBrowseSnapshotKey(currentBrowseSnapshot);
  const canResumeBrowsing =
    resumeFiltersRestored &&
    !hasActiveBrowseFilters &&
    Boolean(resumeBrowseFilters) &&
    Boolean(resumeBrowseSummary);
  const handleResumeBrowse = () => {
    if (!resumeBrowseFilters) {
      return;
    }

    applyBuyerBrowseSnapshot(resumeBrowseFilters, {
      setSearchQuery,
      setCategoryFilter,
      setTypeFilter,
      setSortMode,
      setLocalOnly,
      setAvailableToday,
      setPopularOnly,
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshMarketplace} />}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Local marketplace + booking</Text>
        <Text style={styles.title}>Browse live listings from the seeded marketplace.</Text>
        <Text style={styles.subtitle}>
          Products, services, and hybrid offers are all coming from the real backend now.
        </Text>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Available Now</Text>
        <Text style={styles.sectionMeta}>{filteredListings.length} live listings</Text>
      </View>

      <View style={styles.filterPanel}>
        <View style={styles.filterHeader}>
          <Text style={styles.filterTitle}>Browse Filters</Text>
          <View style={styles.filterHeaderActions}>
            {savedSliceIsDifferent ? (
              <Pressable style={styles.savedSliceCueButton} onPress={handleResumeBrowse}>
                <Text style={styles.savedSliceCueButtonText}>Resume browsing</Text>
              </Pressable>
            ) : null}
            {hasActiveBrowseFilters ? (
              <Pressable
                style={styles.clearButton}
                onPress={() => {
                  setSearchQuery('');
                  setCategoryFilter('');
                  setTypeFilter('all');
                  setSortMode('newest');
                  setLocalOnly(false);
                  setAvailableToday(false);
                  setPopularOnly(false);
                }}>
                <Text style={styles.clearButtonText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {recommendedPreset ? (
          <View style={styles.recommendationRow}>
            <Text style={styles.recommendationLabel}>Based on your activity</Text>
            <Pressable
              style={[
                styles.recommendationChip,
                recommendedPresetActive && styles.recommendationChipActive,
              ]}
              onPress={() => {
                setTypeFilter(recommendedPreset.type);
                setCategoryFilter('');
                setLocalOnly(recommendedPreset.localOnly);
                setSortMode('newest');
                setSearchQuery('');
                setAvailableToday(false);
                setPopularOnly(false);
              }}>
              <Text
                style={[
                  styles.recommendationChipText,
                  recommendedPresetActive && styles.recommendationChipTextActive,
                ]}>
                {recommendedPreset.label}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search listings, services, or location"
          placeholderTextColor="#8d8376"
        />
        {suggestedSearches.length > 0 ? (
          <View style={styles.searchSuggestionRow}>
            {suggestedSearches.map((suggestion) => (
              <FilterChip
                key={suggestion}
                label={suggestion}
                active={searchQuery.trim().toLowerCase() === suggestion.toLowerCase()}
                onPress={() => setSearchQuery(suggestion)}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.filterRow}>
          <FilterChip
            label="All categories"
            active={!categoryFilter}
            onPress={() => setCategoryFilter('')}
          />
          {categoryOptions.map((option) => (
            <FilterChip
              key={option.label}
              label={`${option.label} (${option.count})`}
              active={categoryFilter === option.label}
              onPress={() => setCategoryFilter(option.label)}
            />
          ))}
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            active={typeFilter === 'all'}
            onPress={() => setTypeFilter('all')}
          />
          <FilterChip
            label="Products"
            active={typeFilter === 'product'}
            onPress={() => setTypeFilter('product')}
          />
          <FilterChip
            label="Services"
            active={typeFilter === 'service'}
            onPress={() => setTypeFilter('service')}
          />
          <FilterChip
            label="Hybrid"
            active={typeFilter === 'hybrid'}
            onPress={() => setTypeFilter('hybrid')}
          />
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="Local Only"
            active={localOnly}
            onPress={() => setLocalOnly((current) => !current)}
          />
          <FilterChip
            label="Newest"
            active={sortMode === 'newest'}
            onPress={() => setSortMode('newest')}
          />
          <FilterChip
            label="Lowest Price"
            active={sortMode === 'price-low'}
            onPress={() => setSortMode('price-low')}
          />
          <FilterChip
            label="Highest Price"
            active={sortMode === 'price-high'}
            onPress={() => setSortMode('price-high')}
          />
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="Available today"
            active={availableToday}
            onPress={() => setAvailableToday((current) => !current)}
          />
          <FilterChip
            label="Popular near you"
            active={popularOnly}
            onPress={() => setPopularOnly((current) => !current)}
          />
        </View>
      </View>

      <View style={styles.summaryPanel}>
        <View style={styles.summaryHeader}>
          {dominantLocation ? (
            <Pressable
              style={[styles.summaryChip, localOnly && styles.summaryChipActive]}
              onPress={() => setLocalOnly((current) => !current)}>
              <Text style={[styles.summaryChipText, localOnly && styles.summaryChipTextActive]}>
                {dominantLocation}
              </Text>
            </Pressable>
          ) : null}
          <Text style={styles.summaryText}>
            {summaryText} · {filteredListings.length}{' '}
            result{filteredListings.length === 1 ? '' : 's'}
          </Text>
        </View>
        {localOnly ? <Text style={styles.summarySubtext}>Local only listings enabled</Text> : null}
        {searchQuery.trim().length > 0 ? (
          <Text style={styles.summarySubtext}>Search: “{searchQuery.trim()}”</Text>
        ) : null}
      </View>

      {canResumeBrowsing ? (
        <View style={styles.resumePanel}>
          <View style={styles.resumePanelHeader}>
            <View>
              <Text style={styles.resumeEyebrow}>Saved Browse Slice</Text>
              <Text style={styles.resumeTitle}>Resume where you left off.</Text>
            </View>
            <Pressable
              style={styles.resumeButton}
              onPress={handleResumeBrowse}>
              <Text style={styles.resumeButtonText}>Resume browsing</Text>
            </Pressable>
          </View>
          {resumeBrowseSummary ? <Text style={styles.resumeSummary}>{resumeBrowseSummary}</Text> : null}
          <Pressable
            style={styles.resumeClearButton}
            onPress={async () => {
              setResumeBrowseFiltersState(null);
              await clearBuyerBrowseResumeFilters();
            }}>
            <Text style={styles.resumeClearButtonText}>Clear saved browse</Text>
          </Pressable>
        </View>
      ) : null}

      {recentlyViewedListings.length > 0 ? (
        <View style={styles.recentPanel}>
          <View style={styles.recentHeader}>
            <View>
              <Text style={styles.recentEyebrow}>Recently Viewed</Text>
              <Text style={styles.recentTitle}>Jump back into listings you opened.</Text>
            </View>
            <Pressable
              style={styles.recentClearButton}
              onPress={async () => {
                setRecentListingIds([]);
                await setBuyerRecentListings(JSON.stringify([]));
              }}>
              <Text style={styles.recentClearButtonText}>Clear History</Text>
            </Pressable>
          </View>
          <View style={styles.recentList}>
            {recentlyViewedListings.map((listing) => (
              <Pressable
                key={listing.id}
                style={styles.recentCard}
                onPress={() =>
                  router.push({
                    pathname: '/listings/[id]',
                    params: { id: listing.id },
                  })
                }>
                <View style={styles.recentCardTop}>
                  <Text style={styles.recentCardType}>{listing.type}</Text>
                  {listing.available_today ? (
                    <Text style={styles.recentCardBadge}>Available today</Text>
                  ) : null}
                </View>
                <Text style={styles.recentCardTitle} numberOfLines={2}>
                  {listing.title}
                </Text>
                <Text style={styles.recentCardMeta} numberOfLines={2}>
                  {formatLocation(listing) || 'Location pending'} · {getSuggestionSecondarySignal(listing)}
                </Text>
                <Text style={styles.recentCardPrice}>
                  {formatCurrency(listing.price_cents, listing.currency)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {recentTransactionReceipts.length > 0 ? (
        <View style={styles.recentPanel}>
          <View style={styles.recentHeader}>
            <View>
              <Text style={styles.recentEyebrow}>Recently Opened Receipts</Text>
              <Text style={styles.recentTitle}>Jump back into orders and bookings you inspected.</Text>
            </View>
            <Pressable
              style={styles.recentClearButton}
              onPress={async () => {
                setRecentTransactionReceiptIds([]);
                await setBuyerRecentTransactionReceipts(JSON.stringify([]));
              }}>
              <Text style={styles.recentClearButtonText}>Clear saved receipt history</Text>
            </Pressable>
          </View>
          <View style={styles.recentList}>
            {recentTransactionReceipts.map((receipt) => (
              <Pressable
                key={`${receipt.kind}:${receipt.id}`}
                style={styles.recentCard}
                onPress={() =>
                  router.push({
                    pathname: '/transactions/[kind]/[id]',
                    params: { kind: receipt.kind, id: receipt.id },
                  })
                }>
                <Text style={styles.recentCardType}>
                  {receipt.label} · {receipt.meta}
                </Text>
                <Text style={styles.recentCardMeta}>
                  {receipt.kind} · {receipt.id}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.cardList}>
        {filteredListings.map((listing) => (
          (() => {
            const signals = getListingSignals(listing);
            const primaryImageUrl = getPrimaryImageUrl(listing);
            const recommendationBadge = getRecommendationBadge(listing, recommendedPreset);
            const locationLabel = getLocationLabel([listing.city, listing.state]);
            const isPopularNearYou =
              baseLocationLabel &&
              locationLabel === baseLocationLabel &&
              (listing.recent_transaction_count ?? 0) >= 3;
            const searchScore = getListingSearchScore(listing, normalizedSearchQuery);
            const isBestMatch =
              normalizedSearchQuery.length > 0 &&
              filteredListings[0]?.id === listing.id &&
              searchScore > 0;
            return (
            <Pressable
              key={listing.id}
              onPress={() =>
                router.push({
                  pathname: '/listings/[id]',
                  params: { id: listing.id },
                })
              }
              style={styles.card}>
              {primaryImageUrl ? (
                <Image source={{ uri: primaryImageUrl }} style={styles.cardImage} />
              ) : (
                <View style={styles.cardImagePlaceholder}>
                  <Text style={styles.cardImagePlaceholderText}>{listing.type}</Text>
                </View>
              )}
              <View style={styles.cardTop}>
                <Text style={[styles.typePill, { color: getListingTypeColor(listing.type) }]}>{listing.type}</Text>
                {listing.category ? (
                  <Text style={styles.categoryPill}>{listing.category}</Text>
                ) : null}
                <Text style={styles.locationText}>{formatLocation(listing) || 'Location pending'}</Text>
              </View>
              <View style={styles.badgeRow}>
                {recommendationBadge ? (
                  <View
                    style={[
                      styles.scanBadge,
                      styles.recommendationCardBadge,
                      recommendationBadge.tone === 'local'
                        ? styles.recommendationCardBadgeLocal
                        : recommendationBadge.tone === 'service'
                          ? styles.recommendationCardBadgeService
                          : recommendationBadge.tone === 'hybrid'
                            ? styles.recommendationCardBadgeHybrid
                            : styles.recommendationCardBadgeProduct,
                    ]}>
                    <Text style={styles.recommendationCardBadgeText}>
                      {recommendationBadge.text}
                    </Text>
                  </View>
                ) : null}
                {isBestMatch ? (
                  <View style={[styles.scanBadge, styles.bestMatchBadge]}>
                    <Text style={[styles.scanBadgeText, styles.bestMatchBadgeText]}>Best match</Text>
                  </View>
                ) : null}
                <View style={[styles.scanBadge, styles.bookingBadge]}>
                  <Text style={[styles.scanBadgeText, styles.bookingBadgeText]}>{signals.booking}</Text>
                </View>
                {listing.available_today ? (
                  <View style={[styles.scanBadge, styles.availableBadge]}>
                    <Text style={[styles.scanBadgeText, styles.availableBadgeText]}>Available today</Text>
                  </View>
                ) : null}
                {isPopularNearYou ? (
                  <View style={[styles.scanBadge, styles.popularBadge]}>
                    <Text style={[styles.scanBadgeText, styles.popularBadgeText]}>Popular near you</Text>
                  </View>
                ) : null}
                {listing.is_local_only ? (
                  <View style={[styles.scanBadge, styles.localBadge]}>
                    <Text style={[styles.scanBadgeText, styles.localBadgeText]}>Local Only</Text>
                  </View>
                ) : null}
                {listing.is_new_listing ? (
                  <View style={[styles.scanBadge, styles.newListingBadge]}>
                    <Text style={[styles.scanBadgeText, styles.newListingBadgeText]}>New listing</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardTitle}>{listing.title}</Text>
              <Text numberOfLines={3} style={styles.cardDescription}>
                {listing.description}
              </Text>
              <View style={styles.signalRow}>
                <Text style={styles.signalText}>{signals.booking}</Text>
                <Text style={styles.signalText}>{signals.fulfillment}</Text>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.priceText}>
                  {formatCurrency(listing.price_cents, listing.currency)}
                </Text>
                <Text style={styles.tapHint}>Open</Text>
              </View>
            </Pressable>
            );
          })()
        ))}
        {filteredListings.length === 0 ? (
          <Text style={styles.emptyText}>
            No listings match this search yet. Try a broader query or switch the type filter.
          </Text>
        ) : null}
      </View>

      {hasMoreListings ? (
        <Pressable
          style={[styles.loadMoreButton, loadingMoreListings && styles.loadMoreButtonDisabled]}
          onPress={() => void loadMoreListings()}
          disabled={loadingMoreListings}>
          <Text style={styles.loadMoreButtonText}>
            {loadingMoreListings ? 'Loading more listings...' : 'Load more listings'}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#efe4cf',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 18,
  },
  hero: {
    backgroundColor: '#1f351f',
    borderRadius: 28,
    padding: 22,
    gap: 10,
  },
  eyebrow: {
    color: '#f6d999',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff6e8',
    fontSize: 31,
    fontWeight: '700',
    lineHeight: 36,
  },
  subtitle: {
    color: '#d7d3c8',
    fontSize: 15,
    lineHeight: 23,
  },
  errorCard: {
    backgroundColor: '#fff0ef',
    borderColor: '#efb4ae',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  errorText: {
    color: '#9a3428',
    fontSize: 14,
    lineHeight: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionTitle: {
    color: '#1f2319',
    fontSize: 24,
    fontWeight: '700',
  },
  sectionMeta: {
    color: '#6f6556',
    fontSize: 13,
    fontWeight: '600',
  },
  filterPanel: {
    backgroundColor: '#fff8ee',
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  filterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  filterHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  recommendationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recommendationLabel: {
    color: '#6f6556',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recommendationChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ccb68c',
    backgroundColor: '#fbf4e4',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recommendationChipActive: {
    borderColor: '#1f351f',
    backgroundColor: '#1f351f',
  },
  recommendationChipText: {
    color: '#7c5a1f',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recommendationChipTextActive: {
    color: '#fff8ee',
  },
  filterTitle: {
    color: '#1f2319',
    fontSize: 15,
    fontWeight: '700',
  },
  clearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearButtonText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  savedSliceCueButton: {
    borderRadius: 999,
    backgroundColor: '#eef3e4',
    borderWidth: 1,
    borderColor: '#c7d7ab',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  savedSliceCueButtonText: {
    color: '#496022',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  searchInput: {
    backgroundColor: '#f4eadb',
    borderRadius: 16,
    color: '#1f2319',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  searchSuggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: '#1f351f',
    borderColor: '#1f351f',
  },
  filterChipText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  filterChipTextActive: {
    color: '#fff8ee',
  },
  summaryPanel: {
    backgroundColor: '#f4eadb',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  summaryHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  summaryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff8ee',
  },
  summaryChipActive: {
    backgroundColor: '#1f351f',
    borderColor: '#1f351f',
  },
  summaryChipText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  summaryChipTextActive: {
    color: '#fff8ee',
  },
  summaryText: {
    color: '#1f2319',
    fontSize: 13,
    fontWeight: '700',
  },
  summarySubtext: {
    color: '#6f6556',
    fontSize: 12,
  },
  resumePanel: {
    backgroundColor: '#f7f0e2',
    borderRadius: 22,
    padding: 16,
    gap: 8,
  },
  resumePanelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  resumeEyebrow: {
    color: '#6f6556',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  resumeTitle: {
    color: '#1f2319',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  resumeButton: {
    borderRadius: 999,
    backgroundColor: '#1f351f',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resumeButtonText: {
    color: '#fff8ee',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  resumeSummary: {
    color: '#6f6556',
    fontSize: 12,
    lineHeight: 18,
  },
  resumeClearButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resumeClearButtonText: {
    color: '#4d4338',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recentPanel: {
    backgroundColor: '#f7f0e2',
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  recentEyebrow: {
    color: '#6f6556',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  recentTitle: {
    color: '#1f2319',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  recentClearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentClearButtonText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recentList: {
    gap: 10,
  },
  recentCard: {
    backgroundColor: '#fff8ee',
    borderRadius: 18,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e1d1b5',
  },
  recentCardTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  recentCardType: {
    color: '#7c3a10',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recentCardBadge: {
    color: '#0f6a4a',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recentCardTitle: {
    color: '#1f2319',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  recentCardMeta: {
    color: '#6f6556',
    fontSize: 12,
    lineHeight: 18,
  },
  recentCardPrice: {
    color: '#7c3a10',
    fontSize: 15,
    fontWeight: '700',
  },
  cardList: {
    gap: 14,
  },
  cardImage: {
    width: '100%',
    height: 184,
    borderRadius: 18,
    backgroundColor: '#e8dcc9',
  },
  cardImagePlaceholder: {
    width: '100%',
    height: 184,
    borderRadius: 18,
    backgroundColor: '#d9c7a8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePlaceholderText: {
    color: '#4d4338',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#fff8ee',
    borderRadius: 24,
    padding: 18,
    gap: 12,
    shadowColor: '#6d5831',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  cardTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scanBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recommendationCardBadge: {
    borderWidth: 1,
  },
  recommendationCardBadgeLocal: {
    backgroundColor: '#edf8f2',
    borderColor: '#9bc9b1',
  },
  recommendationCardBadgeService: {
    backgroundColor: '#ecf7f8',
    borderColor: '#98cfd2',
  },
  recommendationCardBadgeProduct: {
    backgroundColor: '#fff1df',
    borderColor: '#e5bb84',
  },
  recommendationCardBadgeHybrid: {
    backgroundColor: '#f6ecdb',
    borderColor: '#d8b77a',
  },
  bookingBadge: {
    backgroundColor: '#e4f1ed',
  },
  bestMatchBadge: {
    backgroundColor: '#f3ecff',
  },
  availableBadge: {
    backgroundColor: '#e8f7ed',
  },
  popularBadge: {
    backgroundColor: '#e7f3ff',
  },
  newListingBadge: {
    backgroundColor: '#fff5e6',
  },
  localBadge: {
    backgroundColor: '#f3e1bd',
  },
  scanBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  recommendationCardBadgeText: {
    color: '#3f3428',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  bookingBadgeText: {
    color: '#0f5f62',
  },
  bestMatchBadgeText: {
    color: '#6b37a8',
  },
  localBadgeText: {
    color: '#7c3a10',
  },
  availableBadgeText: {
    color: '#0f6a4a',
  },
  popularBadgeText: {
    color: '#0f4a87',
  },
  newListingBadgeText: {
    color: '#7c4310',
  },
  typePill: {
    backgroundColor: '#f3e1bd',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  categoryPill: {
    backgroundColor: '#f7ecd7',
    borderColor: '#d8b77a',
    borderRadius: 999,
    borderWidth: 1,
    color: '#7a5717',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  locationText: {
    color: '#6f6556',
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'right',
  },
  cardTitle: {
    color: '#1f2319',
    fontSize: 23,
    fontWeight: '700',
  },
  cardDescription: {
    color: '#5f5548',
    fontSize: 14,
    lineHeight: 22,
  },
  signalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  signalText: {
    color: '#6f6556',
    fontSize: 12,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceText: {
    color: '#7c3a10',
    fontSize: 18,
    fontWeight: '700',
  },
  tapHint: {
    color: '#1f351f',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    color: '#5f5548',
    fontSize: 14,
    lineHeight: 21,
  },
  loadMoreButton: {
    alignItems: 'center',
    backgroundColor: '#1f351f',
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  loadMoreButtonDisabled: {
    opacity: 0.7,
  },
  loadMoreButtonText: {
    color: '#fff6e8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
