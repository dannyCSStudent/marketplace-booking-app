import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatCurrency, loadBuyerBooking, loadBuyerOrder, type Booking, type Order } from '@/lib/api';
import { getBuyerDeliveryRetryMode, setBuyerDeliveryRetryMode } from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

function formatRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'Validate First' : 'Best Effort';
}

function toggleRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'best_effort' : 'atomic';
}

export default function TransactionReceiptScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const router = useRouter();
  const { session, orders, bookings, notifications, notificationDeliveries, retryNotificationDelivery } = useBuyerSession();
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryingRelatedDeliveries, setRetryingRelatedDeliveries] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [deliveryRetryMode, setDeliveryRetryModeState] = useState<'best_effort' | 'atomic'>('best_effort');

  const order = kind === 'order' && id ? orders.find((item) => item.id === id) : undefined;
  const booking = kind === 'booking' && id ? bookings.find((item) => item.id === id) : undefined;
  const relatedNotifications = notifications.filter(
    (item) => item.transactionKind === kind && item.transactionId === id,
  );
  const relatedDeliveries = notificationDeliveries.filter(
    (item) => item.transaction_kind === kind && item.transaction_id === id,
  );
  const failedRelatedDeliveries = relatedDeliveries.filter(
    (item) => item.delivery_status === 'failed',
  );

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

  function retryFailedRelatedDeliveries() {
    if (failedRelatedDeliveries.length === 0) {
      return;
    }

    void (async () => {
      try {
        setActionError(null);
        setActionMessage(null);
        setActionDetails([]);
        setRetryingRelatedDeliveries(true);
        const result = await retryNotificationDelivery(
          failedRelatedDeliveries.map((delivery) => delivery.id),
          deliveryRetryMode,
        );

        setActionMessage(
          result.failed.length === 0
            ? `Retried ${result.succeeded_ids.length} failed ${
                result.succeeded_ids.length === 1 ? 'delivery' : 'deliveries'
              } for this transaction using ${formatRetryMode(deliveryRetryMode)} mode.`
            : result.succeeded_ids.length > 0
              ? `Retried ${result.succeeded_ids.length} of ${failedRelatedDeliveries.length} failed deliveries for this transaction using ${formatRetryMode(deliveryRetryMode)} mode. ${result.failed.length} failed again.`
              : `Unable to retry ${failedRelatedDeliveries.length} failed deliveries for this transaction using ${formatRetryMode(deliveryRetryMode)} mode.`,
        );
        setActionDetails(
          result.failed.map(
            (failure: { id: string; detail: string }) =>
              `${failure.id.slice(0, 8)} · ${failure.detail}`,
          ),
        );
      } catch (error: unknown) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to retry failed delivery attempts.',
        );
        setActionDetails([]);
      } finally {
        setRetryingRelatedDeliveries(false);
      }
    })();
  }

  useEffect(() => {
    let cancelled = false;

    if (!session?.access_token || !id) {
      return () => {
        cancelled = true;
      };
    }

    if (kind === 'order') {
      if (order) {
        setReceiptOrder(order);
        setLoadError(null);
        return () => {
          cancelled = true;
        };
      }

      setLoading(true);
      setLoadError(null);

      void loadBuyerOrder(session.access_token, id)
        .then((result) => {
          if (cancelled) {
            return;
          }

          setReceiptOrder(result);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          setLoadError(error instanceof Error ? error.message : 'Unable to load this order receipt.');
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }

    if (kind === 'booking') {
      if (booking) {
        setReceiptBooking(booking);
        setLoadError(null);
        return () => {
          cancelled = true;
        };
      }

      setLoading(true);
      setLoadError(null);

      void loadBuyerBooking(session.access_token, id)
        .then((result) => {
          if (cancelled) {
            return;
          }

          setReceiptBooking(result);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          setLoadError(error instanceof Error ? error.message : 'Unable to load this booking receipt.');
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [booking, id, kind, order, session?.access_token]);

  if (kind === 'order') {
    const resolvedOrder = order ?? receiptOrder;
    if (loading && !resolvedOrder) {
      return <LoadingReceipt message="Loading order receipt..." />;
    }

    if (!resolvedOrder) {
      return (
        <MissingReceipt
          message={loadError ?? 'Order receipt is not loaded yet. Return to Buyer and refresh activity.'}
        />
      );
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <ReceiptRow label="Order ID" value={resolvedOrder.id} />
          <ReceiptRow label="Status" value={resolvedOrder.status.replaceAll('_', ' ')} />
          <ReceiptRow label="Fulfillment" value={resolvedOrder.fulfillment} />
          <ReceiptRow label="Total" value={formatCurrency(resolvedOrder.total_cents, resolvedOrder.currency)} />
          <ReceiptRow
            label="Seller update"
            value={resolvedOrder.seller_response_note ?? 'No seller note yet'}
          />
          <ReceiptRow label="Notes" value={resolvedOrder.notes ?? 'No notes added'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Requested items</Text>
          {(resolvedOrder.items ?? []).length > 0 ? (
            (resolvedOrder.items ?? []).map((item) => (
              <View key={item.id} style={styles.lineItem}>
                <Text style={styles.lineTitle}>{item.quantity}x {item.listing_title ?? item.listing_id}</Text>
                <Text style={styles.lineMeta}>
                  {formatCurrency(item.total_price_cents, resolvedOrder.currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Item detail is not available for this order yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {(resolvedOrder.status_history ?? []).length > 0 ? (
            (resolvedOrder.status_history ?? []).map((event) => (
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Related Updates</Text>
          {relatedNotifications.length > 0 ? (
            relatedNotifications.slice(0, 4).map((notification) => (
              <View key={notification.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>{notification.title}</Text>
                <Text style={styles.lineMeta}>{new Date(notification.createdAt).toLocaleString()}</Text>
                <Text style={styles.rowValue}>{notification.message}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No related seller updates yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Delivery Attempts</Text>
            {failedRelatedDeliveries.length > 0 ? (
              <Pressable style={styles.inlineAction} onPress={retryFailedRelatedDeliveries}>
                <Text style={styles.inlineActionText}>
                  {retryingRelatedDeliveries ? 'Retrying...' : `Retry Failed · ${failedRelatedDeliveries.length}`}
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
            relatedDeliveries.slice(0, 4).map((delivery) => (
              <Pressable
                key={delivery.id}
                onPress={() =>
                  router.push({
                    pathname: '/notifications/[id]',
                    params: { id: delivery.id },
                  })
                }
                style={styles.linkCard}>
                <Text style={styles.lineTitle}>
                  {delivery.channel} · {delivery.delivery_status}
                </Text>
                <Text style={styles.lineMeta}>
                  {new Date(delivery.created_at).toLocaleString()} · attempts {delivery.attempts}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>No notification deliveries recorded for this order yet.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  if (kind === 'booking') {
    const resolvedBooking = booking ?? receiptBooking;
    if (loading && !resolvedBooking) {
      return <LoadingReceipt message="Loading booking receipt..." />;
    }

    if (!resolvedBooking) {
      return (
        <MissingReceipt
          message={loadError ?? 'Booking receipt is not loaded yet. Return to Buyer and refresh activity.'}
        />
      );
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <ReceiptRow label="Booking ID" value={resolvedBooking.id} />
          <ReceiptRow label="Status" value={resolvedBooking.status.replaceAll('_', ' ')} />
          <ReceiptRow label="Listing" value={resolvedBooking.listing_title ?? resolvedBooking.listing_id} />
          <ReceiptRow label="Type" value={resolvedBooking.listing_type ?? 'Not specified'} />
          <ReceiptRow label="Starts" value={new Date(resolvedBooking.scheduled_start).toLocaleString()} />
          <ReceiptRow label="Ends" value={new Date(resolvedBooking.scheduled_end).toLocaleString()} />
          <ReceiptRow label="Price" value={formatCurrency(resolvedBooking.total_cents, resolvedBooking.currency)} />
          <ReceiptRow
            label="Seller update"
            value={resolvedBooking.seller_response_note ?? 'No seller note yet'}
          />
          <ReceiptRow label="Notes" value={resolvedBooking.notes ?? 'No notes added'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {(resolvedBooking.status_history ?? []).length > 0 ? (
            (resolvedBooking.status_history ?? []).map((event) => (
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Related Updates</Text>
          {relatedNotifications.length > 0 ? (
            relatedNotifications.slice(0, 4).map((notification) => (
              <View key={notification.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>{notification.title}</Text>
                <Text style={styles.lineMeta}>{new Date(notification.createdAt).toLocaleString()}</Text>
                <Text style={styles.rowValue}>{notification.message}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No related seller updates yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Delivery Attempts</Text>
            {failedRelatedDeliveries.length > 0 ? (
              <Pressable style={styles.inlineAction} onPress={retryFailedRelatedDeliveries}>
                <Text style={styles.inlineActionText}>
                  {retryingRelatedDeliveries ? 'Retrying...' : `Retry Failed · ${failedRelatedDeliveries.length}`}
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
            relatedDeliveries.slice(0, 4).map((delivery) => (
              <Pressable
                key={delivery.id}
                onPress={() =>
                  router.push({
                    pathname: '/notifications/[id]',
                    params: { id: delivery.id },
                  })
                }
                style={styles.linkCard}>
                <Text style={styles.lineTitle}>
                  {delivery.channel} · {delivery.delivery_status}
                </Text>
                <Text style={styles.lineMeta}>
                  {new Date(delivery.created_at).toLocaleString()} · attempts {delivery.attempts}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>No notification deliveries recorded for this booking yet.</Text>
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

function LoadingReceipt({ message }: { message: string }) {
  return (
    <View style={styles.missingState}>
      <ActivityIndicator size="large" color="#1f351f" />
      <Text style={styles.missingTitle}>Loading receipt</Text>
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
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    color: '#1f2319',
    fontSize: 20,
    fontWeight: '700',
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
  inlineAction: {
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
  linkCard: {
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
