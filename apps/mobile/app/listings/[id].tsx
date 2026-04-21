import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  fetchApi,
  formatBuyerActionError,
  formatCurrency,
  formatLocation,
  type PlatformFeeRateRead,
} from '@/lib/api';
import { getBuyerRecentListings, setBuyerBrowseFilters, setBuyerRecentListings } from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

function getFulfillmentOptions(listing: {
  pickup_enabled?: boolean;
  meetup_enabled?: boolean;
  delivery_enabled?: boolean;
  shipping_enabled?: boolean;
}) {
  return [
    listing.pickup_enabled ? { label: 'Pickup', value: 'pickup' } : null,
    listing.meetup_enabled ? { label: 'Meetup', value: 'meetup' } : null,
    listing.delivery_enabled ? { label: 'Delivery', value: 'delivery' } : null,
    listing.shipping_enabled ? { label: 'Shipping', value: 'shipping' } : null,
  ].filter(Boolean) as { label: string; value: string }[];
}

function computeBookingWindow(listing: {
  lead_time_hours?: number | null;
  duration_minutes?: number | null;
}, dayOffset: number) {
  const start = new Date();
  const leadTimeHours = listing.lead_time_hours ?? 24;
  start.setHours(start.getHours() + leadTimeHours + dayOffset * 24);
  start.setMinutes(0, 0, 0);

  const durationMinutes = listing.duration_minutes ?? 90;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  return { start, end, durationMinutes, leadTimeHours };
}

function getPrimaryImageUrl(listing: { images?: { image_url: string }[] | null }) {
  return listing.images?.[0]?.image_url ?? null;
}

function getSuggestionSecondarySignal(listing: {
  duration_minutes?: number | null;
  price_cents?: number | null;
  currency?: string | null;
}) {
  if (listing.duration_minutes) {
    return `${listing.duration_minutes} min`;
  }

  if (typeof listing.price_cents === 'number' && typeof listing.currency === 'string') {
    return formatCurrency(listing.price_cents, listing.currency);
  }

  return 'Price unavailable';
}

function getSuggestionActionMode(listing: {
  requires_booking?: boolean | null;
  type: string;
}) {
  return listing.requires_booking || listing.type === 'service' ? 'Booking ready' : 'Order ready';
}

function getSuggestionSellerLabel(listing: { seller_id: string }, currentSellerId: string) {
  return listing.seller_id === currentSellerId ? 'Same seller' : 'Another seller';
}

function getSuggestionSellerPriority(listing: { seller_id: string }, currentSellerId: string) {
  return listing.seller_id === currentSellerId ? 1 : 0;
}

function normalizeFollowOnContext(
  value: string | string[] | undefined,
): 'same-seller' | 'cross-seller' | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === 'same-seller' || normalized === 'cross-seller') {
    return normalized;
  }

  return null;
}

function buildMobileBrowseContext(input: {
  preset: { label: 'Local-First' | 'Services' | 'Hybrid' | 'Products' } | null;
  followOn: 'same-seller' | 'cross-seller' | null;
}) {
  const parts: string[] = ['Mobile browse'];

  if (input.preset?.label === 'Local-First') {
    parts.push('Local Only');
  } else if (input.preset?.label) {
    parts.push(input.preset.label);
  }

  if (input.followOn === 'same-seller') {
    parts.push('Same seller follow-on');
  }

  if (input.followOn === 'cross-seller') {
    parts.push('Cross-seller follow-on');
  }

  return parts.join(' · ');
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
          (itemListing) => itemListing.id === item.listing_id && itemListing.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) =>
      input.listings.some(
        (itemListing) => itemListing.id === booking.listing_id && itemListing.is_local_only,
      ),
    ).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (itemListing) => itemListing.id === item.listing_id && itemListing.type === 'hybrid',
        ),
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) => booking.listing_type === 'hybrid').length;

  if (localScore >= Math.max(productScore, serviceScore, hybridScore) && localScore > 0) {
    return { label: 'Local-First' as const };
  }

  if (serviceScore >= Math.max(productScore, hybridScore) && serviceScore > 0) {
    return { label: 'Services' as const };
  }

  if (hybridScore >= Math.max(productScore, serviceScore) && hybridScore > 0) {
    return { label: 'Hybrid' as const };
  }

  if (productScore > 0) {
    return { label: 'Products' as const };
  }

  return null;
}

function getRecommendationReason(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: 'Local-First' | 'Services' | 'Hybrid' | 'Products' } | null,
) {
  if (!preset) {
    return null;
  }

  if (preset.label === 'Local-First' && listing.is_local_only) {
    return 'You have been engaging more with local-first listings, and this one is configured for local demand.';
  }

  if (
    preset.label === 'Services' &&
    (listing.type === 'service' || listing.type === 'hybrid')
  ) {
    return 'Your recent buyer activity leans toward service-based offers, so this listing matches that pattern.';
  }

  if (preset.label === 'Products' && (listing.type === 'product' || listing.type === 'hybrid')) {
    return 'Your recent buyer activity leans toward product purchases, so this listing matches that pattern.';
  }

  if (preset.label === 'Hybrid' && listing.type === 'hybrid') {
    return 'You have been interacting with hybrid listings, and this offer fits that mixed product-plus-service pattern.';
  }

  return null;
}

