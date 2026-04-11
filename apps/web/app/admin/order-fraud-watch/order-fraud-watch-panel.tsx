"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type OrderFraudWatchBuyerSummaryRead,
  type OrderFraudWatchEventRead,
} from "@/app/lib/api";
import { restoreAdminSession, type AdminSession } from "@/app/lib/admin-auth";

type StateFilter = "active" | "acknowledged" | "all";
type EventActionFilter = "all" | "acknowledged" | "cleared";
type RiskFilter = "all" | "watch" | "elevated" | "critical";

type FilterState = {
  stateFilter?: StateFilter;
  eventActionFilter?: EventActionFilter;
  riskFilter?: RiskFilter;
};

const STORAGE_KEY = "order-fraud-watch-filters";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function toneClasses(level: string) {
  if (level === "critical") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  if (level === "elevated") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  return "border-border bg-surface text-foreground/68";
}

function parseEventFilter(value: string | null): EventActionFilter | null {
  if (value === "all" || value === "acknowledged" || value === "cleared") {
    return value;
  }

  return null;
}

function isAcknowledged(summary: OrderFraudWatchBuyerSummaryRead) {
  return summary.acknowledged;
}

function matchesSearch(summary: OrderFraudWatchBuyerSummaryRead, searchQuery: string) {
  if (!searchQuery.trim()) {
    return true;
  }

  const haystack = [
    summary.buyer_id,
    summary.buyer_display_name,
    summary.alert_reason,
    summary.latest_order_id,
    summary.latest_order_status,
    summary.risk_level,
    String(summary.order_exception_count),
    String(summary.recent_order_exception_count),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchQuery.trim().toLowerCase());
}

function matchesEventSearch(event: OrderFraudWatchEventRead, searchQuery: string) {
  if (!searchQuery.trim()) {
    return true;
  }

  const haystack = [
    event.buyer_id,
    event.buyer_display_name,
    event.latest_order_id,
    event.latest_order_status,
    event.action,
    event.risk_level,
    String(event.order_exception_count),
    String(event.recent_order_exception_count),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchQuery.trim().toLowerCase());
}

