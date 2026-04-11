"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  buildNotifications,
  createApiClient,
  formatCurrency,
  type Booking,
  type NotificationDelivery,
  type NotificationItem,
  type Order,
  type Profile,
} from "@/app/lib/api";
import { clearBuyerSession, restoreBuyerSession } from "@/app/lib/buyer-auth";
import {
  clearRecentReceipts,
  getRecentReceipts,
  type RecentReceiptEntry,
} from "@/app/lib/receipt-history";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const BUYER_WATCHLIST_ACTIVITY_KEY = "buyer_watchlist_activity";
const BUYER_WATCHLIST_ACTIVITY_FILTER_KEY = "buyer_watchlist_activity_filter";
const BUYER_WATCHLIST_ACTIVITY_GROUPS_KEY = "buyer_watchlist_activity_groups";
const BUYER_RECENT_RECEIPT_FILTER_KEY = "buyer_recent_receipt_filter";

type BuyerActivityState = {
  profile: Profile;
  orders: Order[];
  bookings: Booking[];
  deliveries: NotificationDelivery[];
};

type BuyerActivityView =
  | "all"
  | "orders"
  | "bookings"
  | "updates"
  | "deliveries"
  | "failed_deliveries";

type BuyerEngagementFilter = "all" | "product" | "service" | "local" | "hybrid";
type BuyerWatchlistFilter = "all" | "orders" | "bookings" | "updates";
type BuyerWatchlistActivityFilter = "all" | "orders" | "bookings" | "updates";
type BuyerWatchlistActivityEntry = {
  id: string;
  lane: Exclude<BuyerWatchlistFilter, "all">;
  view: BuyerActivityView;
  summary: string;
  createdAt: string;
};

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBookingActivityWindow(start: string, end: string | null | undefined) {
  const bookingStart = new Date(start);
  const bookingEnd = end ? new Date(end) : null;

  return `${bookingStart.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} · ${bookingStart.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}${bookingEnd ? `-${bookingEnd.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}` : ""}`;
}

