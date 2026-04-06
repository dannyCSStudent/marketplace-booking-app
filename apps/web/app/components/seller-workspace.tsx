"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authenticateWithSupabase,
  getSupabaseRealtimeClient,
  refreshSupabaseSession,
} from "@repo/auth";

import { ApiError, buildNotifications, createApiClient, formatCurrency } from "@/app/lib/api";
import type {
  Booking,
  Listing,
  ListingImage,
  ListingCreateInput,
  ListingUpdateInput,
  NotificationDelivery,
  NotificationItem,
  Order,
  Profile,
  ProfileUpdateInput,
  ProfilePayload,
  ReviewRead,
  SellerCreateInput,
  SellerProfile,
  SellerWorkspaceData,
} from "@/app/lib/api";

type WorkspaceState = {
  seller: SellerProfile;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
  reviews: ReviewRead[];
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

type ListingImageDraft = {
  image_url: string;
  alt_text: string;
};

type ActionFeedback = {
  tone: "success" | "error";
  message: string;
  details?: string[];
};

type PendingBulkAction = {
  kind: "order" | "booking";
  currentStatus: "pending" | "ready" | "requested" | "in_progress";
  nextStatus: "confirmed" | "completed";
  actionKey: string;
  count: number;
  label: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const api = createApiClient(apiBaseUrl);
const SELLER_ACCESS_TOKEN_KEY = "seller_access_token";
const SELLER_REFRESH_TOKEN_KEY = "seller_refresh_token";
const SELLER_NOTIFICATIONS_SEEN_AT_KEY = "seller_notifications_seen_at";

function isExpiredAuthError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403 || error.message.includes("bad_jwt");
  }

  if (error instanceof Error) {
    return error.message.includes("bad_jwt") || error.message.includes("token is expired");
  }

  return false;
}

function formatBulkExecutionMode(mode: "best_effort" | "atomic") {
  return mode === "atomic" ? "validate first" : "best effort";
}

function toggleBulkExecutionMode(mode: "best_effort" | "atomic") {
  return mode === "atomic" ? "best_effort" : "atomic";
}

function getListingOperatingRole(listing: Listing) {
  const hasOrderFlow = listing.type !== "service";
  const hasBookingFlow = Boolean(listing.requires_booking || listing.type !== "product");

  if (hasOrderFlow && hasBookingFlow) {
    return "hybrid";
  }

  if (hasBookingFlow) {
    return "booking-led";
  }

  return "order-led";
}

function getListingOperatingGuidance(listing: Listing) {
  const role = getListingOperatingRole(listing);

  if (role === "booking-led") {
    return "Driven by booking requirements and service timing. Adjust booking, duration, and lead time first.";
  }

  if (role === "hybrid") {
    return "Supports both order and booking flows. Tune booking requirements and fulfillment together.";
  }

  return "Driven by order flow and fulfillment methods. Tune pickup, meetup, delivery, or shipping first.";
}

function formatSellerRating(rating?: number, reviewCount?: number) {
  const safeRating = rating ?? 0;
  const safeReviewCount = reviewCount ?? 0;

  if (safeReviewCount <= 0) {
    return "No reviews yet";
  }

  return `${safeRating.toFixed(1)} stars · ${safeReviewCount} review${safeReviewCount === 1 ? "" : "s"}`;
}

function titleCaseWorkspaceLabel(value: string) {
  return value
    .split("-")
    .flatMap((part) => part.split("_"))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBuyerBrowseContextLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isLocalDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return normalized?.includes("local only") ?? false;
}

function isSearchDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return normalized?.includes('search: "') ?? false;
}

function isPriceDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return (
    normalized?.includes("lowest price") ||
    normalized?.includes("highest price") ||
    false
  );
}

function isRecentTransactionEvent(
  history: Array<{ created_at: string }> | undefined,
  windowDays: number,
) {
  const oldestEvent = history && history.length > 0 ? history[history.length - 1] : null;
  if (!oldestEvent?.created_at) {
    return false;
  }

  const createdAt = new Date(oldestEvent.created_at).getTime();
  if (Number.isNaN(createdAt)) {
    return false;
  }

  return Date.now() - createdAt <= windowDays * 24 * 60 * 60 * 1000;
}

function matchesActivityRecency(
  history: Array<{ created_at: string }> | undefined,
  filter: "7d" | "all",
) {
  if (filter === "all") {
    return true;
  }

  return isRecentTransactionEvent(history, 7);
}

