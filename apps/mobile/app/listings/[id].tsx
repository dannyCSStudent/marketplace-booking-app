import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatBuyerActionError, formatCurrency, formatLocation } from '@/lib/api';
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

export default function ListingDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listings, createOrder, createBooking, session } = useBuyerSession();
  const [quantity, setQuantity] = useState('2');
  const [notes, setNotes] = useState('Buyer flow test from mobile.');
  const [selectedFulfillment, setSelectedFulfillment] = useState<string>('');
  const [bookingDayOffset, setBookingDayOffset] = useState('1');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listing = useMemo(() => listings.find((item) => item.id === id), [id, listings]);
  const fulfillmentOptions = useMemo(
    () => (listing ? getFulfillmentOptions(listing) : []),
    [listing],
  );
  const canOrder = Boolean(listing && listing.type !== 'service');
  const canBook = Boolean(listing && (listing.requires_booking || listing.type !== 'product'));
  const bookingWindow = useMemo(() => {
    if (!listing) {
      return null;
    }

    const parsedOffset = Number(bookingDayOffset);
    return computeBookingWindow(listing, Number.isFinite(parsedOffset) ? parsedOffset : 1);
  }, [bookingDayOffset, listing]);

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

  async function handleOrder() {
    setError(null);
    setMessage(null);

    try {
      const order = await createOrder({
        sellerId: listing.seller_id,
        listingId: listing.id,
        quantity: Number(quantity),
        fulfillment: selectedFulfillment,
        notes,
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
        sellerId: listing.seller_id,
        listingId: listing.id,
        scheduledStart: bookingWindow.start.toISOString(),
        scheduledEnd: bookingWindow.end.toISOString(),
        notes,
      });
      router.push({ pathname: '/transactions/[kind]/[id]', params: { kind: 'booking', id: booking.id } });
    } catch (err) {
      setError(formatBuyerActionError(err));
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.typePill}>{listing.type}</Text>
        <Text style={styles.title}>{listing.title}</Text>
        <Text style={styles.location}>{formatLocation(listing) || 'Location pending'}</Text>
        <Text style={styles.description}>{listing.description}</Text>
        <Text style={styles.price}>{formatCurrency(listing.price_cents, listing.currency)}</Text>
      </View>

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
              styles.button,
              (!session || !canOrder || !selectedFulfillment) && styles.buttonDisabled,
            ]}
            disabled={!session || !canOrder || !selectedFulfillment}
            onPress={handleOrder}>
            <Text style={styles.buttonText}>{canOrder ? 'Place Order' : 'Order Unavailable'}</Text>
          </Pressable>
          <Pressable
            style={[styles.buttonSecondary, (!session || !canBook) && styles.buttonDisabled]}
            disabled={!session || !canBook}
            onPress={handleBooking}>
            <Text style={styles.buttonSecondaryText}>
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
