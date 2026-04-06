"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  buildNotifications,
  createApiClient,
  formatCurrency,
  type Booking,
  type Listing,
  type NotificationDelivery,
  type NotificationItem,
  type Order,
  type Profile,
} from "@/app/lib/api";
import { clearBuyerSession, restoreBuyerSession } from "@/app/lib/buyer-auth";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

type BuyerDashboardState = {
  profile: Profile;
  listings: Listing[];
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

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function BuyerActivityPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dashboard, setDashboard] = useState<BuyerDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BuyerActivityView>("all");
  const [engagementFilter, setEngagementFilter] = useState<BuyerEngagementFilter>("all");
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
  }, [searchParams]);

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

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [engagementFilter, pathname, router, searchParams, view]);

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

        const [buyerDashboard, deliveries] = await Promise.all([
          api.loadBuyerDashboard(session.access_token),
          api.loadMyNotificationDeliveries(session.access_token),
        ]);

        if (!cancelled) {
          setDashboard({
            profile: buyerDashboard.profile,
            listings: buyerDashboard.listings,
            orders: buyerDashboard.orders,
            bookings: buyerDashboard.bookings,
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

      const matchingListings = (order.items ?? [])
        .map((item) => dashboard.listings.find((listing) => listing.id === item.listing_id))
        .filter((listing): listing is Listing => Boolean(listing));

      if (engagementFilter === "product") {
        return matchingListings.some(
          (listing) => listing.type === "product" || listing.type === "hybrid",
        );
      }
      if (engagementFilter === "local") {
        return matchingListings.some((listing) => listing.is_local_only);
      }
      if (engagementFilter === "hybrid") {
        return matchingListings.some((listing) => listing.type === "hybrid");
      }

      return false;
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

      const matchingListing =
        dashboard.listings.find((listing) => listing.id === booking.listing_id) ?? null;

      if (engagementFilter === "service") {
        return booking.listing_type === "service" || booking.listing_type === "hybrid";
      }
      if (engagementFilter === "local") {
        return Boolean(matchingListing?.is_local_only);
      }
      if (engagementFilter === "hybrid") {
        return booking.listing_type === "hybrid";
      }
      if (engagementFilter === "product") {
        return false;
      }

      return true;
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

    return engagementFilter === "all"
      ? baseLabel
      : `${baseLabel} · ${titleCaseLabel(engagementFilter)} engagement`;
  }, [engagementFilter, view]);
  const productActivityCount = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    return dashboard.orders.reduce((count, order) => {
      const matchingListings = (order.items ?? [])
        .map((item) => dashboard.listings.find((listing) => listing.id === item.listing_id))
        .filter((listing): listing is Listing => Boolean(listing));

      return (
        count +
        matchingListings.filter(
          (listing) => listing.type === "product" || listing.type === "hybrid",
        ).length
      );
    }, 0);
  }, [dashboard]);
  const serviceActivityCount = useMemo(
    () =>
      (dashboard?.bookings ?? []).filter(
        (booking) => booking.listing_type === "service" || booking.listing_type === "hybrid",
      ).length,
    [dashboard?.bookings],
  );
  const localActivityCount = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    const orderLocalMatches = dashboard.orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) =>
        dashboard.listings.some(
          (listing) => listing.id === item.listing_id && listing.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0);

    const bookingLocalMatches = dashboard.bookings.filter((booking) =>
      dashboard.listings.some(
        (listing) => listing.id === booking.listing_id && listing.is_local_only,
      ),
    ).length;

    return orderLocalMatches + bookingLocalMatches;
  }, [dashboard]);
  const hybridActivityCount = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    const orderHybridMatches = dashboard.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        dashboard.listings.some(
          (listing) => listing.id === item.listing_id && listing.type === "hybrid",
        ),
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0);

    const bookingHybridMatches = dashboard.bookings.filter(
      (booking) => booking.listing_type === "hybrid",
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
              {view !== "all" || engagementFilter !== "all" ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={() => {
                    setView("all");
                    setEngagementFilter("all");
                  }}
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
                subtitle: `${booking.listing_title ?? booking.listing_id} · ${new Date(booking.scheduled_start).toLocaleString()}`,
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
