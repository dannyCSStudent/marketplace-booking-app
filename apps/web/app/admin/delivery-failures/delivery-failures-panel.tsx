"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type DeliveryFailureEventRead,
  type DeliveryFailureSummaryRead,
} from "@/app/lib/api";
import { restoreAdminSession, type AdminSession } from "@/app/lib/admin-auth";

type StateFilter = "active" | "acknowledged" | "all";
type StatusFilter = "all" | "queued" | "sent" | "failed";
type ChannelFilter = "all" | "email" | "push";
type EventFilter = "all" | "acknowledged" | "cleared";

type FilterState = {
  stateFilter?: StateFilter;
  statusFilter?: StatusFilter;
  channelFilter?: ChannelFilter;
  eventFilter?: EventFilter;
};

type EventGroup = {
  failedDeliveryId: string;
  latestCreatedAt: string;
  events: DeliveryFailureEventRead[];
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const STORAGE_KEY = "delivery-failures-filters";

function toneClasses(status: string) {
  if (status === "failed") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  if (status === "queued") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  return "border-border bg-surface text-foreground/68";
}

function parseEventFilter(value: string | null): EventFilter | null {
  if (value === "all" || value === "acknowledged" || value === "cleared") {
    return value;
  }

  return null;
}

function isAcknowledged(summary: DeliveryFailureSummaryRead) {
  return summary.acknowledged;
}

function matchesSearch(summary: DeliveryFailureSummaryRead, searchQuery: string) {
  if (!searchQuery.trim()) {
    return true;
  }

  const haystack = [
    summary.failed_delivery_id,
    summary.transaction_kind,
    summary.transaction_id,
    summary.failed_delivery_channel,
    summary.failed_delivery_status,
    summary.failed_delivery_reason,
    summary.original_recipient_user_id,
    String(summary.failed_delivery_attempts),
    String(summary.alert_delivery_count),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchQuery.trim().toLowerCase());
}

function matchesEventSearch(event: DeliveryFailureEventRead, searchQuery: string) {
  if (!searchQuery.trim()) {
    return true;
  }

  const haystack = [
    event.failed_delivery_id,
    event.failed_delivery_channel,
    event.failed_delivery_status,
    event.failed_delivery_reason,
    event.original_recipient_user_id,
    event.action,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchQuery.trim().toLowerCase());
}

export function DeliveryFailuresPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filtersInitialized = useRef(false);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<DeliveryFailureSummaryRead[]>([]);
  const [events, setEvents] = useState<DeliveryFailureEventRead[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("active");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  useEffect(() => {
    const urlEventFilter = parseEventFilter(searchParams.get("events"));
    const urlStateParam = searchParams.get("state");
    const urlStateFilter =
      urlStateParam === "active" || urlStateParam === "acknowledged" || urlStateParam === "all"
        ? (urlStateParam as StateFilter)
        : null;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FilterState | null;
        if (parsed && typeof parsed === "object") {
          if (
            parsed.stateFilter === "active" ||
            parsed.stateFilter === "acknowledged" ||
            parsed.stateFilter === "all"
          ) {
            setStateFilter(parsed.stateFilter);
          }
          if (
            parsed.statusFilter === "all" ||
            parsed.statusFilter === "queued" ||
            parsed.statusFilter === "sent" ||
            parsed.statusFilter === "failed"
          ) {
            setStatusFilter(parsed.statusFilter);
          }
          if (parsed.channelFilter === "all" || parsed.channelFilter === "email" || parsed.channelFilter === "push") {
            setChannelFilter(parsed.channelFilter);
          }
          if (parsed.eventFilter === "all" || parsed.eventFilter === "acknowledged" || parsed.eventFilter === "cleared") {
            setEventFilter(parsed.eventFilter);
          }
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    if (urlStateFilter) {
      setStateFilter(urlStateFilter);
    }
    if (urlEventFilter) {
      setEventFilter(urlEventFilter);
    }
    filtersInitialized.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!filtersInitialized.current) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    if (stateFilter === "active") {
      nextParams.delete("state");
    } else {
      nextParams.set("state", stateFilter);
    }
    if (eventFilter === "all") {
      nextParams.delete("events");
    } else {
      nextParams.set("events", eventFilter);
    }

    const nextQuery = nextParams.toString();
    if (nextQuery === searchParams.toString()) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [eventFilter, pathname, router, searchParams, stateFilter]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          stateFilter,
          statusFilter,
          channelFilter,
          eventFilter,
        } satisfies FilterState),
      );
    } catch {
      // Ignore browser persistence failures.
    }
  }, [channelFilter, eventFilter, stateFilter, statusFilter]);

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

        const [summaryRows, eventRows] = await Promise.all([
          api.listAdminDeliveryFailureSummaries(12, stateFilter, {
            accessToken: currentSession.access_token,
          }),
          api.listAdminDeliveryFailureEvents(50, {
            accessToken: currentSession.access_token,
          }),
        ]);

        if (!cancelled) {
          setSummaries(summaryRows);
          setEvents(eventRows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load delivery failures.");
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

  const filteredSummaries = useMemo(
    () =>
      summaries.filter((summary) => {
        if (stateFilter === "active" && isAcknowledged(summary)) {
          return false;
        }
        if (stateFilter === "acknowledged" && !isAcknowledged(summary)) {
          return false;
        }
        if (statusFilter !== "all" && summary.latest_alert_delivery_status !== statusFilter) {
          return false;
        }
        if (channelFilter !== "all" && summary.failed_delivery_channel !== channelFilter) {
          return false;
        }
        return matchesSearch(summary, searchQuery);
      }),
    [channelFilter, searchQuery, stateFilter, statusFilter, summaries],
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (eventFilter !== "all" && event.action !== eventFilter) {
          return false;
        }
        return matchesEventSearch(event, searchQuery);
      }),
    [eventFilter, events, searchQuery],
  );

  const eventGroups = useMemo(() => {
    const grouped = new Map<string, EventGroup>();

    filteredEvents.forEach((event) => {
      const current = grouped.get(event.failed_delivery_id);
      if (!current) {
        grouped.set(event.failed_delivery_id, {
          failedDeliveryId: event.failed_delivery_id,
          latestCreatedAt: event.created_at,
          events: [event],
        });
        return;
      }

      current.events.push(event);
      if (new Date(event.created_at).getTime() > new Date(current.latestCreatedAt).getTime()) {
        current.latestCreatedAt = event.created_at;
      }
    });

    return [...grouped.values()].sort(
      (left, right) =>
        new Date(right.latestCreatedAt).getTime() - new Date(left.latestCreatedAt).getTime(),
    );
  }, [filteredEvents]);

  const counts = useMemo(
    () => ({
      total: summaries.length,
      active: summaries.filter((summary) => !isAcknowledged(summary)).length,
      acknowledged: summaries.filter((summary) => isAcknowledged(summary)).length,
      queued: summaries.filter((summary) => summary.latest_alert_delivery_status === "queued").length,
      sent: summaries.filter((summary) => summary.latest_alert_delivery_status === "sent").length,
      failed: summaries.filter((summary) => summary.latest_alert_delivery_status === "failed").length,
    }),
    [summaries],
  );

  async function retryOriginalDelivery(failedDeliveryId: string) {
    if (!session) {
      return;
    }

    setRetryingId(failedDeliveryId);
    try {
      await api.retryAdminNotificationDelivery(failedDeliveryId, session.access_token);
      setRefreshTick((current) => current + 1);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Unable to retry delivery.");
    } finally {
      setRetryingId((current) => (current === failedDeliveryId ? null : current));
    }
  }

  async function setAcknowledgement(failedDeliveryId: string, acknowledged: boolean) {
    if (!session) {
      return;
    }

    setAcknowledgingId(failedDeliveryId);
    try {
      if (acknowledged) {
        await api.acknowledgeAdminDeliveryFailure(failedDeliveryId, {
          accessToken: session.access_token,
        });
      } else {
        await api.clearAdminDeliveryFailureAcknowledgement(failedDeliveryId, {
          accessToken: session.access_token,
        });
      }
      setRefreshTick((current) => current + 1);
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : "Unable to update delivery failure acknowledgement.");
    } finally {
      setAcknowledgingId((current) => (current === failedDeliveryId ? null : current));
    }
  }

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading delivery failures...
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
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Queue health</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Delivery failure alerts
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
            Worker-side notification failures that exhausted retries. This lane tracks the queued
            alert deliveries that fire after a notification row hits its final failure state, and
            records acknowledge and clear actions in the event history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {[
            ["active", `Active · ${counts.active}`],
            ["acknowledged", `Acknowledged · ${counts.acknowledged}`],
            ["all", `All · ${counts.total}`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStateFilter(value as StateFilter)}
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
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["all", `All statuses · ${counts.total}`],
          ["queued", `Queued · ${counts.queued}`],
          ["sent", `Sent · ${counts.sent}`],
          ["failed", `Failed · ${counts.failed}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value as StatusFilter)}
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

      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["all", "All channels"],
          ["email", "Email"],
          ["push", "Push"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setChannelFilter(value as ChannelFilter)}
            className={`rounded-full border px-3 py-1 transition ${
              channelFilter === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="rounded-full border border-border px-3 py-1 text-foreground/56">
          {counts.total} delivery failure groups
        </span>
      </div>

      <div className="mt-4">
        <input
          className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent sm:max-w-md"
          placeholder="Search delivery id, reason, or payload..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <div className="mt-6 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/50">
                Summary
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">
                Failure groups
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setStateFilter("active");
                setStatusFilter("all");
                setChannelFilter("all");
                setEventFilter("all");
                setSearchQuery("");
              }}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
            >
              Clear filters
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {filteredSummaries.length > 0 ? (
              filteredSummaries.map((summary) => (
                <article
                  key={summary.failed_delivery_id}
                  className="rounded-[1.5rem] border border-border bg-background/85 p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                        {summary.transaction_kind} · {summary.failed_delivery_id}
                      </p>
                      <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">
                        {summary.transaction_id} · {summary.alert_delivery_count} alert deliver
                        {summary.alert_delivery_count === 1 ? "y" : "ies"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                        Attempts · {summary.failed_delivery_attempts}
                      </span>
                      <span className={`rounded-full border px-3 py-1 ${toneClasses(summary.latest_alert_delivery_status)}`}>
                        {summary.latest_alert_delivery_status}
                      </span>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                        {summary.failed_delivery_channel}
                      </span>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/56">
                        {isAcknowledged(summary) ? "Acknowledged" : "Active"}
                      </span>
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-7 text-foreground/72">{summary.failed_delivery_reason}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void retryOriginalDelivery(summary.failed_delivery_id)}
                      disabled={retryingId === summary.failed_delivery_id}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                    >
                      {retryingId === summary.failed_delivery_id ? "Retrying..." : "Retry original delivery"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void setAcknowledgement(summary.failed_delivery_id, !summary.acknowledged)}
                      disabled={acknowledgingId === summary.failed_delivery_id}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                    >
                      {acknowledgingId === summary.failed_delivery_id
                        ? "Updating..."
                        : summary.acknowledged
                          ? "Clear ack"
                          : "Acknowledge"}
                    </button>
                    <Link
                      href={`/admin/deliveries?preset=failed_only&status=failed&q=${encodeURIComponent(summary.failed_delivery_id)}`}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    >
                      Open delivery ops
                    </Link>
                  </div>

                  <div className="mt-4 text-xs uppercase tracking-[0.16em] text-foreground/54">
                    Latest update · {new Date(summary.latest_alert_delivery_created_at).toLocaleString()}
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
                No delivery failure alerts match the current filter.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/50">
                Event history
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">
                Acknowledge and clear audit trail
              </h3>
            </div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
              {[
                ["all", "All"],
                ["acknowledged", "Acknowledged"],
                ["cleared", "Cleared"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEventFilter(value as EventFilter)}
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
          </div>

          {eventGroups.length > 0 ? (
            <div className="space-y-3">
              {eventGroups.map((group) => (
                <article key={group.failedDeliveryId} className="rounded-[1.5rem] border border-border bg-background/85 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-semibold tracking-[-0.03em] text-foreground">
                        {group.failedDeliveryId}
                      </p>
                      <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">
                        {group.events.length} event{group.events.length === 1 ? "" : "s"} · latest{" "}
                        {new Date(group.latestCreatedAt).toLocaleString()}
                      </p>
                    </div>
                    <Link
                      href={`/admin/deliveries?preset=failed_only&status=failed&q=${encodeURIComponent(group.failedDeliveryId)}`}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    >
                      Open delivery ops
                    </Link>
                  </div>

                  <div className="mt-4 space-y-2">
                    {group.events.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-border bg-surface px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-foreground/60">
                            {event.action}
                          </span>
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-foreground/60">
                            {event.failed_delivery_channel}
                          </span>
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-foreground/60">
                            {event.failed_delivery_status}
                          </span>
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-foreground/60">
                            attempts · {event.failed_delivery_attempts}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-foreground/70">
                          {event.failed_delivery_reason}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void setAcknowledgement(group.failedDeliveryId, event.action !== "acknowledged")}
                            className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                          >
                            {event.action === "acknowledged" ? "Clear ack" : "Acknowledge"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void retryOriginalDelivery(group.failedDeliveryId)}
                            className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                          >
                            Retry original delivery
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
              No delivery failure events match the current filter.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
