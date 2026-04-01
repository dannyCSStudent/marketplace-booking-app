import { useEffect } from 'react';
import { Link } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatCurrency, formatLocation } from '@/lib/api';
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

export default function BrowseScreen() {
  const { listings, refreshMarketplace, refreshing, error } = useBuyerSession();

  useEffect(() => {
    void refreshMarketplace();
  }, [refreshMarketplace]);

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
        <Text style={styles.sectionMeta}>{listings.length} live listings</Text>
      </View>

      <View style={styles.cardList}>
        {listings.map((listing) => (
          (() => {
            const signals = getListingSignals(listing);
            return (
          <Link key={listing.id} href={{ pathname: '/listings/[id]', params: { id: listing.id } }} asChild>
            <Pressable style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={[styles.typePill, { color: typeColors[listing.type] }]}>{listing.type}</Text>
                <Text style={styles.locationText}>{formatLocation(listing) || 'Location pending'}</Text>
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
          </Link>
            );
          })()
        ))}
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
  cardList: {
    gap: 14,
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
});
