"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type NotificationDelivery,
  type OrderExceptionEventRead,
  type OrderExceptionSellerSummaryRead,
} from "@/app/lib/api";
import { restoreAdminSession, type AdminSession } from "@/app/lib/admin-auth";

type DeliveryStatusFilter = "all" | "queued" | "sent" | "failed";
type OrderExceptionStateFilter = "active" | "acknowledged" | "all";
type OrderExceptionEventFilter = "all" | "acknowledged" | "cleared";
type OrderExceptionSummaryFilter = "all" | "acknowledged" | "cleared";

type OrderExceptionFilterState = {
  statusFilter?: DeliveryStatusFilter;
  stateFilter?: OrderExceptionStateFilter;
  eventFilter?: OrderExceptionEventFilter;
  summaryFilter?: OrderExceptionSummaryFilter;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const ORDER_EXCEPTION_FILTERS_STORAGE_KEY = "order-exceptions-filters";

function toneClasses(status: string) {
  if (status === "failed") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  if (status === "queued") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  return "border-border bg-surface text-foreground/68";
}

function formatFilterLabel(value: string) {
  return value.replaceAll("_", " ");
}

function parseEventFilter(value: string | null): OrderExceptionEventFilter | null {
  if (value === "all" || value === "acknowledged" || value === "cleared") {
    return value;
  }

  return null;
}

function isAcknowledged(delivery?: NotificationDelivery) {
  if (!delivery) {
    return false;
  }

  const payload = delivery.payload ?? {};
  const acknowledgedSignature = String(payload.acknowledged_signature ?? "").trim();
  const alertSignature = String(payload.alert_signature ?? "").trim();
  return Boolean(acknowledgedSignature) && acknowledgedSignature === alertSignature;
}

export function OrderExceptionsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filtersInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [sellerSummaries, setSellerSummaries] = useState<OrderExceptionSellerSummaryRead[]>([]);
  const [events, setEvents] = useState<OrderExceptionEventRead[]>([]);
  const [statusFilter, setStatusFilter] = useState<DeliveryStatusFilter>("all");
  const [stateFilter, setStateFilter] = useState<OrderExceptionStateFilter>("active");
  const [eventFilter, setEventFilter] = useState<OrderExceptionEventFilter>("all");
  const [summaryFilter, setSummaryFilter] = useState<OrderExceptionSummaryFilter>("all");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const urlEventFilter = parseEventFilter(searchParams.get("events"));
    const stateParam = searchParams.get("state");
    const urlStateFilter =
      stateParam === "active" || stateParam === "acknowledged" || stateParam === "all"
        ? (stateParam as OrderExceptionStateFilter)
        : null;

    try {
      const raw = window.localStorage.getItem(ORDER_EXCEPTION_FILTERS_STORAGE_KEY);
      if (!raw) {
        if (urlEventFilter) {
          setEventFilter(urlEventFilter);
        }
        if (urlStateFilter) {
          setStateFilter(urlStateFilter);
        }
        filtersInitialized.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as OrderExceptionFilterState | null;
      if (!parsed || typeof parsed !== "object") {
        if (urlEventFilter) {
          setEventFilter(urlEventFilter);
        }
        if (urlStateFilter) {
          setStateFilter(urlStateFilter);
        }
        filtersInitialized.current = true;
        return;
      }

      if (parsed.statusFilter === "all" || parsed.statusFilter === "queued" || parsed.statusFilter === "sent" || parsed.statusFilter === "failed") {
        setStatusFilter(parsed.statusFilter);
      }
      if (parsed.stateFilter === "active" || parsed.stateFilter === "acknowledged" || parsed.stateFilter === "all") {
        setStateFilter(parsed.stateFilter);
      }
      if (parsed.eventFilter === "all" || parsed.eventFilter === "acknowledged" || parsed.eventFilter === "cleared") {
        setEventFilter(parsed.eventFilter);
      }
      if (
        parsed.summaryFilter === "all" ||
        parsed.summaryFilter === "acknowledged" ||
        parsed.summaryFilter === "cleared"
      ) {
        setSummaryFilter(parsed.summaryFilter);
      }
      if (urlStateFilter) {
        setStateFilter(urlStateFilter);
      }
      if (urlEventFilter) {
        setEventFilter(urlEventFilter);
      }
    } catch {
      window.localStorage.removeItem(ORDER_EXCEPTION_FILTERS_STORAGE_KEY);
      if (urlEventFilter) {
        setEventFilter(urlEventFilter);
      }
      if (urlStateFilter) {
        setStateFilter(urlStateFilter);
      }
    }
    filtersInitialized.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!filtersInitialized.current) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    if (eventFilter === "all") {
      nextParams.delete("events");
    } else {
      nextParams.set("events", eventFilter);
    }
    if (stateFilter === "active") {
      nextParams.delete("state");
    } else {
      nextParams.set("state", stateFilter);
    }
    if (summaryFilter === "all") {
      nextParams.delete("summary");
    } else {
      nextParams.set("summary", summaryFilter);
    }

    const nextQuery = nextParams.toString();
    if (nextQuery === searchParams.toString()) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [eventFilter, pathname, router, searchParams, stateFilter, summaryFilter]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ORDER_EXCEPTION_FILTERS_STORAGE_KEY,
          JSON.stringify({
            statusFilter,
            stateFilter,
            eventFilter,
            summaryFilter,
          } satisfies OrderExceptionFilterState),
      );
    } catch {
      // Ignore browser persistence failures.
    }
  }, [eventFilter, stateFilter, statusFilter, summaryFilter]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const currentSession = await restoreAdminSession();
        if (!currentSession) {
          throw new Error("Admin session not available.");
        }
        setSession(currentSession);

        const [response, sellerSummaryRows, eventRows] = await Promise.all([
          api.loadAdminNotificationDeliveries(currentSession.access_token),
          api.listAdminOrderExceptionSellerSummaries(
            4,
            summaryFilter === "all" ? undefined : summaryFilter,
            {
              accessToken: currentSession.access_token,
            },
          ),
          api.listAdminOrderExceptionEvents(20, { accessToken: currentSession.access_token }),
        ]);

        if (!cancelled) {
          setDeliveries(
            response.deliveries.filter((delivery) => delivery.payload?.alert_type === "order_exception"),
          );
          setSellerSummaries(sellerSummaryRows);
          setEvents(eventRows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load order exceptions.");
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
  }, [refreshTick, summaryFilter]);

  const latestDeliveryBySeller = useMemo(() => {
    const map = new Map<string, NotificationDelivery>();

    deliveries.forEach((delivery) => {
      const sellerId = String(delivery.payload?.seller_id ?? "").trim();
      if (!sellerId || map.has(sellerId)) {
        return;
      }

      map.set(sellerId, delivery);
    });

    return map;
  }, [deliveries]);

  const acknowledgedBySeller = useMemo(() => {
    const result: Record<string, boolean> = {};

    latestDeliveryBySeller.forEach((delivery, sellerId) => {
      result[sellerId] = isAcknowledged(delivery);
    });

    return result;
  }, [latestDeliveryBySeller]);

  const alertCounts = useMemo(
    () => ({
      total: deliveries.length,
      queued: deliveries.filter((delivery) => delivery.delivery_status === "queued").length,
      sent: deliveries.filter((delivery) => delivery.delivery_status === "sent").length,
      failed: deliveries.filter((delivery) => delivery.delivery_status === "failed").length,
      sellerTriggered: deliveries.filter((delivery) => delivery.payload?.actor_role === "seller").length,
      buyerTriggered: deliveries.filter((delivery) => delivery.payload?.actor_role === "buyer").length,
    }),
    [deliveries],
  );

  const filteredDeliveries = useMemo(
    () =>
      deliveries.filter((delivery) => {
        if (statusFilter !== "all" && delivery.delivery_status !== statusFilter) {
          return false;
        }

        return true;
      }),
    [deliveries, statusFilter],
  );

  const groupedDeliveries = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        orderId: string;
        listingTitle: string;
        previousStatus: string;
        currentStatus: string;
        deliveries: NotificationDelivery[];
      }
    >();

    filteredDeliveries.forEach((delivery) => {
      const payload = delivery.payload ?? {};
      const sellerSlug = String(payload.seller_slug ?? "").trim();
      const orderId = String(payload.order_id ?? delivery.transaction_id ?? "").trim();
      const listingTitle = String(payload.listing_title ?? "Order exception").trim();
      const sellerDisplayName = String(payload.seller_display_name ?? "Seller").trim();
      const previousStatus = String(payload.previous_status ?? "unknown").trim();
      const currentStatus = String(payload.current_status ?? "unknown").trim();
      const key = `${sellerSlug}:${orderId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.deliveries.push(delivery);
        return;
      }

      groups.set(key, {
        sellerDisplayName,
        sellerSlug,
        orderId,
        listingTitle,
        previousStatus,
        currentStatus,
        deliveries: [delivery],
      });
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      deliveries: [...group.deliveries].sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
    }));
  }, [filteredDeliveries]);

  const sellerSummariesByState = useMemo(
    () =>
      sellerSummaries.filter((summary) => {
        const acknowledged = acknowledgedBySeller[summary.seller_id];
        if (stateFilter === "active") {
          return !acknowledged;
        }
        if (stateFilter === "acknowledged") {
          return acknowledged;
        }
        return true;
      }),
    [acknowledgedBySeller, sellerSummaries, stateFilter],
  );

  const eventGroups = useMemo(() => {
    const filteredEvents = events.filter((event) => {
      if (eventFilter !== "all" && event.action !== eventFilter) {
        return false;
      }

      return true;
    });

    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        sellerId: string;
        events: OrderExceptionEventRead[];
      }
    >();

    filteredEvents.forEach((event) => {
      const existing = groups.get(event.seller_id);
      if (existing) {
        existing.events.push(event);
        return;
      }

      groups.set(event.seller_id, {
        sellerDisplayName: event.seller_display_name,
        sellerSlug: event.seller_slug,
        sellerId: event.seller_id,
        events: [event],
      });
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        events: [...group.events].sort(
          (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
        ),
      }))
      .sort(
        (left, right) =>
          right.events.length - left.events.length ||
          left.sellerDisplayName.localeCompare(right.sellerDisplayName),
      );
  }, [eventFilter, events]);

  const summaryCounts = useMemo(
    () => ({
      total: sellerSummaries.length,
      highPressure: sellerSummaries.filter((summary) => summary.event_count >= 2).length,
      active: sellerSummariesByState.filter((summary) => !acknowledgedBySeller[summary.seller_id]).length,
      acknowledged: sellerSummariesByState.filter((summary) => acknowledgedBySeller[summary.seller_id]).length,
    }),
    [acknowledgedBySeller, sellerSummaries, sellerSummariesByState],
  );

  const eventCounts = useMemo(
    () => ({
      total: events.length,
      acknowledged: events.filter((event) => event.action === "acknowledged").length,
      cleared: events.filter((event) => event.action === "cleared").length,
    }),
    [events],
  );

  async function setAcknowledgement(sellerId: string, acknowledged: boolean) {
    if (!session) {
      return;
    }

    try {
      if (acknowledged) {
        await api.acknowledgeAdminOrderException(sellerId, { accessToken: session.access_token });
      } else {
        await api.clearAdminOrderExceptionAcknowledgement(sellerId, { accessToken: session.access_token });
      }
      setRefreshTick((current) => current + 1);
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : "Unable to update order exception state.");
    }
  }

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading order exceptions...
      </section>
    );
  }

  if (error) {
    return (
      <section className="card-shadow rounded-[2rem] border border-danger/30 bg-danger/8 p-6 text-sm text-danger">
        {error}
      </section>
    );
  }

  return (
    <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Transaction automation
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Order exception notifications
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
            Orders that were confirmed and later canceled or otherwise flagged out of flow. Use this lane
            to inspect the resulting alerts and jump straight into transaction support.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {[
            ["all", `All · ${alertCounts.total}`],
            ["queued", `Queued · ${alertCounts.queued}`],
            ["sent", `Sent · ${alertCounts.sent}`],
            ["failed", `Failed · ${alertCounts.failed}`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value as DeliveryStatusFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                statusFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total", alertCounts.total],
          ["Seller-triggered", alertCounts.sellerTriggered],
          ["Buyer-triggered", alertCounts.buyerTriggered],
          ["Failed", alertCounts.failed],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Tracked sellers", summaryCounts.total],
          ["Active", summaryCounts.active],
          ["Acknowledged", summaryCounts.acknowledged],
          ["High pressure", summaryCounts.highPressure],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {String(value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["all", `All summary · ${sellerSummaries.length}`],
          ["acknowledged", `Acknowledged · ${sellerSummaries.filter((summary) => acknowledgedBySeller[summary.seller_id]).length}`],
          ["cleared", `Cleared · ${sellerSummaries.filter((summary) => !acknowledgedBySeller[summary.seller_id]).length}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSummaryFilter(value as OrderExceptionSummaryFilter)}
            className={`rounded-full border px-3 py-1 transition ${
              summaryFilter === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["active", `Active · ${summaryCounts.active}`],
          ["acknowledged", `Acknowledged · ${summaryCounts.acknowledged}`],
          ["all", `All sellers · ${summaryCounts.total}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStateFilter(value as OrderExceptionStateFilter)}
            className={`rounded-full border px-3 py-1 transition ${
              stateFilter === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["all", `All events · ${eventCounts.total}`],
          ["acknowledged", `Acknowledged · ${eventCounts.acknowledged}`],
          ["cleared", `Cleared · ${eventCounts.cleared}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setEventFilter(value as OrderExceptionEventFilter)}
            className={`rounded-full border px-3 py-1 transition ${
              eventFilter === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {sellerSummariesByState.length > 0 ? (
          sellerSummariesByState.map((summary) => {
            const delivery = latestDeliveryBySeller.get(summary.seller_id);
            const acknowledged = acknowledgedBySeller[summary.seller_id];
            return (
              <article
                key={summary.seller_id}
                className="rounded-[1.5rem] border border-border bg-background/85 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link
                      href={`/sellers/${summary.seller_slug}`}
                      className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {summary.seller_display_name}
                    </Link>
                    <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">
                      {summary.seller_slug}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                      {summary.event_count} alerts
                    </span>
                    <span className={`rounded-full border px-3 py-1 ${toneClasses(summary.latest_event_status)}`}>
                      {summary.latest_event_status.replaceAll("_", " ")}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                      {acknowledged ? "Acknowledged" : "Active"}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-7 text-foreground/72">
                  Latest action · {formatFilterLabel(summary.latest_event_action)} ·{" "}
                  {new Date(summary.latest_event_created_at).toLocaleString()}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void setAcknowledgement(summary.seller_id, !acknowledged)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    {acknowledged ? "Clear ack" : "Acknowledge"}
                  </button>
                  <Link
                    href={`/sellers/${summary.seller_slug}`}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Open seller
                  </Link>
                </div>
                {delivery ? (
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-foreground/52">
                    Latest signature · {String(delivery.payload?.alert_signature ?? "unknown")}
                  </p>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No seller summaries match the current state filter.
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {groupedDeliveries.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No order exceptions match the current filter.
          </div>
        ) : (
          groupedDeliveries.map((group) => (
            <article
              key={`${group.sellerSlug}:${group.orderId}`}
              className="rounded-[1.5rem] border border-border bg-background/85 p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3 lg:flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${group.sellerSlug}`}
                      className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {group.sellerDisplayName}
                    </Link>
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.sellerSlug}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.deliveries.length} alerts
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/transactions?focus=order:${group.orderId}`}
                      className="text-sm font-medium text-foreground transition hover:text-accent"
                    >
                      {group.listingTitle}
                    </Link>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.orderId}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      Previous · {formatFilterLabel(group.previousStatus)}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      Current · {formatFilterLabel(group.currentStatus)}
                    </span>
                  </div>

                  <p className="text-sm leading-7 text-foreground/72">
                    {String(group.deliveries[0]?.payload?.exception_reason ?? "Order exception")}
                  </p>

                  <div className="flex flex-wrap gap-2 text-xs text-foreground/60">
                    <span className="rounded-full border border-border bg-surface px-3 py-1">
                      Open · {group.deliveries.filter((delivery) => delivery.delivery_status === "queued").length}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-3 py-1">
                      Sent · {group.deliveries.filter((delivery) => delivery.delivery_status === "sent").length}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-3 py-1">
                      Failed · {group.deliveries.filter((delivery) => delivery.delivery_status === "failed").length}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-3 py-1">
                      Actor · {formatFilterLabel(String(group.deliveries[0]?.payload?.actor_role ?? "unknown"))}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-right">
                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                      group.deliveries[0]?.delivery_status
                        ? toneClasses(group.deliveries[0].delivery_status)
                        : "border-border bg-background text-foreground/68"
                    }`}
                  >
                    {group.deliveries[0]?.delivery_status ?? "unknown"}
                  </span>
                  <p className="text-xs text-foreground/52">
                    {new Date(group.deliveries[0]?.created_at ?? "").toLocaleString()}
                  </p>
                  <Link
                    href={`/admin/transactions?focus=order:${group.orderId}`}
                    className="inline-flex rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Open support queue
                  </Link>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {eventGroups.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No order exception events match the current history filter.
          </div>
        ) : (
          eventGroups.map((group) => (
            <article
              key={group.sellerId}
              className="rounded-[1.5rem] border border-border bg-background/85 p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link
                    href={`/sellers/${group.sellerSlug}`}
                    className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                  >
                    {group.sellerDisplayName}
                  </Link>
                  <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">
                    {group.sellerSlug}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                    {group.events.length} events
                  </span>
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                    Latest · {formatFilterLabel(group.events[0]?.action ?? "unknown")}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {group.events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-[1.25rem] border border-border bg-surface px-4 py-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {formatFilterLabel(event.action)} · {event.order_status.replaceAll("_", " ")}
                        </p>
                        <p className="text-xs text-foreground/58">
                          Order {event.order_id} · {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-border bg-background px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-foreground/56">
                          Signature · {event.alert_signature.slice(0, 18)}
                        </span>
                        <Link
                          href={`/admin/transactions?focus=order:${event.order_id}`}
                          className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                          >
                            Open queue
                          </Link>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void setAcknowledgement(group.sellerId, !acknowledgedBySeller[group.sellerId])}
                        className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      >
                        {acknowledgedBySeller[group.sellerId] ? "Clear ack" : "Acknowledge"}
                      </button>
                      <Link
                        href={`/sellers/${group.sellerSlug}`}
                        className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      >
                        Open seller
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
