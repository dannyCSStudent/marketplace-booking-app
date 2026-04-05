import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getBuyerDeliveryRetryMode, setBuyerDeliveryRetryMode } from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

function formatRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'Validate First' : 'Best Effort';
}

function toggleRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'best_effort' : 'atomic';
}

export default function NotificationDeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { notificationDeliveries, notifications, retryNotificationDelivery } = useBuyerSession();
  const [retryingCurrent, setRetryingCurrent] = useState(false);
  const [retryingRelated, setRetryingRelated] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [deliveryRetryMode, setDeliveryRetryModeState] = useState<'best_effort' | 'atomic'>('best_effort');
  const delivery = notificationDeliveries.find((item) => item.id === id);

  useEffect(() => {
    void (async () => {
      const storedRetryMode = await getBuyerDeliveryRetryMode();
      setDeliveryRetryModeState(storedRetryMode === 'atomic' ? 'atomic' : 'best_effort');
    })();
  }, []);

  function setDeliveryRetryMode(mode: 'best_effort' | 'atomic') {
    setDeliveryRetryModeState(mode);
    void setBuyerDeliveryRetryMode(mode);
  }

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

  const relatedNotifications = notifications.filter(
    (item) =>
      item.transactionKind === delivery.transaction_kind &&
      item.transactionId === delivery.transaction_id,
  );
  const relatedDeliveries = notificationDeliveries.filter(
    (item) =>
      item.id !== delivery.id &&
      item.transaction_kind === delivery.transaction_kind &&
      item.transaction_id === delivery.transaction_id,
  );
  const failedRelatedDeliveries = relatedDeliveries.filter(
    (item) => item.delivery_status === 'failed',
  );

  function retryCurrentDelivery() {
    if (delivery.delivery_status !== 'failed') {
      return;
    }

    void (async () => {
      try {
        setActionError(null);
        setActionMessage(null);
        setActionDetails([]);
        setRetryingCurrent(true);
        await retryNotificationDelivery(delivery.id);
        setActionMessage('Retried this delivery.');
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : 'Unable to retry this delivery.');
      } finally {
        setRetryingCurrent(false);
      }
    })();
  }

  function retryRelatedDeliveries() {
    if (failedRelatedDeliveries.length === 0) {
      return;
    }

    void (async () => {
      try {
        setActionError(null);
        setActionMessage(null);
        setActionDetails([]);
        setRetryingRelated(true);
        const result = await retryNotificationDelivery(
          failedRelatedDeliveries.map((item) => item.id),
          deliveryRetryMode,
        );

        setActionMessage(
          result.failed.length === 0
            ? `Retried ${result.succeeded_ids.length} related ${
                result.succeeded_ids.length === 1 ? 'delivery' : 'deliveries'
              } using ${formatRetryMode(deliveryRetryMode)} mode.`
            : result.succeeded_ids.length > 0
              ? `Retried ${result.succeeded_ids.length} of ${failedRelatedDeliveries.length} related deliveries using ${formatRetryMode(deliveryRetryMode)} mode. ${result.failed.length} failed again.`
              : `Unable to retry ${failedRelatedDeliveries.length} related deliveries using ${formatRetryMode(deliveryRetryMode)} mode.`,
        );
        setActionDetails(
          result.failed.map(
            (failure: { id: string; detail: string }) =>
              `${failure.id.slice(0, 8)} · ${failure.detail}`,
          ),
        );
      } catch (error: unknown) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to retry related delivery attempts.',
        );
        setActionDetails([]);
      } finally {
        setRetryingRelated(false);
      }
    })();
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

      {actionError ? <Text style={styles.feedbackError}>{actionError}</Text> : null}
      {actionMessage ? <Text style={styles.feedbackSuccess}>{actionMessage}</Text> : null}
      {actionDetails.length > 0 ? (
        <View style={styles.feedbackList}>
          {actionDetails.slice(0, 4).map((detail) => (
            <Text key={detail} style={styles.feedbackDetailText}>
              {detail}
            </Text>
          ))}
          {actionDetails.length > 4 ? (
            <Text style={styles.feedbackDetailText}>
              {actionDetails.length - 4} more not shown.
            </Text>
          ) : null}
        </View>
      ) : null}
      {failedRelatedDeliveries.length > 0 ? (
        <View style={styles.feedbackList}>
          <Text style={styles.feedbackDetailText}>
            Retry mode: {formatRetryMode(deliveryRetryMode)}
          </Text>
          <View style={styles.modeSwitchRow}>
            <Pressable
              style={[styles.inlineAction, deliveryRetryMode === 'best_effort' && styles.inlineActionActive]}
              onPress={() => setDeliveryRetryMode('best_effort')}>
              <Text style={[styles.inlineActionText, deliveryRetryMode === 'best_effort' && styles.inlineActionTextActive]}>
                Best Effort
              </Text>
            </Pressable>
            <Pressable
              style={[styles.inlineAction, deliveryRetryMode === 'atomic' && styles.inlineActionActive]}
              onPress={() => setDeliveryRetryMode('atomic')}>
              <Text style={[styles.inlineActionText, deliveryRetryMode === 'atomic' && styles.inlineActionTextActive]}>
                Validate First
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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
        {delivery.delivery_status === 'failed' ? (
          <Pressable style={styles.inlineAction} onPress={retryCurrentDelivery}>
            <Text style={styles.inlineActionText}>
              {retryingCurrent ? 'Retrying...' : 'Retry This Delivery'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Transaction</Text>
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/transactions/[kind]/[id]',
              params: {
                kind: delivery.transaction_kind,
                id: delivery.transaction_id,
              },
            })
          }
          style={styles.linkCard}>
          <Text style={styles.linkTitle}>Open related receipt</Text>
          <Text style={styles.linkMeta}>
            {delivery.transaction_kind} · {delivery.transaction_id}
          </Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Related Updates</Text>
        {relatedNotifications.length > 0 ? (
          relatedNotifications.slice(0, 4).map((notification) => (
            <View key={notification.id} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{notification.title}</Text>
              <Text style={styles.detailValue}>{notification.message}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.copy}>No related transaction updates are cached right now.</Text>
        )}
      </View>

      <View style={styles.panel}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Other Delivery Attempts</Text>
          {failedRelatedDeliveries.length > 0 ? (
            <Pressable style={styles.inlineAction} onPress={retryRelatedDeliveries}>
              <Text style={styles.inlineActionText}>
                {retryingRelated ? 'Retrying...' : `Retry Failed · ${failedRelatedDeliveries.length}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          style={styles.modeBadge}
          onPress={() => setDeliveryRetryMode(toggleRetryMode(deliveryRetryMode))}>
          <Text style={styles.modeBadgeLabel}>Retry Mode</Text>
          <Text style={styles.modeBadgeValue}>{formatRetryMode(deliveryRetryMode)}</Text>
          <Text style={styles.modeBadgeHint}>Tap to switch</Text>
        </Pressable>
        {relatedDeliveries.length > 0 ? (
          relatedDeliveries.slice(0, 4).map((item) => (
            <Pressable
              key={item.id}
              onPress={() =>
                router.push({
                  pathname: '/notifications/[id]',
                  params: { id: item.id },
                })
              }
              style={styles.linkCard}>
              <Text style={styles.linkTitle}>
                {item.channel} · {item.delivery_status}
              </Text>
              <Text style={styles.linkMeta}>
                {new Date(item.created_at).toLocaleString()} · attempts {item.attempts}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.copy}>No other delivery attempts are recorded for this transaction.</Text>
        )}
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
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f4eadb',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  modeBadgeLabel: {
    color: '#6f6556',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modeBadgeValue: {
    color: '#1f2319',
    fontSize: 14,
    fontWeight: '700',
  },
  modeBadgeHint: {
    color: '#6f6556',
    fontSize: 11,
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
  linkCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6bf',
    backgroundColor: '#f7efe2',
    padding: 14,
    gap: 6,
  },
  linkTitle: {
    color: '#1f2319',
    fontSize: 14,
    fontWeight: '700',
  },
  linkMeta: {
    color: '#6f6556',
    fontSize: 13,
    lineHeight: 20,
  },
  inlineAction: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineActionText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  inlineActionActive: {
    backgroundColor: '#1f351f',
    borderColor: '#1f351f',
  },
  inlineActionTextActive: {
    color: '#fff8ee',
  },
  feedbackError: {
    color: '#a13428',
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  feedbackSuccess: {
    color: '#1f351f',
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  feedbackList: {
    gap: 4,
    paddingHorizontal: 4,
  },
  modeSwitchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  feedbackDetailText: {
    color: '#5f5548',
    fontSize: 12,
    lineHeight: 18,
  },
});