function getListingComparisonScopeBadge(scope: string | null | undefined) {
  if (!scope) {
    return null;
  }

  if (scope === 'Category + local') {
    return {
      label: scope,
      badgeStyle: { borderColor: '#9bc9b1', backgroundColor: '#e4f1ed' },
      textStyle: { color: '#0f5f62' },
    };
  }

  if (scope === 'Category') {
    return {
      label: scope,
      badgeStyle: { borderColor: '#c7e0ff', backgroundColor: '#ecf7ff' },
      textStyle: { color: '#0f4a87' },
    };
  }

  if (scope === 'Type + local') {
    return {
      label: scope,
      badgeStyle: { borderColor: '#f1c58d', backgroundColor: '#fff4e7' },
      textStyle: { color: '#8a4a0f' },
    };
  }

  if (scope === 'Type') {
    return {
      label: scope,
      badgeStyle: { borderColor: '#d4cfcd', backgroundColor: '#f4f1eb' },
      textStyle: { color: '#4e4a41' },
    };
  }

  return {
    label: scope,
    badgeStyle: { borderColor: '#f5b3c0', backgroundColor: '#ffeef0' },
    textStyle: { color: '#a01622' },
  };
}

function getRecommendationScore(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: 'Local-First' | 'Services' | 'Hybrid' | 'Products' } | null,
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

function getRecommendationMatch(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: 'Local-First' | 'Services' | 'Hybrid' | 'Products' } | null,
) {
  const score = getRecommendationScore(listing, preset);
  if (score === 0 || !preset) {
    return null;
  }

  if (preset.label === 'Local-First') {
    return { score, label: 'Local match' };
  }

  if (preset.label === 'Services') {
    return { score, label: 'Service fit' };
  }

  if (preset.label === 'Products') {
    return { score, label: 'Product fit' };
  }

  return { score, label: 'Hybrid fit' };
}