export function OrderFraudWatchPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filtersInitialized = useRef(false);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<OrderFraudWatchBuyerSummaryRead[]>([]);
  const [events, setEvents] = useState<OrderFraudWatchEventRead[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("active");
  const [eventActionFilter, setEventActionFilter] = useState<EventActionFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [acknowledgingBuyerId, setAcknowledgingBuyerId] = useState<string | null>(null);

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
            parsed.eventActionFilter === "all" ||
            parsed.eventActionFilter === "acknowledged" ||
            parsed.eventActionFilter === "cleared"
          ) {
            setEventActionFilter(parsed.eventActionFilter);
          }
          if (
            parsed.riskFilter === "all" ||
            parsed.riskFilter === "watch" ||
            parsed.riskFilter === "elevated" ||
            parsed.riskFilter === "critical"
          ) {
            setRiskFilter(parsed.riskFilter);
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
      setEventActionFilter(urlEventFilter);
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
    if (eventActionFilter === "all") {
      nextParams.delete("events");
    } else {
      nextParams.set("events", eventActionFilter);
    }

    const nextQuery = nextParams.toString();
    if (nextQuery === searchParams.toString()) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [eventActionFilter, pathname, router, searchParams, stateFilter]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          stateFilter,
          eventActionFilter,
          riskFilter,
        } satisfies FilterState),
      );
    } catch {
      // Ignore browser persistence failures.
    }
  }, [eventActionFilter, riskFilter, stateFilter]);

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
          api.listAdminOrderFraudWatchBuyerSummaries(currentSession.access_token, {
            limit: 12,
            state: stateFilter,
          }),
          api.listAdminOrderFraudWatchEvents(currentSession.access_token, {
            limit: 20,
          }),
        ]);

        if (!cancelled) {
          setSummaries(summaryRows);
          setEvents(eventRows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load order fraud watch.");
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

  const counts = useMemo(
    () => ({
      total: summaries.length,
      active: summaries.filter((summary) => !isAcknowledged(summary)).length,
      acknowledged: summaries.filter((summary) => isAcknowledged(summary)).length,
      critical: summaries.filter((summary) => summary.risk_level === "critical").length,
      elevated: summaries.filter((summary) => summary.risk_level === "elevated").length,
      watch: summaries.filter((summary) => summary.risk_level === "watch").length,
    }),
    [summaries],
  );

  const filteredSummaries = useMemo(
    () =>
      summaries
        .filter((summary) => {
          const acknowledged = isAcknowledged(summary);
          if (stateFilter === "active" && acknowledged) {
            return false;
          }
          if (stateFilter === "acknowledged" && !acknowledged) {
            return false;
          }
          if (riskFilter !== "all" && summary.risk_level !== riskFilter) {
            return false;
          }
          return matchesSearch(summary, searchQuery);
        })
        .sort((left, right) => {
          if (left.risk_level !== right.risk_level) {
            const order = { critical: 0, elevated: 1, watch: 2 };
            return order[left.risk_level as keyof typeof order] - order[right.risk_level as keyof typeof order];
          }
          return right.alert_delivery_count - left.alert_delivery_count;
        }),
    [riskFilter, searchQuery, stateFilter, summaries],
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (eventActionFilter !== "all" && event.action !== eventActionFilter) {
          return false;
        }
        return matchesEventSearch(event, searchQuery);
      }),
    [eventActionFilter, events, searchQuery],
  );

  const latestSummary = filteredSummaries[0] ?? null;

  const handleAcknowledge = async (summary: OrderFraudWatchBuyerSummaryRead) => {
    if (!session) {
      return;
    }

    setAcknowledgingBuyerId(summary.buyer_id);
    try {
      await api.acknowledgeAdminOrderFraudWatch(summary.buyer_id, {
        accessToken: session.access_token,
      });
      setRefreshTick((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to acknowledge order fraud watch.");
    } finally {
      setAcknowledgingBuyerId(null);
    }
  };

  const handleClear = async (summary: OrderFraudWatchBuyerSummaryRead) => {
    if (!session) {
      return;
    }

    setAcknowledgingBuyerId(summary.buyer_id);
    try {
      await api.clearAdminOrderFraudWatchAcknowledgement(summary.buyer_id, {
        accessToken: session.access_token,
      });
      setRefreshTick((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to clear order fraud watch.");
    } finally {
      setAcknowledgingBuyerId(null);
    }
  };

  if (loading && summaries.length === 0) {
    return <p className="text-sm text-foreground/66">Loading order fraud watch…</p>;
  }

  if (!loading && summaries.length === 0 && error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["Total", counts.total],
          ["Active", counts.active],
          ["Acknowledged", counts.acknowledged],
          ["Critical", counts.critical],
          ["Elevated", counts.elevated],
          ["Watch", counts.watch],
        ].map(([label, count]) => (
          <article
            key={label as string}
            className="rounded-[1.5rem] border border-border bg-surface p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/52">
              {label as string}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">{count as number}</p>
          </article>
        ))}
      </div>

      <div className="rounded-[1.75rem] border border-border bg-surface p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/52">
              Filters
            </p>
            <p className="mt-1 text-sm text-foreground/68">
              Buyer exception bursts ranked by recurrence and risk level.
            </p>
          </div>
          <label className="flex min-w-0 flex-1 max-w-xl items-center gap-3 rounded-full border border-border bg-background px-4 py-3 text-sm text-foreground/72">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/50">
              Search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buyer, order, reason, or risk"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/36"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["active", `Active · ${counts.active}`],
            ["acknowledged", `Acknowledged · ${counts.acknowledged}`],
            ["all", `All · ${counts.total}`],
          ].map(([value, label]) => {
            const active = stateFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStateFilter(value as StateFilter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/62 hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["all", "All risk"],
            ["watch", "Watch"],
            ["elevated", "Elevated"],
            ["critical", "Critical"],
          ].map(([value, label]) => {
            const active = riskFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRiskFilter(value as RiskFilter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/62 hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setSearchQuery("");
            setRiskFilter("all");
            setStateFilter("active");
            setEventActionFilter("all");
          }}
          className="mt-4 rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/64 transition hover:border-foreground/40 hover:text-foreground"
        >
          Clear filters
        </button>
      </div>

      {latestSummary ? (
        <div className="rounded-[1.75rem] border border-border bg-background p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/52">
                Latest buyer alert
              </p>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {latestSummary.buyer_display_name}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-foreground/72">
                {latestSummary.alert_reason}
              </p>
            </div>
            <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClasses(latestSummary.risk_level)}`}>
              {latestSummary.risk_level}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/admin/transactions?focus=order:${latestSummary.latest_order_id ?? latestSummary.buyer_id}`}
              className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70 transition hover:border-foreground/40 hover:text-foreground"
            >
              Open latest order
            </Link>
            <button
              type="button"
              disabled={acknowledgingBuyerId === latestSummary.buyer_id}
              onClick={() =>
                void (latestSummary.acknowledged
                  ? handleClear(latestSummary)
                  : handleAcknowledge(latestSummary))
              }
              className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70 transition hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {latestSummary.acknowledged ? "Re-open" : "Acknowledge"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <section className="rounded-[2rem] border border-border bg-surface p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/52">
                Buyer fraud watch
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-foreground">
                Alert summaries
              </h2>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/42">
              {filteredSummaries.length} visible
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {filteredSummaries.length > 0 ? (
              filteredSummaries.map((summary) => (
                <article
                  key={summary.buyer_id}
                  className={`rounded-[1.5rem] border p-4 ${toneClasses(summary.risk_level)}`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">
                          {summary.buyer_display_name}
                        </h3>
                        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                          {summary.risk_level}
                        </span>
                        {summary.acknowledged ? (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                            Acknowledged
                          </span>
                        ) : null}
                      </div>
                      <p className="max-w-3xl text-sm leading-6 text-foreground/74">
                        {summary.alert_reason}
                      </p>
                      <p className="text-xs uppercase tracking-[0.2em] text-foreground/48">
                        Latest order · {summary.latest_order_status ?? "unknown"}{" "}
                        {summary.latest_order_id ? `· ${summary.latest_order_id.slice(0, 8)}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-xs uppercase tracking-[0.18em] text-foreground/58">
                      <p>Alerts {summary.alert_delivery_count}</p>
                      <p className="mt-1">
                        Exceptions {summary.order_exception_count} · Recent {summary.recent_order_exception_count}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/admin/transactions?focus=order:${summary.latest_order_id ?? summary.buyer_id}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70 transition hover:border-foreground/40 hover:text-foreground"
                    >
                      Open latest order
                    </Link>
                    <button
                      type="button"
                      disabled={acknowledgingBuyerId === summary.buyer_id}
                      onClick={() =>
                        void (summary.acknowledged ? handleClear(summary) : handleAcknowledge(summary))
                      }
                      className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70 transition hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {summary.acknowledged ? "Re-open" : "Acknowledge"}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-[1.5rem] border border-dashed border-border bg-background px-4 py-6 text-sm text-foreground/64">
                {error
                  ? "Unable to load order fraud watch alerts right now."
                  : "No order fraud watch alerts match the current filters."}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-border bg-surface p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/52">
                Alert history
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-foreground">
                Recent activity
              </h2>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/42">
              {filteredEvents.length} events
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["all", `All · ${events.length}`],
              ["acknowledged", `Acknowledged · ${events.filter((event) => event.action === "acknowledged").length}`],
              ["cleared", `Cleared · ${events.filter((event) => event.action === "cleared").length}`],
            ].map(([value, label]) => {
              const active = eventActionFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEventActionFilter(value as EventActionFilter)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground/62 hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3">
            {filteredEvents.length > 0 ? (
              filteredEvents.map((event) => (
                <article key={event.id} className="rounded-[1.5rem] border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{event.buyer_display_name}</h3>
                        <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                          {event.action}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] ${toneClasses(event.risk_level)}`}>
                          {event.risk_level}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-foreground/72">
                        {event.order_exception_count} order exception alert
                        {event.order_exception_count === 1 ? "" : "s"} across the last 30 days
                      </p>
                      <p className="text-xs uppercase tracking-[0.2em] text-foreground/48">
                        Latest order · {event.latest_order_status ?? "unknown"}{" "}
                        {event.latest_order_id ? `· ${event.latest_order_id.slice(0, 8)}` : ""}
                      </p>
                    </div>
                    <p className="text-xs uppercase tracking-[0.18em] text-foreground/48">
                      {new Date(event.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {event.latest_order_id ? (
                      <Link
                        href={`/admin/transactions?focus=order:${event.latest_order_id}`}
                        className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70 transition hover:border-foreground/40 hover:text-foreground"
                      >
                        Open latest order
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-[1.5rem] border border-dashed border-border bg-background px-4 py-6 text-sm text-foreground/64">
                No fraud watch history matches the current filters.
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
