"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createApiClient,
  type SellerInactivityEventRead,
  type SellerInactivitySummaryRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type StateFilter = "active" | "acknowledged" | "all";
type SeverityFilter = "all" | "high" | "medium" | "monitor";
type HistoryGroup = "Today" | "Earlier";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const STORAGE_KEY = "seller-inactivity-state-filter";
const STORAGE_KEY_SEVERITY = "seller-inactivity-severity-filter";
const STORAGE_KEY_COLLAPSED = "seller-inactivity-history-collapsed";

function toneClasses(severity: string) {
  if (severity === "high") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (severity === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function formatLastActive(summary: SellerInactivitySummaryRead) {
  const kind = (summary.last_active_kind ?? "unknown").replaceAll("_", " ");
  const when = summary.last_active_at ? new Date(summary.last_active_at).toLocaleDateString() : "unknown";
  return `${kind} · ${when}`;
}

function getEventDayLabel(createdAt: string): HistoryGroup {
  const createdDate = new Date(createdAt);
  const today = new Date();
  if (
    createdDate.getFullYear() === today.getFullYear() &&
    createdDate.getMonth() === today.getMonth() &&
    createdDate.getDate() === today.getDate()
  ) {
    return "Today";
  }

  return "Earlier";
}

export function SellerInactivityPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SellerInactivitySummaryRead[]>([]);
  const [events, setEvents] = useState<SellerInactivityEventRead[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("active");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [collapsedHistoryGroups, setCollapsedHistoryGroups] = useState<Record<HistoryGroup, boolean>>({
    Today: false,
    Earlier: false,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const updateUrlFilter = useCallback((name: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      nextParams.delete(name);
    } else {
      nextParams.set(name, value);
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const urlState = searchParams.get("state");
    if (urlState === "active" || urlState === "acknowledged" || urlState === "all") {
      setStateFilter(urlState);
    } else {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "active" || stored === "acknowledged" || stored === "all") {
        setStateFilter(stored);
      }
    }

    const urlSeverity = searchParams.get("severity");
    if (
      urlSeverity === "all" ||
      urlSeverity === "high" ||
      urlSeverity === "medium" ||
      urlSeverity === "monitor"
    ) {
      setSeverityFilter(urlSeverity);
    } else {
      const storedSeverity = window.localStorage.getItem(STORAGE_KEY_SEVERITY);
      if (
        storedSeverity === "all" ||
        storedSeverity === "high" ||
        storedSeverity === "medium" ||
        storedSeverity === "monitor"
      ) {
        setSeverityFilter(storedSeverity);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<Record<HistoryGroup, boolean>>;
      setCollapsedHistoryGroups({
        Today: Boolean(parsed.Today),
        Earlier: Boolean(parsed.Earlier),
      });
    } catch {
      window.localStorage.removeItem(STORAGE_KEY_COLLAPSED);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, stateFilter);
    updateUrlFilter("state", stateFilter);
  }, [stateFilter, updateUrlFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY_SEVERITY, severityFilter);
    updateUrlFilter("severity", severityFilter);
  }, [severityFilter, updateUrlFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(collapsedHistoryGroups));
  }, [collapsedHistoryGroups]);

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
          api.listAdminSellerInactivitySummaries(20, "all", {
            accessToken: session.access_token,
          }),
          api.listAdminSellerInactivityEvents(24, {
            accessToken: session.access_token,
          }),
        ]);

        if (!cancelled) {
          setSummaries(summaryRows);
          setEvents(eventRows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load seller inactivity.");
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
  }, [stateFilter]);

  const stateCounts = useMemo(
    () => ({
      active: summaries.filter((summary) => !summary.acknowledged).length,
      acknowledged: summaries.filter((summary) => summary.acknowledged).length,
      all: summaries.length,
    }),
    [summaries],
  );

  const visibleSummaries = useMemo(
    () =>
      summaries.filter((summary) => {
        if (stateFilter === "active" && summary.acknowledged) {
          return false;
        }
        if (stateFilter === "acknowledged" && !summary.acknowledged) {
          return false;
        }
        if (severityFilter !== "all" && summary.severity !== severityFilter) {
          return false;
        }
        return true;
      }),
    [severityFilter, stateFilter, summaries],
  );
  const severityCounts = useMemo(
    () => ({
      high: summaries.filter((summary) => summary.severity === "high").length,
      medium: summaries.filter((summary) => summary.severity === "medium").length,
      monitor: summaries.filter((summary) => summary.severity === "monitor").length,
      all: summaries.length,
    }),
    [summaries],
  );
  const topSellerSummary = visibleSummaries[0] ?? null;
  const groupedEvents = useMemo(
    () =>
      events.reduce(
        (acc, event) => {
          acc[getEventDayLabel(event.created_at)].push(event);
          return acc;
        },
        { Today: [] as SellerInactivityEventRead[], Earlier: [] as SellerInactivityEventRead[] },
      ),
    [events],
  );
  const topEvent = events[0] ?? null;
  const summaryBySellerId = useMemo(
    () => Object.fromEntries(summaries.map((summary) => [summary.seller_id, summary])),
    [summaries],
  );
  const hasEarlierEvents = groupedEvents.Earlier.length > 0;
  const canCollapseEarlierEvents = hasEarlierEvents && !collapsedHistoryGroups.Earlier;
  const canExpandAllEvents =
    (groupedEvents.Today.length > 0 && collapsedHistoryGroups.Today) ||
    (groupedEvents.Earlier.length > 0 && collapsedHistoryGroups.Earlier);

  function toggleHistoryGroup(group: HistoryGroup) {
    setCollapsedHistoryGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  }

  function collapseEarlierHistory() {
    setCollapsedHistoryGroups((current) => ({
      ...current,
      Earlier: true,
    }));
  }

  function expandAllHistory() {
    setCollapsedHistoryGroups({
      Today: false,
      Earlier: false,
    });
  }

  function openLatestSellerInactivityAlert() {
    if (topEvent) {
      document.getElementById("seller-inactivity-history")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    if (topSellerSummary) {
      document.getElementById(`seller-inactivity-summary-${topSellerSummary.seller_id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }

  function clearFilters() {
    setStateFilter("active");
    setSeverityFilter("all");
    updateUrlFilter("state", "active");
    updateUrlFilter("severity", "all");
  }

  async function acknowledgeSellerInactivity(summary: SellerInactivitySummaryRead) {
    setActionLoading(summary.seller_id);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available.");
      }

      await api.acknowledgeAdminSellerInactivity(summary.seller_id, {
        accessToken: session.access_token,
      });
      const [summaryRows, eventRows] = await Promise.all([
        api.listAdminSellerInactivitySummaries(20, "all", {
          accessToken: session.access_token,
        }),
        api.listAdminSellerInactivityEvents(24, {
          accessToken: session.access_token,
        }),
      ]);
      setSummaries(summaryRows);
      setEvents(eventRows);
    } catch (acknowledgeError) {
      setError(
        acknowledgeError instanceof Error
          ? acknowledgeError.message
          : "Unable to acknowledge seller inactivity.",
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function clearSellerInactivity(summary: SellerInactivitySummaryRead) {
    setActionLoading(summary.seller_id);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available.");
      }

      await api.clearAdminSellerInactivityAcknowledgement(summary.seller_id, {
        accessToken: session.access_token,
      });
      const [summaryRows, eventRows] = await Promise.all([
        api.listAdminSellerInactivitySummaries(20, "all", {
          accessToken: session.access_token,
        }),
        api.listAdminSellerInactivityEvents(24, {
          accessToken: session.access_token,
        }),
      ]);
      setSummaries(summaryRows);
      setEvents(eventRows);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to clear seller inactivity.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <section className="rounded-4xl border border-border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Phase 6</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Seller inactivity</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/64">
            Idle sellers are surfaced here from backend activity data. The lane tracks who has gone quiet,
            what their last meaningful activity was, and whether the alert has already been acknowledged.
          </p>
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {(["active", "acknowledged", "all"] as const).map((bucket) => (
            <button
              key={bucket}
              type="button"
              className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                stateFilter === bucket
                  ? "border-foreground bg-foreground text-white"
                  : "border-border text-foreground hover:border-foreground hover:text-foreground/90"
              }`}
              onClick={() => setStateFilter(bucket)}
            >
              {bucket === "active"
                ? `Active (${stateCounts.active})`
                : bucket === "acknowledged"
                  ? `Acknowledged (${stateCounts.acknowledged})`
                : `All (${stateCounts.all})`}
            </button>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            {([
              ["all", `All Severity (${severityCounts.all})`],
              ["high", `High (${severityCounts.high})`],
              ["medium", `Medium (${severityCounts.medium})`],
              ["monitor", `Monitor (${severityCounts.monitor})`],
            ] as const).map(([bucket, label]) => (
              <button
                key={bucket}
                type="button"
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  severityFilter === bucket
                    ? "border-foreground bg-foreground text-white"
                    : "border-border text-foreground hover:border-foreground hover:text-foreground/90"
                }`}
                onClick={() => setSeverityFilter(bucket)}
              >
                {label}
              </button>
            ))}
          </div>
          {(stateFilter !== "active" || severityFilter !== "all") ? (
            <button
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="mt-5 text-sm text-foreground/60">Loading seller inactivity...</p>
      ) : null}

      {topSellerSummary ? (
        <div className="mt-5 rounded-[1.4rem] border border-sky-200 bg-sky-50/35 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/52">
                Top quiet seller
              </p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                {topSellerSummary.seller_display_name} · {topSellerSummary.idle_days} days idle
              </p>
              <p className="mt-1 text-sm text-foreground/64">
                {topSellerSummary.alert_reason}
              </p>
              <p className="mt-1 text-xs text-foreground/56">
                Last active: {formatLastActive(topSellerSummary)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
                {topSellerSummary.severity}
              </span>
              <button
                className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={openLatestSellerInactivityAlert}
                type="button"
              >
                Open latest alert
              </button>
              <Link
                href={`/sellers/${topSellerSummary.seller_slug}`}
                className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90"
              >
                Open seller
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {visibleSummaries.length > 0 ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {visibleSummaries.map((summary) => (
              <article
              id={`seller-inactivity-summary-${summary.seller_id}`}
              key={summary.seller_id}
              className={`rounded-[1.6rem] border px-4 py-4 ${toneClasses(summary.severity ?? "monitor")}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-current/15 bg-white/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/72">
                      {summary.idle_days} days idle
                    </span>
                    {summary.acknowledged ? (
                      <span className="rounded-full border border-border/20 bg-white/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                        Acknowledged
                      </span>
                    ) : (
                      <span className="rounded-full border border-current/15 bg-white/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                        Active
                      </span>
                    )}
                    <p className="text-sm font-semibold text-foreground">{summary.seller_display_name}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-foreground/72">{summary.alert_reason}</p>
                  <p className="mt-1 text-xs text-foreground/56">
                    Last active: {formatLastActive(summary)}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-current/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/72 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() =>
                      summary.acknowledged
                        ? void clearSellerInactivity(summary)
                        : void acknowledgeSellerInactivity(summary)
                    }
                    disabled={actionLoading === summary.seller_id}
                  >
                    {summary.acknowledged ? "Re-open" : "Acknowledge"}
                  </button>
                  <Link
                    href={`/sellers/${summary.seller_slug}`}
                    className="rounded-full border border-current/20 bg-white px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                  >
                    Open seller
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/66">
          {stateFilter === "active"
            ? "No active seller inactivity alerts match the current filters."
            : stateFilter === "acknowledged"
              ? "No acknowledged seller inactivity alerts match the current filters."
              : "No seller inactivity alerts were returned."}
        </p>
      )}

      {events.length > 0 ? (
        <div id="seller-inactivity-history" className="mt-6 rounded-[1.6rem] border border-border/60 bg-background px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/52">
                Recent alert activity
              </p>
              <p className="mt-1 text-sm text-foreground/60">
                Acknowledge and re-open actions recorded from the inactivity lane.
              </p>
              {collapsedHistoryGroups.Earlier ? (
                <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-foreground/52">
                  Earlier collapsed · {groupedEvents.Earlier.length} hidden action
                  {groupedEvents.Earlier.length === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                {events.length} recent action{events.length === 1 ? "" : "s"}
              </span>
              {topEvent ? (
                <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                  Latest · {topEvent.seller_display_name}
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60 transition hover:border-accent hover:text-accent"
              onClick={() => setEvents([])}
              type="button"
            >
              Clear history
            </button>
            <button
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
              disabled={!canCollapseEarlierEvents && !canExpandAllEvents}
              onClick={() => {
                if (canExpandAllEvents) {
                  expandAllHistory();
                  return;
                }

                collapseEarlierHistory();
              }}
              type="button"
            >
              {canExpandAllEvents ? "Expand all" : "Collapse earlier"}
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {groupedEvents.Today.length > 0 ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/46">Today</p>
                  <button
                    className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={() => toggleHistoryGroup("Today")}
                    type="button"
                  >
                    {collapsedHistoryGroups.Today ? "Expand" : "Collapse"}
                  </button>
                </div>
                {collapsedHistoryGroups.Today ? null : (
                  <div className="mt-3 grid gap-3">
                    {groupedEvents.Today.map((event) => (
                      <div key={event.id} className="rounded-[1.2rem] border border-border/60 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-border/60 bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                                {event.action}
                              </span>
                              <p className="text-sm font-semibold text-foreground">
                                {event.seller_display_name}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-foreground/56">
                              {event.idle_days} days idle · {event.last_active_kind.replaceAll("_", " ")} ·{" "}
                              {new Date(event.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/sellers/${event.seller_slug}`}
                              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            >
                              Open seller
                            </Link>
                            {summaryBySellerId[event.seller_id] ? (
                              <button
                                className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={actionLoading === event.seller_id}
                                onClick={() => {
                                  const summary = summaryBySellerId[event.seller_id];
                                  if (!summary) {
                                    return;
                                  }

                                  if (summary.acknowledged) {
                                    void clearSellerInactivity(summary);
                                    return;
                                  }

                                  void acknowledgeSellerInactivity(summary);
                                }}
                                type="button"
                              >
                                {summaryBySellerId[event.seller_id]?.acknowledged ? "Re-open alert" : "Acknowledge"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            {groupedEvents.Earlier.length > 0 ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/46">Earlier</p>
                  <button
                    className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={() => toggleHistoryGroup("Earlier")}
                    type="button"
                  >
                    {collapsedHistoryGroups.Earlier ? "Expand" : "Collapse"}
                  </button>
                </div>
                {collapsedHistoryGroups.Earlier ? null : (
                  <div className="mt-3 grid gap-3">
                    {groupedEvents.Earlier.map((event) => (
                      <div key={event.id} className="rounded-[1.2rem] border border-border/60 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-border/60 bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                                {event.action}
                              </span>
                              <p className="text-sm font-semibold text-foreground">
                                {event.seller_display_name}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-foreground/56">
                              {event.idle_days} days idle · {event.last_active_kind.replaceAll("_", " ")} ·{" "}
                              {new Date(event.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/sellers/${event.seller_slug}`}
                              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            >
                              Open seller
                            </Link>
                            {summaryBySellerId[event.seller_id] ? (
                              <button
                                className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={actionLoading === event.seller_id}
                                onClick={() => {
                                  const summary = summaryBySellerId[event.seller_id];
                                  if (!summary) {
                                    return;
                                  }

                                  if (summary.acknowledged) {
                                    void clearSellerInactivity(summary);
                                    return;
                                  }

                                  void acknowledgeSellerInactivity(summary);
                                }}
                                type="button"
                              >
                                {summaryBySellerId[event.seller_id]?.acknowledged ? "Re-open alert" : "Acknowledge"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
