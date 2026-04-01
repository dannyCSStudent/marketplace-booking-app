"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { authenticateWithSupabase, getSupabaseRealtimeClient } from "@repo/auth";

import { ApiError, buildNotifications, createApiClient, formatCurrency } from "@/app/lib/api";
import type {
  Booking,
  Listing,
  ListingCreateInput,
  ListingUpdateInput,
  NotificationDelivery,
  NotificationItem,
  Order,
  Profile,
  ProfileUpdateInput,
  ProfilePayload,
  SellerCreateInput,
  SellerProfile,
  SellerWorkspaceData,
} from "@/app/lib/api";

type WorkspaceState = {
  seller: SellerProfile;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
};

type ListingDraft = {
  price_cents: string;
  requires_booking: boolean;
  duration_minutes: string;
  lead_time_hours: string;
  is_local_only: boolean;
  pickup_enabled: boolean;
  meetup_enabled: boolean;
  delivery_enabled: boolean;
  shipping_enabled: boolean;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const api = createApiClient(apiBaseUrl);
const SELLER_NOTIFICATIONS_SEEN_AT_KEY = "seller_notifications_seen_at";

export function SellerWorkspace() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerSlug, setSellerSlug] = useState("");
  const [city, setCity] = useState("Dallas");
  const [stateRegion, setStateRegion] = useState("TX");
  const [country, setCountry] = useState("USA");
  const [loading, setLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState<string | null>(null);
  const [listingActionLoading, setListingActionLoading] = useState<string | null>(null);
  const [listingSaveLoading, setListingSaveLoading] = useState<string | null>(null);
  const [listingDrafts, setListingDrafts] = useState<Record<string, ListingDraft>>({});
  const [responseNotes, setResponseNotes] = useState<Record<string, string>>({});
  const [notificationsSeenAt, setNotificationsSeenAt] = useState<string | null>(null);
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [accountProfile, setAccountProfile] = useState<Profile | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("Weekend Pan Dulce Box");
  const [description, setDescription] = useState(
    "Small-batch sweet bread box for local pickup.",
  );
  const [listingType, setListingType] = useState<"product" | "service" | "hybrid">(
    "product",
  );
  const [price, setPrice] = useState("2400");

  const loadWorkspace = useCallback(async (accessToken: string) => {
    const profile = await api.get<Profile>("/profiles/me", { accessToken });
    setAccountProfile(profile);
    const deliveries = await api.loadMyNotificationDeliveries(accessToken);
    setNotificationDeliveries(deliveries);
    const nextWorkspace: SellerWorkspaceData | null = await api.loadSellerWorkspace(accessToken);
    if (!nextWorkspace) {
      setWorkspace(null);
      setListingDrafts({});
      setResponseNotes({});
      setNotificationDeliveries([]);
      return;
    }
    setWorkspace(nextWorkspace);
    const nextDrafts: Record<string, ListingDraft> = Object.fromEntries(
      nextWorkspace.listings.map((listing) => [
        listing.id,
        {
          price_cents: listing.price_cents?.toString() ?? "",
          requires_booking: listing.requires_booking ?? false,
          duration_minutes: listing.duration_minutes?.toString() ?? "",
          lead_time_hours: listing.lead_time_hours?.toString() ?? "",
          is_local_only: listing.is_local_only ?? true,
          pickup_enabled: listing.pickup_enabled ?? false,
          meetup_enabled: listing.meetup_enabled ?? false,
          delivery_enabled: listing.delivery_enabled ?? false,
          shipping_enabled: listing.shipping_enabled ?? false,
        },
      ]),
    );
    setListingDrafts(nextDrafts);
    setResponseNotes({
      ...Object.fromEntries(
        nextWorkspace.orders.map((order) => [order.id, order.seller_response_note ?? ""]),
      ),
      ...Object.fromEntries(
        nextWorkspace.bookings.map((booking) => [booking.id, booking.seller_response_note ?? ""]),
      ),
    });
  }, []);

  useEffect(() => {
    const accessToken = window.localStorage.getItem("seller_access_token");
    setNotificationsSeenAt(window.localStorage.getItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY));
    if (!accessToken) {
      return;
    }

    setLoading(true);
    startTransition(async () => {
      try {
        await loadWorkspace(accessToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to restore workspace");
      } finally {
        setLoading(false);
      }
    });
  }, [loadWorkspace]);

  useEffect(() => {
    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken || !workspace) {
      return;
    }

    const client = getSupabaseRealtimeClient(
      {
        supabaseUrl,
        anonKey: supabaseAnonKey,
      },
      accessToken,
    );

    const channel = client
      .channel(`seller-notifications-${workspace.seller.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_status_events",
        },
        () => {
          void loadWorkspace(accessToken);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "booking_status_events",
        },
        () => {
          void loadWorkspace(accessToken);
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadWorkspace, workspace]);

  function handleSignOut() {
    window.localStorage.removeItem("seller_access_token");
    window.localStorage.removeItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY);
    setWorkspace(null);
    setAccountProfile(null);
    setNotificationDeliveries([]);
    setNotificationsSeenAt(null);
    setError(null);
    setCreateError(null);
    setCreateMessage(null);
  }

  function handleAuth() {
    setLoading(true);
    setError(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        const session =
          await authenticateWithSupabase({
            mode,
            email,
            password,
            config: {
              supabaseUrl,
              anonKey: supabaseAnonKey,
            },
          });

        try {
          await api.get("/profiles/me", { accessToken: session.access_token });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            const profilePayload: ProfilePayload = {
              full_name: fullName || null,
              username: username || null,
              city,
              state: stateRegion,
              country,
            };
            await api.createProfile(profilePayload, {
              accessToken: session.access_token,
            });
          } else {
            throw err;
          }
        }

        window.localStorage.setItem("seller_access_token", session.access_token);
        await loadWorkspace(session.access_token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to continue");
      } finally {
        setLoading(false);
      }
    });
  }

  function handleCreateSellerProfile() {
    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken) {
      setError("Sign in before creating a seller profile.");
      return;
    }

    setLoading(true);
    setError(null);

    startTransition(async () => {
      try {
        const sellerPayload: SellerCreateInput = {
          display_name: sellerName,
          slug: sellerSlug,
          bio: "Independent seller storefront for local commerce.",
          city,
          state: stateRegion,
          country,
          accepts_custom_orders: true,
        };
        await api.createSellerProfile(sellerPayload, {
          accessToken,
        });

        await loadWorkspace(accessToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to create seller profile");
      } finally {
        setLoading(false);
      }
    });
  }

  function handleCreateListing() {
    if (!workspace) {
      return;
    }

    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken) {
      setCreateError("Sign in again before creating a listing.");
      return;
    }

    setCreateError(null);
    setCreateMessage(null);
    setLoading(true);

    startTransition(async () => {
      try {
        const listingPayload: ListingCreateInput = {
          seller_id: workspace.seller.id,
          title,
          description,
          type: listingType,
          price_cents: Number(price),
          currency: "USD",
          city: workspace.seller.city,
          state: workspace.seller.state,
          country: workspace.seller.country,
          pickup_enabled: listingType !== "service",
          meetup_enabled: true,
          delivery_enabled: listingType === "hybrid",
          shipping_enabled: false,
          requires_booking: listingType !== "product",
        };
        await api.createListing(listingPayload, {
          accessToken,
        });

        await loadWorkspace(accessToken);
        setCreateMessage("Listing created and workspace refreshed.");
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Unable to create listing");
      } finally {
        setLoading(false);
      }
    });
  }

  function updateOrderStatus(orderId: string, status: string) {
    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken) {
      setError("Sign in again before updating orders.");
      return;
    }

    setQueueLoading(orderId);
    setError(null);

    startTransition(async () => {
      try {
        await api.updateOrderStatus(
          orderId,
          {
            status,
            seller_response_note: responseNotes[orderId] || null,
          },
          {
            accessToken,
          },
        );
        await loadWorkspace(accessToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update order");
      } finally {
        setQueueLoading(null);
      }
    });
  }

  function updateBookingStatus(bookingId: string, status: string) {
    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken) {
      setError("Sign in again before updating bookings.");
      return;
    }

    setQueueLoading(bookingId);
    setError(null);

    startTransition(async () => {
      try {
        await api.updateBookingStatus(
          bookingId,
          {
            status,
            seller_response_note: responseNotes[bookingId] || null,
          },
          {
            accessToken,
          },
        );
        await loadWorkspace(accessToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update booking");
      } finally {
        setQueueLoading(null);
      }
    });
  }

  function updateListingStatus(listingId: string, status: ListingUpdateInput["status"]) {
    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken || !status) {
      setCreateError("Sign in again before updating listings.");
      return;
    }

    setListingActionLoading(listingId);
    setCreateError(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        await api.updateListing(listingId, { status }, { accessToken });
        await loadWorkspace(accessToken);
        setCreateMessage(`Listing moved to ${status.replaceAll("_", " ")}.`);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Unable to update listing");
      } finally {
        setListingActionLoading(null);
      }
    });
  }

  function updateListingDraft(
    listingId: string,
    updater: (current: ListingDraft) => ListingDraft,
  ) {
    setListingDrafts((current) => {
      const existing = current[listingId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [listingId]: updater(existing),
      };
    });
  }

  function saveListingDetails(listing: Listing) {
    const accessToken = window.localStorage.getItem("seller_access_token");
    const draft = listingDrafts[listing.id];
    if (!accessToken || !draft) {
      setCreateError("Sign in again before updating listings.");
      return;
    }

    setListingSaveLoading(listing.id);
    setCreateError(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        const payload: ListingUpdateInput = {
          price_cents: draft.price_cents === "" ? null : Number(draft.price_cents),
          requires_booking: draft.requires_booking,
          duration_minutes: draft.duration_minutes === "" ? null : Number(draft.duration_minutes),
          lead_time_hours: draft.lead_time_hours === "" ? null : Number(draft.lead_time_hours),
          is_local_only: draft.is_local_only,
          pickup_enabled: draft.pickup_enabled,
          meetup_enabled: draft.meetup_enabled,
          delivery_enabled: draft.delivery_enabled,
          shipping_enabled: draft.shipping_enabled,
        };

        await api.updateListing(listing.id, payload, { accessToken });
        await loadWorkspace(accessToken);
        setCreateMessage(`Saved operating settings for ${listing.title}.`);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Unable to save listing details");
      } finally {
        setListingSaveLoading(null);
      }
    });
  }

  const notifications: NotificationItem[] = workspace
    ? buildNotifications({
        audience: "seller",
        orders: workspace.orders,
        bookings: workspace.bookings,
      })
    : [];
  const unreadNotificationCount = notificationsSeenAt
    ? notifications.filter(
        (item) => new Date(item.createdAt).getTime() > new Date(notificationsSeenAt).getTime(),
      ).length
    : notifications.length;

  function markNotificationsSeen() {
    const latestTimestamp = notifications[0]?.createdAt ?? new Date().toISOString();
    window.localStorage.setItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY, latestTimestamp);
    setNotificationsSeenAt(latestTimestamp);
  }

  function updateNotificationPreferences(
    changes: Pick<
      ProfileUpdateInput,
      | "email_notifications_enabled"
      | "push_notifications_enabled"
      | "marketing_notifications_enabled"
    >,
  ) {
    const accessToken = window.localStorage.getItem("seller_access_token");
    if (!accessToken) {
      setError("Sign in again before updating notification settings.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const updatedProfile = await api.updateProfile(changes, { accessToken });
        setAccountProfile(updatedProfile);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update notification settings");
      }
    });
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
      <div className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
          Seller Onboarding
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
          Create a seller account or sign in without relying on seeded demo credentials
        </h2>
        <p className="mt-3 text-sm leading-7 text-foreground/72">
          This uses Supabase Auth in the browser, ensures a profile exists, and then loads the
          live seller workspace from the API.
        </p>

        <div className="mt-6 space-y-4">
          <div className="flex gap-2">
            <button
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                mode === "sign-in" ? "bg-foreground text-background" : "border border-border"
              }`}
              onClick={() => setMode("sign-in")}
              type="button"
            >
              Sign In
            </button>
            <button
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                mode === "sign-up" ? "bg-foreground text-background" : "border border-border"
              }`}
              onClick={() => setMode("sign-up")}
              type="button"
            >
              Create Account
            </button>
          </div>
          <label className="block">
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
              Email
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
              Password
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === "sign-up" ? (
            <>
              <label className="block">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Full Name
                </span>
                <input
                  className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Username
                </span>
                <input
                  className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
            </>
          ) : null}

          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-65"
            onClick={handleAuth}
            disabled={loading}
            type="button"
          >
            {loading ? "Working..." : mode === "sign-in" ? "Sign In" : "Create Account"}
          </button>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <p className="text-xs leading-5 text-foreground/56">
            The seller token is cached in local storage so this workspace can restore itself on
            refresh.
          </p>
        </div>
      </div>

      <div className="card-shadow rounded-[2rem] border border-border bg-[#fff8ed] p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
              Seller Workspace
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
              {workspace ? workspace.seller.display_name : "Sign in to load live seller data"}
            </h2>
          </div>
          {workspace ? (
            <div className="rounded-full border border-olive/25 bg-olive px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white">
              Authenticated
            </div>
          ) : null}
        </div>

        {workspace ? (
          <div className="mt-6 space-y-6">
            <div className="flex justify-end">
              <button
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={handleSignOut}
                type="button"
              >
                Sign Out
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat label="Listings" value={String(workspace.listings.length)} />
              <MiniStat label="Orders" value={String(workspace.orders.length)} />
              <MiniStat label="Bookings" value={String(workspace.bookings.length)} />
            </div>

            <div className="rounded-[1.5rem] border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Notifications
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {unreadNotificationCount} unread seller alerts
                  </p>
                </div>
                <button
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={markNotificationsSeen}
                  type="button"
                >
                  Mark Seen
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {notifications.length > 0 ? (
                  notifications.slice(0, 5).map((notification) => (
                    <div
                      key={notification.id}
                      className="rounded-[1.1rem] border border-border bg-background/35 px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {notification.title}
                      </p>
                      <p className="mt-1 text-sm text-foreground/70">{notification.message}</p>
                      <p className="mt-2 text-xs text-foreground/52">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-foreground/68">
                    Buyer requests and updates will show up here.
                  </p>
                )}
              </div>
            </div>

            {accountProfile ? (
              <div className="rounded-[1.5rem] border border-border bg-white px-4 py-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Delivery Preferences
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    [
                      "Email alerts",
                      accountProfile.email_notifications_enabled ?? true,
                      { email_notifications_enabled: !(accountProfile.email_notifications_enabled ?? true) },
                    ],
                    [
                      "Push alerts",
                      accountProfile.push_notifications_enabled ?? true,
                      { push_notifications_enabled: !(accountProfile.push_notifications_enabled ?? true) },
                    ],
                    [
                      "Marketing updates",
                      accountProfile.marketing_notifications_enabled ?? false,
                      { marketing_notifications_enabled: !(accountProfile.marketing_notifications_enabled ?? false) },
                    ],
                  ].map(([label, value, changes]) => (
                    <button
                      key={label as string}
                      className={`rounded-[1.1rem] border px-4 py-3 text-left transition ${
                        value
                          ? "border-olive/25 bg-olive/8 text-olive"
                          : "border-border bg-background/35 text-foreground/70"
                      }`}
                      onClick={() =>
                        updateNotificationPreferences(
                          changes as Pick<
                            ProfileUpdateInput,
                            | "email_notifications_enabled"
                            | "push_notifications_enabled"
                            | "marketing_notifications_enabled"
                          >,
                        )
                      }
                      type="button"
                    >
                      <p className="text-sm font-semibold">{label as string}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em]">
                        {value ? "On" : "Off"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-[1.5rem] border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Delivery Jobs
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Resend and push outbox status
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
                  {notificationDeliveries.length} recent
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {notificationDeliveries.length > 0 ? (
                  notificationDeliveries.slice(0, 8).map((delivery) => (
                    <div
                      key={delivery.id}
                      className="rounded-[1.1rem] border border-border bg-background/35 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {delivery.channel} · {delivery.transaction_kind}
                          </p>
                          <p className="mt-1 text-sm text-foreground/70">
                            {String(delivery.payload.subject ?? delivery.payload.status ?? "No payload summary")}
                          </p>
                          {delivery.failure_reason ? (
                            <p className="mt-2 text-sm text-red-700">
                              {delivery.failure_reason}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <span
                            className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                              delivery.delivery_status === "sent"
                                ? "bg-olive text-white"
                                : delivery.delivery_status === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : delivery.delivery_status === "queued"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-stone-200 text-stone-700"
                            }`}
                          >
                            {delivery.delivery_status}
                          </span>
                          <p className="mt-2 text-xs text-foreground/52">
                            Attempts: {delivery.attempts}
                          </p>
                          <p className="mt-1 text-xs text-foreground/52">
                            {new Date(delivery.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-foreground/68">
                    Notification deliveries will appear here after the worker queues them.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Create Listing</h3>
                <label className="block">
                  <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Title
                  </span>
                  <input
                    className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Description
                  </span>
                  <textarea
                    className="min-h-28 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                      Type
                    </span>
                    <select
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                      value={listingType}
                      onChange={(event) =>
                        setListingType(
                          event.target.value as "product" | "service" | "hybrid",
                        )
                      }
                    >
                      <option value="product">Product</option>
                      <option value="service">Service</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                      Price Cents
                    </span>
                    <input
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="w-full rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-65"
                  onClick={handleCreateListing}
                  disabled={loading}
                  type="button"
                >
                  Create Listing
                </button>
                {createError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {createError}
                  </div>
                ) : null}
                {createMessage ? (
                  <div className="rounded-2xl border border-olive/20 bg-olive/8 px-4 py-3 text-sm text-olive">
                    {createMessage}
                  </div>
                ) : null}

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-base font-semibold tracking-[-0.03em]">
                      Listing Control Tower
                    </h4>
                    <span className="text-xs uppercase tracking-[0.18em] text-foreground/50">
                      {workspace.listings.length} total
                    </span>
                  </div>

                  {workspace.listings.length === 0 ? (
                    <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4 text-sm text-foreground/68">
                      No listings yet. Create one above and then publish it here.
                    </div>
                  ) : null}

                  {workspace.listings.map((listing) => (
                    <div
                      key={listing.id}
                      className="rounded-[1.3rem] border border-border bg-white px-4 py-4"
                    >
                      {listingDrafts[listing.id] ? (
                        <>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-foreground">
                              {listing.title}
                            </p>
                            <span
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                listing.status === "active"
                                  ? "bg-olive text-white"
                                  : listing.status === "draft"
                                    ? "bg-amber-100 text-amber-800"
                                    : listing.status === "paused"
                                      ? "bg-stone-200 text-stone-700"
                                      : "bg-foreground/10 text-foreground/70"
                              }`}
                            >
                              {listing.status.replaceAll("_", " ")}
                            </span>
                            <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                              {listing.type}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/68">
                            {listing.description ?? "No seller description yet."}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-foreground/58">
                            <span>{formatCurrency(listing.price_cents, listing.currency)}</span>
                            <span>Slug: {listing.slug}</span>
                            <span>
                              Fulfillment:
                              {" "}
                              {[
                                listing.pickup_enabled ? "pickup" : null,
                                listing.meetup_enabled ? "meetup" : null,
                                listing.delivery_enabled ? "delivery" : null,
                                listing.shipping_enabled ? "shipping" : null,
                              ]
                                .filter(Boolean)
                                .join(", ") || "not configured"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Price Cents
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            value={listingDrafts[listing.id].price_cents}
                            onChange={(event) =>
                              updateListingDraft(listing.id, (current) => ({
                                ...current,
                                price_cents: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Duration Minutes
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            value={listingDrafts[listing.id].duration_minutes}
                            onChange={(event) =>
                              updateListingDraft(listing.id, (current) => ({
                                ...current,
                                duration_minutes: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Lead Time Hours
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            value={listingDrafts[listing.id].lead_time_hours}
                            onChange={(event) =>
                              updateListingDraft(listing.id, (current) => ({
                                ...current,
                                lead_time_hours: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="rounded-2xl border border-border bg-background/40 px-4 py-3">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Booking
                          </p>
                          <label className="mt-3 flex items-center gap-2 text-sm text-foreground/76">
                            <input
                              checked={listingDrafts[listing.id].requires_booking}
                              onChange={(event) =>
                                updateListingDraft(listing.id, (current) => ({
                                  ...current,
                                  requires_booking: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                            Requires booking
                          </label>
                          <label className="mt-2 flex items-center gap-2 text-sm text-foreground/76">
                            <input
                              checked={listingDrafts[listing.id].is_local_only}
                              onChange={(event) =>
                                updateListingDraft(listing.id, (current) => ({
                                  ...current,
                                  is_local_only: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                            Local only
                          </label>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4">
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                          Fulfillment Methods
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {[
                            ["pickup_enabled", "Pickup"],
                            ["meetup_enabled", "Meetup"],
                            ["delivery_enabled", "Delivery"],
                            ["shipping_enabled", "Shipping"],
                          ].map(([field, label]) => (
                            <label
                              key={field}
                              className="flex items-center gap-2 text-sm text-foreground/76"
                            >
                              <input
                                checked={
                                  listingDrafts[listing.id][field as keyof ListingDraft] as boolean
                                }
                                onChange={(event) =>
                                  updateListingDraft(listing.id, (current) => ({
                                    ...current,
                                    [field]: event.target.checked,
                                  }))
                                }
                                type="checkbox"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          ["draft", "Move To Draft"],
                          ["active", "Publish"],
                          ["paused", "Pause"],
                          ["archived", "Archive"],
                        ].map(([status, label]) => (
                          <button
                            key={status}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                            disabled={
                              listingActionLoading === listing.id || listing.status === status
                            }
                            onClick={() =>
                              updateListingStatus(
                                listing.id,
                                status as ListingUpdateInput["status"],
                              )
                            }
                            type="button"
                          >
                            {listingActionLoading === listing.id ? "..." : label}
                          </button>
                        ))}
                        <button
                          className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:opacity-45"
                          disabled={listingSaveLoading === listing.id}
                          onClick={() => saveListingDetails(listing)}
                          type="button"
                        >
                          {listingSaveLoading === listing.id ? "Saving..." : "Save Details"}
                        </button>
                      </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Live Activity</h3>
                <div className="space-y-3">
                  {workspace.orders.length === 0 && workspace.bookings.length === 0 ? (
                    <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4 text-sm text-foreground/68">
                      No incoming transaction activity yet. Use the demo buyer to place an
                      order or booking.
                    </div>
                  ) : null}

                  {workspace.orders.map((order) => (
                    (() => {
                      const orderItems = order.items ?? [];
                      return (
                    <div
                      key={order.id}
                      className="rounded-[1.3rem] border border-border bg-white px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                            Order
                          </p>
                          <p className="mt-2 text-base font-semibold capitalize text-foreground">
                            {order.status.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-sm text-foreground/68">
                            {order.notes ?? "No buyer notes"}
                          </p>
                          {order.seller_response_note ? (
                            <p className="mt-2 text-sm text-olive">
                              Seller note: {order.seller_response_note}
                            </p>
                          ) : null}
                          {(order.status_history ?? []).length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-border bg-background/35 px-3 py-3">
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                                Timeline
                              </p>
                              <div className="mt-2 space-y-2 text-sm text-foreground/70">
                                {(order.status_history ?? []).slice(0, 3).map((event) => (
                                  <div key={event.id}>
                                    <p className="font-medium text-foreground">
                                      {event.status.replaceAll("_", " ")}
                                      {" · "}
                                      {event.actor_role}
                                    </p>
                                    <p className="text-xs text-foreground/52">
                                      {new Date(event.created_at).toLocaleString()}
                                    </p>
                                    {event.note ? <p>{event.note}</p> : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {orderItems.length > 0 ? (
                            <div className="mt-3 space-y-1 text-sm text-foreground/70">
                              {orderItems.map((item) => (
                                <p key={item.id}>
                                  {item.quantity}x {item.listing_title ?? item.listing_id}
                                  {" "}
                                  <span className="text-foreground/52">
                                    {formatCurrency(item.total_price_cents, order.currency)}
                                  </span>
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <span className="font-semibold">
                          {formatCurrency(order.total_cents, order.currency)}
                        </span>
                      </div>
                      <label className="mt-4 block">
                        <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                          Seller Response Note
                        </span>
                        <textarea
                          className="min-h-24 w-full rounded-2xl border border-border bg-background/35 px-4 py-3 text-sm outline-none transition focus:border-accent"
                          value={responseNotes[order.id] ?? ""}
                          onChange={(event) =>
                            setResponseNotes((current) => ({
                              ...current,
                              [order.id]: event.target.value,
                            }))
                          }
                          placeholder="Add a seller note for this order update"
                        />
                      </label>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          ["confirmed", "Confirm"],
                          ["preparing", "Prep"],
                          ["ready", "Ready"],
                          ["completed", "Complete"],
                        ].map(([status, label]) => (
                          <button
                            key={status}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                            disabled={queueLoading === order.id}
                            onClick={() => updateOrderStatus(order.id, status)}
                            type="button"
                          >
                            {queueLoading === order.id ? "..." : label}
                          </button>
                        ))}
                      </div>
                    </div>
                      );
                    })()
                  ))}

                  {workspace.bookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="rounded-[1.3rem] border border-border bg-white px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                            Booking
                          </p>
                          <p className="mt-2 text-base font-semibold capitalize text-foreground">
                            {booking.status.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-sm font-medium text-foreground/76">
                            {booking.listing_title ?? booking.listing_id}
                            {booking.listing_type ? ` · ${booking.listing_type}` : ""}
                          </p>
                          <p className="mt-1 text-sm text-foreground/68">
                            {booking.notes ?? "No buyer notes"}
                          </p>
                          {booking.seller_response_note ? (
                            <p className="mt-2 text-sm text-olive">
                              Seller note: {booking.seller_response_note}
                            </p>
                          ) : null}
                          {(booking.status_history ?? []).length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-border bg-background/35 px-3 py-3">
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                                Timeline
                              </p>
                              <div className="mt-2 space-y-2 text-sm text-foreground/70">
                                {(booking.status_history ?? []).slice(0, 3).map((event) => (
                                  <div key={event.id}>
                                    <p className="font-medium text-foreground">
                                      {event.status.replaceAll("_", " ")}
                                      {" · "}
                                      {event.actor_role}
                                    </p>
                                    <p className="text-xs text-foreground/52">
                                      {new Date(event.created_at).toLocaleString()}
                                    </p>
                                    {event.note ? <p>{event.note}</p> : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <span className="text-sm text-foreground/72">
                            {new Date(booking.scheduled_start).toLocaleString()}
                          </span>
                          <p className="mt-1 text-xs text-foreground/56">
                            {formatCurrency(booking.total_cents, booking.currency)}
                          </p>
                        </div>
                      </div>
                      <label className="mt-4 block">
                        <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                          Seller Response Note
                        </span>
                        <textarea
                          className="min-h-24 w-full rounded-2xl border border-border bg-background/35 px-4 py-3 text-sm outline-none transition focus:border-accent"
                          value={responseNotes[booking.id] ?? ""}
                          onChange={(event) =>
                            setResponseNotes((current) => ({
                              ...current,
                              [booking.id]: event.target.value,
                            }))
                          }
                          placeholder="Add a seller note for this booking update"
                        />
                      </label>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          ["confirmed", "Confirm"],
                          ["in_progress", "Start"],
                          ["completed", "Complete"],
                          ["declined", "Decline"],
                        ].map(([status, label]) => (
                          <button
                            key={status}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                            disabled={queueLoading === booking.id}
                            onClick={() => updateBookingStatus(booking.id, status)}
                            type="button"
                          >
                            {queueLoading === booking.id ? "..." : label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4 rounded-[1.5rem] border border-dashed border-border bg-white/55 p-6 text-sm leading-7 text-foreground/68">
            <p>
              Sign in with an existing seller account, or create an account and then publish a
              seller profile here.
            </p>
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Seller Display Name
              </span>
              <input
                className="w-full rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={sellerName}
                onChange={(event) => setSellerName(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Seller Slug
              </span>
              <input
                className="w-full rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={sellerSlug}
                onChange={(event) => setSellerSlug(event.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="City"
              />
              <input
                className="rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={stateRegion}
                onChange={(event) => setStateRegion(event.target.value)}
                placeholder="State"
              />
              <input
                className="rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="Country"
              />
            </div>
            <button
              className="rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-65"
              onClick={handleCreateSellerProfile}
              disabled={loading || !sellerName || !sellerSlug}
              type="button"
            >
              {loading ? "Working..." : "Create Seller Profile"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}
