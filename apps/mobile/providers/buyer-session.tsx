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
  buildNotifications,
  createBuyerBooking,
  createBuyerOrder,
  createBuyerProfile,
  loadBuyerDashboard,
  loadPublicListings,
  signInBuyer,
  signUpBuyer,
  type Booking,
  type BuyerSession,
  type Listing,
  type NotificationItem,
  type Order,
  type Profile,
  type ProfilePayload,
  type ProfileUpdateInput,
  updateBuyerProfile,
} from '@/lib/api';
import {
  clearBuyerAccessToken,
  clearBuyerNotificationsSeenAt,
  getBuyerAccessToken,
  getBuyerNotificationsSeenAt,
  setBuyerAccessToken,
  setBuyerNotificationsSeenAt,
} from '@/lib/session-storage';

type BuyerSessionValue = {
  session: BuyerSession | null;
  profile: Profile | null;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
  notifications: NotificationItem[];
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

export function BuyerSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BuyerSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [notificationsSeenAt, setNotificationsSeenAtState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMarketplace = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const listings = await loadPublicListings();
      startTransition(() => {
        setListings(listings);
      });

      if (session) {
        const dashboard = await loadBuyerDashboard(session.access_token);

        startTransition(() => {
          setListings(dashboard.listings);
          setProfile(dashboard.profile);
          setOrders(dashboard.orders);
          setBookings(dashboard.bookings);
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh marketplace');
    } finally {
      setRefreshing(false);
    }
  }, [session]);

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
      const dashboard = await loadBuyerDashboard(nextSession.access_token);
      await setBuyerAccessToken(nextSession.access_token);

      startTransition(() => {
        setSession(nextSession);
        setListings(dashboard.listings);
        setProfile(dashboard.profile);
        setOrders(dashboard.orders);
        setBookings(dashboard.bookings);
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
      const dashboard = await loadBuyerDashboard(nextSession.access_token);
      await setBuyerAccessToken(nextSession.access_token);

      startTransition(() => {
        setSession(nextSession);
        setListings(dashboard.listings);
        setProfile(dashboard.profile);
        setOrders(dashboard.orders);
        setBookings(dashboard.bookings);
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
    await clearBuyerNotificationsSeenAt();
    startTransition(() => {
      setSession(null);
      setProfile(null);
      setOrders([]);
      setBookings([]);
      setNotificationsSeenAtState(null);
    });
    await refreshMarketplace();
  }, [refreshMarketplace]);

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

  useEffect(() => {
    startTransition(async () => {
      try {
        const token = await getBuyerAccessToken();
        const storedNotificationsSeenAt = await getBuyerNotificationsSeenAt();
        const listings = await loadPublicListings();
        if (!token) {
          setListings(listings);
          setNotificationsSeenAtState(storedNotificationsSeenAt);
          return;
        }

        const dashboard = await loadBuyerDashboard(token);

        startTransition(() => {
          setSession({ access_token: token });
          setListings(dashboard.listings);
          setProfile(dashboard.profile);
          setOrders(dashboard.orders);
          setBookings(dashboard.bookings);
          setNotificationsSeenAtState(storedNotificationsSeenAt);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to restore session');
      } finally {
        setRestoring(false);
      }
    });
  }, []);

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
