import { useRouter } from 'expo-router';
import { startTransition, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCurrency, getApiBaseUrl } from '@/lib/api';
import {
  getBuyerDeliveryRetryMode,
  getBuyerWorkspaceFilters,
  setBuyerDeliveryRetryMode,
  setBuyerWorkspaceFilters,
} from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

function formatRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'Validate First' : 'Best Effort';
}

function toggleRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'best_effort' : 'atomic';
}

export default function BuyerScreen() {
  const {
    profile,
    listings,
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [retryingFailedDeliveries, setRetryingFailedDeliveries] = useState(false);
  const [syncingPush, setSyncingPush] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'order' | 'booking'>('all');
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'queued' | 'sent' | 'failed'>('all');
  const [deliveryRecencyFilter, setDeliveryRecencyFilter] = useState<'today' | '7d' | 'all'>('7d');
  const [activityFilter, setActivityFilter] = useState<'all' | 'order' | 'booking'>('all');
  const [activityEngagementFilter, setActivityEngagementFilter] = useState<
    'all' | 'product' | 'service' | 'local' | 'hybrid'
  >('all');
  const [workspacePreset, setWorkspacePreset] = useState<'default' | 'needs-action' | 'recent-failures'>('default');
  const [deliveryRetryMode, setDeliveryRetryMode] = useState<'best_effort' | 'atomic'>('best_effort');
  const [filtersRestored, setFiltersRestored] = useState(false);

  const filteredNotifications = useMemo(
    () =>
      notifications.filter((notification) => {
        if (notificationFilter === 'all') {
          return true;
        }

        return notification.transactionKind === notificationFilter;
      }),
    [notificationFilter, notifications],
  );

  const filteredDeliveries = useMemo(
    () =>
      notificationDeliveries.filter((delivery) => {
        if (!matchesRecency(delivery.created_at, deliveryRecencyFilter)) {
          return false;
        }

        if (deliveryFilter === 'all') {
          return true;
        }

        return delivery.delivery_status === deliveryFilter;
      }),
    [deliveryFilter, deliveryRecencyFilter, notificationDeliveries],
  );

  const showOrders = activityFilter === 'all' || activityFilter === 'order';
  const showBookings = activityFilter === 'all' || activityFilter === 'booking';
  const queuedDeliveryCount = useMemo(
    () => notificationDeliveries.filter((delivery) => delivery.delivery_status === 'queued').length,
    [notificationDeliveries],
  );
  const failedDeliveryCount = useMemo(
    () => notificationDeliveries.filter((delivery) => delivery.delivery_status === 'failed').length,
    [notificationDeliveries],
  );
  const productActivityCount = useMemo(
    () =>
      orders.reduce((count, order) => {
        const matchingListings = (order.items ?? [])
          .map((item) => listings.find((listing) => listing.id === item.listing_id))
          .filter((listing): listing is (typeof listings)[number] => Boolean(listing));

        return (
          count +
          matchingListings.filter(
            (listing) => listing.type === 'product' || listing.type === 'hybrid',
          ).length
        );
      }, 0),
    [listings, orders],
  );
  const serviceActivityCount = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.listing_type === 'service' || booking.listing_type === 'hybrid',
      ).length,
    [bookings],
  );
  const localActivityCount = useMemo(() => {
    const orderLocalMatches = orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) =>
        listings.some((listing) => listing.id === item.listing_id && listing.is_local_only),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0);

    const bookingLocalMatches = bookings.filter((booking) =>
      listings.some((listing) => listing.id === booking.listing_id && listing.is_local_only),
    ).length;

    return orderLocalMatches + bookingLocalMatches;
  }, [bookings, listings, orders]);
  const hybridActivityCount = useMemo(() => {
    const orderHybridMatches = orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        listings.some((listing) => listing.id === item.listing_id && listing.type === 'hybrid'),
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0);

    const bookingHybridMatches = bookings.filter(
      (booking) => booking.listing_type === 'hybrid',
    ).length;

    return orderHybridMatches + bookingHybridMatches;
  }, [bookings, listings, orders]);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (activityEngagementFilter === 'all') {
          return true;
        }

        const matchingListings = (order.items ?? [])
          .map((item) => listings.find((listing) => listing.id === item.listing_id))
          .filter((listing): listing is (typeof listings)[number] => Boolean(listing));

        if (activityEngagementFilter === 'product') {
          return matchingListings.some(
            (listing) => listing.type === 'product' || listing.type === 'hybrid',
          );
        }
        if (activityEngagementFilter === 'local') {
          return matchingListings.some((listing) => listing.is_local_only);
        }
        if (activityEngagementFilter === 'hybrid') {
          return matchingListings.some((listing) => listing.type === 'hybrid');
        }

        return false;
      }),
    [activityEngagementFilter, listings, orders],
  );
  const filteredBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        if (activityEngagementFilter === 'all') {
          return true;
        }

        const matchingListing = listings.find((listing) => listing.id === booking.listing_id);

        if (activityEngagementFilter === 'service') {
          return booking.listing_type === 'service' || booking.listing_type === 'hybrid';
        }
        if (activityEngagementFilter === 'local') {
          return Boolean(matchingListing?.is_local_only);
        }
        if (activityEngagementFilter === 'hybrid') {
          return booking.listing_type === 'hybrid';
        }
        if (activityEngagementFilter === 'product') {
          return false;
        }

        return true;
      }),
    [activityEngagementFilter, bookings, listings],
  );

  useEffect(() => {
    void (async () => {
      const storedValue = await getBuyerWorkspaceFilters();
      if (!storedValue) {
        setFiltersRestored(true);
        return;
      }

      try {
        const storedFilters = JSON.parse(storedValue) as {
          notificationFilter?: 'all' | 'order' | 'booking';
          deliveryFilter?: 'all' | 'queued' | 'sent' | 'failed';
          deliveryRecencyFilter?: 'today' | '7d' | 'all';
          activityFilter?: 'all' | 'order' | 'booking';
          activityEngagementFilter?: 'all' | 'product' | 'service' | 'local' | 'hybrid';
          workspacePreset?: 'default' | 'needs-action' | 'recent-failures';
        };
        const storedRetryMode = await getBuyerDeliveryRetryMode();

        setNotificationFilter(storedFilters.notificationFilter ?? 'all');
        setDeliveryFilter(storedFilters.deliveryFilter ?? 'all');
        setDeliveryRecencyFilter(storedFilters.deliveryRecencyFilter ?? '7d');
        setActivityFilter(storedFilters.activityFilter ?? 'all');
        setActivityEngagementFilter(storedFilters.activityEngagementFilter ?? 'all');
        setWorkspacePreset(storedFilters.workspacePreset ?? 'default');
        setDeliveryRetryMode(
          storedRetryMode === 'atomic' ? 'atomic' : 'best_effort',
        );
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

    void setBuyerWorkspaceFilters(
      JSON.stringify({
        notificationFilter,
        deliveryFilter,
        deliveryRecencyFilter,
        activityFilter,
        activityEngagementFilter,
        workspacePreset,
      }),
    );
    void setBuyerDeliveryRetryMode(deliveryRetryMode);
  }, [
    activityFilter,
    activityEngagementFilter,
    deliveryRetryMode,
    deliveryFilter,
    deliveryRecencyFilter,
    filtersRestored,
    notificationFilter,
    workspacePreset,
  ]);

  function applyBuyerPreset(preset: 'default' | 'needs-action' | 'recent-failures') {
    setWorkspacePreset(preset);

    if (preset === 'default') {
      setNotificationFilter('all');
      setDeliveryFilter('all');
      setDeliveryRecencyFilter('7d');
      setActivityFilter('all');
      setActivityEngagementFilter('all');
      return;
    }

    if (preset === 'needs-action') {
      setNotificationFilter('all');
      setDeliveryFilter('queued');
      setDeliveryRecencyFilter('today');
      setActivityFilter('all');
      setActivityEngagementFilter('all');
      return;
    }

    setNotificationFilter('all');
    setDeliveryFilter('failed');
    setDeliveryRecencyFilter('7d');
    setActivityFilter('all');
    setActivityEngagementFilter('all');
  }

  function handleAuth() {
    setLocalError(null);
    setActionMessage(null);
    setActionDetails([]);

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

  function retryFailedDeliveriesInView() {
    const failedDeliveries = filteredDeliveries.filter((delivery) => delivery.delivery_status === 'failed');
    if (failedDeliveries.length === 0) {
      return;
    }

    startTransition(async () => {
      try {
        setLocalError(null);
        setActionMessage(null);
        setActionDetails([]);
        setRetryingFailedDeliveries(true);
        const result = await retryNotificationDelivery(
          failedDeliveries.map((delivery) => delivery.id),
          deliveryRetryMode,
        );

        setActionMessage(
          result.failed.length === 0
            ? `Retried ${result.succeeded_ids.length} failed ${
                result.succeeded_ids.length === 1 ? 'delivery' : 'deliveries'
              } in view using ${formatRetryMode(deliveryRetryMode)} mode.`
            : result.succeeded_ids.length > 0
              ? `Retried ${result.succeeded_ids.length} of ${failedDeliveries.length} failed deliveries in view using ${formatRetryMode(deliveryRetryMode)} mode. ${result.failed.length} failed again.`
              : `Unable to retry ${failedDeliveries.length} failed deliveries in view using ${formatRetryMode(deliveryRetryMode)} mode.`,
        );
        setActionDetails(
          result.failed.map(
            (failure: { id: string; detail: string }) =>
              `${failure.id.slice(0, 8)} · ${failure.detail}`,
          ),
        );
      } catch (err) {
        setLocalError(
          err instanceof Error ? err.message : 'Unable to retry filtered failed deliveries',
        );
        setActionDetails([]);
      } finally {
        setRetryingFailedDeliveries(false);
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
        {actionMessage ? <Text style={styles.successText}>{actionMessage}</Text> : null}
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
        <Text style={styles.helperText}>API base URL: {getApiBaseUrl()}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Workspace Views</Text>
        <View style={styles.filterRow}>
          <FilterChip
            label="Default"
            active={workspacePreset === 'default'}
            onPress={() => applyBuyerPreset('default')}
          />
          <FilterChip
            label={`Needs Action · ${queuedDeliveryCount}`}
            tone={queuedDeliveryCount > 0 ? 'queued' : 'default'}
            active={workspacePreset === 'needs-action'}
            onPress={() => applyBuyerPreset('needs-action')}
          />
          <FilterChip
            label={`Recent Failures · ${failedDeliveryCount}`}
            tone={failedDeliveryCount > 0 ? 'failed' : 'default'}
            active={workspacePreset === 'recent-failures'}
            onPress={() => applyBuyerPreset('recent-failures')}
          />
        </View>
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

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Activity Mix</Text>
        <Text style={styles.helperText}>
          A quick read on the kinds of listings you are engaging with most.
        </Text>
        <View style={styles.snapshotGrid}>
          <SnapshotCard
            label="Product Activity"
            value={String(productActivityCount)}
            active={activityEngagementFilter === 'product'}
            onPress={() => setActivityEngagementFilter('product')}
          />
          <SnapshotCard
            label="Service Activity"
            value={String(serviceActivityCount)}
            active={activityEngagementFilter === 'service'}
            onPress={() => setActivityEngagementFilter('service')}
          />
          <SnapshotCard
            label="Local-First"
            value={String(localActivityCount)}
            active={activityEngagementFilter === 'local'}
            onPress={() => setActivityEngagementFilter('local')}
          />
          <SnapshotCard
            label="Hybrid Mix"
            value={String(hybridActivityCount)}
            active={activityEngagementFilter === 'hybrid'}
            onPress={() => setActivityEngagementFilter('hybrid')}
          />
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="All Engagement"
            active={activityEngagementFilter === 'all'}
            onPress={() => setActivityEngagementFilter('all')}
          />
          <FilterChip
            label="Product"
            active={activityEngagementFilter === 'product'}
            onPress={() => setActivityEngagementFilter('product')}
          />
          <FilterChip
            label="Service"
            active={activityEngagementFilter === 'service'}
            onPress={() => setActivityEngagementFilter('service')}
          />
          <FilterChip
            label="Local-First"
            active={activityEngagementFilter === 'local'}
            onPress={() => setActivityEngagementFilter('local')}
          />
          <FilterChip
            label="Hybrid"
            active={activityEngagementFilter === 'hybrid'}
            onPress={() => setActivityEngagementFilter('hybrid')}
          />
        </View>
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
                    setActionMessage(null);
                    setActionDetails([]);
                    setSyncingPush(true);
                    const synced = await syncPushToken();
                    if (!synced && !profile.expo_push_token) {
                      setLocalError('Push token sync requires a development build on a real device, notification permission, and EXPO_PUBLIC_EAS_PROJECT_ID. Expo Go and emulators will not register a remote push token.');
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

      <View style={[styles.panel, unreadNotificationCount > 0 && styles.panelUnread]}>
        <View style={styles.notificationsHeader}>
          <Text style={styles.panelTitle}>Notifications · {filteredNotifications.length}</Text>
          {profile ? (
            <Pressable style={styles.markSeenButton} onPress={() => void markNotificationsSeen()}>
              <Text style={styles.markSeenButtonText}>Mark seen</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            active={notificationFilter === 'all'}
            onPress={() => setNotificationFilter('all')}
          />
          <FilterChip
            label="Orders"
            active={notificationFilter === 'order'}
            onPress={() => setNotificationFilter('order')}
          />
          <FilterChip
            label="Bookings"
            active={notificationFilter === 'booking'}
            onPress={() => setNotificationFilter('booking')}
          />
        </View>
        {filteredNotifications.length > 0 ? (
          filteredNotifications.slice(0, 6).map((notification) => (
            <Pressable
              key={notification.id}
              onPress={() =>
                router.push({
                  pathname: '/transactions/[kind]/[id]',
                  params: {
                    kind: notification.transactionKind,
                    id: notification.transactionId,
                  },
                })
              }
              style={[styles.notificationCard, unreadNotificationCount > 0 && styles.notificationCardUnread]}>
              <Text style={styles.activityLabel}>{notification.title}</Text>
              <Text style={styles.activityMeta}>
                {new Date(notification.createdAt).toLocaleString()}
              </Text>
              <Text style={styles.activityNote}>{notification.message}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.emptyText}>Seller updates will show up here.</Text>
        )}
      </View>

      <View style={styles.panel}>
        <View style={styles.notificationsHeader}>
          <Text style={styles.panelTitle}>Delivery History · {filteredDeliveries.length}</Text>
          {filteredDeliveries.some((delivery) => delivery.delivery_status === 'failed') ? (
            <Pressable style={styles.markSeenButton} onPress={retryFailedDeliveriesInView}>
              <Text style={styles.markSeenButtonText}>
                {retryingFailedDeliveries ? 'Retrying...' : 'Retry Failed'}
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
        <View style={styles.modeRow}>
          <Text style={styles.modeCaption}>Retry mode</Text>
          <View style={styles.filterRow}>
            <FilterChip
              label={`Best Effort${deliveryRetryMode === 'best_effort' ? ' · Active' : ''}`}
              active={deliveryRetryMode === 'best_effort'}
              onPress={() => setDeliveryRetryMode('best_effort')}
            />
            <FilterChip
              label={`Validate First${deliveryRetryMode === 'atomic' ? ' · Active' : ''}`}
              active={deliveryRetryMode === 'atomic'}
              onPress={() => setDeliveryRetryMode('atomic')}
            />
          </View>
          <Text style={styles.helperText}>
            Current mode: {formatRetryMode(deliveryRetryMode)}
          </Text>
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            active={deliveryFilter === 'all'}
            onPress={() => setDeliveryFilter('all')}
          />
          <FilterChip
            label="Queued"
            active={deliveryFilter === 'queued'}
            onPress={() => setDeliveryFilter('queued')}
          />
          <FilterChip
            label="Sent"
            active={deliveryFilter === 'sent'}
            onPress={() => setDeliveryFilter('sent')}
          />
          <FilterChip
            label="Failed"
            active={deliveryFilter === 'failed'}
            onPress={() => setDeliveryFilter('failed')}
          />
          <FilterChip
            label="Today"
            active={deliveryRecencyFilter === 'today'}
            onPress={() => setDeliveryRecencyFilter('today')}
          />
          <FilterChip
            label="7 Days"
            active={deliveryRecencyFilter === '7d'}
            onPress={() => setDeliveryRecencyFilter('7d')}
          />
          <FilterChip
            label="All Time"
            active={deliveryRecencyFilter === 'all'}
            onPress={() => setDeliveryRecencyFilter('all')}
          />
        </View>
        {filteredDeliveries.length > 0 ? (
          filteredDeliveries.slice(0, 8).map((delivery) => (
            <View
              key={delivery.id}
              style={[
                styles.deliveryCard,
                delivery.delivery_status === 'queued'
                  ? styles.deliveryCardQueued
                  : delivery.delivery_status === 'failed'
                    ? styles.deliveryCardFailed
                    : null,
              ]}>
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
                        setActionMessage(null);
                        setActionDetails([]);
                        setRetryingDeliveryId(delivery.id);
                        await retryNotificationDelivery(delivery.id);
                        setActionMessage('Retried this delivery.');
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
        <View style={styles.notificationsHeader}>
          <Text style={styles.panelTitle}>
            Recent Activity · {(showOrders ? filteredOrders.length : 0) + (showBookings ? filteredBookings.length : 0)}
          </Text>
          {activityFilter !== 'all' || activityEngagementFilter !== 'all' ? (
            <Pressable
              style={styles.markSeenButton}
              onPress={() => {
                setActivityFilter('all');
                setActivityEngagementFilter('all');
              }}>
              <Text style={styles.markSeenButtonText}>Clear Filter</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            active={activityFilter === 'all'}
            onPress={() => setActivityFilter('all')}
          />
          <FilterChip
            label="Orders"
            active={activityFilter === 'order'}
            onPress={() => setActivityFilter('order')}
          />
          <FilterChip
            label="Bookings"
            active={activityFilter === 'booking'}
            onPress={() => setActivityFilter('booking')}
          />
        </View>
        {showOrders && filteredOrders.length > 0 ? (
          filteredOrders.map((order) => (
            <Pressable
              key={order.id}
              onPress={() =>
                router.push({
                  pathname: '/transactions/[kind]/[id]',
                  params: { kind: 'order', id: order.id },
                })
              }
              style={styles.activityCard}>
              <Text style={styles.activityLabel}>Order</Text>
              <Text style={styles.activityValue}>{order.status}</Text>
              <Text style={styles.activityMeta}>
                {formatCurrency(order.total_cents, order.currency)} via {order.fulfillment}
              </Text>
              {order.seller_response_note ? (
                <Text style={styles.activityNote}>{order.seller_response_note}</Text>
              ) : null}
            </Pressable>
          ))
        ) : null}
        {showBookings && filteredBookings.length > 0 ? (
          filteredBookings.map((booking) => (
            <Pressable
              key={booking.id}
              onPress={() =>
                router.push({
                  pathname: '/transactions/[kind]/[id]',
                  params: { kind: 'booking', id: booking.id },
                })
              }
              style={styles.activityCard}>
              <Text style={styles.activityLabel}>Booking</Text>
              <Text style={styles.activityValue}>{booking.status}</Text>
              <Text style={styles.activityMeta}>
                {new Date(booking.scheduled_start).toLocaleString()}
              </Text>
              {booking.seller_response_note ? (
                <Text style={styles.activityNote}>{booking.seller_response_note}</Text>
              ) : null}
            </Pressable>
          ))
        ) : null}
        {((showOrders && filteredOrders.length === 0) || (showBookings && filteredBookings.length === 0)) &&
        (!showOrders || filteredOrders.length === 0) &&
        (!showBookings || filteredBookings.length === 0) ? (
          <Text style={styles.emptyText}>
            {activityFilter === 'order'
              ? 'No orders yet. Open a listing and place one.'
              : activityFilter === 'booking'
                ? 'No bookings yet. Use a service or hybrid listing.'
                : activityEngagementFilter !== 'all'
                  ? 'No buyer activity matches this engagement filter yet.'
                  : 'No buyer activity yet.'}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function FilterChip({
  label,
  active,
  tone = 'default',
  onPress,
}: {
  label: string;
  active: boolean;
  tone?: 'default' | 'queued' | 'failed';
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.filterChip,
        tone === 'queued' && styles.filterChipQueued,
        tone === 'failed' && styles.filterChipFailed,
        active && styles.filterChipActive,
      ]}
      onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SnapshotCard({
  label,
  value,
  active = false,
  onPress,
}: {
  label: string;
  value: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <View style={[styles.snapshotCard, active && styles.snapshotCardActive]}>
      <Text style={styles.snapshotLabel}>{label}</Text>
      <Text style={styles.snapshotValue}>{value}</Text>
    </View>
  );

  if (!onPress) {
    return content;
  }

  return <Pressable onPress={onPress}>{content}</Pressable>;
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

function matchesRecency(value: string, filter: 'today' | '7d' | 'all') {
  if (filter === 'all') {
    return true;
  }

  const createdAt = new Date(value).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (filter === 'today') {
    return now - createdAt <= dayMs;
  }

  return now - createdAt <= dayMs * 7;
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
  panelUnread: {
    borderWidth: 1,
    borderColor: '#d88c43',
    backgroundColor: '#fff3e4',
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
  filterChipQueued: {
    borderColor: '#ccb68c',
    backgroundColor: '#fbf4e4',
  },
  filterChipFailed: {
    borderColor: '#d26d5f',
    backgroundColor: '#fff0ed',
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
  notificationCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6bf',
    backgroundColor: '#f7efe2',
    padding: 14,
    gap: 6,
  },
  notificationCardUnread: {
    borderColor: '#d88c43',
    backgroundColor: '#fff1dd',
  },
  deliveryCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6bf',
    backgroundColor: '#f7efe2',
    padding: 14,
    gap: 8,
  },
  deliveryCardQueued: {
    borderColor: '#ccb68c',
    backgroundColor: '#fbf4e4',
  },
  deliveryCardFailed: {
    borderColor: '#d26d5f',
    backgroundColor: '#fff0ed',
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
  successText: {
    color: '#1f351f',
    fontSize: 13,
    lineHeight: 19,
  },
  feedbackList: {
    gap: 4,
  },
  feedbackDetailText: {
    color: '#5f5548',
    fontSize: 12,
    lineHeight: 18,
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
  snapshotCardActive: {
    backgroundColor: '#dfe8ca',
    borderWidth: 1,
    borderColor: '#8aa05b',
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
