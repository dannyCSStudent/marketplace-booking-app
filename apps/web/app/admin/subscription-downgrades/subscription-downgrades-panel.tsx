"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  createApiClient,
  type SubscriptionDowngradeEventRead,
  type SubscriptionDowngradeSellerSummaryRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type SummaryStateFilter = "active" | "acknowledged" | "all";
type EventActionFilter = "all" | "acknowledged" | "cleared";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const SUMMARY_STATE_STORAGE_KEY = "subscription-downgrades-summary-state";
const EVENT_FILTER_STORAGE_KEY = "subscription-downgrades-event-filter";

function toneClasses(status: string) {
  if (status === "failed") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  if (status === "queued") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  return "border-border bg-surface text-foreground/68";
}

function formatTierLabel(previousTier: string | null | undefined, currentTier: string | null | undefined) {
  const fromTier = String(previousTier ?? "Previous tier").trim();
  const toTier = String(currentTier ?? "Current tier").trim();
  return `${fromTier} → ${toTier}`;
}

export function SubscriptionDowngradesPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SubscriptionDowngradeSellerSummaryRead[]>([]);
  const [events, setEvents] = useState<SubscriptionDowngradeEventRead[]>([]);
  const [summaryStateFilter, setSummaryStateFilter] = useState<SummaryStateFilter>("active");
  const [eventFilter, setEventFilter] = useState<EventActionFilter>("all");
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedState = window.localStorage.getItem(SUMMARY_STATE_STORAGE_KEY);
    if (storedState === "active" || storedState === "acknowledged" || storedState === "all") {
      setSummaryStateFilter(storedState);
    }

    const storedEvents = window.localStorage.getItem(EVENT_FILTER_STORAGE_KEY);
    if (storedEvents === "all" || storedEvents === "acknowledged" || storedEvents === "cleared") {
      setEventFilter(storedEvents);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SUMMARY_STATE_STORAGE_KEY, summaryStateFilter);
  }, [summaryStateFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(EVENT_FILTER_STORAGE_KEY, eventFilter);
  }, [eventFilter]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const session = await restoreAdminSession();
        if (!session) {
          throw new Error("Admin session not available.");
        }

        const [summaryRows, eventRows] = await Promise.all([
          api.listAdminSubscriptionDowngradeSellerSummaries(12, "all", {
            accessToken: session.access_token,
          }),
          api.listAdminSubscriptionDowngradeEvents(50, { accessToken: session.access_token }),
        ]);

        if (!cancelled) {
          setSummaries(summaryRows);
          setEvents(eventRows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load subscription downgrades.",
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
  }, [refreshIndex]);

  const summaryCounts = useMemo(
    () => ({
      total: summaries.length,
      active: summaries.filter((summary) => !summary.acknowledged).length,
      acknowledged: summaries.filter((summary) => summary.acknowledged).length,
    }),
    [summaries],
  );

  const filteredSummaries = useMemo(
    () =>
      summaries.filter((summary) => {
        if (summaryStateFilter === "all") {
          return true;
        }

        return summaryStateFilter === "acknowledged" ? summary.acknowledged : !summary.acknowledged;
      }),
    [summaries, summaryStateFilter],
  );

  const eventCounts = useMemo(
    () => ({
      total: events.length,
      acknowledged: events.filter((event) => event.action === "acknowledged").length,
      cleared: events.filter((event) => event.action === "cleared").length,
    }),
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (eventFilter === "all") {
          return true;
        }

        return event.action === eventFilter;
      }),
    [eventFilter, events],
  );

  const groupedEvents = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerId: string;
        sellerSlug: string;
        sellerDisplayName: string;
        events: SubscriptionDowngradeEventRead[];
      }
    >();

    filteredEvents.forEach((event) => {
      const existing = groups.get(event.seller_id);
      if (existing) {
        existing.events.push(event);
        return;
      }

      groups.set(event.seller_id, {
        sellerId: event.seller_id,
        sellerSlug: event.seller_slug,
        sellerDisplayName: event.seller_display_name,
        events: [event],
      });
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        events: [...group.events].sort(
          (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
        ),
      }))
      .sort((left, right) => right.events.length - left.events.length || left.sellerDisplayName.localeCompare(right.sellerDisplayName));
  }, [filteredEvents]);

  async function acknowledgeSeller(sellerId: string) {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available.");
    }

    await api.acknowledgeAdminSubscriptionDowngrade(sellerId, {
      accessToken: session.access_token,
    });
    setRefreshIndex((current) => current + 1);
  }

  async function clearSellerAcknowledgement(sellerId: string) {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available.");
    }

    await api.clearAdminSubscriptionDowngradeAcknowledgement(sellerId, {
      accessToken: session.access_token,
    });
    setRefreshIndex((current) => current + 1);
  }

  async function retryDelivery(deliveryId: string) {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available.");
    }

    setRetryingDeliveryId(deliveryId);
    try {
      await api.retryAdminNotificationDelivery(deliveryId, session.access_token);
      setRefreshIndex((current) => current + 1);
    } finally {
      setRetryingDeliveryId(null);
    }
  }

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading subscription downgrades...
      </section>
    );
  }

  if (error) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-danger">
        {error}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["All alerts", summaryCounts.total],
          ["Active", summaryCounts.active],
          ["Acknowledged", summaryCounts.acknowledged],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-3xl border border-border bg-white p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/48">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {value as number}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-[2rem] border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
              Alert Lane
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              Subscription downgrade alerts
            </h2>
            <p className="mt-2 text-sm leading-7 text-foreground/68">
              Notifications emitted when sellers move to a lower tier or lose premium perks.
            </p>
          </div>
          <Link
            href="/admin/monetization"
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Open monetization
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["active", `Active · ${summaryCounts.active}`],
            ["acknowledged", `Acknowledged · ${summaryCounts.acknowledged}`],
            ["all", `All · ${summaryCounts.total}`],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                summaryStateFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
              onClick={() => setSummaryStateFilter(value as SummaryStateFilter)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {filteredSummaries.length > 0 ? (
            filteredSummaries.map((summary) => (
              <div key={summary.seller_id} className="rounded-[1.1rem] border border-border bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{summary.seller_display_name}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/52">
                      {summary.seller_slug}
                    </p>
                    <p className="mt-2 text-sm text-foreground/70">
                      {formatTierLabel(summary.previous_tier_name, summary.current_tier_name)}
                    </p>
                    <p className="mt-1 text-xs text-foreground/52">
                      {summary.reason_code ?? "downgrade"} · Latest alert{" "}
                      {new Date(summary.latest_alert_delivery_created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClasses(summary.latest_alert_delivery_status)}`}>
                      {summary.latest_alert_delivery_status}
                    </span>
                    <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
                      {summary.alert_delivery_count} alert{summary.alert_delivery_count === 1 ? "" : "s"}
                    </span>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={() => acknowledgeSeller(summary.seller_id)}
                        type="button"
                      >
                        Acknowledge
                      </button>
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={() => clearSellerAcknowledgement(summary.seller_id)}
                        type="button"
                      >
                        Clear ack
                      </button>
                      <button
                        className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:opacity-45"
                        disabled={!summary.latest_alert_delivery_id || retryingDeliveryId === summary.latest_alert_delivery_id}
                        onClick={() => summary.latest_alert_delivery_id && retryDelivery(summary.latest_alert_delivery_id)}
                        type="button"
                      >
                        {retryingDeliveryId === summary.latest_alert_delivery_id ? "Retrying..." : "Retry latest"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-foreground/66">No subscription downgrade alerts match the current filter.</p>
          )}
        </div>
      </section>

      <section className="rounded-[2rem] border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
              Event History
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              Subscription downgrade history
            </h2>
            <p className="mt-2 text-sm leading-7 text-foreground/68">
              Acknowledges and clears recorded against the downgrade alert deliveries.
            </p>
          </div>
          <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
            {events.length} events
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["all", `All · ${eventCounts.total}`],
            ["acknowledged", `Acknowledged · ${eventCounts.acknowledged}`],
            ["cleared", `Cleared · ${eventCounts.cleared}`],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                eventFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
              onClick={() => setEventFilter(value as EventActionFilter)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {groupedEvents.length > 0 ? (
            groupedEvents.map((group) => (
              <div key={group.sellerId} className="rounded-[1.1rem] border border-border bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{group.sellerDisplayName}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/52">
                      {group.sellerSlug}
                    </p>
                    <p className="mt-2 text-sm text-foreground/70">
                      {group.events[0]?.reason_code ?? "downgrade"} · {group.events.length} history
                      {group.events.length === 1 ? "" : " entries"}
                    </p>
                  </div>
                  <Link
                    href={`/admin/monetization?seller=${encodeURIComponent(group.sellerSlug || group.sellerId)}`}
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Open monetization
                  </Link>
                </div>
                <div className="mt-3 space-y-2">
                  {group.events.map((event) => (
                    <div key={event.id} className="rounded-[1rem] border border-border/70 bg-surface px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {event.action === "acknowledged" ? "Acknowledged" : "Cleared"} ·{" "}
                            {formatTierLabel(event.from_tier_name, event.to_tier_name)}
                          </p>
                          <p className="mt-1 text-xs text-foreground/52">
                            {event.reason_code ?? "downgrade"}{event.note ? ` · ${event.note}` : ""}
                          </p>
                        </div>
                        <p className="text-xs text-foreground/52">
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-foreground/66">No subscription downgrade events match the current filter.</p>
          )}
        </div>
      </section>
    </div>
  );
}
