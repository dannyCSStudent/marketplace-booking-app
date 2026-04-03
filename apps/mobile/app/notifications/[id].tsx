import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useBuyerSession } from '@/providers/buyer-session';

export default function NotificationDeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notificationDeliveries } = useBuyerSession();
  const delivery = notificationDeliveries.find((item) => item.id === id);

  if (!delivery) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.title}>Delivery not found</Text>
          <Text style={styles.copy}>
            This notification delivery is no longer in the recent mobile session cache. Return to
            the Buyer tab and refresh the workspace.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Notification delivery</Text>
        <Text style={styles.title}>{String(delivery.payload.subject ?? delivery.channel)}</Text>
        <Text style={styles.copy}>
          {new Date(delivery.created_at).toLocaleString()} • {delivery.delivery_status} • attempts{' '}
          {delivery.attempts}
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Routing</Text>
        <DetailRow label="Channel" value={delivery.channel} />
        <DetailRow label="Transaction" value={`${delivery.transaction_kind} • ${delivery.transaction_id}`} />
        <DetailRow label="Event" value={delivery.event_id} />
        <DetailRow label="Recipient user" value={delivery.recipient_user_id} />
        <DetailRow label="Recipient target" value={getRecipientTarget(delivery.payload)} />
        <DetailRow label="Sent at" value={delivery.sent_at ? new Date(delivery.sent_at).toLocaleString() : 'Not sent yet'} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Delivery Summary</Text>
        <DetailRow label="Title" value={getStringField(delivery.payload.subject) ?? 'No subject recorded'} />
        <DetailRow label="Message" value={getStringField(delivery.payload.body) ?? getStringField(delivery.payload.note) ?? 'No message recorded'} />
        <DetailRow label="Status" value={getStringField(delivery.payload.status) ?? 'Unknown'} />
        {delivery.channel === 'push' ? (
          <Text style={styles.copy}>
            Push tests only succeed on a real device after `Sync Push` stores an Expo token on the
            buyer profile.
          </Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Failure</Text>
        <Text style={styles.copy}>
          {delivery.failure_reason ?? 'No failure recorded for this delivery.'}
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Payload</Text>
        <Text style={styles.payload}>{JSON.stringify(delivery.payload, null, 2)}</Text>
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function getStringField(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function getRecipientTarget(payload: Record<string, unknown>) {
  const target = payload.to;

  if (typeof target !== 'string') {
    return 'Resolved from buyer profile';
  }

  if (target.startsWith('ExponentPushToken[')) {
    const suffix = target.slice(-10);
    return `Expo token • …${suffix}`;
  }

  return target;
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
    color: '#d7f0d1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff8ee',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 31,
  },
  copy: {
    color: '#d9d3c7',
    fontSize: 14,
    lineHeight: 22,
  },
  panel: {
    backgroundColor: '#fff8ee',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    color: '#1f2319',
    fontSize: 18,
    fontWeight: '700',
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    color: '#6f6556',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: '#1f2319',
    fontSize: 14,
    lineHeight: 21,
  },
  payload: {
    color: '#1f2319',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
