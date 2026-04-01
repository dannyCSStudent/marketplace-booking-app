import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatCurrency } from '@/lib/api';
import { useBuyerSession } from '@/providers/buyer-session';

export default function TransactionReceiptScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const { orders, bookings } = useBuyerSession();

  if (kind === 'order') {
    const order = orders.find((item) => item.id === id);
    if (!order) {
      return <MissingReceipt message="Order receipt is not loaded yet. Return to Buyer and refresh activity." />;
    }

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Order receipt</Text>
          <Text style={styles.title}>Order submitted successfully.</Text>
          <Text style={styles.subtitle}>
            The seller queue now has this order and can start moving it through the workflow.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <ReceiptRow label="Order ID" value={order.id} />
          <ReceiptRow label="Status" value={order.status.replaceAll('_', ' ')} />
          <ReceiptRow label="Fulfillment" value={order.fulfillment} />
          <ReceiptRow label="Total" value={formatCurrency(order.total_cents, order.currency)} />
          <ReceiptRow
            label="Seller update"
            value={order.seller_response_note ?? 'No seller note yet'}
          />
          <ReceiptRow label="Notes" value={order.notes ?? 'No notes added'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Requested items</Text>
          {(order.items ?? []).length > 0 ? (
            (order.items ?? []).map((item) => (
              <View key={item.id} style={styles.lineItem}>
                <Text style={styles.lineTitle}>{item.quantity}x {item.listing_title ?? item.listing_id}</Text>
                <Text style={styles.lineMeta}>
                  {formatCurrency(item.total_price_cents, order.currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Item detail is not available for this order yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {(order.status_history ?? []).length > 0 ? (
            (order.status_history ?? []).map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>
                  {event.status.replaceAll('_', ' ')} · {event.actor_role}
                </Text>
                <Text style={styles.lineMeta}>{new Date(event.created_at).toLocaleString()}</Text>
                {event.note ? <Text style={styles.rowValue}>{event.note}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No transaction history yet.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  if (kind === 'booking') {
    const booking = bookings.find((item) => item.id === id);
    if (!booking) {
      return <MissingReceipt message="Booking receipt is not loaded yet. Return to Buyer and refresh activity." />;
    }

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Booking receipt</Text>
          <Text style={styles.title}>Booking request sent.</Text>
          <Text style={styles.subtitle}>
            The seller can now confirm, decline, or move this booking into progress from the web workspace.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <ReceiptRow label="Booking ID" value={booking.id} />
          <ReceiptRow label="Status" value={booking.status.replaceAll('_', ' ')} />
          <ReceiptRow label="Listing" value={booking.listing_title ?? booking.listing_id} />
          <ReceiptRow label="Type" value={booking.listing_type ?? 'Not specified'} />
          <ReceiptRow label="Starts" value={new Date(booking.scheduled_start).toLocaleString()} />
          <ReceiptRow label="Ends" value={new Date(booking.scheduled_end).toLocaleString()} />
          <ReceiptRow label="Price" value={formatCurrency(booking.total_cents, booking.currency)} />
          <ReceiptRow
            label="Seller update"
            value={booking.seller_response_note ?? 'No seller note yet'}
          />
          <ReceiptRow label="Notes" value={booking.notes ?? 'No notes added'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {(booking.status_history ?? []).length > 0 ? (
            (booking.status_history ?? []).map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>
                  {event.status.replaceAll('_', ' ')} · {event.actor_role}
                </Text>
                <Text style={styles.lineMeta}>{new Date(event.created_at).toLocaleString()}</Text>
                {event.note ? <Text style={styles.rowValue}>{event.note}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No transaction history yet.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  return <MissingReceipt message="This receipt type is not supported." />;
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function MissingReceipt({ message }: { message: string }) {
  return (
    <View style={styles.missingState}>
      <Text style={styles.missingTitle}>Receipt unavailable</Text>
      <Text style={styles.missingText}>{message}</Text>
    </View>
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
    backgroundColor: '#1f351f',
    borderRadius: 26,
    padding: 20,
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
    color: '#fff8ee',
    fontSize: 29,
    fontWeight: '700',
    lineHeight: 34,
  },
  subtitle: {
    color: '#d7d3c8',
    fontSize: 14,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#fff8ee',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  cardTitle: {
    color: '#1f2319',
    fontSize: 20,
    fontWeight: '700',
  },
  row: {
    gap: 4,
  },
  rowLabel: {
    color: '#7a6d5a',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rowValue: {
    color: '#322d25',
    fontSize: 14,
    lineHeight: 21,
  },
  lineItem: {
    borderTopWidth: 1,
    borderTopColor: '#ebddc5',
    paddingTop: 12,
    gap: 4,
  },
  timelineItem: {
    borderTopWidth: 1,
    borderTopColor: '#ebddc5',
    paddingTop: 12,
    gap: 4,
  },
  lineTitle: {
    color: '#1f2319',
    fontSize: 15,
    fontWeight: '700',
  },
  lineMeta: {
    color: '#6f6556',
    fontSize: 13,
  },
  emptyText: {
    color: '#6f6556',
    fontSize: 14,
    lineHeight: 21,
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
