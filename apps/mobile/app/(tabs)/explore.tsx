import { Link, useRouter } from 'expo-router';
import { startTransition, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCurrency, getApiBaseUrl } from '@/lib/api';
import { useBuyerSession } from '@/providers/buyer-session';

export default function BuyerScreen() {
  const {
    profile,
    orders,
    bookings,
    notifications,
    notificationDeliveries,
    unreadNotificationCount,
    loading,
    restoring,
    error,
    signIn,
    signUp,
    signOut,
    markNotificationsSeen,
    updateNotificationPreferences,
    syncPushToken,
    retryNotificationDelivery,
  } = useBuyerSession();
  const router = useRouter();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [syncingPush, setSyncingPush] = useState(false);

  function handleAuth() {
    setLocalError(null);

    startTransition(async () => {
      try {
        if (mode === 'sign-in') {
          await signIn(email, password);
        } else {
          await signUp(email, password, {
            full_name: fullName || null,
            username: username || null,
            city: 'Dallas',
            state: 'TX',
            country: 'USA',
          });
        }
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Unable to continue');
      }
    });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Buyer workspace</Text>
        <Text style={styles.title}>Authenticate the demo buyer and transact against live data.</Text>
        <Text style={styles.subtitle}>
          Orders and bookings created here land in the real Supabase tables and show up in the web
          seller workspace.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Buyer Onboarding</Text>
        {profile ? (
          <Pressable style={styles.signOutButton} onPress={() => void signOut()}>
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </Pressable>
        ) : null}
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeButton, mode === 'sign-in' && styles.modeButtonActive]}
            onPress={() => setMode('sign-in')}>
            <Text style={[styles.modeButtonText, mode === 'sign-in' && styles.modeButtonTextActive]}>
              Sign In
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'sign-up' && styles.modeButtonActive]}
            onPress={() => setMode('sign-up')}>
            <Text style={[styles.modeButtonText, mode === 'sign-up' && styles.modeButtonTextActive]}>
              Create Account
            </Text>
          </Pressable>
        </View>
        <TextInput
          autoCapitalize="none"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="#8d8376"
        />
        <TextInput
          autoCapitalize="none"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#8d8376"
        />
        {mode === 'sign-up' ? (
          <>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Full name"
              placeholderTextColor="#8d8376"
            />
            <TextInput
              autoCapitalize="none"
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor="#8d8376"
            />
          </>
        ) : null}
        <Pressable style={styles.actionButton} onPress={handleAuth}>
          <Text style={styles.actionButtonText}>
            {loading || restoring ? 'Working...' : mode === 'sign-in' ? 'Sign In' : 'Create Buyer Account'}
          </Text>
        </Pressable>
        {localError || error ? (
          <Text style={styles.errorText}>{localError ?? error}</Text>
        ) : null}
        <Text style={styles.helperText}>API base URL: {getApiBaseUrl()}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Buyer Snapshot</Text>
        {profile ? (
          <View style={styles.snapshotGrid}>
            <SnapshotCard label="Username" value={profile.username ?? 'not set'} />
            <SnapshotCard label="Orders" value={String(orders.length)} />
            <SnapshotCard label="Bookings" value={String(bookings.length)} />
            <SnapshotCard label="Unread" value={String(unreadNotificationCount)} />
            <SnapshotCard
              label="Email jobs"
              value={String(notificationDeliveries.filter((delivery) => delivery.channel === 'email').length)}
            />
          </View>
        ) : (
          <Text style={styles.emptyText}>Sign in to see live buyer activity.</Text>
        )}
      </View>

      {profile ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Delivery Preferences</Text>
          <PreferenceRow
            label="Email alerts"
            value={profile.email_notifications_enabled ?? true}
            onPress={() =>
              void updateNotificationPreferences({
                email_notifications_enabled: !(profile.email_notifications_enabled ?? true),
              })
            }
          />
          <PreferenceRow
            label="Push alerts"
            value={profile.push_notifications_enabled ?? true}
            onPress={() =>
              void updateNotificationPreferences({
                push_notifications_enabled: !(profile.push_notifications_enabled ?? true),
              })
            }
          />
          <PreferenceRow
            label="Marketing updates"
            value={profile.marketing_notifications_enabled ?? false}
            onPress={() =>
              void updateNotificationPreferences({
                marketing_notifications_enabled: !(profile.marketing_notifications_enabled ?? false),
              })
            }
          />
          <View style={styles.pushStatusRow}>
            <View style={styles.pushStatusCopy}>
              <Text style={styles.preferenceLabel}>Push token</Text>
              <Text style={styles.helperText}>
                {profile.expo_push_token
                  ? 'Registered and ready for Expo push delivery.'
                  : profile.push_notifications_enabled === false
                    ? 'Push alerts are disabled for this buyer.'
                    : 'No Expo push token is stored yet. Run sync on a real device.'}
              </Text>
            </View>
            <Pressable
              style={[styles.syncPushButton, syncingPush && styles.syncPushButtonDisabled]}
              disabled={syncingPush}
              onPress={() =>
                startTransition(async () => {
                  try {
                    setLocalError(null);
                    setSyncingPush(true);
                    const synced = await syncPushToken();
                    if (!synced && !profile.expo_push_token) {
                      setLocalError('Push token sync requires a real device, notification permission, and EXPO_PUBLIC_EAS_PROJECT_ID.');
                    }
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : 'Unable to sync push token');
                  } finally {
                    setSyncingPush(false);
                  }
                })
              }>
              <Text style={styles.syncPushButtonText}>
                {syncingPush ? 'Syncing...' : 'Sync Push'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.panel}>
        <View style={styles.notificationsHeader}>
          <Text style={styles.panelTitle}>Notifications</Text>
          {profile ? (
            <Pressable style={styles.markSeenButton} onPress={() => void markNotificationsSeen()}>
              <Text style={styles.markSeenButtonText}>Mark seen</Text>
            </Pressable>
          ) : null}
        </View>
        {notifications.length > 0 ? (
          notifications.slice(0, 6).map((notification) => (
            <Link
              key={notification.id}
              href={{
                pathname: '/transactions/[kind]/[id]',
                params: {
                  kind: notification.transactionKind,
                  id: notification.transactionId,
                },
              }}
              asChild>
              <Pressable style={styles.notificationCard}>
                <Text style={styles.activityLabel}>{notification.title}</Text>
                <Text style={styles.activityMeta}>
                  {new Date(notification.createdAt).toLocaleString()}
                </Text>
                <Text style={styles.activityNote}>{notification.message}</Text>
              </Pressable>
            </Link>
          ))
        ) : (
          <Text style={styles.emptyText}>Seller updates will show up here.</Text>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Delivery History</Text>
        {notificationDeliveries.length > 0 ? (
          notificationDeliveries.slice(0, 8).map((delivery) => (
            <View key={delivery.id} style={styles.deliveryCard}>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/notifications/[id]',
                    params: { id: delivery.id },
                  })
                }
                style={styles.deliveryBody}>
                <View style={styles.deliveryHeader}>
                  <Text style={styles.activityLabel}>
                    {delivery.channel} delivery
                  </Text>
                  <View
                    style={[
                      styles.deliveryStatusPill,
                      delivery.delivery_status === 'sent'
                        ? styles.deliveryStatusSent
                        : delivery.delivery_status === 'failed'
                          ? styles.deliveryStatusFailed
                          : styles.deliveryStatusQueued,
                    ]}>
                    <Text style={styles.deliveryStatusText}>{delivery.delivery_status}</Text>
                  </View>
                </View>
                <Text style={styles.activityValue}>
                  {getDeliverySummary(delivery.payload)}
                </Text>
                <Text style={styles.activityMeta}>
                  {new Date(delivery.created_at).toLocaleString()} • attempts {delivery.attempts}
                </Text>
                {delivery.failure_reason ? (
                  <Text style={styles.deliveryFailure}>{delivery.failure_reason}</Text>
                ) : (
                  <Text style={styles.activityNote}>
                    {getDeliveryRecipient(delivery.payload)}
                  </Text>
                )}
              </Pressable>
              {delivery.delivery_status === 'failed' ? (
                <Pressable
                  onPress={() =>
                    startTransition(async () => {
                      try {
                        setLocalError(null);
                        setRetryingDeliveryId(delivery.id);
                        await retryNotificationDelivery(delivery.id);
                      } catch (err) {
                        setLocalError(
                          err instanceof Error ? err.message : 'Unable to retry notification delivery',
                        );
                      } finally {
                        setRetryingDeliveryId(null);
                      }
                    })
                  }
                  style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>
                    {retryingDeliveryId === delivery.id ? 'Retrying...' : 'Retry Delivery'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>
            Email and push delivery attempts for your account will show up here.
          </Text>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Recent Orders</Text>
        {orders.length > 0 ? (
          orders.map((order) => (
            <Link
              key={order.id}
              href={{ pathname: '/transactions/[kind]/[id]', params: { kind: 'order', id: order.id } }}
              asChild>
              <Pressable style={styles.activityCard}>
                <Text style={styles.activityLabel}>Order</Text>
                <Text style={styles.activityValue}>{order.status}</Text>
                <Text style={styles.activityMeta}>
                  {formatCurrency(order.total_cents, order.currency)} via {order.fulfillment}
                </Text>
                {order.seller_response_note ? (
                  <Text style={styles.activityNote}>{order.seller_response_note}</Text>
                ) : null}
              </Pressable>
            </Link>
          ))
        ) : (
          <Text style={styles.emptyText}>No orders yet. Open a listing and place one.</Text>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Recent Bookings</Text>
        {bookings.length > 0 ? (
          bookings.map((booking) => (
            <Link
              key={booking.id}
              href={{ pathname: '/transactions/[kind]/[id]', params: { kind: 'booking', id: booking.id } }}
              asChild>
              <Pressable style={styles.activityCard}>
                <Text style={styles.activityLabel}>Booking</Text>
                <Text style={styles.activityValue}>{booking.status}</Text>
                <Text style={styles.activityMeta}>
                  {new Date(booking.scheduled_start).toLocaleString()}
                </Text>
                {booking.seller_response_note ? (
                  <Text style={styles.activityNote}>{booking.seller_response_note}</Text>
                ) : null}
              </Pressable>
            </Link>
          ))
        ) : (
          <Text style={styles.emptyText}>No bookings yet. Use a service or hybrid listing.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.snapshotCard}>
      <Text style={styles.snapshotLabel}>{label}</Text>
      <Text style={styles.snapshotValue}>{value}</Text>
    </View>
  );
}

function PreferenceRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.preferenceRow} onPress={onPress}>
      <Text style={styles.preferenceLabel}>{label}</Text>
      <View style={[styles.preferencePill, value ? styles.preferencePillOn : styles.preferencePillOff]}>
        <Text style={styles.preferencePillText}>{value ? 'On' : 'Off'}</Text>
      </View>
    </Pressable>
  );
}

function getDeliverySummary(payload: Record<string, unknown>) {
  const subject = typeof payload.subject === 'string' ? payload.subject : null;
  const eventType = typeof payload.event_type === 'string' ? payload.event_type : null;
  const status = typeof payload.status === 'string' ? payload.status : null;

  return subject ?? eventType ?? status ?? 'Notification delivery';
}

function getDeliveryRecipient(payload: Record<string, unknown>) {
  const recipient = payload.to;

  if (typeof recipient === 'string') {
    return recipient;
  }

  if (Array.isArray(recipient)) {
    return recipient.filter((value): value is string => typeof value === 'string').join(', ');
  }

  return 'Recipient resolved from your account profile';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#efe4cf',
  },
  activityNote: {
    color: '#1f351f',
    fontSize: 13,
    lineHeight: 20,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 18,
  },
  hero: {
    backgroundColor: '#8f3f17',
    borderRadius: 28,
    padding: 22,
    gap: 10,
  },
  eyebrow: {
    color: '#ffe8b7',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff8ee',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 35,
  },
  subtitle: {
    color: '#f4d5c4',
    fontSize: 15,
    lineHeight: 23,
  },
  panel: {
    backgroundColor: '#fff8ee',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  preferenceRow: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadbc4',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  preferenceLabel: {
    color: '#1f2319',
    fontSize: 15,
    fontWeight: '600',
  },
  preferencePill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  preferencePillOn: {
    backgroundColor: '#1f351f',
  },
  preferencePillOff: {
    backgroundColor: '#b4a489',
  },
  preferencePillText: {
    color: '#fff8ee',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pushStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  pushStatusCopy: {
    flex: 1,
    gap: 4,
  },
  syncPushButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  syncPushButtonDisabled: {
    opacity: 0.55,
  },
  syncPushButtonText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  notificationsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  notificationCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6bf',
    backgroundColor: '#f7efe2',
    padding: 14,
    gap: 6,
  },
  deliveryCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6bf',
    backgroundColor: '#f7efe2',
    padding: 14,
    gap: 8,
  },
  deliveryBody: {
    gap: 8,
  },
  deliveryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  deliveryStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deliveryStatusQueued: {
    backgroundColor: '#ccb68c',
  },
  deliveryStatusSent: {
    backgroundColor: '#1f351f',
  },
  deliveryStatusFailed: {
    backgroundColor: '#a13428',
  },
  deliveryStatusText: {
    color: '#fff8ee',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  deliveryFailure: {
    color: '#a13428',
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  markSeenButton: {
    borderRadius: 999,
    backgroundColor: '#1f351f',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  markSeenButtonText: {
    color: '#fff8ee',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#1f2319',
    borderColor: '#1f2319',
  },
  modeButtonText: {
    color: '#4d4338',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modeButtonTextActive: {
    color: '#fff8ee',
  },
  panelTitle: {
    color: '#1f2319',
    fontSize: 20,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#f4eadb',
    borderRadius: 16,
    color: '#1f2319',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  actionButton: {
    backgroundColor: '#1f351f',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff8ee',
    fontSize: 14,
    fontWeight: '700',
  },
  signOutButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signOutButtonText: {
    color: '#4d4338',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  helperText: {
    color: '#6f6556',
    fontSize: 12,
  },
  errorText: {
    color: '#a13428',
    fontSize: 13,
    lineHeight: 19,
  },
  snapshotGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  snapshotCard: {
    flex: 1,
    backgroundColor: '#f4eadb',
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  snapshotLabel: {
    color: '#6f6556',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  snapshotValue: {
    color: '#1f2319',
    fontSize: 18,
    fontWeight: '700',
  },
  activityCard: {
    backgroundColor: '#f4eadb',
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  activityLabel: {
    color: '#6f6556',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  activityValue: {
    color: '#1f2319',
    fontSize: 17,
    fontWeight: '700',
  },
  activityMeta: {
    color: '#5f5548',
    fontSize: 13,
    lineHeight: 19,
  },
  emptyText: {
    color: '#5f5548',
    fontSize: 14,
    lineHeight: 21,
  },
});
