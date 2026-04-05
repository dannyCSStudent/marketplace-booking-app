import {
  createContext,
  useCallback,
  useEffect,
  startTransition,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getSupabaseRealtimeClient } from '@repo/auth';

import {
  ApiError,
  buildNotifications,
  createBuyerBooking,
  createBuyerOrder,
  createBuyerProfile,
  loadBuyerDashboard,
  loadBuyerNotificationDeliveries,
  loadPublicListings,
  refreshBuyerSession,
  registerBuyerExpoPushToken,
  retryBuyerNotificationDelivery,
  signInBuyer,
  signUpBuyer,
  type Booking,
  type BuyerSession,
  type Listing,
  type NotificationDelivery,
  type NotificationDeliveryBulkRetryResult,
  type NotificationItem,
  type Order,
  type Profile,
  type ProfilePayload,
  type ProfileUpdateInput,
  updateBuyerProfile,
} from '@/lib/api';
import { getExpoPushToken } from '@/lib/push-notifications';
import {
  clearBuyerAccessToken,
  clearBuyerNotificationsSeenAt,
  clearBuyerRefreshToken,
  getBuyerAccessToken,
  getBuyerNotificationsSeenAt,
  getBuyerRefreshToken,
  setBuyerAccessToken,
  setBuyerNotificationsSeenAt,
  setBuyerRefreshToken,
} from '@/lib/session-storage';

type BuyerSessionValue = {
  session: BuyerSession | null;
  profile: Profile | null;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
  notifications: NotificationItem[];
  notificationDeliveries: NotificationDelivery[];
  unreadNotificationCount: number;
  loading: boolean;
  refreshing: boolean;
  restoring: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profile: ProfilePayload) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMarketplace: () => Promise<void>;
  markNotificationsSeen: () => Promise<void>;
  updateNotificationPreferences: (input: {
    email_notifications_enabled?: boolean;
    push_notifications_enabled?: boolean;
    marketing_notifications_enabled?: boolean;
  }) => Promise<void>;
  syncPushToken: () => Promise<boolean>;
  retryNotificationDelivery: (
    deliveryIdOrIds: string | string[],
    executionMode?: 'best_effort' | 'atomic',
  ) => Promise<void | NotificationDeliveryBulkRetryResult>;
  createOrder: (input: {
    sellerId: string;
    listingId: string;
    quantity: number;
    fulfillment: string;
    notes?: string;
  }) => Promise<Order>;
  createBooking: (input: {
    sellerId: string;
    listingId: string;
    scheduledStart: string;
    scheduledEnd: string;
    notes?: string;
  }) => Promise<Booking>;
};

const BuyerSessionContext = createContext<BuyerSessionValue | null>(null);
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function isExpiredAuthError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403 || error.message.includes('bad_jwt');
  }

  if (error instanceof Error) {
    return error.message.includes('bad_jwt') || error.message.includes('token is expired');
  }

  return false;
}