function formatRelativeBuyerTime(input: string) {
  const then = new Date(input);
  const diffHours = Math.round((then.getTime() - Date.now()) / (1000 * 60 * 60));

  if (Math.abs(diffHours) < 1) {
    return "within the hour";
  }

  if (diffHours > 0 && diffHours < 24) {
    return `in ${diffHours} hr${diffHours === 1 ? "" : "s"}`;
  }

  if (diffHours < 0 && diffHours > -24) {
    const hoursAgo = Math.abs(diffHours);
    return `${hoursAgo} hr${hoursAgo === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays > 0) {
    return `in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  }

  const daysAgo = Math.abs(diffDays);
  return `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
}

function getBuyerActivityDayGroupLabel(input: string) {
  const value = new Date(input);
  const now = new Date();

  if (value.toDateString() === now.toDateString()) {
    return "Today";
  }

  return "Earlier";
}

type BuyerOrderItem = NonNullable<Order["items"]>[number];

function orderItemMatchesEngagement(
  item: BuyerOrderItem,
  engagement: Exclude<BuyerEngagementFilter, "all">,
) {
  if (engagement === "product") {
    return item.listing_type === "product" || item.listing_type === "hybrid";
  }

  if (engagement === "local") {
    return Boolean(item.is_local_only);
  }

  if (engagement === "hybrid") {
    return item.listing_type === "hybrid";
  }

  return false;
}

function orderMatchesEngagement(order: Order, engagement: BuyerEngagementFilter) {
  if (engagement === "all") {
    return true;
  }

  return (order.items ?? []).some((item) => orderItemMatchesEngagement(item, engagement));
}

function bookingMatchesEngagement(booking: Booking, engagement: BuyerEngagementFilter) {
  if (engagement === "all") {
    return true;
  }

  if (engagement === "service") {
    return booking.listing_type === "service" || booking.listing_type === "hybrid";
  }

  if (engagement === "local") {
    return Boolean(booking.is_local_only);
  }

  if (engagement === "hybrid") {
    return booking.listing_type === "hybrid";
  }

  return false;
}

export function BuyerActivityPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dashboard, setDashboard] = useState<BuyerActivityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BuyerActivityView>("all");
  const [engagementFilter, setEngagementFilter] = useState<BuyerEngagementFilter>("all");
  const [watchlistFilter, setWatchlistFilter] = useState<BuyerWatchlistFilter>("all");
  const [watchlistActivity, setWatchlistActivity] = useState<BuyerWatchlistActivityEntry[]>([]);
  const [watchlistActivityFilter, setWatchlistActivityFilter] =
    useState<BuyerWatchlistActivityFilter>("all");
  const [collapsedWatchlistGroups, setCollapsedWatchlistGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [recentReceipts, setRecentReceipts] = useState<RecentReceiptEntry[]>([]);
  const [recentReceiptFilter, setRecentReceiptFilter] = useState<"all" | "orders" | "bookings">(
    "all",
  );
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
  const safeFromHref = useMemo(() => {
    const fromParam = searchParams.get("from");
    if (!fromParam || !fromParam.startsWith("/") || fromParam.startsWith("//")) {
      return null;
    }

    return fromParam;
  }, [searchParams]);
  const currentBuyerSliceHref = useMemo(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    const currentFrom = nextParams.get("from");
    if (currentFrom) {
      nextParams.set("from", currentFrom);
    }
    if (view === "all") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", view);
    }
    const query = nextParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams, view]);
  const receiptOriginSummary = useMemo(() => {
    if (!safeFromHref) {
      return null;
    }

    const parsedUrl = new URL(safeFromHref, "https://marketplace.local");
    const params = parsedUrl.searchParams;
    const parts: string[] = [];
    const type = params.get("type");
    const sort = params.get("sort");
    const local = params.get("local");
    const query = params.get("q")?.trim();

    if (type && type !== "all") {
      parts.push(titleCaseLabel(type));
    }
    if (local === "1") {
      parts.push("Local Only");
    }
    if (sort === "price_low") {
      parts.push("Lowest Price");
    }
    if (sort === "price_high") {
      parts.push("Highest Price");
    }
    if (query) {
      parts.push(`Search: "${query}"`);
    }

    return parts.length > 0 ? parts.join(" · ") : "Default marketplace slice";
  }, [safeFromHref]);
  const hasSavedActivitySlice = useMemo(
    () => view !== "all" || engagementFilter !== "all" || watchlistFilter !== "all",
    [engagementFilter, view, watchlistFilter],
  );
  const savedActivitySliceLabel = useMemo(() => {
    const parts: string[] = [];

    if (view !== "all") {
      parts.push(titleCaseLabel(view));
    }

    if (engagementFilter !== "all") {
      parts.push(titleCaseLabel(engagementFilter));
    }

    if (watchlistFilter !== "all") {
      parts.push(`${titleCaseLabel(watchlistFilter)} watchlist`);
    }

    return parts.length > 0 ? parts.join(" · ") : "All buyer activity";
  }, [engagementFilter, view, watchlistFilter]);
  const filteredRecentReceipts = useMemo(
    () =>
      recentReceipts.filter(
        (entry) =>
          recentReceiptFilter === "all" || entry.kind === recentReceiptFilter.slice(0, -1),
      ),
    [recentReceipts, recentReceiptFilter],
  );
  const recentReceiptCounts = useMemo(
    () => ({
      all: recentReceipts.length,
      orders: recentReceipts.filter((entry) => entry.kind === "order").length,
      bookings: recentReceipts.filter((entry) => entry.kind === "booking").length,
    }),
    [recentReceipts],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(BUYER_WATCHLIST_ACTIVITY_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as BuyerWatchlistActivityEntry[];
      if (Array.isArray(parsed)) {
        setWatchlistActivity(parsed);
      }
    } catch {
      window.sessionStorage.removeItem(BUYER_WATCHLIST_ACTIVITY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem(BUYER_WATCHLIST_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "orders" || stored === "bookings" || stored === "updates") {
      setWatchlistActivityFilter(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(BUYER_WATCHLIST_ACTIVITY_GROUPS_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        setCollapsedWatchlistGroups(parsed);
      }
    } catch {
      window.sessionStorage.removeItem(BUYER_WATCHLIST_ACTIVITY_GROUPS_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setRecentReceipts(getRecentReceipts());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem(BUYER_RECENT_RECEIPT_FILTER_KEY);
    if (stored === "all" || stored === "orders" || stored === "bookings") {
      setRecentReceiptFilter(stored);
    }
  }, []);

  useEffect(() => {
    const nextView = searchParams.get("view");
    setView(
      nextView === "orders" ||
        nextView === "bookings" ||
        nextView === "updates" ||
        nextView === "deliveries" ||
        nextView === "failed_deliveries"
        ? nextView
        : "all",
    );
    const nextEngagement = searchParams.get("engagement");
    setEngagementFilter(
      nextEngagement === "product" ||
        nextEngagement === "service" ||
        nextEngagement === "local" ||
        nextEngagement === "hybrid"
        ? nextEngagement
        : "all",
    );
    const nextWatchlist = searchParams.get("watchlist");
    setWatchlistFilter(
      nextWatchlist === "orders" || nextWatchlist === "bookings" || nextWatchlist === "updates"
        ? nextWatchlist
        : "all",
    );
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(BUYER_WATCHLIST_ACTIVITY_KEY, JSON.stringify(watchlistActivity));
  }, [watchlistActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(BUYER_WATCHLIST_ACTIVITY_FILTER_KEY, watchlistActivityFilter);
  }, [watchlistActivityFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      BUYER_WATCHLIST_ACTIVITY_GROUPS_KEY,
      JSON.stringify(collapsedWatchlistGroups),
    );
  }, [collapsedWatchlistGroups]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(BUYER_RECENT_RECEIPT_FILTER_KEY, recentReceiptFilter);
  }, [recentReceiptFilter]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "all") {
      params.delete("view");
    } else {
      params.set("view", view);
    }
    if (engagementFilter === "all") {
      params.delete("engagement");
    } else {
      params.set("engagement", engagementFilter);
    }
    if (watchlistFilter === "all") {
      params.delete("watchlist");
    } else {
      params.set("watchlist", watchlistFilter);
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [engagementFilter, pathname, router, searchParams, view, watchlistFilter]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await restoreBuyerSession();
        if (!session) {
          if (!cancelled) {
            setError("Buyer session is not available. Sign in from a listing page first.");
            setLoading(false);
          }
          return;
        }

        const [profile, buyerEngagement, deliveries] = await Promise.all([
          api.loadMyProfile(session.access_token),
          api.loadBuyerEngagementContext(session.access_token),
          api.loadMyNotificationDeliveries(session.access_token),
        ]);

        if (!cancelled) {
          setDashboard({
            profile,
            orders: buyerEngagement.orders,
            bookings: buyerEngagement.bookings,
            deliveries,
          });
        }
      } catch (dashboardError) {
        if (!cancelled) {
          setError(
            dashboardError instanceof Error
              ? dashboardError.message
              : "Unable to load buyer activity.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const notifications: NotificationItem[] = useMemo(
    () =>
      dashboard
        ? buildNotifications({
            audience: "buyer",
            orders: dashboard.orders,
            bookings: dashboard.bookings,
          })
        : [],
    [dashboard],
  );
  const visibleOrders = useMemo(() => {
    if (
      view === "bookings" ||
      view === "updates" ||
      view === "deliveries" ||
      view === "failed_deliveries"
    ) {
      return [];
    }

    return (dashboard?.orders ?? []).filter((order) => {
      if (!dashboard || engagementFilter === "all") {
        return true;
      }

      return orderMatchesEngagement(order, engagementFilter);
    });
  }, [dashboard, engagementFilter, view]);
  const visibleBookings = useMemo(() => {
    if (
      view === "orders" ||
      view === "updates" ||
      view === "deliveries" ||
      view === "failed_deliveries"
    ) {
      return [];
    }

    return (dashboard?.bookings ?? []).filter((booking) => {
      if (!dashboard || engagementFilter === "all") {
        return true;
      }

      return bookingMatchesEngagement(booking, engagementFilter);
    });
  }, [dashboard, engagementFilter, view]);
  const visibleNotifications = useMemo(
    () => (view === "orders" || view === "bookings" || view === "deliveries" || view === "failed_deliveries" ? [] : notifications),
    [notifications, view],
  );
  const visibleDeliveries = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    if (view === "orders" || view === "bookings" || view === "updates") {
      return [];
    }
    if (view === "failed_deliveries") {
      return dashboard.deliveries.filter((delivery) => delivery.delivery_status === "failed");
    }
    return dashboard.deliveries;
  }, [dashboard, view]);
  const watchlistAlerts = useMemo(() => {
    const alerts: Array<{
      id: string;
      lane: Exclude<BuyerWatchlistFilter, "all">;
      tone: "high" | "medium" | "monitor";
      title: string;
      description: string;
      actionLabel: string;
      onSelect: () => void;
    }> = [];
    const now = Date.now();
    const next72Hours = now + 72 * 60 * 60 * 1000;

    const pendingOrders = dashboard.orders.filter((order) => order.status === "pending");
    if (pendingOrders.length > 0) {
      alerts.push({
        id: "pending-orders",
        lane: "orders",
        tone: pendingOrders.length >= 3 ? "high" : "medium",
        title: "Orders awaiting seller confirmation",
        description: `${pendingOrders.length} order${pendingOrders.length === 1 ? "" : "s"} still show pending status.`,
        actionLabel: "Review orders",
        onSelect: () => {
          recordWatchlistActivity({
            lane: "orders",
            view: "orders",
            summary: "Reviewed pending orders from watchlist",
          });
          setWatchlistFilter("orders");
          setView("orders");
        },
      });
    }

    const requestedBookings = dashboard.bookings.filter((booking) => booking.status === "requested");
    if (requestedBookings.length > 0) {
      alerts.push({
        id: "requested-bookings",
        lane: "bookings",
        tone: requestedBookings.length >= 2 ? "high" : "medium",
        title: "Bookings awaiting confirmation",
        description: `${requestedBookings.length} booking request${requestedBookings.length === 1 ? "" : "s"} still need a seller response.`,
        actionLabel: "Review bookings",
        onSelect: () => {
          recordWatchlistActivity({
            lane: "bookings",
            view: "bookings",
            summary: "Reviewed requested bookings from watchlist",
          });
          setWatchlistFilter("bookings");
          setView("bookings");
        },
      });
    }

    const upcomingConfirmedBookings = dashboard.bookings.filter((booking) => {
      const scheduledStart = new Date(booking.scheduled_start).getTime();
      return booking.status === "confirmed" && scheduledStart >= now && scheduledStart <= next72Hours;
    });
    if (upcomingConfirmedBookings.length > 0) {
      const soonestBooking = upcomingConfirmedBookings
        .slice()
        .sort(
          (left, right) =>
            new Date(left.scheduled_start).getTime() - new Date(right.scheduled_start).getTime(),
        )[0];
      alerts.push({
        id: "upcoming-bookings",
        lane: "bookings",
        tone: "monitor",
        title: "Upcoming confirmed bookings",
        description: `${upcomingConfirmedBookings.length} confirmed booking${upcomingConfirmedBookings.length === 1 ? "" : "s"} start ${formatRelativeBuyerTime(soonestBooking.scheduled_start)}.`,
        actionLabel: "Check schedule",
        onSelect: () => {
          recordWatchlistActivity({
            lane: "bookings",
            view: "bookings",
            summary: "Checked upcoming booking schedule from watchlist",
          });
          setWatchlistFilter("bookings");
          setView("bookings");
        },
      });
    }

    const failedDeliveries = dashboard.deliveries.filter((delivery) => delivery.delivery_status === "failed");
    if (failedDeliveries.length > 0) {
      alerts.push({
        id: "failed-deliveries",
        lane: "updates",
        tone: "high",
        title: "Seller updates failed to deliver",
        description: `${failedDeliveries.length} notification update${failedDeliveries.length === 1 ? "" : "s"} failed. Open the delivery trail to review the affected transaction${failedDeliveries.length === 1 ? "" : "s"}.`,
        actionLabel: "Review failed updates",
        onSelect: () => {
          recordWatchlistActivity({
            lane: "updates",
            view: "failed_deliveries",
            summary: "Reviewed failed seller updates from watchlist",
          });
          setWatchlistFilter("updates");
          setView("failed_deliveries");
        },
      });
    }

    return alerts;
  }, [dashboard.bookings, dashboard.deliveries, dashboard.orders]);
  const filteredWatchlistAlerts = useMemo(
    () =>
      watchlistAlerts.filter((alert) => watchlistFilter === "all" || alert.lane === watchlistFilter),
    [watchlistAlerts, watchlistFilter],
  );
  const watchlistCounts = useMemo(
    () => ({
      all: watchlistAlerts.length,
      orders: watchlistAlerts.filter((alert) => alert.lane === "orders").length,
      bookings: watchlistAlerts.filter((alert) => alert.lane === "bookings").length,
      updates: watchlistAlerts.filter((alert) => alert.lane === "updates").length,
    }),
    [watchlistAlerts],
  );
  const filteredWatchlistActivity = useMemo(
    () =>
      watchlistActivity.filter(
        (entry) => watchlistActivityFilter === "all" || entry.lane === watchlistActivityFilter,
      ),
    [watchlistActivity, watchlistActivityFilter],
  );
  const watchlistActivityCounts = useMemo(
    () => ({
      all: watchlistActivity.length,
      orders: watchlistActivity.filter((entry) => entry.lane === "orders").length,
      bookings: watchlistActivity.filter((entry) => entry.lane === "bookings").length,
      updates: watchlistActivity.filter((entry) => entry.lane === "updates").length,
    }),
    [watchlistActivity],
  );
  const groupedWatchlistActivity = useMemo(() => {
    const groups = new Map<string, BuyerWatchlistActivityEntry[]>();

    filteredWatchlistActivity.forEach((entry) => {
      const label = getBuyerActivityDayGroupLabel(entry.createdAt);
      const current = groups.get(label) ?? [];
      current.push(entry);
      groups.set(label, current);
    });

    return Array.from(groups.entries()).map(([label, entries]) => ({
      label,
      entries,
    }));
  }, [filteredWatchlistActivity]);
  const hasEarlierWatchlistActivity = useMemo(
    () => groupedWatchlistActivity.some((group) => group.label === "Earlier"),
    [groupedWatchlistActivity],
  );
  const isEarlierWatchlistActivityCollapsed = collapsedWatchlistGroups.Earlier ?? false;
  const earlierWatchlistActivityCount = useMemo(
    () => groupedWatchlistActivity.find((group) => group.label === "Earlier")?.entries.length ?? 0,
    [groupedWatchlistActivity],
  );
  const hasCollapsedWatchlistActivityGroups = useMemo(
    () => groupedWatchlistActivity.some((group) => collapsedWatchlistGroups[group.label]),
    [collapsedWatchlistGroups, groupedWatchlistActivity],
  );
  const latestReceipt = recentReceipts[0] ?? null;
  const activeSliceSummary = useMemo(() => {
    const baseLabel = (() => {
      switch (view) {
        case "orders":
          return "Orders only";
        case "bookings":
          return "Bookings only";
        case "updates":
          return "Seller updates only";
        case "deliveries":
          return "All delivery history";
        case "failed_deliveries":
          return "Failed deliveries only";
        default:
          return "All buyer activity";
      }
    })();

    const withEngagement =
      engagementFilter === "all"
        ? baseLabel
        : `${baseLabel} · ${titleCaseLabel(engagementFilter)} engagement`;

    return watchlistFilter === "all"
      ? withEngagement
      : `${withEngagement} · ${titleCaseLabel(watchlistFilter)} watchlist`;
  }, [engagementFilter, view, watchlistFilter]);
  const productActivityCount = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    return dashboard.orders.reduce((count, order) => {
      return count + (order.items ?? []).filter((item) => orderItemMatchesEngagement(item, "product")).length;
    }, 0);
  }, [dashboard]);
  const serviceActivityCount = useMemo(
    () =>
      (dashboard?.bookings ?? []).filter(
        (booking) => bookingMatchesEngagement(booking, "service"),
      ).length,
    [dashboard?.bookings],
  );
  const localActivityCount = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    const orderLocalMatches = dashboard.orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) => orderItemMatchesEngagement(item, "local"));
      return count + (hasLocalMatch ? 1 : 0);
    }, 0);

    const bookingLocalMatches = dashboard.bookings.filter((booking) =>
      bookingMatchesEngagement(booking, "local"),
    ).length;

    return orderLocalMatches + bookingLocalMatches;
  }, [dashboard]);
  const hybridActivityCount = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    const orderHybridMatches = dashboard.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) => orderItemMatchesEngagement(item, "hybrid"));
      return count + (hasHybridMatch ? 1 : 0);
    }, 0);

    const bookingHybridMatches = dashboard.bookings.filter((booking) =>
      bookingMatchesEngagement(booking, "hybrid"),
    ).length;

    return orderHybridMatches + bookingHybridMatches;
  }, [dashboard]);

  async function copyCurrentSliceLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkFeedback("Link copied");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    } catch {
      setLinkFeedback("Copy failed");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    }
  }

  function recordWatchlistActivity(entry: Omit<BuyerWatchlistActivityEntry, "id" | "createdAt">) {
    setWatchlistActivity((current) =>
      [
        {
          ...entry,
          id: `${entry.lane}:${entry.view}:${Date.now()}`,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 8),
    );
  }

  function openWatchlistSlice(entry: Pick<BuyerWatchlistActivityEntry, "lane" | "view">) {
    setWatchlistFilter(entry.lane);
    setView(entry.view);
  }

  if (loading) {
    return (
      <div className="rounded-[1.5rem] border border-border bg-white/70 p-6 text-sm text-foreground/66">
        Loading buyer activity...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 rounded-[1.5rem] border border-[#efb4ae] bg-[#fff0ef] p-6 text-sm text-[#9a3428]">
        <p>{error}</p>
        <button
          className="rounded-full border border-[#efb4ae] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em]"
          onClick={() => {
            clearBuyerSession();
            window.location.href = "/";
          }}
          type="button"
        >
          Clear Buyer Session
        </button>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  return (
    <div className="space-y-6">
      <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
              Buyer Workspace
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
              {dashboard.profile.full_name ?? "Buyer activity"}
            </h2>
            <p className="mt-4 text-sm leading-7 text-foreground/72">
              Review your live orders, bookings, and seller updates on desktop.
            </p>
            {hasSavedActivitySlice ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void copyCurrentSliceLink()}
                  className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent transition hover:border-accent hover:bg-accent/15"
                >
                  Copy activity link
                </button>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/52">
                  {savedActivitySliceLabel}
                </span>
              </div>
            ) : null}
            {latestReceipt ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent transition hover:border-accent hover:bg-accent/15"
                  href={latestReceipt.href}
                >
                  Open latest receipt
                </Link>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/52">
                  {latestReceipt.kind} · {latestReceipt.detail}
                </span>
              </div>
            ) : null}
          </div>
          <button
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
            onClick={() => {
              clearBuyerSession();
              window.location.href = "/";
            }}
            type="button"
          >
            Sign Out
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Orders"
            value={String(dashboard.orders.length)}
            tone="accent"
            active={view === "orders"}
            onClick={() => setView("orders")}
          />
          <MetricCard
            label="Bookings"
            value={String(dashboard.bookings.length)}
            tone="olive"
            active={view === "bookings"}
            onClick={() => setView("bookings")}
          />
          <MetricCard
            label="Seller Updates"
            value={String(notifications.length)}
            tone="gold"
            active={view === "updates"}
            onClick={() => setView("updates")}
          />
        </div>
        <div className="mt-4 rounded-[1.4rem] border border-border bg-white/62 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Activity Mix
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                A quick read on the kinds of listings you are engaging with most.
              </p>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/46">
              Buyer-side signal
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Product Activity"
              value={String(productActivityCount)}
              tone="accent"
              active={engagementFilter === "product"}
              onClick={() => setEngagementFilter("product")}
            />
            <MetricCard
              label="Service Activity"
              value={String(serviceActivityCount)}
              tone="olive"
              active={engagementFilter === "service"}
              onClick={() => setEngagementFilter("service")}
            />
            <MetricCard
              label="Local-First"
              value={String(localActivityCount)}
              tone="gold"
              active={engagementFilter === "local"}
              onClick={() => setEngagementFilter("local")}
            />
            <MetricCard
              label="Hybrid Mix"
              value={String(hybridActivityCount)}
              tone="accent"
              active={engagementFilter === "hybrid"}
              onClick={() => setEngagementFilter("hybrid")}
            />
          </div>
        </div>
        {receiptOriginSummary ? (
          <div className="mt-4 rounded-[1.25rem] border border-border bg-[#f6eee2] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                  Recent Receipt Context
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground/72">
                  You arrived here from a receipt tied to this discovery slice.
                </p>
                <div className="mt-3 inline-flex rounded-full border border-border bg-white/72 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
                  {receiptOriginSummary}
                </div>
              </div>
              {safeFromHref ? (
                <Link
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  href={safeFromHref}
                >
                  Back to Browse Slice
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        {recentReceipts.length > 0 ? (
          <div className="mt-4 rounded-[1.25rem] border border-border bg-white/62 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                  Recently Opened Receipts
                </p>
                <p className="mt-2 text-sm text-foreground/72">
                  Jump back into the latest order or booking receipts you opened in this browser.
                </p>
              </div>
              <button
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={() => {
                  clearRecentReceipts();
                  setRecentReceipts([]);
                }}
                type="button"
                >
                  Clear saved receipt history
                </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["orders", "Orders"],
                  ["bookings", "Bookings"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                    recentReceiptFilter === value
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setRecentReceiptFilter(value)}
                  type="button"
                >
                  {label} ({recentReceiptCounts[value]})
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {filteredRecentReceipts.length > 0 ? (
                filteredRecentReceipts.map((entry) => (
                  <Link
                    key={`${entry.kind}:${entry.id}`}
                    className={`rounded-[1.1rem] border px-4 py-3 transition hover:border-accent hover:text-accent ${
                      latestReceipt?.kind === entry.kind && latestReceipt?.id === entry.id
                        ? "border-accent bg-accent/5"
                        : "border-border bg-white/80"
                    }`}
                    href={entry.href}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-foreground/58">
                          {entry.kind} · {entry.detail}
                        </p>
                      </div>
                      {latestReceipt?.kind === entry.kind && latestReceipt?.id === entry.id ? (
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                          Latest
                        </span>
                      ) : null}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-[1.1rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66 md:col-span-2">
                  No saved receipts match this filter.
                </div>
              )}
            </div>
          </div>
        ) : null}
        <div className="mt-4 rounded-[1.25rem] border border-border bg-white/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Current Slice
              </p>
              <p className="mt-2 text-sm text-foreground/72">{activeSliceSummary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {linkFeedback ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                  {linkFeedback}
                </span>
              ) : null}
              <button
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={() => void copyCurrentSliceLink()}
                type="button"
              >
                Copy Link
              </button>
              {view !== "all" || engagementFilter !== "all" || watchlistFilter !== "all" ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={() => {
                    setView("all");
                    setEngagementFilter("all");
                    setWatchlistFilter("all");
                  }}
                  type="button"
                >
                  Reset View
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-[1.4rem] border border-border bg-white/62 px-4 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Action Watchlist
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Start with the buyer-side items that still need attention.
              </p>
            </div>
            <span className="rounded-full border border-border bg-white/72 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
              {filteredWatchlistAlerts.length} visible
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["all", "All Alerts"],
              ["orders", "Orders"],
              ["bookings", "Bookings"],
              ["updates", "Updates"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  watchlistFilter === value
                    ? "border-accent bg-accent text-white"
                    : "border-border text-foreground hover:border-accent hover:text-accent"
                }`}
                onClick={() => setWatchlistFilter(value)}
                type="button"
              >
                {label} ({watchlistCounts[value]})
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {filteredWatchlistAlerts.length > 0 ? (
              filteredWatchlistAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-[1.3rem] border border-border bg-white/70 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                      <p className="mt-2 text-sm leading-6 text-foreground/68">{alert.description}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                        alert.tone === "high"
                          ? "border border-rose-200 bg-rose-50 text-rose-700"
                          : alert.tone === "medium"
                            ? "border border-amber-300 bg-amber-50 text-amber-800"
                            : "border border-sky-300 bg-sky-50 text-sky-800"
                      }`}
                    >
                      {alert.tone}
                    </span>
                  </div>
                  <div className="mt-4">
                    <button
                      className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={alert.onSelect}
                      type="button"
                    >
                      {alert.actionLabel}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.3rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
                {watchlistFilter === "all"
                  ? "No buyer-side actions need attention right now."
                  : `No ${watchlistFilter} watchlist items are active right now.`}
              </div>
            )}
          </div>
          <div className="mt-4 rounded-[1.3rem] border border-border bg-white/72 px-4 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                  Recent Watchlist Activity
                </p>
                <p className="mt-2 text-sm text-foreground/72">
                  Re-open the latest buyer-side actions you took from this watchlist.
                </p>
                {collapsedWatchlistGroups.Earlier ? (
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/46">
                    Earlier collapsed · {earlierWatchlistActivityCount} hidden
                  </p>
                ) : null}
              </div>
              <span className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
                {filteredWatchlistActivity.length} visible
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {([
                ["all", "All"],
                ["orders", "Orders"],
                ["bookings", "Bookings"],
                ["updates", "Updates"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                    watchlistActivityFilter === value
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setWatchlistActivityFilter(value)}
                  type="button"
                >
                  {label} ({watchlistActivityCounts[value]})
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  hasEarlierWatchlistActivity && !isEarlierWatchlistActivityCollapsed
                    ? "border-border text-foreground hover:border-accent hover:text-accent"
                    : "border-border/60 text-foreground/38"
                }`}
                disabled={!hasEarlierWatchlistActivity || isEarlierWatchlistActivityCollapsed}
                onClick={() =>
                  setCollapsedWatchlistGroups((current) => ({
                    ...current,
                    Earlier: true,
                  }))
                }
                type="button"
              >
                Collapse earlier
              </button>
              <button
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  hasCollapsedWatchlistActivityGroups
                    ? "border-border text-foreground hover:border-accent hover:text-accent"
                    : "border-border/60 text-foreground/38"
                }`}
                disabled={!hasCollapsedWatchlistActivityGroups}
                onClick={() => setCollapsedWatchlistGroups({})}
                type="button"
              >
                Expand all
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {filteredWatchlistActivity.length > 0 ? (
                groupedWatchlistActivity.map((group) => (
                  <div key={group.label}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                        {group.label}
                      </p>
                      <button
                        className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={() =>
                          setCollapsedWatchlistGroups((current) => ({
                            ...current,
                            [group.label]: !current[group.label],
                          }))
                        }
                        type="button"
                      >
                        {collapsedWatchlistGroups[group.label] ? "Expand" : "Collapse"}
                      </button>
                    </div>
                    {collapsedWatchlistGroups[group.label] ? (
                      <div className="rounded-[1.2rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
                        {group.entries.length} hidden watchlist action{group.entries.length === 1 ? "" : "s"}.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {group.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-[1.2rem] border border-border bg-background/80 px-4 py-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{entry.summary}</p>
                                <p className="mt-2 text-sm leading-6 text-foreground/68">
                                  {titleCaseLabel(entry.lane)} watchlist · {new Date(entry.createdAt).toLocaleString()}
                                </p>
                              </div>
                              <button
                                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                                onClick={() => openWatchlistSlice(entry)}
                                type="button"
                              >
                                Re-open
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-[1.2rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
                  {watchlistActivity.length === 0
                    ? "Use a watchlist action above to build a recent trail here."
                    : `No ${watchlistActivityFilter} watchlist actions in this session yet.`}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["all", "All Activity"],
            ["orders", "Orders"],
            ["bookings", "Bookings"],
            ["updates", "Seller Updates"],
            ["deliveries", "Deliveries"],
            ["failed_deliveries", "Failed Deliveries"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                view === value
                  ? "border-accent bg-accent text-white"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setView(value as BuyerActivityView)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["all", "All Engagement"],
            ["product", "Product"],
            ["service", "Service"],
            ["local", "Local-First"],
            ["hybrid", "Hybrid"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                engagementFilter === value
                  ? "border-accent bg-accent text-white"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setEngagementFilter(value as BuyerEngagementFilter)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          {view !== "updates" && view !== "deliveries" && view !== "failed_deliveries" ? (
            <ActivityCard
              title="Orders"
              empty="No orders yet. Create one from a listing detail page."
              items={visibleOrders.map((order) => ({
                id: order.id,
                title: order.status.replaceAll("_", " "),
                subtitle: `${order.fulfillment} · ${formatCurrency(order.total_cents, order.currency)}`,
                href: `/transactions/order/${order.id}?from=${encodeURIComponent(currentBuyerSliceHref)}`,
              }))}
            />
          ) : null}
          {view !== "orders" && view !== "updates" && view !== "deliveries" && view !== "failed_deliveries" ? (
            <ActivityCard
              title="Bookings"
              empty="No bookings yet. Create one from a listing detail page."
              items={visibleBookings.map((booking) => ({
                id: booking.id,
                title: booking.status.replaceAll("_", " "),
                subtitle: `${booking.listing_title ?? booking.listing_id} · ${formatBookingActivityWindow(
                  booking.scheduled_start,
                  booking.scheduled_end,
                )}`,
                href: `/transactions/booking/${booking.id}?from=${encodeURIComponent(currentBuyerSliceHref)}`,
              }))}
            />
          ) : null}
        </div>

        <div className="space-y-6">
          {view !== "orders" && view !== "bookings" && view !== "deliveries" && view !== "failed_deliveries" ? (
            <ActivityCard
              title="Seller Updates"
              empty="No seller-side updates yet."
              items={visibleNotifications.map((notification) => ({
                id: notification.id,
                title: notification.title,
                subtitle: notification.message,
                href: `/transactions/${notification.transactionKind}/${notification.transactionId}?from=${encodeURIComponent(currentBuyerSliceHref)}`,
              }))}
            />
          ) : null}
          {view !== "orders" && view !== "bookings" && view !== "updates" ? (
            <ActivityCard
              title={view === "failed_deliveries" ? "Failed Delivery History" : "Delivery History"}
              empty={
                view === "failed_deliveries"
                  ? "No failed notification deliveries yet."
                  : "No notification deliveries yet."
              }
              items={visibleDeliveries.map((delivery) => ({
                id: delivery.id,
                title: `${delivery.channel} · ${delivery.delivery_status}`,
                subtitle:
                  delivery.failure_reason ??
                  `${delivery.transaction_kind} · ${delivery.transaction_id}`,
                href: `/transactions/${delivery.transaction_kind}/${delivery.transaction_id}?from=${encodeURIComponent(currentBuyerSliceHref)}`,
              }))}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone: "accent" | "olive" | "gold";
  active?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    accent: "bg-accent text-white",
    olive: "bg-olive text-white",
    gold: "bg-gold text-foreground",
  };

  return (
    <button
      className={`rounded-[1.4rem] p-4 text-left transition hover:-translate-y-0.5 ${tones[tone]} ${
        active ? "ring-2 ring-foreground/20" : ""
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] opacity-80">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </button>
  );
}

function ActivityCard({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    href: string;
  }>;
}) {
  return (
    <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
        {title}
      </p>
      <div className="mt-4 space-y-3">
        {items.length > 0 ? (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block rounded-[1.3rem] border border-border bg-white/70 px-4 py-4 transition hover:-translate-y-0.5 hover:border-accent"
            >
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-foreground/68">{item.subtitle}</p>
            </Link>
          ))
        ) : (
          <div className="rounded-[1.3rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}