export default function ListingDetailScreen() {
  const router = useRouter();
  const { id, followOn } = useLocalSearchParams<{ id: string; followOn?: string }>();
  const { listings, orders, bookings, createOrder, createBooking, session } = useBuyerSession();
  const [quantity, setQuantity] = useState('2');
  const [notes, setNotes] = useState('Buyer flow test from mobile.');
  const [selectedFulfillment, setSelectedFulfillment] = useState<string>('');
  const [bookingDayOffset, setBookingDayOffset] = useState('1');
  const [platformFee, setPlatformFee] = useState<PlatformFeeRateRead | null>(null);
  const [platformFeeLoading, setPlatformFeeLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentListingIds, setRecentListingIds] = useState<string[]>([]);
  const listing = useMemo(() => listings.find((item) => item.id === id), [id, listings]);
  const fulfillmentOptions = useMemo(
    () => (listing ? getFulfillmentOptions(listing) : []),
    [listing],
  );
  const canOrder = Boolean(listing && listing.type !== 'service');
  const canBook = Boolean(listing && (listing.requires_booking || listing.type !== 'product'));
  const primaryAction = canBook && !canOrder ? 'booking' : 'order';
  const primaryImageUrl = useMemo(() => (listing ? getPrimaryImageUrl(listing) : null), [listing]);
  const recommendationReason = useMemo(() => {
    if (!listing) {
      return null;
    }

    const preset = getRecommendedBrowsePreset({ listings, orders, bookings });
    return getRecommendationReason(listing, preset);
  }, [bookings, listing, listings, orders]);
  const recommendedPreset = useMemo(
    () => getRecommendedBrowsePreset({ listings, orders, bookings }),
    [bookings, listings, orders],
  );
  const followOnContext = useMemo(() => normalizeFollowOnContext(followOn), [followOn]);
  const buyerBrowseContext = useMemo(
    () => buildMobileBrowseContext({ preset: recommendedPreset, followOn: followOnContext }),
    [followOnContext, recommendedPreset],
  );
  const moreLikeThisListings = useMemo(() => {
    if (!listing) {
      return [];
    }

    return listings
      .filter((item) => item.id !== listing.id)
      .map((item) => ({
        listing: item,
        match: getRecommendationMatch(item, recommendedPreset),
      }))
      .filter((item): item is { listing: (typeof listings)[number]; match: { score: number; label: string } } =>
        Boolean(item.match),
      )
      .sort((left, right) => {
        const rightSellerPriority = getSuggestionSellerPriority(right.listing, listing.seller_id);
        const leftSellerPriority = getSuggestionSellerPriority(left.listing, listing.seller_id);
        if (rightSellerPriority !== leftSellerPriority) {
          return rightSellerPriority - leftSellerPriority;
        }

        if (right.match.score !== left.match.score) {
          return right.match.score - left.match.score;
        }

        return new Date(right.listing.created_at).getTime() - new Date(left.listing.created_at).getTime();
      })
      .slice(0, 3)
      .map((item) => ({ ...item.listing, recommendationLabel: item.match.label }));
  }, [listing, listings, recommendedPreset]);
  const sameSellerSuggestions = useMemo(
    () => moreLikeThisListings.filter((item) => item.seller_id === listing?.seller_id),
    [listing?.seller_id, moreLikeThisListings],
  );
  const otherSellerSuggestions = useMemo(
    () => moreLikeThisListings.filter((item) => item.seller_id !== listing?.seller_id),
    [listing?.seller_id, moreLikeThisListings],
  );
  const bookingWindow = useMemo(() => {
    if (!listing) {
      return null;
    }

    const parsedOffset = Number(bookingDayOffset);
    return computeBookingWindow(listing, Number.isFinite(parsedOffset) ? parsedOffset : 1);
  }, [bookingDayOffset, listing]);
  const recentViewedListings = useMemo(
    () =>
      recentListingIds
        .map((listingId) => listings.find((item) => item.id === listingId) ?? null)
        .filter((item): item is (typeof listings)[number] => Boolean(item))
        .filter((item) => item.id !== listing?.id)
        .slice(0, 3),
    [listing?.id, listings, recentListingIds],
  );
  const latestRecentViewedListing = recentViewedListings[0] ?? null;
  const hasRecentListingHistory = recentViewedListings.length > 0;

  useEffect(() => {
    if (fulfillmentOptions.length > 0) {
      setSelectedFulfillment((current) =>
        current && fulfillmentOptions.some((option) => option.value === current)
          ? current
          : fulfillmentOptions[0].value,
      );
    } else {
      setSelectedFulfillment('');
    }
  }, [fulfillmentOptions]);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await getBuyerRecentListings();
        const parsed = stored ? (JSON.parse(stored) as string[]) : [];
        if (Array.isArray(parsed)) {
          setRecentListingIds(parsed.filter((item) => typeof item === 'string'));
        }
      } catch {
        // Ignore corrupted recent-listing state.
      }
    })();
  }, []);

  useEffect(() => {
    if (!listing) {
      return;
    }

    void (async () => {
      try {
        setRecentListingIds((current) => {
          const nextIds = [listing.id, ...current.filter((item) => item !== listing.id)].slice(0, 4);
          const isSame = nextIds.length === current.length && nextIds.every((item, index) => item === current[index]);
          if (isSame) {
            return current;
          }

          void setBuyerRecentListings(JSON.stringify(nextIds));
          return nextIds;
        });
      } catch {
        // Ignore corrupted recent-listing state.
      }
    })();
  }, [listing]);

  function clearRecentListingHistory() {
    void setBuyerRecentListings(JSON.stringify([]));
    setRecentListingIds([]);
  }

  function openRecentListing(listingId: string) {
    router.push({ pathname: '/listings/[id]', params: { id: listingId } });
  }

  useEffect(() => {
    let cancelled = false;
    setPlatformFeeLoading(true);

    fetchApi<PlatformFeeRateRead>('/platform-fees')
      .then((fee) => {
        if (!cancelled) {
          setPlatformFee(fee);
          setPlatformFeeLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlatformFee(null);
          setPlatformFeeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!listing) {
    return (
      <View style={styles.missingState}>
        <Text style={styles.missingTitle}>Listing not loaded</Text>
        <Text style={styles.missingText}>
          Go back to Browse and refresh listings before opening this screen.
        </Text>
      </View>
    );
  }

  const transactionCount = listing.recent_transaction_count ?? 0;
  const isPopularNearYou = transactionCount >= 3;
  const comparisonScopeBadge = getListingComparisonScopeBadge(
    listing.last_pricing_comparison_scope,
  );
  const tractionValue = transactionCount > 0
    ? `${transactionCount} recent requests${isPopularNearYou ? ' · Popular near you' : ''}`
    : listing.is_new_listing
      ? 'New entry · waiting on the first buyers'
      : 'Activity warming up';
  const platformFeeRateNumber = platformFee ? Number(platformFee.rate) : 0;
  const platformFeePercentLabel = platformFeeLoading
    ? 'Loading…'
    : platformFee
      ? `${(platformFeeRateNumber * 100).toFixed(2).replace(/\.00$/, '')}%`
      : 'Unavailable';
  const platformFeeAmountLabel =
    platformFee && platformFeeRateNumber > 0
      ? formatCurrency(
          Math.round((listing.price_cents ?? 0) * platformFeeRateNumber),
          listing.currency ?? 'USD',
        )
      : null;
  const platformFeeDetail = platformFeeLoading
    ? 'Connecting to the current rate'
    : platformFee
      ? `${platformFeeAmountLabel ?? 'Fee added at checkout'} · ${platformFee.name}`
      : 'Platform fee info unavailable';

  async function handleOrder() {
    setError(null);
    setMessage(null);

    try {
      const order = await createOrder({
        sellerId: listing!.seller_id,
        listingId: listing!.id,
        quantity: Number(quantity),
        fulfillment: selectedFulfillment,
        notes,
        buyerBrowseContext,
      });
      router.push({ pathname: '/transactions/[kind]/[id]', params: { kind: 'order', id: order.id } });
    } catch (err) {
      setError(formatBuyerActionError(err));
    }
  }

  async function handleBooking() {
    setError(null);
    setMessage(null);

    try {
      if (!bookingWindow) {
        throw new Error('Booking timing is not available for this listing.');
      }

      const booking = await createBooking({
        sellerId: listing!.seller_id,
        listingId: listing!.id,
        scheduledStart: bookingWindow.start.toISOString(),
        scheduledEnd: bookingWindow.end.toISOString(),
        notes,
        buyerBrowseContext,
      });
      router.push({ pathname: '/transactions/[kind]/[id]', params: { kind: 'booking', id: booking.id } });
    } catch (err) {
      setError(formatBuyerActionError(err));
    }
  }

  function handleKeepBrowsingLane() {
    if (!recommendedPreset) {
      return;
    }

    void setBuyerBrowseFilters(
      JSON.stringify({
        searchQuery: '',
        typeFilter: recommendedPreset.label === 'Services'
          ? 'service'
          : recommendedPreset.label === 'Products'
            ? 'product'
            : recommendedPreset.label === 'Hybrid'
              ? 'hybrid'
              : 'all',
        sortMode: 'newest',
        localOnly: recommendedPreset.label === 'Local-First',
      }),
    );

    router.push('/');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        {primaryImageUrl ? (
          <Image source={{ uri: primaryImageUrl }} style={styles.heroImage} />
        ) : (
          <View style={styles.heroImagePlaceholder}>
            <Text style={styles.heroImagePlaceholderText}>{listing.type}</Text>
          </View>
        )}
        <Text style={styles.typePill}>{listing.type}</Text>
        <Text style={styles.title}>{listing.title}</Text>
        <Text style={styles.location}>{formatLocation(listing) || 'Location pending'}</Text>
        <Text style={styles.description}>{listing.description}</Text>
        <Text style={styles.price}>{formatCurrency(listing.price_cents, listing.currency)}</Text>
        <View style={styles.platformFeeRow}>
          <Text style={styles.platformFeeLabel}>Platform fee</Text>
          <Text style={styles.platformFeeValue}>{platformFeePercentLabel}</Text>
        </View>
        <Text style={styles.platformFeeDetail}>{platformFeeDetail}</Text>
        {hasRecentListingHistory ? (
          <View style={styles.recentSummaryRow}>
            <Text style={styles.recentSummaryLabel}>Saved listing history available</Text>
            <Text style={styles.recentSummaryText}>
              {latestRecentViewedListing
                ? `Open latest listing · ${latestRecentViewedListing.title}`
                : `${recentViewedListings.length} recent listings saved`}
            </Text>
          </View>
        ) : null}
        <View style={styles.heroBadgeRow}>
          <View style={[styles.heroBadge, styles.heroBadgeBooking]}>
            <Text style={[styles.heroBadgeText, styles.heroBadgeBookingText]}>
              {canBook ? 'Booking Ready' : 'Order Flow'}
            </Text>
          </View>
          {listing.is_local_only ? (
            <View style={[styles.heroBadge, styles.heroBadgeLocal]}>
              <Text style={[styles.heroBadgeText, styles.heroBadgeLocalText]}>Local Only</Text>
            </View>
          ) : null}
          {listing.available_today ? (
            <View style={[styles.heroBadge, styles.heroBadgeAvailable]}>
              <Text style={[styles.heroBadgeText, styles.heroBadgeAvailableText]}>Available today</Text>
            </View>
          ) : null}
          {isPopularNearYou ? (
            <View style={[styles.heroBadge, styles.heroBadgePopular]}>
              <Text style={[styles.heroBadgeText, styles.heroBadgePopularText]}>Popular near you</Text>
            </View>
          ) : null}
          <View style={[styles.heroBadge, styles.heroBadgeStatus]}>
            <Text style={[styles.heroBadgeText, styles.heroBadgeStatusText]}> 
              {listing.status.replaceAll('_', ' ')}
            </Text>
          </View>
          {listing.is_new_listing ? (
            <View style={[styles.heroBadge, styles.heroBadgeNew]}>
              <Text style={[styles.heroBadgeText, styles.heroBadgeNewText]}>New listing</Text>
            </View>
          ) : null}
        {listing.is_promoted ? (
            <View style={[styles.heroBadge, styles.heroBadgePromoted]}>
              <Text style={[styles.heroBadgeText, styles.heroBadgePromotedText]}>Promoted</Text>
            </View>
          ) : null}
          {comparisonScopeBadge ? (
            <View style={[styles.heroBadge, comparisonScopeBadge.badgeStyle]}>
              <Text style={[styles.heroBadgeText, comparisonScopeBadge.textStyle]}>
                {comparisonScopeBadge.label}
              </Text>
            </View>
          ) : null}
        </View>
        {latestRecentViewedListing ? (
          <View style={styles.recentRail}>
            <View style={styles.recentRailHeader}>
              <View>
                <Text style={styles.recentRailLabel}>Recently Viewed</Text>
                <Text style={styles.recentRailText}>
                  Jump back into the latest listing you opened in this app.
                </Text>
              </View>
              <Pressable style={styles.recentClearButton} onPress={clearRecentListingHistory}>
                <Text style={styles.recentClearButtonText}>Clear history</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.recentOpenButton}
              onPress={() => openRecentListing(latestRecentViewedListing.id)}
            >
              <Text style={styles.recentOpenButtonText}>
                Open latest listing · {latestRecentViewedListing.title}
              </Text>
              <Text style={styles.recentOpenButtonSubtext}>
                {formatLocation(latestRecentViewedListing) || 'Location pending'} ·{' '}
                {getSuggestionSecondarySignal(latestRecentViewedListing)}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.quickGrid}>
        <View style={styles.quickCard}>
          <Text style={styles.quickLabel}>Fulfillment</Text>
          <Text style={styles.quickValue}>
            {fulfillmentOptions.length > 0
              ? fulfillmentOptions.map((option) => option.label).join(', ')
              : 'Pending'}
          </Text>
        </View>
        <View style={styles.quickCard}>
          <Text style={styles.quickLabel}>Booking</Text>
          <Text style={styles.quickValue}>{canBook ? 'Accepts requests' : 'Order only'}</Text>
        </View>
        <View style={styles.quickCard}>
          <Text style={styles.quickLabel}>Service Time</Text>
          <Text style={styles.quickValue}>
            {listing.duration_minutes ? `${listing.duration_minutes} min` : 'Not set'}
          </Text>
        </View>
        <View style={styles.quickCard}>
          <Text style={styles.quickLabel}>Lead Time</Text>
          <Text style={styles.quickValue}>
            {listing.lead_time_hours ? `${listing.lead_time_hours} hr` : 'Immediate'}
          </Text>
        </View>
      </View>

      {recommendationReason ? (
        <View style={styles.recommendationPanel}>
          <Text style={styles.recommendationLabel}>Why recommended</Text>
          <Text style={styles.recommendationText}>{recommendationReason}</Text>
          {recommendedPreset ? (
            <Pressable style={styles.recommendationAction} onPress={handleKeepBrowsingLane}>
              <Text style={styles.recommendationActionText}>Keep Browsing This Lane</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {moreLikeThisListings.length > 0 ? (
        <View style={styles.moreLikeThisPanel}>
          <Text style={styles.moreLikeThisTitle}>More Like This</Text>
          <Text style={styles.moreLikeThisSubtitle}>
            Keep exploring listings that match the same buyer lane.
          </Text>
          {sameSellerSuggestions.length > 0 ? (
            <View style={styles.moreLikeThisGroup}>
              {otherSellerSuggestions.length > 0 ? (
                <Text style={styles.moreLikeThisGroupTitle}>More from this seller</Text>
              ) : null}
              <View style={styles.moreLikeThisRow}>
                {sameSellerSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.moreLikeThisCard}
                    onPress={() =>
                      router.push({
                        pathname: '/listings/[id]',
                        params: {
                          id: item.id,
                          followOn: item.seller_id === listing.seller_id ? 'same-seller' : 'cross-seller',
                        },
                      })
                    }>
                    <View style={styles.moreLikeThisCardRow}>
                      {getPrimaryImageUrl(item) ? (
                        <Image source={{ uri: getPrimaryImageUrl(item)! }} style={styles.moreLikeThisImage} />
                      ) : (
                        <View style={styles.moreLikeThisImagePlaceholder}>
                          <Text style={styles.moreLikeThisImagePlaceholderText}>{item.type}</Text>
                        </View>
                      )}
                      <View style={styles.moreLikeThisCardBody}>
                        <View style={styles.moreLikeThisCardHeader}>
                          <Text style={styles.moreLikeThisCardType}>{item.type}</Text>
                          <Text style={styles.moreLikeThisCardSignal}>
                            {getSuggestionSecondarySignal(item)}
                          </Text>
                        </View>
                        <Text numberOfLines={2} style={styles.moreLikeThisCardTitle}>
                          {item.title}
                        </Text>
                        <Text style={styles.moreLikeThisCardMeta}>
                          {item.is_local_only ? 'Local Only' : formatLocation(item) || 'Open Reach'}
                        </Text>
                        <View style={styles.moreLikeThisBadgeRow}>
                          <Text style={styles.moreLikeThisCardReason}>{item.recommendationLabel}</Text>
                          <Text style={styles.moreLikeThisCardMode}>{getSuggestionActionMode(item)}</Text>
                          <Text style={styles.moreLikeThisCardSeller}>
                            {getSuggestionSellerLabel(item, listing.seller_id)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {otherSellerSuggestions.length > 0 ? (
            <View style={styles.moreLikeThisGroup}>
              {sameSellerSuggestions.length > 0 ? (
                <Text style={styles.moreLikeThisGroupTitle}>Explore similar listings</Text>
              ) : null}
              <View style={styles.moreLikeThisRow}>
                {otherSellerSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.moreLikeThisCard}
                    onPress={() =>
                      router.push({
                        pathname: '/listings/[id]',
                        params: {
                          id: item.id,
                          followOn: item.seller_id === listing.seller_id ? 'same-seller' : 'cross-seller',
                        },
                      })
                    }>
                    <View style={styles.moreLikeThisCardRow}>
                      {getPrimaryImageUrl(item) ? (
                        <Image source={{ uri: getPrimaryImageUrl(item)! }} style={styles.moreLikeThisImage} />
                      ) : (
                        <View style={styles.moreLikeThisImagePlaceholder}>
                          <Text style={styles.moreLikeThisImagePlaceholderText}>{item.type}</Text>
                        </View>
                      )}
                      <View style={styles.moreLikeThisCardBody}>
                        <View style={styles.moreLikeThisCardHeader}>
                          <Text style={styles.moreLikeThisCardType}>{item.type}</Text>
                          <Text style={styles.moreLikeThisCardSignal}>
                            {getSuggestionSecondarySignal(item)}
                          </Text>
                        </View>
                        <Text numberOfLines={2} style={styles.moreLikeThisCardTitle}>
                          {item.title}
                        </Text>
                        <Text style={styles.moreLikeThisCardMeta}>
                          {item.is_local_only ? 'Local Only' : formatLocation(item) || 'Open Reach'}
                        </Text>
                        <View style={styles.moreLikeThisBadgeRow}>
                          <Text style={styles.moreLikeThisCardReason}>{item.recommendationLabel}</Text>
                          <Text style={styles.moreLikeThisCardMode}>{getSuggestionActionMode(item)}</Text>
                          <Text style={styles.moreLikeThisCardSeller}>
                            {getSuggestionSellerLabel(item, listing.seller_id)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>How This Listing Works</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status</Text>
          <Text style={styles.infoValue}>{listing.status.replaceAll('_', ' ')}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Fulfillment</Text>
          <Text style={styles.infoValue}>
            {fulfillmentOptions.length > 0
              ? fulfillmentOptions.map((option) => option.label).join(', ')
              : 'Seller has not configured methods yet'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Booking</Text>
          <Text style={styles.infoValue}>
            {canBook ? 'Accepts booking requests' : 'Order flow only'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Service Time</Text>
          <Text style={styles.infoValue}>
            {listing.duration_minutes ? `${listing.duration_minutes} minutes` : 'No duration set'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Lead Time</Text>
          <Text style={styles.infoValue}>
            {listing.lead_time_hours ? `${listing.lead_time_hours} hours` : 'Ready without extra lead time'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Available today</Text>
          <Text style={styles.infoValue}>{listing.available_today ? 'Yes' : 'Not today'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Recent traction</Text>
          <Text style={styles.infoValue}>{tractionValue}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Local Only</Text>
          <Text style={styles.infoValue}>{listing.is_local_only ? 'Yes' : 'No'}</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Buyer action</Text>
        <Text style={styles.panelText}>
          {session
            ? 'You are signed in. Use the actions below to create real orders or bookings against the live backend.'
            : 'Sign in on the Buyer tab before creating orders or bookings.'}
        </Text>
        <Text style={styles.panelHint}>
          {canOrder
            ? 'Order works best for products and hybrid offers.'
            : 'This listing is configured as a service, so booking is the primary action.'}
        </Text>
        <View style={styles.actionModeBanner}>
          <Text style={styles.actionModeText}>
            {primaryAction === 'booking'
              ? 'Primary action: Request Booking'
              : 'Primary action: Place Order'}
          </Text>
        </View>

        {canOrder ? (
          <View style={styles.selectorWrap}>
            <Text style={styles.selectorLabel}>Choose fulfillment</Text>
            <View style={styles.selectorRow}>
              {fulfillmentOptions.map((option) => (
                <Pressable
                  key={option.value}
                  style={[
                    styles.selectorChip,
                    selectedFulfillment === option.value && styles.selectorChipActive,
                  ]}
                  onPress={() => setSelectedFulfillment(option.value)}>
                  <Text
                    style={[
                      styles.selectorChipText,
                      selectedFulfillment === option.value && styles.selectorChipTextActive,
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          placeholder="Quantity"
          placeholderTextColor="#8d8376"
        />
        <TextInput
          style={[styles.input, styles.notesInput]}
          multiline
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes"
          placeholderTextColor="#8d8376"
        />

        {canBook && bookingWindow ? (
          <View style={styles.selectorWrap}>
            <Text style={styles.selectorLabel}>Booking timing</Text>
            <Text style={styles.bookingText}>
              Request starts {bookingWindow.start.toLocaleString()} and runs for{' '}
              {bookingWindow.durationMinutes} minutes.
            </Text>
            <Text style={styles.bookingText}>
              Seller lead time: {bookingWindow.leadTimeHours} hours.
            </Text>
            <TextInput
              style={styles.input}
              value={bookingDayOffset}
              onChangeText={setBookingDayOffset}
              keyboardType="number-pad"
              placeholder="Days from now"
              placeholderTextColor="#8d8376"
            />
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            style={[
              primaryAction === 'order' ? styles.button : styles.buttonSecondary,
              (!session || !canOrder || !selectedFulfillment) && styles.buttonDisabled,
            ]}
            disabled={!session || !canOrder || !selectedFulfillment}
            onPress={handleOrder}>
            <Text style={primaryAction === 'order' ? styles.buttonText : styles.buttonSecondaryText}>
              {canOrder ? 'Place Order' : 'Order Unavailable'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              primaryAction === 'booking' ? styles.button : styles.buttonSecondary,
              (!session || !canBook) && styles.buttonDisabled,
            ]}
            disabled={!session || !canBook}
            onPress={handleBooking}>
            <Text style={primaryAction === 'booking' ? styles.buttonText : styles.buttonSecondaryText}>
              {canBook ? 'Request Booking' : 'Booking Unavailable'}
            </Text>
          </Pressable>
        </View>

        {message ? <Text style={styles.successText}>{message}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#efe4cf',
  },
  content: {
    padding: 18,
    gap: 18,
  },
  hero: {
    backgroundColor: '#fff8ee',
    borderRadius: 26,
    padding: 20,
    gap: 10,
  },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: 20,
    backgroundColor: '#e8dcc9',
  },
  heroImagePlaceholder: {
    width: '100%',
    height: 220,
    borderRadius: 20,
    backgroundColor: '#d9c7a8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImagePlaceholderText: {
    color: '#4d4338',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  infoCard: {
    backgroundColor: '#f8eedc',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  infoTitle: {
    color: '#1f2319',
    fontSize: 20,
    fontWeight: '700',
  },
  infoRow: {
    gap: 4,
  },
  infoLabel: {
    color: '#7a6d5a',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  infoValue: {
    color: '#3e372d',
    fontSize: 14,
    lineHeight: 21,
  },
  typePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#f3e1bd',
    color: '#7c3a10',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#1f2319',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  location: {
    color: '#6f6556',
    fontSize: 13,
  },
  description: {
    color: '#5f5548',
    fontSize: 15,
    lineHeight: 23,
  },
  price: {
    color: '#8f3f17',
    fontSize: 24,
    fontWeight: '700',
  },
  platformFeeRow: {
    marginTop: 4,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  platformFeeLabel: {
    color: '#7a6d5a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  platformFeeValue: {
    color: '#1f2319',
    fontSize: 14,
    fontWeight: '700',
  },
  platformFeeDetail: {
    color: '#5f5548',
    fontSize: 12,
    lineHeight: 18,
  },
  recentSummaryRow: {
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6be',
    backgroundColor: '#fff6e7',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  recentSummaryLabel: {
    color: '#7a6d5a',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  recentSummaryText: {
    color: '#8f3f17',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroBadgeBooking: {
    backgroundColor: '#e4f1ed',
  },
  heroBadgeLocal: {
    backgroundColor: '#f3e1bd',
  },
  heroBadgeAvailable: {
    backgroundColor: '#e8f7ed',
  },
  heroBadgePopular: {
    backgroundColor: '#e7f3ff',
  },
  heroBadgeStatus: {
    backgroundColor: '#ece7dc',
  },
  heroBadgeNew: {
    backgroundColor: '#fff5e6',
  },
  heroBadgePromoted: {
    backgroundColor: '#fbe8dd',
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroBadgeBookingText: {
    color: '#0f5f62',
  },
  heroBadgeLocalText: {
    color: '#7c3a10',
  },
  heroBadgeAvailableText: {
    color: '#0f6a4a',
  },
  heroBadgePopularText: {
    color: '#0f4a87',
  },
  heroBadgeStatusText: {
    color: '#4d4338',
  },
  heroBadgeNewText: {
    color: '#7c4310',
  },
  heroBadgePromotedText: {
    color: '#b94c23',
  },
  recentRail: {
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e4d6be',
    backgroundColor: '#fff8ee',
    padding: 16,
  },
  recentRailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  recentRailLabel: {
    color: '#7a6d5a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recentRailText: {
    color: '#5f5548',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    maxWidth: 260,
  },
  recentClearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d9c7a8',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recentClearButtonText: {
    color: '#4d4338',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recentOpenButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f4b24f',
    backgroundColor: '#fff6e7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  recentOpenButtonText: {
    color: '#8f3f17',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  recentOpenButtonSubtext: {
    color: '#6f6556',
    fontSize: 12,
    lineHeight: 18,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickCard: {
    flexBasis: '47%',
    backgroundColor: '#f8eedc',
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  quickLabel: {
    color: '#7a6d5a',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  quickValue: {
    color: '#1f2319',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  recommendationPanel: {
    backgroundColor: '#edf8f2',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#b9d9c5',
    padding: 18,
    gap: 8,
  },
  recommendationLabel: {
    color: '#0f5f62',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  recommendationText: {
    color: '#24493f',
    fontSize: 14,
    lineHeight: 22,
  },
  recommendationAction: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f5f62',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recommendationActionText: {
    color: '#fff8ee',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  moreLikeThisPanel: {
    backgroundColor: '#fff8ee',
    borderRadius: 22,
    padding: 18,
    gap: 10,
  },
  moreLikeThisTitle: {
    color: '#1f2319',
    fontSize: 20,
    fontWeight: '700',
  },
  moreLikeThisSubtitle: {
    color: '#6f6556',
    fontSize: 13,
    lineHeight: 20,
  },
  moreLikeThisRow: {
    gap: 10,
  },
  moreLikeThisGroup: {
    gap: 10,
  },
  moreLikeThisGroupTitle: {
    color: '#5f5548',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  moreLikeThisCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6be',
    backgroundColor: '#f8eedc',
    padding: 14,
    gap: 6,
  },
  moreLikeThisCardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  moreLikeThisCardBody: {
    flex: 1,
    gap: 6,
  },
  moreLikeThisCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  moreLikeThisImage: {
    width: 76,
    height: 76,
    borderRadius: 14,
    backgroundColor: '#e8dcc9',
  },
  moreLikeThisImagePlaceholder: {
    width: 76,
    height: 76,
    borderRadius: 14,
    backgroundColor: '#d9c7a8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreLikeThisImagePlaceholderText: {
    color: '#4d4338',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  moreLikeThisCardType: {
    color: '#7c3a10',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  moreLikeThisCardTitle: {
    color: '#1f2319',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  moreLikeThisCardSignal: {
    color: '#1f2319',
    fontSize: 11,
    fontWeight: '700',
  },
  moreLikeThisCardMeta: {
    color: '#6f6556',
    fontSize: 12,
    fontWeight: '600',
  },
  moreLikeThisCardReason: {
    color: '#0f5f62',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  moreLikeThisBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  moreLikeThisCardMode: {
    color: '#7c3a10',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  moreLikeThisCardSeller: {
    color: '#5d5a7a',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  panel: {
    backgroundColor: '#1f351f',
    borderRadius: 26,
    padding: 20,
    gap: 12,
  },
  panelTitle: {
    color: '#fff8ee',
    fontSize: 24,
    fontWeight: '700',
  },
  panelText: {
    color: '#d4d0c5',
    fontSize: 14,
    lineHeight: 22,
  },
  panelHint: {
    color: '#f0dfbf',
    fontSize: 13,
    lineHeight: 20,
  },
  actionModeBanner: {
    alignSelf: 'flex-start',
    backgroundColor: '#2a472a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionModeText: {
    color: '#fff0d2',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  selectorWrap: {
    gap: 10,
  },
  selectorLabel: {
    color: '#fff0d2',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  selectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectorChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6b816b',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectorChipActive: {
    backgroundColor: '#f4b24f',
    borderColor: '#f4b24f',
  },
  selectorChipText: {
    color: '#eef0e6',
    fontSize: 12,
    fontWeight: '700',
  },
  selectorChipTextActive: {
    color: '#1f2319',
  },
  bookingText: {
    color: '#d4d0c5',
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#f4eadb',
    borderRadius: 16,
    color: '#1f2319',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  notesInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  actionRow: {
    gap: 10,
  },
  button: {
    backgroundColor: '#f4b24f',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#fff8ee',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#1f2319',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#1f351f',
    fontSize: 14,
    fontWeight: '700',
  },
  successText: {
    color: '#b8f3ca',
    fontSize: 13,
    lineHeight: 20,
  },
  errorText: {
    color: '#ffcbc5',
    fontSize: 13,
    lineHeight: 20,
  },
  missingState: {
    flex: 1,
    backgroundColor: '#efe4cf',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  missingTitle: {
    color: '#1f2319',
    fontSize: 24,
    fontWeight: '700',
  },
  missingText: {
    color: '#5f5548',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
});
