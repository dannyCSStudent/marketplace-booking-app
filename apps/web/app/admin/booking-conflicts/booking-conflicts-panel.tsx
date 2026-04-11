"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type BookingConflictEventRead,
  type BookingConflictSellerSummaryRead,
  type NotificationDelivery,
} from "@/app/lib/api";
import { restoreAdminSession, type AdminSession } from "@/app/lib/admin-auth";

type DeliveryStatusFilter = "all" | "queued" | "sent" | "failed";
type ConflictStateFilter = "active" | "acknowledged" | "all";
type ConflictEventFilter = "all" | "acknowledged" | "cleared";

type ConflictFilterState = {
  statusFilter?: DeliveryStatusFilter;
  stateFilter?: ConflictStateFilter;
  eventFilter?: ConflictEventFilter;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const STORAGE_KEY = "booking-conflicts-filters";

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

function parseEventFilter(value: string | null): ConflictEventFilter | null {
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
  return (
    String(payload.acknowledged_signature ?? "").trim() === String(payload.alert_signature ?? "").trim()
  );
}

export function BookingConflictsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [sellerSummaries, setSellerSummaries] = useState<BookingConflictSellerSummaryRead[]>([]);
  const [events, setEvents] = useState<BookingConflictEventRead[]>([]);
  const [statusFilter, setStatusFilter] = useState<DeliveryStatusFilter>("all");
  const [stateFilter, setStateFilter] = useState<ConflictStateFilter>("active");
  const [eventFilter, setEventFilter] = useState<ConflictEventFilter>("all");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const urlEventFilter = parseEventFilter(searchParams.get("events"));
    const urlStateParam = searchParams.get("state");
    const urlStateFilter =
      urlStateParam === "active" || urlStateParam === "acknowledged" || urlStateParam === "all"
        ? (urlStateParam as ConflictStateFilter)
        : null;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ConflictFilterState | null;
        if (parsed && typeof parsed === "object") {
          if (
            parsed.statusFilter === "all" ||
            parsed.statusFilter === "queued" ||
            parsed.statusFilter === "sent" ||
            parsed.statusFilter === "failed"
          ) {
            setStatusFilter(parsed.statusFilter);
          }
          if (
            parsed.stateFilter === "active" ||
            parsed.stateFilter === "acknowledged" ||
            parsed.stateFilter === "all"
          ) {
            setStateFilter(parsed.stateFilter);
          }
          if (
            parsed.eventFilter === "all" ||
            parsed.eventFilter === "acknowledged" ||
            parsed.eventFilter === "cleared"
          ) {
            setEventFilter(parsed.eventFilter);
          }
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    if (urlEventFilter) {
      setEventFilter(urlEventFilter);
    }
    if (urlStateFilter) {
      setStateFilter(urlStateFilter);
    }
    initialized.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!initialized.current) {
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
    const nextQuery = nextParams.toString();
    if (nextQuery === searchParams.toString()) {
      return;
    }
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [eventFilter, pathname, router, searchParams, stateFilter]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ statusFilter, stateFilter, eventFilter } satisfies ConflictFilterState),
      );
    } catch {
      // ignore
    }
  }, [eventFilter, stateFilter, statusFilter]);

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

        const [response, summaryRows, eventRows] = await Promise.all([
          api.loadAdminNotificationDeliveries(currentSession.access_token),
          api.listAdminBookingConflictSellerSummaries(
            4,
            stateFilter === "all" ? undefined : stateFilter === "active" ? "cleared" : "acknowledged",
            { accessToken: currentSession.access_token },
          ),
          api.listAdminBookingConflictEvents(20, { accessToken: currentSession.access_token }),
        ]);

        if (!cancelled) {
          setDeliveries(
            response.deliveries.filter((delivery) => delivery.payload?.alert_type === "booking_conflict"),
          );
          setSellerSummaries(summaryRows);
          setEvents(eventRows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load booking conflicts.");
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
  }, [refreshTick, stateFilter]);

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
    }),
    [deliveries],
  );

  const sellerCounts = useMemo(
    () => ({
      total: sellerSummaries.length,
      active: sellerSummaries.filter((summary) => !acknowledgedBySeller[summary.seller_id]).length,
      acknowledged: sellerSummaries.filter((summary) => acknowledgedBySeller[summary.seller_id]).length,
    }),
    [acknowledgedBySeller, sellerSummaries],
  );

  const filteredSummaries = useMemo(
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
    const filteredEvents = events.filter((event) => eventFilter === "all" || event.action === eventFilter);
    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        sellerId: string;
        events: BookingConflictEventRead[];
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

  async function setAcknowledgement(sellerId: string, acknowledged: boolean) {
    if (!session) {
      return;
    }

    try {
      if (acknowledged) {
        await api.acknowledgeAdminBookingConflict(sellerId, { accessToken: session.access_token });
      } else {
        await api.clearAdminBookingConflictAcknowledgement(sellerId, { accessToken: session.access_token });
      }
      setRefreshTick((current) => current + 1);
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : "Unable to update booking conflict state.");
    }
  }

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading booking conflicts...
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
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Transaction automation</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Booking conflict notifications
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
            Overlapping booking requests and auto-accept conflicts. Use this lane to inspect the
            resulting alerts, acknowledge them, and jump into the affected booking.
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
          ["Queued", alertCounts.queued],
          ["Sent", alertCounts.sent],
          ["Failed", alertCounts.failed],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["all", `All summaries · ${sellerCounts.total}`],
          ["acknowledged", `Acknowledged · ${sellerCounts.acknowledged}`],
          ["cleared", `Active · ${sellerCounts.active}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStateFilter(value as ConflictStateFilter)}
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
          ["all", `All events · ${events.length}`],
          ["acknowledged", `Acknowledged · ${events.filter((event) => event.action === "acknowledged").length}`],
          ["cleared", `Cleared · ${events.filter((event) => event.action === "cleared").length}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setEventFilter(value as ConflictEventFilter)}
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
        {filteredSummaries.length > 0 ? (
          filteredSummaries.map((summary) => {
            const acknowledged = acknowledgedBySeller[summary.seller_id];
            const delivery = latestDeliveryBySeller.get(summary.seller_id);
            return (
              <article key={summary.seller_id} className="rounded-[1.5rem] border border-border bg-background/85 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/sellers/${summary.seller_slug}`} className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent">
                      {summary.seller_display_name}
                    </Link>
                    <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{summary.seller_slug}</p>
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
                  Latest action · {formatFilterLabel(summary.latest_event_action)} · {new Date(summary.latest_event_created_at).toLocaleString()}
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
                    href={`/admin/transactions?focus=booking:${delivery?.transaction_id ?? summary.seller_id}`}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Open queue
                  </Link>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No booking conflict summaries match the current filter.
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {eventGroups.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No booking conflict events match the current history filter.
          </div>
        ) : (
          eventGroups.map((group) => (
            <article key={group.sellerId} className="rounded-[1.5rem] border border-border bg-background/85 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/sellers/${group.sellerSlug}`} className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent">
                    {group.sellerDisplayName}
                  </Link>
                  <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{group.sellerSlug}</p>
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
                  <div key={event.id} className="rounded-[1.25rem] border border-border bg-surface px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {formatFilterLabel(event.action)} · {event.conflict_count} conflict
                          {event.conflict_count === 1 ? "" : "s"}
                        </p>
                        <p className="text-xs text-foreground/58">
                          Booking {event.booking_id} · {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/admin/transactions?focus=booking:${event.booking_id}`}
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