export function SellerWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activityRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listingControlRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listingControlHighlightTimeoutRef = useRef<number | null>(null);
  const focusedPanelHighlightTimeoutRef = useRef<number | null>(null);
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
  const [bulkQueueActionLoading, setBulkQueueActionLoading] = useState<string | null>(null);
  const [listingActionLoading, setListingActionLoading] = useState<string | null>(null);
  const [listingSaveLoading, setListingSaveLoading] = useState<string | null>(null);
  const [listingDrafts, setListingDrafts] = useState<Record<string, ListingDraft>>({});
  const [listingImageDrafts, setListingImageDrafts] = useState<Record<string, ListingImageDraft>>(
    {},
  );
  const [listingImageActionLoading, setListingImageActionLoading] = useState<string | null>(null);
  const [reviewResponseLoading, setReviewResponseLoading] = useState<string | null>(null);
  const [responseNotes, setResponseNotes] = useState<Record<string, string>>({});
  const [reviewResponseDrafts, setReviewResponseDrafts] = useState<Record<string, string>>({});
  const [notificationsSeenAt, setNotificationsSeenAt] = useState<string | null>(null);
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([]);
  const [deliveryRetryLoading, setDeliveryRetryLoading] = useState<string | null>(null);
  const [retryingFailedDeliveries, setRetryingFailedDeliveries] = useState(false);
  const [focusedActivityKey, setFocusedActivityKey] = useState<string | null>(
    () => searchParams.get("focus"),
  );
  const [activityTypeFilter, setActivityTypeFilter] = useState<"all" | "order" | "booking">(
    () => (searchParams.get("activityType") as "all" | "order" | "booking") ?? "all",
  );
  const [activityStatusFilter, setActivityStatusFilter] = useState<string>(
    () => searchParams.get("activityStatus") ?? "all",
  );
  const [activityDiscoveryFilter, setActivityDiscoveryFilter] = useState<
    "all" | "local" | "search" | "price"
  >(
    () =>
      (searchParams.get("activityDiscovery") as "all" | "local" | "search" | "price") ??
      "all",
  );
  const [activityRecencyFilter, setActivityRecencyFilter] = useState<"7d" | "all">(
    () => (searchParams.get("activityWindow") as "7d" | "all") ?? "all",
  );
  const [activityContextFilter, setActivityContextFilter] = useState<"all" | "unread" | "focused">(
    () => (searchParams.get("activityContext") as "all" | "unread" | "focused") ?? "all",
  );
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<"all" | "queued" | "sent" | "failed">(
    () => (searchParams.get("deliveryStatus") as "all" | "queued" | "sent" | "failed") ?? "all",
  );
  const [deliveryRecencyFilter, setDeliveryRecencyFilter] = useState<"today" | "7d" | "all">(
    () => (searchParams.get("deliveryWindow") as "today" | "7d" | "all") ?? "7d",
  );
  const [workspacePreset, setWorkspacePreset] = useState<"default" | "needs-action" | "recent-failures" | "focused-work">(
    () =>
      (searchParams.get("preset") as "default" | "needs-action" | "recent-failures" | "focused-work") ??
      "default",
  );
  const [highlightedListingControlKey, setHighlightedListingControlKey] = useState<string | null>(null);
  const [highlightedFocusedPanelKey, setHighlightedFocusedPanelKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [workspaceLinkFeedback, setWorkspaceLinkFeedback] = useState<string | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction | null>(null);
  const [bulkExecutionMode, setBulkExecutionMode] = useState<"best_effort" | "atomic">(
    () => (searchParams.get("bulkMode") as "best_effort" | "atomic") ?? "best_effort",
  );
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

  const clearSellerSession = useCallback((message?: string) => {
    window.localStorage.removeItem(SELLER_ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(SELLER_REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY);
    setWorkspace(null);
    setAccountProfile(null);
    setNotificationDeliveries([]);
    setNotificationsSeenAt(null);
    setListingDrafts({});
    setResponseNotes({});
    setReviewResponseDrafts({});
    setError(message ?? null);
    setActionFeedback(null);
    setPendingBulkAction(null);
    setCreateError(null);
    setCreateMessage(null);
  }, []);

  const loadWorkspace = useCallback(async (accessToken: string) => {
    const profile = await api.get<Profile>("/profiles/me", { accessToken });
    setAccountProfile(profile);
    const deliveries = await api.loadMyNotificationDeliveries(accessToken);
    setNotificationDeliveries(deliveries);
    const nextWorkspace: SellerWorkspaceData | null = await api.loadSellerWorkspace(accessToken);
    if (!nextWorkspace) {
      setWorkspace(null);
      setListingDrafts({});
      setListingImageDrafts({});
      setResponseNotes({});
      setReviewResponseDrafts({});
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
    setListingImageDrafts(
      Object.fromEntries(
        nextWorkspace.listings.map((listing) => [
          listing.id,
          {
            image_url: "",
            alt_text: listing.title,
          },
        ]),
      ),
    );
    setResponseNotes({
      ...Object.fromEntries(
        nextWorkspace.orders.map((order) => [order.id, order.seller_response_note ?? ""]),
      ),
      ...Object.fromEntries(
        nextWorkspace.bookings.map((booking) => [booking.id, booking.seller_response_note ?? ""]),
      ),
    });
    setReviewResponseDrafts(
      Object.fromEntries(
        nextWorkspace.reviews.map((review) => [review.id, review.seller_response ?? ""]),
      ),
    );
  }, []);

  useEffect(() => {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const refreshToken = window.localStorage.getItem(SELLER_REFRESH_TOKEN_KEY);
    setNotificationsSeenAt(window.localStorage.getItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY));
    if (!accessToken || !refreshToken) {
      return;
    }

    setLoading(true);
    startTransition(async () => {
      try {
        let restoredAccessToken = accessToken;

        try {
          await loadWorkspace(accessToken);
        } catch (err) {
          if (!isExpiredAuthError(err)) {
            throw err;
          }

          const refreshedSession = await refreshSupabaseSession(refreshToken, {
            supabaseUrl,
            anonKey: supabaseAnonKey,
          });

          window.localStorage.setItem(SELLER_ACCESS_TOKEN_KEY, refreshedSession.access_token);
          window.localStorage.setItem(SELLER_REFRESH_TOKEN_KEY, refreshedSession.refresh_token);
          restoredAccessToken = refreshedSession.access_token;
          await loadWorkspace(restoredAccessToken);
        }
      } catch (err) {
        if (isExpiredAuthError(err)) {
          clearSellerSession("Your session expired. Sign in again.");
        } else {
          setError(err instanceof Error ? err.message : "Unable to restore workspace");
        }
      } finally {
        setLoading(false);
      }
    });
  }, [clearSellerSession, loadWorkspace]);

  useEffect(() => {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
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

  useEffect(() => {
    if (!focusedActivityKey) {
      return;
    }

    const target = activityRefs.current[focusedActivityKey];
    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    setHighlightedFocusedPanelKey(focusedActivityKey);
    if (focusedPanelHighlightTimeoutRef.current) {
      window.clearTimeout(focusedPanelHighlightTimeoutRef.current);
    }
    focusedPanelHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedFocusedPanelKey((current) =>
        current === focusedActivityKey ? null : current,
      );
      focusedPanelHighlightTimeoutRef.current = null;
    }, 1800);
  }, [focusedActivityKey]);

  useEffect(() => {
    const requestedFocus = searchParams.get("focus");
    if (!requestedFocus) {
      return;
    }

    setFocusedActivityKey(requestedFocus);
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (activityTypeFilter === "all") {
      params.delete("activityType");
    } else {
      params.set("activityType", activityTypeFilter);
    }

    if (activityStatusFilter === "all") {
      params.delete("activityStatus");
    } else {
      params.set("activityStatus", activityStatusFilter);
    }

    if (activityDiscoveryFilter === "all") {
      params.delete("activityDiscovery");
    } else {
      params.set("activityDiscovery", activityDiscoveryFilter);
    }

    if (activityRecencyFilter === "all") {
      params.delete("activityWindow");
    } else {
      params.set("activityWindow", activityRecencyFilter);
    }

    if (activityContextFilter === "all") {
      params.delete("activityContext");
    } else {
      params.set("activityContext", activityContextFilter);
    }

    if (deliveryRecencyFilter === "7d") {
      params.delete("deliveryWindow");
    } else {
      params.set("deliveryWindow", deliveryRecencyFilter);
    }

    if (deliveryStatusFilter === "all") {
      params.delete("deliveryStatus");
    } else {
      params.set("deliveryStatus", deliveryStatusFilter);
    }

    if (workspacePreset === "default") {
      params.delete("preset");
    } else {
      params.set("preset", workspacePreset);
    }

    if (bulkExecutionMode === "best_effort") {
      params.delete("bulkMode");
    } else {
      params.set("bulkMode", bulkExecutionMode);
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityRecencyFilter,
    activityStatusFilter,
    activityTypeFilter,
    bulkExecutionMode,
    deliveryStatusFilter,
    deliveryRecencyFilter,
    pathname,
    router,
    searchParams,
    workspacePreset,
  ]);

  function handleSignOut() {
    clearSellerSession();
  }

  function handleAuth() {
    setLoading(true);
    setError(null);
    setActionFeedback(null);
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

        window.localStorage.setItem(SELLER_ACCESS_TOKEN_KEY, session.access_token);
        window.localStorage.setItem(SELLER_REFRESH_TOKEN_KEY, session.refresh_token);
        await loadWorkspace(session.access_token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to continue");
      } finally {
        setLoading(false);
      }
    });
  }

  function handleCreateSellerProfile() {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in before creating a seller profile.");
      return;
    }

    setLoading(true);
    setError(null);
    setActionFeedback(null);

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

    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
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
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before updating orders.");
      return;
    }

    setQueueLoading(orderId);
    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);

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
        setActionFeedback({
          tone: "success",
          message: `Order moved to ${status.replaceAll("_", " ")}.`,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update order");
        setActionFeedback(null);
      } finally {
        setQueueLoading(null);
      }
    });
  }

  function updateBookingStatus(bookingId: string, status: string) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before updating bookings.");
      return;
    }

    setQueueLoading(bookingId);
    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);

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
        setActionFeedback({
          tone: "success",
          message: `Booking moved to ${status.replaceAll("_", " ")}.`,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update booking");
        setActionFeedback(null);
      } finally {
        setQueueLoading(null);
      }
    });
  }

  function updateListingStatus(listingId: string, status: ListingUpdateInput["status"]) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
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
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
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

  function updateListingImageDraft(
    listingId: string,
    updater: (current: ListingImageDraft) => ListingImageDraft,
  ) {
    setListingImageDrafts((current) => ({
      ...current,
      [listingId]: updater(
        current[listingId] ?? {
          image_url: "",
          alt_text: "",
        },
      ),
    }));
  }

  function addListingImage(listing: Listing) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const draft = listingImageDrafts[listing.id];
    if (!accessToken || !draft) {
      setCreateError("Sign in again before updating listing images.");
      return;
    }

    if (!draft.image_url.trim()) {
      setCreateError("Paste an image URL before adding listing media.");
      return;
    }

    setListingImageActionLoading(`${listing.id}:add`);
    setCreateError(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        await api.addListingImage(
          listing.id,
          {
            image_url: draft.image_url.trim(),
            alt_text: draft.alt_text.trim() || listing.title,
          },
          { accessToken },
        );
        await loadWorkspace(accessToken);
        setCreateMessage(`Added image gallery media to ${listing.title}.`);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Unable to add listing image");
      } finally {
        setListingImageActionLoading(null);
      }
    });
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Unable to read image file."));
          return;
        }

        const [, base64Data = ""] = result.split(",", 2);
        resolve(base64Data);
      };
      reader.onerror = () => reject(new Error("Unable to read image file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadListingImageFile(listing: Listing, file: File) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const draft = listingImageDrafts[listing.id];
    if (!accessToken) {
      setCreateError("Sign in again before uploading listing images.");
      return;
    }

    setListingImageActionLoading(`${listing.id}:upload`);
    setCreateError(null);
    setCreateMessage(null);

    try {
      const base64Data = await fileToBase64(file);
      await api.uploadListingImage(
        listing.id,
        {
          filename: file.name,
          content_type: file.type || "image/jpeg",
          base64_data: base64Data,
          alt_text: draft?.alt_text.trim() || listing.title,
        },
        { accessToken },
      );
      await loadWorkspace(accessToken);
      setCreateMessage(`Uploaded image media for ${listing.title}.`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to upload listing image");
    } finally {
      setListingImageActionLoading(null);
    }
  }

  function removeListingImage(listing: Listing, image: ListingImage) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setCreateError("Sign in again before updating listing images.");
      return;
    }

    setListingImageActionLoading(image.id);
    setCreateError(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        await api.deleteListingImage(listing.id, image.id, { accessToken });
        await loadWorkspace(accessToken);
        setCreateMessage(`Removed an image from ${listing.title}.`);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Unable to remove listing image");
      } finally {
        setListingImageActionLoading(null);
      }
    });
  }

  function updateReviewResponseDraft(reviewId: string, value: string) {
    setReviewResponseDrafts((current) => ({
      ...current,
      [reviewId]: value,
    }));
  }

  function saveReviewResponse(review: ReviewRead) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before responding to reviews.");
      return;
    }

    setReviewResponseLoading(review.id);
    setError(null);
    setActionFeedback(null);

    startTransition(async () => {
      try {
        await api.updateReviewSellerResponse(
          review.id,
          {
            seller_response: reviewResponseDrafts[review.id] ?? null,
          },
          { accessToken },
        );
        await loadWorkspace(accessToken);
        setActionFeedback({
          tone: "success",
          message: "Seller review response saved.",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save seller response");
        setActionFeedback(null);
      } finally {
        setReviewResponseLoading(null);
      }
    });
  }

  const notifications: NotificationItem[] = useMemo(
    () =>
      workspace
        ? buildNotifications({
            audience: "seller",
            orders: workspace.orders,
            bookings: workspace.bookings,
          })
        : [],
    [workspace],
  );
  const unreadNotificationCount = notificationsSeenAt
    ? notifications.filter(
        (item) => new Date(item.createdAt).getTime() > new Date(notificationsSeenAt).getTime(),
      ).length
    : notifications.length;
  const unreadActivityKeys = useMemo(
    () =>
      new Set(
        notifications
          .filter((item) =>
            notificationsSeenAt
              ? new Date(item.createdAt).getTime() > new Date(notificationsSeenAt).getTime()
              : true,
          )
          .map((item) => `${item.transactionKind}:${item.transactionId}`),
      ),
    [notifications, notificationsSeenAt],
  );
  const activityStatusOptions = useMemo(() => {
    if (!workspace) {
      return ["all"];
    }

    return [
      "all",
      ...new Set([
        ...workspace.orders.map((order) => order.status),
        ...workspace.bookings.map((booking) => booking.status),
      ]),
    ];
  }, [workspace]);
  const focusedOrder = focusedActivityKey?.startsWith("order:")
    ? workspace?.orders.find((order) => `order:${order.id}` === focusedActivityKey) ?? null
    : null;
  const focusedBooking = focusedActivityKey?.startsWith("booking:")
    ? workspace?.bookings.find((booking) => `booking:${booking.id}` === focusedActivityKey) ?? null
    : null;
  const filteredOrders = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return workspace.orders.filter((order) => {
      const activityKey = `order:${order.id}`;
      if (activityTypeFilter === "booking") {
        return false;
      }
      if (activityStatusFilter !== "all" && order.status !== activityStatusFilter) {
        return false;
      }
      if (
        activityDiscoveryFilter === "local" &&
        !isLocalDrivenBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "search" &&
        !isSearchDrivenBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "price" &&
        !isPriceDrivenBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (!matchesActivityRecency(order.status_history, activityRecencyFilter)) {
        return false;
      }
      if (activityContextFilter === "unread" && !unreadActivityKeys.has(activityKey)) {
        return false;
      }
      if (activityContextFilter === "focused" && focusedActivityKey !== activityKey) {
        return false;
      }
      return true;
    });
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityRecencyFilter,
    activityStatusFilter,
    activityTypeFilter,
    focusedActivityKey,
    unreadActivityKeys,
    workspace,
  ]);
  const filteredBookings = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return workspace.bookings.filter((booking) => {
      const activityKey = `booking:${booking.id}`;
      if (activityTypeFilter === "order") {
        return false;
      }
      if (activityStatusFilter !== "all" && booking.status !== activityStatusFilter) {
        return false;
      }
      if (
        activityDiscoveryFilter === "local" &&
        !isLocalDrivenBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "search" &&
        !isSearchDrivenBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "price" &&
        !isPriceDrivenBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (!matchesActivityRecency(booking.status_history, activityRecencyFilter)) {
        return false;
      }
      if (activityContextFilter === "unread" && !unreadActivityKeys.has(activityKey)) {
        return false;
      }
      if (activityContextFilter === "focused" && focusedActivityKey !== activityKey) {
        return false;
      }
      return true;
    });
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityRecencyFilter,
    activityStatusFilter,
    activityTypeFilter,
    focusedActivityKey,
    unreadActivityKeys,
    workspace,
  ]);
  const filteredNotificationDeliveries = useMemo(
    () =>
      notificationDeliveries.filter((delivery) => {
        if (!matchesDeliveryRecency(delivery.created_at, deliveryRecencyFilter)) {
          return false;
        }

        if (deliveryStatusFilter === "all") {
          return true;
        }

        return delivery.delivery_status === deliveryStatusFilter;
      }),
    [deliveryRecencyFilter, deliveryStatusFilter, notificationDeliveries],
  );
  const queuedDeliveryCount = useMemo(
    () => notificationDeliveries.filter((delivery) => delivery.delivery_status === "queued").length,
    [notificationDeliveries],
  );
  const failedDeliveryCount = useMemo(
    () => notificationDeliveries.filter((delivery) => delivery.delivery_status === "failed").length,
    [notificationDeliveries],
  );
  const pendingVisibleOrdersCount = useMemo(
    () => filteredOrders.filter((order) => order.status === "pending").length,
    [filteredOrders],
  );
  const readyVisibleOrdersCount = useMemo(
    () => filteredOrders.filter((order) => order.status === "ready").length,
    [filteredOrders],
  );
  const requestedVisibleBookingsCount = useMemo(
    () => filteredBookings.filter((booking) => booking.status === "requested").length,
    [filteredBookings],
  );
  const inProgressVisibleBookingsCount = useMemo(
    () => filteredBookings.filter((booking) => booking.status === "in_progress").length,
    [filteredBookings],
  );
  const focusedItemCount = focusedActivityKey ? 1 : 0;
  const localDrivenOrdersCount = useMemo(
    () =>
      (workspace?.orders ?? []).filter((order) =>
        isLocalDrivenBrowseContext(order.buyer_browse_context),
      ).length,
    [workspace?.orders],
  );
  const localDrivenBookingsCount = useMemo(
    () =>
      (workspace?.bookings ?? []).filter((booking) =>
        isLocalDrivenBrowseContext(booking.buyer_browse_context),
      ).length,
    [workspace?.bookings],
  );
  const searchDrivenBookingsCount = useMemo(
    () =>
      (workspace?.bookings ?? []).filter((booking) =>
        isSearchDrivenBrowseContext(booking.buyer_browse_context),
      ).length,
    [workspace?.bookings],
  );
  const priceDrivenConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter((transaction) =>
        isPriceDrivenBrowseContext(transaction.buyer_browse_context),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const localDrivenRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isLocalDrivenBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const searchDrivenRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isSearchDrivenBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const priceDrivenRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isPriceDrivenBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const recentBrowseContextConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          formatBuyerBrowseContextLabel(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const activeWorkspaceSummary = useMemo(() => {
    const parts: string[] = [];

    if (workspacePreset !== "default") {
      parts.push(titleCaseWorkspaceLabel(workspacePreset));
    }
    if (activityTypeFilter !== "all") {
      parts.push(`Type: ${titleCaseWorkspaceLabel(activityTypeFilter)}`);
    }
    if (activityStatusFilter !== "all") {
      parts.push(`Status: ${titleCaseWorkspaceLabel(activityStatusFilter)}`);
    }
    if (activityDiscoveryFilter !== "all") {
      parts.push(`Discovery: ${titleCaseWorkspaceLabel(activityDiscoveryFilter)}`);
    }
    if (activityRecencyFilter !== "all") {
      parts.push(`Activity Window: ${titleCaseWorkspaceLabel(activityRecencyFilter)}`);
    }
    if (activityContextFilter !== "all") {
      parts.push(`Context: ${titleCaseWorkspaceLabel(activityContextFilter)}`);
    }
    if (deliveryStatusFilter !== "all") {
      parts.push(`Deliveries: ${titleCaseWorkspaceLabel(deliveryStatusFilter)}`);
    }
    if (deliveryRecencyFilter !== "7d") {
      parts.push(`Window: ${titleCaseWorkspaceLabel(deliveryRecencyFilter)}`);
    }
    if (bulkExecutionMode !== "best_effort") {
      parts.push("Batch Mode: Validate First");
    }
    if (focusedActivityKey) {
      const [kind, id] = focusedActivityKey.split(":");
      parts.push(`Focus: ${titleCaseWorkspaceLabel(kind ?? "item")} ${id?.slice(0, 8) ?? ""}`.trim());
    }

    return parts.length > 0 ? parts.join(" · ") : "Default workspace view";
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityRecencyFilter,
    activityStatusFilter,
    activityTypeFilter,
    bulkExecutionMode,
    deliveryRecencyFilter,
    deliveryStatusFilter,
    focusedActivityKey,
    workspacePreset,
  ]);
  const isDefaultWorkspaceView =
    workspacePreset === "default" &&
    activityTypeFilter === "all" &&
    activityStatusFilter === "all" &&
    activityDiscoveryFilter === "all" &&
    activityRecencyFilter === "all" &&
    activityContextFilter === "all" &&
    deliveryStatusFilter === "all" &&
    deliveryRecencyFilter === "7d" &&
    bulkExecutionMode === "best_effort" &&
    !focusedActivityKey;

  function isUnreadNotification(notification: NotificationItem) {
    if (!notificationsSeenAt) {
      return true;
    }

    return new Date(notification.createdAt).getTime() > new Date(notificationsSeenAt).getTime();
  }

  function getDeliveryTransactionLabel(delivery: NotificationDelivery) {
    if (!workspace) {
      return `${delivery.transaction_kind} · ${delivery.transaction_id}`;
    }

    if (delivery.transaction_kind === "order") {
      const order = workspace.orders.find((item) => item.id === delivery.transaction_id);
      if (!order) {
        return `order · ${delivery.transaction_id}`;
      }

      const firstItem = order.items?.[0]?.listing_title ?? order.items?.[0]?.listing_id;
      return firstItem ? `order · ${firstItem}` : `order · ${order.id}`;
    }

    const booking = workspace.bookings.find((item) => item.id === delivery.transaction_id);
    if (!booking) {
      return `booking · ${delivery.transaction_id}`;
    }

    return `booking · ${booking.listing_title ?? booking.listing_id}`;
  }

  function focusDeliveryTransaction(delivery: NotificationDelivery) {
    setActivityFocus(`${delivery.transaction_kind}:${delivery.transaction_id}`);
  }

  function getListingTuneRoleTarget(listing: Listing) {
    const role = getListingOperatingRole(listing);
    return role === "order-led" ? "fulfillment" : "booking";
  }

  function focusListingRoleControls(listing: Listing) {
    const targetKey = `${listing.id}:${getListingTuneRoleTarget(listing)}`;
    setHighlightedListingControlKey(targetKey);
    if (listingControlHighlightTimeoutRef.current) {
      window.clearTimeout(listingControlHighlightTimeoutRef.current);
    }
    listingControlRefs.current[targetKey]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    listingControlHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedListingControlKey((current) => (current === targetKey ? null : current));
      listingControlHighlightTimeoutRef.current = null;
    }, 1800);
  }

  function markNotificationsSeen() {
    const latestTimestamp = notifications[0]?.createdAt ?? new Date().toISOString();
    window.localStorage.setItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY, latestTimestamp);
    setNotificationsSeenAt(latestTimestamp);
  }

  function setActivityFocus(nextFocus: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("focus", nextFocus);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setFocusedActivityKey(nextFocus);
  }

  function focusActivity(notification: NotificationItem) {
    const nextFocus = `${notification.transactionKind}:${notification.transactionId}`;
    setActivityFocus(nextFocus);
    markNotificationsSeen();
  }

  function clearFocusedActivity() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("focus");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    setFocusedActivityKey(null);
  }

  function resetWorkspaceView() {
    applySellerPreset("default");
    setBulkExecutionMode("best_effort");
    if (focusedActivityKey) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("focus");
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
      setFocusedActivityKey(null);
    }
  }

  async function copyWorkspaceLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setWorkspaceLinkFeedback("Link copied");
      window.setTimeout(() => setWorkspaceLinkFeedback(null), 2000);
    } catch {
      setWorkspaceLinkFeedback("Copy failed");
      window.setTimeout(() => setWorkspaceLinkFeedback(null), 2000);
    }
  }

  function applySellerPreset(
    preset: "default" | "needs-action" | "recent-failures" | "focused-work",
  ) {
    setWorkspacePreset(preset);

    if (preset === "default") {
      setActivityTypeFilter("all");
      setActivityStatusFilter("all");
      setActivityDiscoveryFilter("all");
      setActivityRecencyFilter("all");
      setActivityContextFilter("all");
      setDeliveryStatusFilter("all");
      setDeliveryRecencyFilter("7d");
      return;
    }

    if (preset === "needs-action") {
      setActivityTypeFilter("all");
      setActivityStatusFilter("all");
      setActivityDiscoveryFilter("all");
      setActivityRecencyFilter("all");
      setActivityContextFilter("unread");
      setDeliveryStatusFilter("queued");
      setDeliveryRecencyFilter("today");
      return;
    }

    if (preset === "recent-failures") {
      setActivityTypeFilter("all");
      setActivityStatusFilter("all");
      setActivityDiscoveryFilter("all");
      setActivityRecencyFilter("all");
      setActivityContextFilter("all");
      setDeliveryStatusFilter("failed");
      setDeliveryRecencyFilter("7d");
      return;
    }

    setActivityTypeFilter("all");
    setActivityStatusFilter("all");
    setActivityDiscoveryFilter("all");
    setActivityRecencyFilter("all");
    setActivityContextFilter("focused");
    setDeliveryStatusFilter("all");
    setDeliveryRecencyFilter("7d");
  }

  function applyDiscoveryQueueSlice(
    discovery: "local" | "search" | "price",
    type: "all" | "order" | "booking" = "all",
    recency: "7d" | "all" = "all",
  ) {
    setWorkspacePreset("default");
    setActivityTypeFilter(type);
    setActivityStatusFilter("all");
    setActivityDiscoveryFilter(discovery);
    setActivityRecencyFilter(recency);
    setActivityContextFilter("all");
    setDeliveryStatusFilter("all");
    setDeliveryRecencyFilter("7d");
  }

  function updateNotificationPreferences(
    changes: Pick<
      ProfileUpdateInput,
      | "email_notifications_enabled"
      | "push_notifications_enabled"
      | "marketing_notifications_enabled"
    >,
  ) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before updating notification settings.");
      return;
    }

    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);
    startTransition(async () => {
      try {
        const updatedProfile = await api.updateProfile(changes, { accessToken });
        setAccountProfile(updatedProfile);
        setActionFeedback({
          tone: "success",
          message: "Notification preferences updated.",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update notification settings");
        setActionFeedback(null);
      }
    });
  }

  function retryNotificationDelivery(deliveryId: string) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before retrying notification deliveries.");
      return;
    }

    setDeliveryRetryLoading(deliveryId);
    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);
    startTransition(async () => {
      try {
        await api.retryNotificationDelivery(deliveryId, accessToken);
        await loadWorkspace(accessToken);
        setActionFeedback({
          tone: "success",
          message: "Notification delivery requeued.",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to retry notification delivery");
        setActionFeedback(null);
      } finally {
        setDeliveryRetryLoading(null);
      }
    });
  }

  function retryFailedDeliveriesInView() {
    const failedDeliveries = filteredNotificationDeliveries.filter(
      (delivery) => delivery.delivery_status === "failed",
    );
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken || failedDeliveries.length === 0) {
      return;
    }

    setRetryingFailedDeliveries(true);
    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);
    startTransition(async () => {
      try {
        const result = await api.bulkRetryNotificationDeliveries(
          failedDeliveries.map((delivery) => delivery.id),
          accessToken,
          bulkExecutionMode,
        );
        await loadWorkspace(accessToken);
        setActionFeedback(
          result.failed.length === 0
            ? {
                tone: "success",
                message: `Retried ${result.succeeded_ids.length} failed ${
                  result.succeeded_ids.length === 1 ? "delivery" : "deliveries"
                } in view using ${formatBulkExecutionMode(bulkExecutionMode)} mode.`,
              }
            : {
                tone: result.succeeded_ids.length > 0 ? "success" : "error",
                message:
                  result.succeeded_ids.length > 0
                    ? `Retried ${result.succeeded_ids.length} of ${failedDeliveries.length} failed deliveries in view using ${formatBulkExecutionMode(bulkExecutionMode)} mode. ${result.failed.length} failed again.`
                    : `Unable to retry ${failedDeliveries.length} failed deliveries in view using ${formatBulkExecutionMode(bulkExecutionMode)} mode.`,
                details: result.failed.map(
                  (failure: { id: string; detail: string }) =>
                    `${failure.id.slice(0, 8)} · ${failure.detail}`,
                ),
              },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to retry failed deliveries");
        setActionFeedback(null);
      } finally {
        setRetryingFailedDeliveries(false);
      }
    });
  }

  function bulkUpdateVisibleOrders(
    currentStatus: "pending" | "ready",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const targetOrders = filteredOrders.filter((order) => order.status === currentStatus);
    if (!accessToken || targetOrders.length === 0) {
      return;
    }

    setBulkQueueActionLoading(actionKey);
    setError(null);
    setActionFeedback(null);
    startTransition(async () => {
      try {
        const result = await api.bulkUpdateOrderStatuses(
          {
            execution_mode: bulkExecutionMode,
            updates: targetOrders.map((order) => ({
              order_id: order.id,
              status: nextStatus,
              seller_response_note: responseNotes[order.id] || null,
            })),
          },
          { accessToken },
        );
        await loadWorkspace(accessToken);
        setPendingBulkAction(null);
        setActionFeedback(
          result.failed.length === 0
            ? {
                tone: "success",
                message: `${nextStatus === "completed" ? "Completed" : "Updated"} ${
                  result.succeeded_ids.length
                } visible ${
                  result.succeeded_ids.length === 1 ? "order" : "orders"
                } to ${nextStatus.replaceAll("_", " ")} using ${formatBulkExecutionMode(bulkExecutionMode)} mode.`,
              }
            : {
                tone: result.succeeded_ids.length > 0 ? "success" : "error",
                message:
                  result.succeeded_ids.length > 0
                    ? `Updated ${result.succeeded_ids.length} of ${targetOrders.length} visible orders using ${formatBulkExecutionMode(bulkExecutionMode)} mode. ${result.failed.length} failed.`
                    : `Unable to update ${targetOrders.length} visible orders using ${formatBulkExecutionMode(bulkExecutionMode)} mode.`,
                details: result.failed.map(
                  (failure: { id: string; detail: string }) =>
                    `${failure.id.slice(0, 8)} · ${failure.detail}`,
                ),
              },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update visible orders");
        setActionFeedback(null);
      } finally {
        setBulkQueueActionLoading(null);
      }
    });
  }

  function stageBulkOrderAction(
    currentStatus: "pending" | "ready",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    const targetOrders = filteredOrders.filter((order) => order.status === currentStatus);
    if (targetOrders.length === 0) {
      return;
    }

    setActionFeedback(null);
    setPendingBulkAction({
      kind: "order",
      currentStatus,
      nextStatus,
      actionKey,
      count: targetOrders.length,
      label:
        nextStatus === "completed"
          ? `Complete ${targetOrders.length} visible ${targetOrders.length === 1 ? "order" : "orders"}`
          : `Confirm ${targetOrders.length} visible ${targetOrders.length === 1 ? "order" : "orders"}`,
    });
  }

  function bulkUpdateVisibleBookings(
    currentStatus: "requested" | "in_progress",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const targetBookings = filteredBookings.filter((booking) => booking.status === currentStatus);
    if (!accessToken || targetBookings.length === 0) {
      return;
    }

    setBulkQueueActionLoading(actionKey);
    setError(null);
    setActionFeedback(null);
    startTransition(async () => {
      try {
        const result = await api.bulkUpdateBookingStatuses(
          {
            execution_mode: bulkExecutionMode,
            updates: targetBookings.map((booking) => ({
              booking_id: booking.id,
              status: nextStatus,
              seller_response_note: responseNotes[booking.id] || null,
            })),
          },
          { accessToken },
        );
        await loadWorkspace(accessToken);
        setPendingBulkAction(null);
        setActionFeedback(
          result.failed.length === 0
            ? {
                tone: "success",
                message: `${nextStatus === "completed" ? "Completed" : "Updated"} ${
                  result.succeeded_ids.length
                } visible ${
                  result.succeeded_ids.length === 1 ? "booking" : "bookings"
                } to ${nextStatus.replaceAll("_", " ")} using ${formatBulkExecutionMode(bulkExecutionMode)} mode.`,
              }
            : {
                tone: result.succeeded_ids.length > 0 ? "success" : "error",
                message:
                  result.succeeded_ids.length > 0
                    ? `Updated ${result.succeeded_ids.length} of ${targetBookings.length} visible bookings using ${formatBulkExecutionMode(bulkExecutionMode)} mode. ${result.failed.length} failed.`
                    : `Unable to update ${targetBookings.length} visible bookings using ${formatBulkExecutionMode(bulkExecutionMode)} mode.`,
                details: result.failed.map(
                  (failure: { id: string; detail: string }) =>
                    `${failure.id.slice(0, 8)} · ${failure.detail}`,
                ),
              },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update visible bookings");
        setActionFeedback(null);
      } finally {
        setBulkQueueActionLoading(null);
      }
    });
  }

  function stageBulkBookingAction(
    currentStatus: "requested" | "in_progress",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    const targetBookings = filteredBookings.filter((booking) => booking.status === currentStatus);
    if (targetBookings.length === 0) {
      return;
    }

    setActionFeedback(null);
    setPendingBulkAction({
      kind: "booking",
      currentStatus,
      nextStatus,
      actionKey,
      count: targetBookings.length,
      label:
        nextStatus === "completed"
          ? `Complete ${targetBookings.length} visible ${
              targetBookings.length === 1 ? "booking" : "bookings"
            }`
          : `Confirm ${targetBookings.length} visible ${
              targetBookings.length === 1 ? "booking" : "bookings"
            }`,
    });
  }

  function confirmPendingBulkAction() {
    if (!pendingBulkAction) {
      return;
    }

    if (pendingBulkAction.kind === "order") {
      bulkUpdateVisibleOrders(
        pendingBulkAction.currentStatus as "pending" | "ready",
        pendingBulkAction.nextStatus,
        pendingBulkAction.actionKey,
      );
      return;
    }

    bulkUpdateVisibleBookings(
      pendingBulkAction.currentStatus as "requested" | "in_progress",
      pendingBulkAction.nextStatus,
      pendingBulkAction.actionKey,
    );
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
      <div className="card-shadow rounded-4xl border border-border bg-surface p-6">
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

      <div className="card-shadow rounded-4xl border border-border bg-[#fff8ed] p-6">
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
            <div className="grid gap-3 sm:grid-cols-4">
              <MiniStat label="Listings" value={String(workspace.listings.length)} />
              <MiniStat label="Orders" value={String(workspace.orders.length)} />
              <MiniStat label="Bookings" value={String(workspace.bookings.length)} />
              <MiniStat label="Reviews" value={String(workspace.reviews.length)} />
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Demand Signals
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Which browse lanes are converting into work
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-foreground/46">
                  Buyer discovery context
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat
                  label="Local Match Orders"
                  value={String(localDrivenOrdersCount)}
                  accent="amber"
                  onClick={() => applyDiscoveryQueueSlice("local", "order")}
                />
                <MiniStat
                  label="Local Match Bookings"
                  value={String(localDrivenBookingsCount)}
                  accent="olive"
                  onClick={() => applyDiscoveryQueueSlice("local", "booking")}
                />
                <MiniStat
                  label="Search-Led Bookings"
                  value={String(searchDrivenBookingsCount)}
                  accent="sky"
                  onClick={() => applyDiscoveryQueueSlice("search", "booking")}
                />
                <MiniStat
                  label="Price-Led Conversions"
                  value={String(priceDrivenConversionsCount)}
                  accent="rose"
                  onClick={() => applyDiscoveryQueueSlice("price", "all")}
                />
              </div>
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Recent Trend
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Discovery-driven conversions in the last 7 days
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-foreground/46">
                  Recent mix
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat
                  label="Local 7d"
                  value={String(localDrivenRecentConversionsCount)}
                  accent="amber"
                  onClick={() => applyDiscoveryQueueSlice("local", "all", "7d")}
                />
                <MiniStat
                  label="Search 7d"
                  value={String(searchDrivenRecentConversionsCount)}
                  accent="sky"
                  onClick={() => applyDiscoveryQueueSlice("search", "all", "7d")}
                />
                <MiniStat
                  label="Price 7d"
                  value={String(priceDrivenRecentConversionsCount)}
                  accent="rose"
                  onClick={() => applyDiscoveryQueueSlice("price", "all", "7d")}
                />
                <MiniStat
                  label="Tracked Browse 7d"
                  value={String(recentBrowseContextConversionsCount)}
                  accent="olive"
                  onClick={() => {
                    setWorkspacePreset("default");
                    setActivityTypeFilter("all");
                    setActivityStatusFilter("all");
                    setActivityDiscoveryFilter("all");
                    setActivityRecencyFilter("7d");
                    setActivityContextFilter("all");
                    setDeliveryStatusFilter("all");
                    setDeliveryRecencyFilter("7d");
                  }}
                />
              </div>
            </div>

            {actionFeedback ? (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  actionFeedback.tone === "success"
                    ? "border-olive/20 bg-olive/8 text-olive"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <p>{actionFeedback.message}</p>
                {actionFeedback.details?.length ? (
                  <div className="mt-3 space-y-1">
                    {actionFeedback.details.slice(0, 4).map((detail) => (
                      <p
                        key={detail}
                        className={`text-xs ${
                          actionFeedback.tone === "success"
                            ? "text-olive/80"
                            : "text-red-700/90"
                        }`}
                      >
                        {detail}
                      </p>
                    ))}
                    {actionFeedback.details.length > 4 ? (
                      <p
                        className={`text-xs ${
                          actionFeedback.tone === "success"
                            ? "text-olive/80"
                            : "text-red-700/90"
                        }`}
                      >
                        {actionFeedback.details.length - 4} more not shown.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Workspace Views
              </p>
              <div className="mt-4 rounded-[1.15rem] border border-border bg-background/45 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                      Current Slice
                    </p>
                    <p className="mt-2 text-sm text-foreground/72">{activeWorkspaceSummary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {workspaceLinkFeedback ? (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                        {workspaceLinkFeedback}
                      </span>
                    ) : null}
                    <button
                      className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => void copyWorkspaceLink()}
                      type="button"
                    >
                      Copy Link
                    </button>
                    {!isDefaultWorkspaceView ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={resetWorkspaceView}
                        type="button"
                      >
                        Reset View
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["default", "Default"],
                  ["needs-action", `Needs Action · ${unreadNotificationCount}`],
                  ["recent-failures", `Recent Failures · ${failedDeliveryCount}`],
                  ["focused-work", `Focused Work · ${focusedItemCount}`],
                ].map(([preset, label]) => (
                  <button
                    key={preset}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                      workspacePreset === preset
                        ? "border-accent bg-accent text-white"
                        : preset === "needs-action" && unreadNotificationCount > 0
                          ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-accent hover:text-accent"
                          : preset === "recent-failures" && failedDeliveryCount > 0
                            ? "border-red-300 bg-red-50 text-red-700 hover:border-accent hover:text-accent"
                            : preset === "focused-work" && focusedItemCount > 0
                              ? "border-sky-300 bg-sky-50 text-sky-800 hover:border-accent hover:text-accent"
                        : "border-border text-foreground hover:border-accent hover:text-accent"
                    }`}
                    onClick={() =>
                      applySellerPreset(
                        preset as
                          | "default"
                          | "needs-action"
                          | "recent-failures"
                          | "focused-work",
                      )
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {unreadNotificationCount > 0 ? (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={markNotificationsSeen}
                    type="button"
                  >
                    Mark All Seen
                  </button>
                ) : null}
                {focusedActivityKey ? (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={clearFocusedActivity}
                    type="button"
                  >
                    Clear Focus
                  </button>
                ) : null}
              </div>
            </div>

            <div
              className={`rounded-3xl border bg-white px-4 py-4 ${
                unreadNotificationCount > 0
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-border"
              }`}
            >
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
                    <button
                      key={notification.id}
                      className={`w-full rounded-[1.1rem] border px-4 py-3 text-left transition ${
                        focusedActivityKey ===
                        `${notification.transactionKind}:${notification.transactionId}`
                          ? "border-accent bg-accent/8"
                          : isUnreadNotification(notification)
                            ? "border-amber-300 bg-amber-50/70 hover:border-accent/50"
                          : "border-border bg-background/35 hover:border-accent/50"
                      }`}
                      onClick={() => focusActivity(notification)}
                      type="button"
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {notification.title}
                      </p>
                      <p className="mt-1 text-sm text-foreground/70">{notification.message}</p>
                      <p className="mt-2 text-xs text-foreground/52">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-foreground/68">
                    Buyer requests and updates will show up here.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Recent Reviews
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {formatSellerRating(
                      workspace.seller.average_rating,
                      workspace.seller.review_count,
                    )}
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
                  {workspace.reviews.length} visible
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {workspace.reviews.length > 0 ? (
                  workspace.reviews.map((review) => (
                    <article
                      key={review.id}
                      className="rounded-[1.1rem] border border-border bg-background/35 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-[#f3e1bd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c3a10]">
                          {review.rating}/5
                        </span>
                        <span className="text-xs text-foreground/52">
                          {new Date(review.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-foreground/72">
                        {review.comment ?? "Buyer left a rating without a written comment."}
                      </p>
                      <div className="mt-4 rounded-[1rem] border border-border bg-white/75 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/48">
                            Seller Response
                          </p>
                          {review.seller_responded_at ? (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45">
                              {new Date(review.seller_responded_at).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        <textarea
                          className="mt-3 min-h-[88px] w-full rounded-[0.9rem] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
                          onChange={(event) => updateReviewResponseDraft(review.id, event.target.value)}
                          placeholder="Reply to this buyer review with context or thanks."
                          value={reviewResponseDrafts[review.id] ?? ""}
                        />
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-foreground/52">
                            Public storefronts will show the latest seller response.
                          </p>
                          <button
                            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                            disabled={reviewResponseLoading === review.id}
                            onClick={() => saveReviewResponse(review)}
                            type="button"
                          >
                            {reviewResponseLoading === review.id ? "Saving..." : "Save Response"}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-foreground/68">
                    Completed orders and bookings can now turn into reviews. They will show up here
                    as buyers submit them.
                  </p>
                )}
              </div>
            </div>

            {accountProfile ? (
              <div className="rounded-3xl border border-border bg-white px-4 py-4">
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

            <div
              className={`rounded-3xl border bg-white px-4 py-4 ${
                queuedDeliveryCount > 0 || failedDeliveryCount > 0
                  ? "border-amber-200 bg-amber-50/30"
                  : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Delivery Jobs
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Resend and push outbox status · {queuedDeliveryCount} queued
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
                  {filteredNotificationDeliveries.length} shown
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {filteredNotificationDeliveries.some((delivery) => delivery.delivery_status === "failed") ? (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                    disabled={retryingFailedDeliveries}
                    onClick={retryFailedDeliveriesInView}
                    type="button"
                  >
                    {retryingFailedDeliveries ? "Retrying..." : "Retry Failed In View"}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["all", "All Statuses"],
                  ["queued", "Queued"],
                  ["sent", "Sent"],
                  ["failed", "Failed"],
                ].map(([status, label]) => (
                  <button
                    key={status}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                      deliveryStatusFilter === status
                        ? "border-accent bg-accent text-white"
                        : "border-border text-foreground hover:border-accent hover:text-accent"
                    }`}
                    onClick={() =>
                      setDeliveryStatusFilter(
                        status as "all" | "queued" | "sent" | "failed",
                      )
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ))}
                <button
                  className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    deliveryRecencyFilter === "today"
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setDeliveryRecencyFilter("today")}
                  type="button"
                >
                  Today
                </button>
                <button
                  className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    deliveryRecencyFilter === "7d"
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setDeliveryRecencyFilter("7d")}
                  type="button"
                >
                  7 Days
                </button>
                <button
                  className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    deliveryRecencyFilter === "all"
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setDeliveryRecencyFilter("all")}
                  type="button"
                >
                  All Time
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {filteredNotificationDeliveries.length > 0 ? (
                  filteredNotificationDeliveries.slice(0, 8).map((delivery) => (
                    <div
                      key={delivery.id}
                      className={`rounded-[1.1rem] border px-4 py-3 ${
                        delivery.delivery_status === "failed"
                          ? "border-red-300 bg-red-50/70"
                          : delivery.delivery_status === "queued"
                            ? "border-amber-300 bg-amber-50/70"
                            : "border-border bg-background/35"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {delivery.channel} · {delivery.transaction_kind}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-foreground/52">
                            {getDeliveryTransactionLabel(delivery)}
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
                          <button
                            className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            onClick={() => focusDeliveryTransaction(delivery)}
                            type="button"
                          >
                            Open Queue Item
                          </button>
                          {delivery.delivery_status === "failed" ? (
                            <button
                              className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                              disabled={deliveryRetryLoading === delivery.id}
                              onClick={() => retryNotificationDelivery(delivery.id)}
                              type="button"
                            >
                              {deliveryRetryLoading === delivery.id ? "Retrying..." : "Retry"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-foreground/68">
                    No delivery jobs match the current time filter.
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
                            <span
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                getListingOperatingRole(listing) === "booking-led"
                                  ? "bg-[#e4f1ed] text-[#0f5f62]"
                                  : getListingOperatingRole(listing) === "hybrid"
                                    ? "bg-[#f3e1bd] text-[#7c3a10]"
                                    : "bg-[#ece7dc] text-[#4d4338]"
                              }`}
                            >
                              {getListingOperatingRole(listing)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/68">
                            {listing.description ?? "No seller description yet."}
                          </p>
                          <p className="text-xs leading-5 text-foreground/56">
                            {getListingOperatingGuidance(listing)}
                          </p>
                          <button
                            className="w-fit rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            onClick={() => focusListingRoleControls(listing)}
                            type="button"
                          >
                            Tune Role
                          </button>
                          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-foreground/58">
                            <span>{formatCurrency(listing.price_cents, listing.currency)}</span>
                            <span>Slug: {listing.slug}</span>
                            <span>
                              Images: {listing.images?.length ?? 0}
                            </span>
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
                        <div
                          className={`rounded-2xl border px-4 py-3 transition ${
                            highlightedListingControlKey === `${listing.id}:booking`
                              ? "border-accent bg-accent/8 ring-2 ring-accent/30"
                              : "border-border bg-background/40"
                          }`}
                          ref={(node) => {
                            listingControlRefs.current[`${listing.id}:booking`] = node;
                          }}
                        >
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

                      <div
                        className={`mt-4 rounded-2xl border px-4 py-4 transition ${
                          highlightedListingControlKey === `${listing.id}:fulfillment`
                            ? "border-accent bg-accent/8 ring-2 ring-accent/30"
                            : "border-border bg-background/40"
                        }`}
                        ref={(node) => {
                          listingControlRefs.current[`${listing.id}:fulfillment`] = node;
                        }}
                      >
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

                      <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Listing Images
                            </p>
                            <p className="mt-2 text-sm text-foreground/68">
                              Add external image URLs now. Storage uploads can come later without changing the gallery model.
                            </p>
                          </div>
                          <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
                            {listing.images?.length ?? 0} image{(listing.images?.length ?? 0) === 1 ? "" : "s"}
                          </span>
                        </div>

                        {(listing.images?.length ?? 0) > 0 ? (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {(listing.images ?? []).map((image) => (
                              <div
                                key={image.id}
                                className="overflow-hidden rounded-2xl border border-border bg-white"
                              >
                                <Image
                                  alt={image.alt_text ?? listing.title}
                                  className="h-32 w-full object-cover"
                                  height={128}
                                  unoptimized
                                  src={image.image_url}
                                  width={320}
                                />
                                <div className="space-y-2 px-3 py-3">
                                  <p className="text-xs text-foreground/64">
                                    {image.alt_text ?? listing.title}
                                  </p>
                                  <button
                                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                                    disabled={listingImageActionLoading === image.id}
                                    onClick={() => removeListingImage(listing, image)}
                                    type="button"
                                  >
                                    {listingImageActionLoading === image.id ? "Removing..." : "Remove"}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-foreground/60">
                            No listing images yet. Add one below to make the buyer feed feel real.
                          </div>
                        )}

                        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                          <label className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-white px-4 py-3 text-sm text-foreground/68 transition hover:border-accent hover:text-accent">
                            <input
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              disabled={listingImageActionLoading === `${listing.id}:upload`}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) {
                                  return;
                                }

                                void uploadListingImageFile(listing, file);
                                event.currentTarget.value = "";
                              }}
                              type="file"
                            />
                            {listingImageActionLoading === `${listing.id}:upload`
                              ? "Uploading image..."
                              : "Choose image file"}
                          </label>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            placeholder="https://images.example.com/listing.jpg"
                            value={listingImageDrafts[listing.id]?.image_url ?? ""}
                            onChange={(event) =>
                              updateListingImageDraft(listing.id, (current) => ({
                                ...current,
                                image_url: event.target.value,
                              }))
                            }
                          />
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            placeholder="Alt text"
                            value={listingImageDrafts[listing.id]?.alt_text ?? ""}
                            onChange={(event) =>
                              updateListingImageDraft(listing.id, (current) => ({
                                ...current,
                                alt_text: event.target.value,
                              }))
                            }
                          />
                          <button
                            className="rounded-full bg-foreground px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:opacity-45"
                            disabled={listingImageActionLoading === `${listing.id}:add`}
                            onClick={() => addListingImage(listing)}
                            type="button"
                          >
                            {listingImageActionLoading === `${listing.id}:add` ? "Adding..." : "Add Image"}
                          </button>
                        </div>
                        <p className="mt-3 text-xs text-foreground/52">
                          Upload a local image file or keep using an external URL for seeded content and quick demos.
                        </p>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-semibold tracking-[-0.03em]">Live Activity</h3>
                    <button
                      className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                        bulkExecutionMode === "atomic"
                          ? "border-amber-300 bg-amber-100 text-amber-900 shadow-[0_0_0_1px_rgba(245,158,11,0.14)]"
                          : "border-stone-300 bg-stone-200 text-stone-700"
                      }`}
                      onClick={() =>
                        setBulkExecutionMode(toggleBulkExecutionMode(bulkExecutionMode))
                      }
                      type="button"
                    >
                      Batch Mode · {bulkExecutionMode === "atomic" ? "Validate First" : "Best Effort"} · Click to switch
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                        bulkExecutionMode === "best_effort"
                          ? "border-accent bg-accent text-white"
                          : "border-border text-foreground hover:border-accent hover:text-accent"
                      }`}
                      onClick={() => setBulkExecutionMode("best_effort")}
                      type="button"
                    >
                      Best Effort
                    </button>
                    <button
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                        bulkExecutionMode === "atomic"
                          ? "border-accent bg-accent text-white"
                          : "border-border text-foreground hover:border-accent hover:text-accent"
                      }`}
                      onClick={() => setBulkExecutionMode("atomic")}
                      type="button"
                    >
                      Validate First
                    </button>
                    {pendingVisibleOrdersCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkOrderAction("pending", "confirmed", "confirm-orders")
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "confirm-orders"
                          ? "Confirming..."
                          : `Confirm Orders · ${pendingVisibleOrdersCount}`}
                      </button>
                    ) : null}
                    {requestedVisibleBookingsCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkBookingAction("requested", "confirmed", "confirm-bookings")
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "confirm-bookings"
                          ? "Confirming..."
                          : `Confirm Bookings · ${requestedVisibleBookingsCount}`}
                      </button>
                    ) : null}
                    {readyVisibleOrdersCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkOrderAction("ready", "completed", "complete-orders")
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "complete-orders"
                          ? "Completing..."
                          : `Complete Orders · ${readyVisibleOrdersCount}`}
                      </button>
                    ) : null}
                    {inProgressVisibleBookingsCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkBookingAction(
                            "in_progress",
                            "completed",
                            "complete-bookings",
                          )
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "complete-bookings"
                          ? "Completing..."
                          : `Complete Bookings · ${inProgressVisibleBookingsCount}`}
                      </button>
                    ) : null}
                  </div>
                </div>
                {pendingBulkAction ? (
                  <div
                    className={`rounded-[1.2rem] border px-4 py-4 ${
                      pendingBulkAction.nextStatus === "completed"
                        ? "border-red-200 bg-red-50/70"
                        : "border-amber-200 bg-amber-50/70"
                    }`}
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                      Confirm Bulk Action
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {pendingBulkAction.label}
                    </p>
                    <p className="mt-2 text-sm text-foreground/70">
                      This will move {pendingBulkAction.count} visible{" "}
                      {pendingBulkAction.kind === "order" ? "order" : "booking"}
                      {pendingBulkAction.count === 1 ? "" : "s"} from{" "}
                      {pendingBulkAction.currentStatus.replaceAll("_", " ")} to{" "}
                      {pendingBulkAction.nextStatus.replaceAll("_", " ")} using the current
                      filter view. Mode: {bulkExecutionMode === "atomic" ? "validate first" : "best effort"}.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <label className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
                        <input
                          checked={bulkExecutionMode === "atomic"}
                          onChange={(event) =>
                            setBulkExecutionMode(
                              event.target.checked ? "atomic" : "best_effort",
                            )
                          }
                          type="checkbox"
                        />
                        Validate First
                      </label>
                      <button
                        className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white transition disabled:opacity-45 ${
                          pendingBulkAction.nextStatus === "completed"
                            ? "bg-red-700 hover:bg-red-800"
                            : "bg-accent hover:bg-accent-deep"
                        }`}
                        disabled={bulkQueueActionLoading !== null}
                        onClick={confirmPendingBulkAction}
                        type="button"
                      >
                        {bulkQueueActionLoading === pendingBulkAction.actionKey
                          ? "Applying..."
                          : pendingBulkAction.nextStatus === "completed"
                            ? "Confirm Completion"
                            : "Confirm Bulk Update"}
                      </button>
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() => setPendingBulkAction(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4">
                  <div className="flex flex-wrap gap-4">
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Type
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityTypeFilter}
                        onChange={(event) =>
                          setActivityTypeFilter(event.target.value as "all" | "order" | "booking")
                        }
                      >
                        <option value="all">All activity</option>
                        <option value="order">Orders only</option>
                        <option value="booking">Bookings only</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Status
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityStatusFilter}
                        onChange={(event) => setActivityStatusFilter(event.target.value)}
                      >
                        {activityStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status === "all" ? "All statuses" : status.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Discovery
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityDiscoveryFilter}
                        onChange={(event) =>
                          setActivityDiscoveryFilter(
                            event.target.value as "all" | "local" | "search" | "price",
                          )
                        }
                      >
                        <option value="all">All discovery</option>
                        <option value="local">Local match</option>
                        <option value="search">Search-led</option>
                        <option value="price">Price-led</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Activity Window
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityRecencyFilter}
                        onChange={(event) =>
                          setActivityRecencyFilter(event.target.value as "7d" | "all")
                        }
                      >
                        <option value="all">All time</option>
                        <option value="7d">Last 7 days</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Context
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityContextFilter}
                        onChange={(event) =>
                          setActivityContextFilter(
                            event.target.value as "all" | "unread" | "focused",
                          )
                        }
                      >
                        <option value="all">All queue items</option>
                        <option value="unread">Unread updates</option>
                        <option value="focused">Focused item</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="space-y-3">
                  {focusedOrder ? (
                    <div
                      className={`rounded-[1.5rem] border px-5 py-5 transition ${
                        highlightedFocusedPanelKey === `order:${focusedOrder.id}`
                          ? "border-accent bg-accent/12 ring-2 ring-accent/35"
                          : "border-accent bg-accent/8"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                            Focused Order
                          </p>
                          <h4 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
                            {focusedOrder.status.replaceAll("_", " ")}
                          </h4>
                          <p className="mt-2 text-sm text-foreground/72">
                            {focusedOrder.notes ?? "No buyer notes"}
                          </p>
                          {formatBuyerBrowseContextLabel(focusedOrder.buyer_browse_context) ? (
                            <div className="mt-3 inline-flex rounded-full border border-[#d7c5a6] bg-[#f6eee2] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
                              {formatBuyerBrowseContextLabel(focusedOrder.buyer_browse_context)}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrency(focusedOrder.total_cents, focusedOrder.currency)}
                          </p>
                          <button
                            className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            onClick={clearFocusedActivity}
                            type="button"
                          >
                            Clear Focus
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 text-sm text-foreground/72 sm:grid-cols-2">
                        <div className="rounded-2xl border border-border bg-white/70 px-4 py-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Order Snapshot
                          </p>
                          <div className="mt-3 space-y-2">
                            <p>Order ID: {focusedOrder.id}</p>
                            <p>Fulfillment: {focusedOrder.fulfillment}</p>
                            <p>Items: {(focusedOrder.items ?? []).length}</p>
                            <p>
                              Buyer discovery:{" "}
                              {formatBuyerBrowseContextLabel(focusedOrder.buyer_browse_context) ??
                                "No browse context"}
                            </p>
                            <p>Seller note: {focusedOrder.seller_response_note ?? "No seller note yet"}</p>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border bg-white/70 px-4 py-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Requested Items
                          </p>
                          <div className="mt-3 space-y-2">
                            {(focusedOrder.items ?? []).length > 0 ? (
                              (focusedOrder.items ?? []).map((item) => (
                                <p key={item.id}>
                                  {item.quantity}x {item.listing_title ?? item.listing_id}
                                  {" · "}
                                  {formatCurrency(item.total_price_cents, focusedOrder.currency)}
                                </p>
                              ))
                            ) : (
                              <p>No item detail is available for this order yet.</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-white/70 px-4 py-4">
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                          Full Timeline
                        </p>
                        <div className="mt-3 space-y-3 text-sm text-foreground/72">
                          {(focusedOrder.status_history ?? []).length > 0 ? (
                            (focusedOrder.status_history ?? []).map((event) => (
                              <div key={event.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                                <p className="font-medium text-foreground">
                                  {event.status.replaceAll("_", " ")}
                                  {" · "}
                                  {event.actor_role}
                                </p>
                                <p className="text-xs text-foreground/52">
                                  {new Date(event.created_at).toLocaleString()}
                                </p>
                                {event.note ? <p className="mt-1">{event.note}</p> : null}
                              </div>
                            ))
                          ) : (
                            <p>No timeline events yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {focusedBooking ? (
                    <div
                      className={`rounded-[1.5rem] border px-5 py-5 transition ${
                        highlightedFocusedPanelKey === `booking:${focusedBooking.id}`
                          ? "border-accent bg-accent/12 ring-2 ring-accent/35"
                          : "border-accent bg-accent/8"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                            Focused Booking
                          </p>
                          <h4 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
                            {focusedBooking.status.replaceAll("_", " ")}
                          </h4>
                          <p className="mt-2 text-sm text-foreground/72">
                            {focusedBooking.listing_title ?? focusedBooking.listing_id}
                          </p>
                          {formatBuyerBrowseContextLabel(focusedBooking.buyer_browse_context) ? (
                            <div className="mt-3 inline-flex rounded-full border border-[#d7c5a6] bg-[#f6eee2] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
                              {formatBuyerBrowseContextLabel(focusedBooking.buyer_browse_context)}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrency(focusedBooking.total_cents, focusedBooking.currency)}
                          </p>
                          <button
                            className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            onClick={clearFocusedActivity}
                            type="button"
                          >
                            Clear Focus
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 text-sm text-foreground/72 sm:grid-cols-2">
                        <div className="rounded-2xl border border-border bg-white/70 px-4 py-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Booking Snapshot
                          </p>
                          <div className="mt-3 space-y-2">
                            <p>Booking ID: {focusedBooking.id}</p>
                            <p>Type: {focusedBooking.listing_type ?? "Not specified"}</p>
                            <p>Starts: {new Date(focusedBooking.scheduled_start).toLocaleString()}</p>
                            <p>Ends: {new Date(focusedBooking.scheduled_end).toLocaleString()}</p>
                            <p>
                              Buyer discovery:{" "}
                              {formatBuyerBrowseContextLabel(focusedBooking.buyer_browse_context) ??
                                "No browse context"}
                            </p>
                            <p>Seller note: {focusedBooking.seller_response_note ?? "No seller note yet"}</p>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border bg-white/70 px-4 py-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Buyer Context
                          </p>
                          <div className="mt-3 space-y-2">
                            <p>{focusedBooking.notes ?? "No buyer notes"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-white/70 px-4 py-4">
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                          Full Timeline
                        </p>
                        <div className="mt-3 space-y-3 text-sm text-foreground/72">
                          {(focusedBooking.status_history ?? []).length > 0 ? (
                            (focusedBooking.status_history ?? []).map((event) => (
                              <div key={event.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                                <p className="font-medium text-foreground">
                                  {event.status.replaceAll("_", " ")}
                                  {" · "}
                                  {event.actor_role}
                                </p>
                                <p className="text-xs text-foreground/52">
                                  {new Date(event.created_at).toLocaleString()}
                                </p>
                                {event.note ? <p className="mt-1">{event.note}</p> : null}
                              </div>
                            ))
                          ) : (
                            <p>No timeline events yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {filteredOrders.length === 0 && filteredBookings.length === 0 ? (
                    <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4 text-sm text-foreground/68">
                      No activity matches the current filters. Change the queue controls or use the
                      demo buyer to place an order or booking.
                    </div>
                  ) : null}

                  {filteredOrders.map((order) => (
                    (() => {
                      const orderItems = order.items ?? [];
                      return (
                    <div
                      key={order.id}
                      ref={(node) => {
                        activityRefs.current[`order:${order.id}`] = node;
                      }}
                      className={`rounded-[1.3rem] border bg-white px-4 py-4 transition ${
                        focusedActivityKey === `order:${order.id}`
                          ? "border-accent ring-2 ring-accent/20"
                          : "border-border"
                      }`}
                      onClick={() => setActivityFocus(`order:${order.id}`)}
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
                          {formatBuyerBrowseContextLabel(order.buyer_browse_context) ? (
                            <div className="mt-2 inline-flex rounded-full border border-[#d7c5a6] bg-[#f6eee2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
                              {formatBuyerBrowseContextLabel(order.buyer_browse_context)}
                            </div>
                          ) : null}
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

                  {filteredBookings.map((booking) => (
                    <div
                      key={booking.id}
                      ref={(node) => {
                        activityRefs.current[`booking:${booking.id}`] = node;
                      }}
                      className={`rounded-[1.3rem] border bg-white px-4 py-4 transition ${
                        focusedActivityKey === `booking:${booking.id}`
                          ? "border-accent ring-2 ring-accent/20"
                          : "border-border"
                      }`}
                      onClick={() => setActivityFocus(`booking:${booking.id}`)}
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
                          {formatBuyerBrowseContextLabel(booking.buyer_browse_context) ? (
                            <div className="mt-2 inline-flex rounded-full border border-[#d7c5a6] bg-[#f6eee2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
                              {formatBuyerBrowseContextLabel(booking.buyer_browse_context)}
                            </div>
                          ) : null}
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
          <div className="mt-6 space-y-4 rounded-3xl border border-dashed border-border bg-white/55 p-6 text-sm leading-7 text-foreground/68">
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

function MiniStat({
  label,
  value,
  accent = "default",
  onClick,
}: {
  label: string;
  value: string;
  accent?: "default" | "amber" | "olive" | "sky" | "rose";
  onClick?: () => void;
}) {
  const accentStyles = {
    default: "border-border bg-white",
    amber: "border-amber-200 bg-amber-50/70",
    olive: "border-lime-200 bg-lime-50/70",
    sky: "border-sky-200 bg-sky-50/70",
    rose: "border-rose-200 bg-rose-50/70",
  } satisfies Record<string, string>;

  const content = (
    <div className={`rounded-[1.3rem] border px-4 py-4 ${accentStyles[accent]}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button
      className="text-left transition hover:-translate-y-0.5"
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

function matchesDeliveryRecency(value: string, filter: "today" | "7d" | "all") {
  if (filter === "all") {
    return true;
  }

  const createdAt = new Date(value).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (filter === "today") {
    return now - createdAt <= dayMs;
  }

  return now - createdAt <= dayMs * 7;
}
