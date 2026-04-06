import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCurrency, formatLocation } from '@/lib/api';
import { getBuyerBrowseFilters, setBuyerBrowseFilters } from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

const typeColors = {
  product: '#7c3a10',
  service: '#0f5f62',
  hybrid: '#6f4a09',
} as const;

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

function formatTypeFilter(typeFilter: 'all' | 'product' | 'service' | 'hybrid') {
  if (typeFilter === 'all') {
    return 'All Listings';
  }

  if (typeFilter === 'product') {
    return 'Products';
  }

  if (typeFilter === 'service') {
    return 'Services';
  }

  return 'Hybrid';
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

function getPrimaryImageUrl(listing: { images?: { image_url: string }[] | null }) {
  return listing.images?.[0]?.image_url ?? null;
}

export default function BrowseScreen() {
  const { listings, refreshMarketplace, refreshing, error } = useBuyerSession();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'service' | 'hybrid'>('all');
  const [sortMode, setSortMode] = useState<'newest' | 'price-low' | 'price-high'>('newest');
  const [localOnly, setLocalOnly] = useState(false);
  const [filtersRestored, setFiltersRestored] = useState(false);
  const hasActiveBrowseFilters =
    searchQuery.trim().length > 0 || typeFilter !== 'all' || sortMode !== 'newest' || localOnly;

  useEffect(() => {
    void refreshMarketplace();
  }, [refreshMarketplace]);

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
          typeFilter?: 'all' | 'product' | 'service' | 'hybrid';
          sortMode?: 'newest' | 'price-low' | 'price-high';
          localOnly?: boolean;
        };

        setSearchQuery(storedFilters.searchQuery ?? '');
        setTypeFilter(storedFilters.typeFilter ?? 'all');
        setSortMode(storedFilters.sortMode ?? 'newest');
        setLocalOnly(storedFilters.localOnly ?? false);
      } catch {
        // Ignore corrupted local filter state and fall back to defaults.
      } finally {
        setFiltersRestored(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!filtersRestored) {
      return;
    }

    void setBuyerBrowseFilters(
      JSON.stringify({
        searchQuery,
        typeFilter,
        sortMode,
        localOnly,
      }),
    );
  }, [filtersRestored, localOnly, searchQuery, sortMode, typeFilter]);

  const filteredListings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const nextListings = listings.filter((listing) => {
      if (typeFilter !== 'all' && listing.type !== typeFilter) {
        return false;
      }

      if (localOnly && !listing.is_local_only) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        listing.title,
        listing.description,
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

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

    return nextListings;
  }, [listings, localOnly, searchQuery, sortMode, typeFilter]);
  const dominantLocation = useMemo(
    () => getLocationSummary(filteredListings),
    [filteredListings],
  );

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
          {hasActiveBrowseFilters ? (
            <Pressable
              style={styles.clearButton}
              onPress={() => {
                setSearchQuery('');
                setTypeFilter('all');
                setSortMode('newest');
                setLocalOnly(false);
              }}>
              <Text style={styles.clearButtonText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search listings, services, or location"
          placeholderTextColor="#8d8376"
        />
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
            {[formatTypeFilter(typeFilter), formatSortMode(sortMode)].join(' · ')} · {filteredListings.length}{' '}
            result{filteredListings.length === 1 ? '' : 's'}
          </Text>
        </View>
        {localOnly ? <Text style={styles.summarySubtext}>Local only listings enabled</Text> : null}
        {searchQuery.trim().length > 0 ? (
          <Text style={styles.summarySubtext}>Search: “{searchQuery.trim()}”</Text>
        ) : null}
      </View>

      <View style={styles.cardList}>
        {filteredListings.map((listing) => (
          (() => {
            const signals = getListingSignals(listing);
            const primaryImageUrl = getPrimaryImageUrl(listing);
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
                <Text style={[styles.typePill, { color: typeColors[listing.type] }]}>{listing.type}</Text>
                <Text style={styles.locationText}>{formatLocation(listing) || 'Location pending'}</Text>
              </View>
              <View style={styles.badgeRow}>
                <View style={[styles.scanBadge, styles.bookingBadge]}>
                  <Text style={[styles.scanBadgeText, styles.bookingBadgeText]}>{signals.booking}</Text>
                </View>
                {listing.is_local_only ? (
                  <View style={[styles.scanBadge, styles.localBadge]}>
                    <Text style={[styles.scanBadgeText, styles.localBadgeText]}>Local Only</Text>
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
  searchInput: {
    backgroundColor: '#f4eadb',
    borderRadius: 16,
    color: '#1f2319',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
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
  bookingBadge: {
    backgroundColor: '#e4f1ed',
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
  bookingBadgeText: {
    color: '#0f5f62',
  },
  localBadgeText: {
    color: '#7c3a10',
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
});