export function BuyerSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BuyerSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([]);
  const [notificationsSeenAt, setNotificationsSeenAtState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [syncingPushToken, setSyncingPushToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearSessionState = useCallback((message?: string) => {
    startTransition(() => {
      setSession(null);
      setProfile(null);
      setOrders([]);
      setBookings([]);
      setNotificationDeliveries([]);
      setNotificationsSeenAtState(null);
      setError(message ?? null);
    });
  }, []);

  const refreshMarketplace = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const listings = await loadPublicListings();
      startTransition(() => {
        setListings(listings);
      });

      if (session) {
        const [dashboard, deliveries] = await Promise.all([
          loadBuyerDashboard(session.access_token),
          loadBuyerNotificationDeliveries(session.access_token),
        ]);

        startTransition(() => {
          setListings(dashboard.listings);
          setProfile(dashboard.profile);
          setOrders(dashboard.orders);
          setBookings(dashboard.bookings);
          setNotificationDeliveries(deliveries);
        });
      }
    } catch (err) {
    if (isExpiredAuthError(err)) {
        await clearBuyerAccessToken();
        await clearBuyerRefreshToken();
        await clearBuyerNotificationsSeenAt();
        clearSessionState('Your session expired. Sign in again.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to refresh marketplace');
      }
    } finally {
      setRefreshing(false);
    }
  }, [clearSessionState, session]);

  const notifications = useMemo(
    () => buildNotifications({ audience: 'buyer', orders, bookings }),
    [orders, bookings],
  );

  const unreadNotificationCount = useMemo(() => {
    if (!notificationsSeenAt) {
      return notifications.length;
    }

    const seenAt = new Date(notificationsSeenAt).getTime();
    return notifications.filter((item) => new Date(item.createdAt).getTime() > seenAt).length;
  }, [notifications, notificationsSeenAt]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const nextSession = await signInBuyer(email, password);
      const [dashboard, deliveries] = await Promise.all([
        loadBuyerDashboard(nextSession.access_token),
        loadBuyerNotificationDeliveries(nextSession.access_token),
      ]);
      await setBuyerAccessToken(nextSession.access_token);
      await setBuyerRefreshToken(nextSession.refresh_token);

      startTransition(() => {
        setSession(nextSession);
        setListings(dashboard.listings);
        setProfile(dashboard.profile);
        setOrders(dashboard.orders);
        setBookings(dashboard.bookings);
        setNotificationDeliveries(deliveries);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, profileInput: ProfilePayload) => {
    setLoading(true);
    setError(null);

    try {
      const nextSession = await signUpBuyer(email, password);
      await createBuyerProfile(nextSession.access_token, profileInput);
      const [dashboard, deliveries] = await Promise.all([
        loadBuyerDashboard(nextSession.access_token),
        loadBuyerNotificationDeliveries(nextSession.access_token),
      ]);
      await setBuyerAccessToken(nextSession.access_token);
      await setBuyerRefreshToken(nextSession.refresh_token);

      startTransition(() => {
        setSession(nextSession);
        setListings(dashboard.listings);
        setProfile(dashboard.profile);
        setOrders(dashboard.orders);
        setBookings(dashboard.bookings);
        setNotificationDeliveries(deliveries);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearBuyerAccessToken();
    await clearBuyerRefreshToken();
    await clearBuyerNotificationsSeenAt();
    clearSessionState();
    await refreshMarketplace();
  }, [clearSessionState, refreshMarketplace]);

  const markNotificationsSeen = useCallback(async () => {
    const latestTimestamp = notifications[0]?.createdAt ?? new Date().toISOString();
    await setBuyerNotificationsSeenAt(latestTimestamp);
    setNotificationsSeenAtState(latestTimestamp);
  }, [notifications]);

  const updateNotificationPreferences = useCallback(async (input: {
    email_notifications_enabled?: boolean;
    push_notifications_enabled?: boolean;
    marketing_notifications_enabled?: boolean;
  }) => {
    if (!session) {
      throw new Error('Sign in before updating notification settings.');
    }

    const updatedProfile = await updateBuyerProfile(
      session.access_token,
      input as ProfileUpdateInput,
    );

    startTransition(() => {
      setProfile(updatedProfile);
    });
  }, [session]);

  const retryNotificationDelivery = useCallback(async (
    deliveryIdOrIds: string | string[],
    executionMode: 'best_effort' | 'atomic' = 'best_effort',
  ) => {
    if (!session) {
      throw new Error('Sign in before retrying notification deliveries.');
    }

    const result = await retryBuyerNotificationDelivery(
      session.access_token,
      deliveryIdOrIds,
      executionMode,
    );
    const deliveries = await loadBuyerNotificationDeliveries(session.access_token);

    startTransition(() => {
      setNotificationDeliveries(deliveries);
    });

    return result;
  }, [session]);

  const syncPushToken = useCallback(async () => {
    if (!session?.access_token || !profile) {
      return false;
    }

    if (profile.push_notifications_enabled === false) {
      return false;
    }

    setSyncingPushToken(true);

    try {
      const expoPushToken = await getExpoPushToken();
      if (!expoPushToken) {
        return false;
      }

      if (expoPushToken === profile.expo_push_token) {
        return true;
      }

      const updatedProfile = await registerBuyerExpoPushToken(session.access_token, expoPushToken);
      startTransition(() => {
        setProfile(updatedProfile);
      });
      return true;
    } finally {
      setSyncingPushToken(false);
    }
  }, [profile, session]);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getBuyerAccessToken();
        const refreshToken = await getBuyerRefreshToken();
        const storedNotificationsSeenAt = await getBuyerNotificationsSeenAt();
        const listings = await loadPublicListings();
        if (!token || !refreshToken) {
          setListings(listings);
          setNotificationsSeenAtState(storedNotificationsSeenAt);
          return;
        }

        let restoredSession: BuyerSession = {
          access_token: token,
          refresh_token: refreshToken,
        };

        try {
          await loadBuyerDashboard(token);
        } catch (err) {
          if (!isExpiredAuthError(err)) {
            throw err;
          }

          restoredSession = await refreshBuyerSession(refreshToken);
          await setBuyerAccessToken(restoredSession.access_token);
          await setBuyerRefreshToken(restoredSession.refresh_token);
        }

        const [dashboard, deliveries] = await Promise.all([
          loadBuyerDashboard(restoredSession.access_token),
          loadBuyerNotificationDeliveries(restoredSession.access_token),
        ]);

        startTransition(() => {
          setSession(restoredSession);
          setListings(dashboard.listings);
          setProfile(dashboard.profile);
          setOrders(dashboard.orders);
          setBookings(dashboard.bookings);
          setNotificationDeliveries(deliveries);
          setNotificationsSeenAtState(storedNotificationsSeenAt);
        });
      } catch (err) {
        if (isExpiredAuthError(err)) {
          await clearBuyerAccessToken();
          await clearBuyerRefreshToken();
          await clearBuyerNotificationsSeenAt();
          clearSessionState('Your session expired. Sign in again.');
        } else {
          setError(err instanceof Error ? err.message : 'Unable to restore session');
        }
      } finally {
        setRestoring(false);
      }
    })();
  }, [clearSessionState]);

  useEffect(() => {
    if (!session?.access_token || !profile) {
      return;
    }

    const client = getSupabaseRealtimeClient(
      {
        supabaseUrl,
        anonKey: supabaseAnonKey,
      },
      session.access_token,
    );

    const channel = client
      .channel(`buyer-notifications-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_status_events',
        },
        () => {
          void refreshMarketplace();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'booking_status_events',
        },
        () => {
          void refreshMarketplace();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [profile, refreshMarketplace, session]);

  useEffect(() => {
    if (!session?.access_token || !profile) {
      return;
    }

    if (syncingPushToken || profile.expo_push_token || profile.push_notifications_enabled === false) {
      return;
    }

    void (async () => {
      try {
        await syncPushToken();
      } catch {
        // Push token registration is opportunistic; auth and commerce flows should continue.
      }
    })();
  }, [profile, session, syncPushToken, syncingPushToken]);

  const createOrder = useCallback(async (input: {
    sellerId: string;
    listingId: string;
    quantity: number;
    fulfillment: string;
    notes?: string;
  }) => {
    if (!session) {
      throw new Error('Sign in as the buyer before placing an order.');
    }

    const order = await createBuyerOrder(session.access_token, {
        seller_id: input.sellerId,
        fulfillment: input.fulfillment,
        notes: input.notes,
        items: [{ listing_id: input.listingId, quantity: input.quantity }],
    });

    startTransition(() => {
      setOrders((current) => [order, ...current]);
    });

    return order;
  }, [session]);

  const createBooking = useCallback(async (input: {
    sellerId: string;
    listingId: string;
    scheduledStart: string;
    scheduledEnd: string;
    notes?: string;
  }) => {
    if (!session) {
      throw new Error('Sign in as the buyer before requesting a booking.');
    }

    const booking = await createBuyerBooking(session.access_token, {
        seller_id: input.sellerId,
        listing_id: input.listingId,
        scheduled_start: input.scheduledStart,
        scheduled_end: input.scheduledEnd,
        notes: input.notes,
    });

    startTransition(() => {
      setBookings((current) => [booking, ...current]);
    });

    return booking;
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      profile,
      listings,
      orders,
      bookings,
      notifications,
      notificationDeliveries,
      unreadNotificationCount,
      loading,
      refreshing,
      restoring,
      error,
      signIn,
      signUp,
      signOut,
      refreshMarketplace,
      markNotificationsSeen,
      updateNotificationPreferences,
      syncPushToken,
      retryNotificationDelivery,
      createOrder,
      createBooking,
    }),
    [
      session,
      profile,
      listings,
      orders,
      bookings,
      notifications,
      notificationDeliveries,
      unreadNotificationCount,
      loading,
      refreshing,
      restoring,
      error,
      signIn,
      signUp,
      signOut,
      refreshMarketplace,
      markNotificationsSeen,
      updateNotificationPreferences,
      syncPushToken,
      retryNotificationDelivery,
      createOrder,
      createBooking,
    ],
  );

  return <BuyerSessionContext.Provider value={value}>{children}</BuyerSessionContext.Provider>;
}

export function useBuyerSession() {
  const context = useContext(BuyerSessionContext);

  if (!context) {
    throw new Error('useBuyerSession must be used within BuyerSessionProvider');
  }

  return context;
}
