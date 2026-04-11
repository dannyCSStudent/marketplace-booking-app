"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { applyPromotionDashboardFilter, applySubscriptionHistoryFilter } from "@/app/admin/monetization/monetization-activity-actions";
import { useMonetizationActivity } from "@/app/admin/monetization/monetization-activity-context";
import { scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { restoreAdminSession } from "@/app/lib/admin-auth";
import {
  ApiError,
  createApiClient,
  type MonetizationWatchlistEventRead,
  type MonetizationWatchlistSummaryRead,
} from "@/app/lib/api";

type WatchlistAlert = {
  id: string;
  signature: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "monitor";
  tone: "amber" | "rose" | "sky";
  actionLabel: string;
  acknowledged: boolean;
  onAction: () => void;
};

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export default function MonetizationWatchlist() {
  const didMarkViewedRef = useRef(false);
  const {
    preferences: {
      toolState: {
        lastWatchlistViewedAt,
        watchlistSeverityFilter,
        watchlistCollapsed,
        watchlistNewOnly,
        watchlistLastActionSummary,
        watchlistLastActionAt,
        watchlistLastActionReplayKey,
      },
    },
    setToolState,
  } = useMonetizationPreferences();
  const [newOnly, setNewOnly] = useState(watchlistNewOnly);
  const [severityFilter, setSeverityFilter] = useState<WatchlistAlert["severity"] | "all">(
    watchlistSeverityFilter,
  );
  const { recordActivity } = useMonetizationActivity();
  const api = useMemo(() => createApiClient(CLIENT_API_BASE_URL), []);
  const [backendSummaries, setBackendSummaries] = useState<MonetizationWatchlistSummaryRead[]>([]);
  const [backendEvents, setBackendEvents] = useState<MonetizationWatchlistEventRead[]>([]);
  const [backendStatus, setBackendStatus] = useState<"idle" | "loading" | "error">("idle");
  const [backendError, setBackendError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"active" | "acknowledged" | "all">("active");
  const severityRank: Record<WatchlistAlert["severity"], number> = {
    high: 0,
    medium: 1,
    monitor: 2,
  };

  function recordWatchlistAction(
    summary: string,
    replayKey:
      | "subscription_destructive"
      | "subscription_downgrade"
      | "promotion_removals"
      | "promoted_listings"
      | null = null,
  ) {
    const createdAt = new Date().toISOString();
    setToolState((current) => ({
      ...current,
      watchlistLastActionSummary: summary,
      watchlistLastActionAt: createdAt,
      watchlistLastActionReplayKey: replayKey,
    }));
  }

  const refreshWatchlist = async () => {
    const session = await restoreAdminSession();
    if (!session) {
      throw new ApiError(401, "Sign in as an admin to update monetization signals.");
    }

    const [summaryRows, eventRows] = await Promise.all([
      api.listMonetizationWatchlistSummaries(lastWatchlistViewedAt ?? undefined, 12, stateFilter, {
        accessToken: session.access_token,
      }),
      api.listMonetizationWatchlistEvents(24, { accessToken: session.access_token }),
    ]);
    setBackendSummaries(summaryRows);
    setBackendEvents(eventRows);
  };

  const acknowledgeWatchlistAlert = async (alert: WatchlistAlert) => {
    setBackendStatus("loading");
    setBackendError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new ApiError(401, "Sign in as an admin to update monetization signals.");
      }

      await api.acknowledgeMonetizationWatchlistAlert(alert.id, {
        accessToken: session.access_token,
      });
      await refreshWatchlist();
      setBackendStatus("idle");
      recordActivity({
        kind: "workflow",
        label: `Watchlist acknowledged: ${alert.title}`,
        summary: `Acknowledged the ${alert.title.toLowerCase()} alert.`,
      });
      recordWatchlistAction(`Acknowledged ${alert.title}`, null);
    } catch (caught) {
      setBackendStatus("error");
      setBackendError(caught instanceof ApiError ? caught.message : "Unable to acknowledge monetization alert.");
    }
  };

  const clearWatchlistAlertAcknowledgement = async (alert: WatchlistAlert) => {
    setBackendStatus("loading");
    setBackendError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new ApiError(401, "Sign in as an admin to update monetization signals.");
      }

      await api.clearMonetizationWatchlistAlert(alert.id, {
        accessToken: session.access_token,
      });
      await refreshWatchlist();
      setBackendStatus("idle");
      recordActivity({
        kind: "workflow",
        label: `Watchlist re-opened: ${alert.title}`,
        summary: `Re-opened the ${alert.title.toLowerCase()} alert from the monetization watchlist.`,
      });
      recordWatchlistAction(`Re-opened ${alert.title}`, null);
    } catch (caught) {
      setBackendStatus("error");
      setBackendError(caught instanceof ApiError ? caught.message : "Unable to clear monetization alert acknowledgement.");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem("admin.monetization.watchlist-state-filter");
    if (stored === "active" || stored === "acknowledged" || stored === "all") {
      setStateFilter(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem("admin.monetization.watchlist-state-filter", stateFilter);
  }, [stateFilter]);

  useEffect(() => {
    let cancelled = false;

    const loadWatchlistAlerts = async () => {
      setBackendStatus("loading");
      setBackendError(null);
      try {
        await refreshWatchlist();
        if (!cancelled) {
          setBackendStatus("idle");
        }
      } catch (caught) {
        if (!cancelled) {
          setBackendStatus("error");
          setBackendError(caught instanceof ApiError ? caught.message : "Unable to load monetization watchlist.");
        }
      }
    };

    void loadWatchlistAlerts();

    return () => {
      cancelled = true;
    };
  }, [api, lastWatchlistViewedAt, stateFilter]);

  const alerts = useMemo<WatchlistAlert[]>(
    () =>
      backendSummaries.map((alert) => ({
        id: alert.id,
        signature: alert.signature,
        title: alert.title,
        detail: alert.detail,
        severity: alert.severity,
        tone: alert.tone,
        actionLabel: alert.action_label,
        acknowledged: alert.acknowledged,
        onAction: () => {
          if (alert.replay_key === "subscription_destructive") {
            recordActivity({
              kind: "saved_view",
              label: "Watchlist: destructive subscription spike",
              summary: "Opened the destructive subscription history slice from the watchlist.",
              replay: {
                kind: "saved_view",
                subscriptionDetail: {
                  direction: "all",
                  reason: "all",
                  destructiveOnly: true,
                  windowDays: 7,
                },
              },
            });
            applySubscriptionHistoryFilter({
              direction: "all",
              reason: "all",
              destructiveOnly: true,
              windowDays: 7,
            });
          } else if (alert.replay_key === "subscription_downgrade") {
            recordActivity({
              kind: "saved_view",
              label: "Watchlist: downgrade pressure",
              summary: "Opened the downgrade-focused subscription history slice from the watchlist.",
              replay: {
                kind: "saved_view",
                subscriptionDetail: {
                  direction: "downgrade",
                  reason: "all",
                  destructiveOnly: false,
                  windowDays: 7,
                },
              },
            });
            applySubscriptionHistoryFilter({
              direction: "downgrade",
              reason: "all",
              destructiveOnly: false,
              windowDays: 7,
            });
          } else if (alert.replay_key === "promotion_removals") {
            recordActivity({
              kind: "saved_view",
              label: "Watchlist: promotion removal pressure",
              summary: "Opened the promotion removals slice from the watchlist.",
              replay: {
                kind: "saved_view",
                promotionDetail: {
                  windowDays: 7,
                  statusFilter: "removed",
                  typeFilter: "all",
                  segmentFilter: "all",
                },
              },
            });
            applyPromotionDashboardFilter({
              windowDays: 7,
              statusFilter: "removed",
              typeFilter: "all",
              segmentFilter: "all",
            });
          } else if (alert.replay_key === "promoted_listings") {
            recordActivity({
              kind: "workflow",
              label: "Watchlist: thin promoted inventory",
              summary: "Jumped from the watchlist into the promoted listings panel.",
            });
            scrollToMonetizationSection("promoted-listings-panel");
          }
          recordWatchlistAction(`Opened ${alert.title.toLowerCase()}`, alert.replay_key);
        },
      })),
    [backendSummaries, recordActivity],
  );

  const visibleAlerts = useMemo(
    () =>
      alerts
        .filter((alert) => severityFilter === "all" || alert.severity === severityFilter)
        .filter((alert) => !newOnly || isVisitBasedAlert(alert))
        .sort((left, right) => severityRank[left.severity] - severityRank[right.severity]),
    [alerts, newOnly, severityFilter, severityRank],
  );

  const alertCounts = useMemo(() => {
    const counts = {
      all: 0,
      high: 0,
      medium: 0,
      monitor: 0,
    };
    for (const alert of alerts) {
      counts.all += 1;
      counts[alert.severity] += 1;
    }
    return counts;
  }, [alerts]);

  const newSinceVisitCounts = useMemo(() => {
    const counts = {
      all: 0,
      high: 0,
      medium: 0,
      monitor: 0,
    };
    for (const alert of alerts) {
      if (!alert.signature.startsWith("since-visit:")) {
        continue;
      }
      counts.all += 1;
      counts[alert.severity] += 1;
    }
    return counts;
  }, [alerts]);

  const stateCounts = useMemo(
    () => ({
      active: alerts.filter((alert) => !alert.acknowledged).length,
      acknowledged: alerts.filter((alert) => alert.acknowledged).length,
      all: alerts.length,
    }),
    [alerts],
  );

  const openSeveritySlice = (nextFilter: WatchlistAlert["severity"] | "all") => {
    setSeverityFilter(nextFilter);
    setToolState((current) => ({
      ...current,
      watchlistCollapsed: false,
      watchlistSeverityFilter: nextFilter,
    }));
  };

  const isVisitBasedAlert = (alert: WatchlistAlert) => alert.signature.startsWith("since-visit:");
  const reopenLastWatchlistAction = () => {
    switch (watchlistLastActionReplayKey) {
      case "subscription_destructive":
        recordActivity({
          kind: "saved_view",
          label: "Watchlist resume: destructive review",
          summary: "Re-opened the destructive subscription history slice from the watchlist header.",
          replay: {
            kind: "saved_view",
            subscriptionDetail: {
              direction: "all",
              reason: "all",
              destructiveOnly: true,
              windowDays: 7,
            },
          },
        });
        applySubscriptionHistoryFilter({
          direction: "all",
          reason: "all",
          destructiveOnly: true,
          windowDays: 7,
        });
        break;
      case "subscription_downgrade":
        recordActivity({
          kind: "saved_view",
          label: "Watchlist resume: downgrade review",
          summary: "Re-opened the downgrade subscription history slice from the watchlist header.",
          replay: {
            kind: "saved_view",
            subscriptionDetail: {
              direction: "downgrade",
              reason: "all",
              destructiveOnly: false,
              windowDays: 7,
            },
          },
        });
        applySubscriptionHistoryFilter({
          direction: "downgrade",
          reason: "all",
          destructiveOnly: false,
          windowDays: 7,
        });
        break;
      case "promotion_removals":
        recordActivity({
          kind: "saved_view",
          label: "Watchlist resume: promotion removals",
          summary: "Re-opened the promotion removals slice from the watchlist header.",
          replay: {
            kind: "saved_view",
            promotionDetail: {
              windowDays: 7,
              statusFilter: "removed",
              typeFilter: "all",
              segmentFilter: "all",
            },
          },
        });
        applyPromotionDashboardFilter({
          windowDays: 7,
          statusFilter: "removed",
          typeFilter: "all",
          segmentFilter: "all",
        });
        break;
      case "promoted_listings":
        recordActivity({
          kind: "workflow",
          label: "Watchlist resume: promoted listings",
          summary: "Re-opened the promoted listings panel from the watchlist header.",
        });
        scrollToMonetizationSection("promoted-listings-panel");
        break;
      default:
        break;
    }
  };

  const lastWatchlistReplayLabel =
    watchlistLastActionReplayKey === "subscription_destructive"
      ? "Re-open destructive review"
      : watchlistLastActionReplayKey === "subscription_downgrade"
        ? "Re-open downgrade review"
        : watchlistLastActionReplayKey === "promotion_removals"
          ? "Re-open promotion removals"
          : watchlistLastActionReplayKey === "promoted_listings"
          ? "Re-open promoted listings"
          : null;
  const lastWatchlistActionLabel =
    watchlistLastActionReplayKey === "subscription_destructive"
      ? "Opened destructive review"
      : watchlistLastActionReplayKey === "subscription_downgrade"
        ? "Opened downgrade review"
        : watchlistLastActionReplayKey === "promotion_removals"
          ? "Opened promotion removals"
          : watchlistLastActionReplayKey === "promoted_listings"
            ? "Opened promoted listings"
            : watchlistLastActionSummary;
  const lastWatchlistActionKindLabel = watchlistLastActionReplayKey ? "Drill-down" : "Dismissed";
  const lastWatchlistActionHint = watchlistLastActionReplayKey
    ? "Resume the same watchlist drill-down."
    : "Dismissals do not have a replay action.";
  const clearLastWatchlistAction = () => {
    recordActivity({
      kind: "workflow",
      label: "Watchlist: cleared saved action",
      summary: "Cleared the saved watchlist action state from the watchlist header.",
    });
    setToolState((current) => ({
      ...current,
      watchlistLastActionSummary: null,
      watchlistLastActionAt: null,
      watchlistLastActionReplayKey: null,
    }));
  };

  useEffect(() => {
    setSeverityFilter(watchlistSeverityFilter);
  }, [watchlistSeverityFilter]);

  useEffect(() => {
    setNewOnly(watchlistNewOnly);
  }, [watchlistNewOnly]);

  useEffect(() => {
    if (newOnly && newSinceVisitCounts.all === 0) {
      setNewOnly(false);
      setToolState((current) => ({
        ...current,
        watchlistNewOnly: false,
      }));
    }
  }, [newOnly, newSinceVisitCounts.all, setToolState]);

  useEffect(() => {
    if (didMarkViewedRef.current) {
      return;
    }
    didMarkViewedRef.current = true;
    const viewedAt = new Date().toISOString();
    setToolState((current) => {
      return {
        ...current,
        lastWatchlistViewedAt: viewedAt,
      };
    });
  }, [setToolState]);

  if (alerts.length === 0 && backendStatus !== "error") {
    return null;
  }

  return (
    <section id="monetization-watchlist" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Watchlist
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">
            Monetization signals to review
          </h2>
          <p className="text-sm text-foreground/66">
            {lastWatchlistViewedAt
              ? "Alerts compare current monetization movement against your last dashboard visit when possible."
              : "Threshold-based alerts built from recent subscription and promotion movement."}
          </p>
          {backendStatus === "error" && backendError ? (
            <p className="mt-2 text-sm text-rose-700">{backendError}</p>
          ) : null}
          {watchlistLastActionSummary ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-border/70 bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/60">
                {lastWatchlistActionKindLabel}
              </span>
              <p className="text-xs text-foreground/56">
                Last action: {lastWatchlistActionLabel}
                {watchlistLastActionAt ? ` • ${new Date(watchlistLastActionAt).toLocaleString()}` : ""}
              </p>
              {watchlistLastActionReplayKey ? (
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                  onClick={reopenLastWatchlistAction}
                >
                  {lastWatchlistReplayLabel}
                </button>
              ) : (
                <span className="text-[11px] text-foreground/48">{lastWatchlistActionHint}</span>
              )}
              <button
                type="button"
                className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60 transition hover:border-foreground hover:text-foreground/90"
                onClick={clearLastWatchlistAction}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={() =>
              setToolState((current) => ({
                ...current,
                watchlistCollapsed: !current.watchlistCollapsed,
              }))
            }
          >
            {watchlistCollapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>
      {watchlistCollapsed ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-full border border-border bg-white px-4 py-2 text-left transition hover:border-foreground hover:text-foreground/90"
            onClick={() => openSeveritySlice("all")}
          >
            <div className="flex items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/52">
                Active Alerts
              </p>
              {newSinceVisitCounts.all > 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-700">
                  {newSinceVisitCounts.all} new
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">{alertCounts.all}</p>
          </button>
          <button
            type="button"
            className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-left transition hover:border-foreground hover:text-foreground/90"
            onClick={() => openSeveritySlice("high")}
          >
            <div className="flex items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose-700">
                High
              </p>
              {newSinceVisitCounts.high > 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-700">
                  New
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">{alertCounts.high}</p>
          </button>
          <button
            type="button"
            className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-left transition hover:border-foreground hover:text-foreground/90"
            onClick={() => openSeveritySlice("medium")}
          >
            <div className="flex items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-700">
                Medium
              </p>
              {newSinceVisitCounts.medium > 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-700">
                  New
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">{alertCounts.medium}</p>
          </button>
          <button
            type="button"
            className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-left transition hover:border-foreground hover:text-foreground/90"
            onClick={() => openSeveritySlice("monitor")}
          >
            <div className="flex items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-700">
                Monitor
              </p>
              {newSinceVisitCounts.monitor > 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-700">
                  New
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">{alertCounts.monitor}</p>
          </button>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            {[
              {
                key: "all" as const,
                label: "All alerts",
                count: alertCounts.all,
                className: "border-border bg-white",
                labelClassName: "text-foreground/66",
              },
              {
                key: "high" as const,
                label: "High Priority",
                count: alertCounts.high,
                className: "border-rose-200 bg-rose-50",
                labelClassName: "text-rose-700",
              },
              {
                key: "medium" as const,
                label: "Medium",
                count: alertCounts.medium,
                className: "border-amber-200 bg-amber-50",
                labelClassName: "text-amber-700",
              },
              {
                key: "monitor" as const,
                label: "Monitor",
                count: alertCounts.monitor,
                className: "border-sky-200 bg-sky-50",
                labelClassName: "text-sky-700",
              },
            ].map((bucket) => {
              const isActive = severityFilter === bucket.key;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  className={`rounded-full border px-4 py-2 text-left transition hover:border-foreground hover:text-foreground/90 ${
                    bucket.className
                  } ${isActive ? "ring-2 ring-foreground/12" : ""}`}
                  onClick={() => {
                    setSeverityFilter(bucket.key);
                    setToolState((current) => ({
                      ...current,
                      watchlistSeverityFilter: bucket.key,
                    }));
                  }}
                >
                  <p
                    className={`font-mono text-[10px] uppercase tracking-[0.18em] ${bucket.labelClassName}`}
                  >
                    {bucket.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{bucket.count}</p>
                </button>
              );
            })}
          </div>
          {severityFilter !== "all" ? (
            <div className="mt-4 flex items-center gap-3">
              <p className="text-xs text-foreground/60">
                Showing only{" "}
                {severityFilter === "high"
                  ? "high priority"
                  : severityFilter === "medium"
                    ? "medium"
                    : "monitor"}{" "}
                alerts.
              </p>
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                onClick={() => {
                  setSeverityFilter("all");
                  setToolState((current) => ({
                    ...current,
                    watchlistSeverityFilter: "all",
                  }));
                }}
              >
                Clear filter
              </button>
            </div>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                newOnly
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-border text-foreground hover:border-foreground hover:text-foreground/90"
              }`}
              onClick={() => {
                const next = !newOnly;
                setNewOnly(next);
                setToolState((toolStateCurrent) => ({
                  ...toolStateCurrent,
                  watchlistNewOnly: next,
                }));
              }}
            >
              {newOnly ? "Showing New Only" : "Show New Only"}
            </button>
            <p className="text-xs text-foreground/60">
              {newSinceVisitCounts.all > 0
                ? `${newSinceVisitCounts.all} alert${newSinceVisitCounts.all === 1 ? "" : "s"} surfaced since your last visit.`
                : "No visit-based alert changes are currently active."}
            </p>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {visibleAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-[1.6rem] border px-4 py-4 ${
                  alert.tone === "rose"
                    ? "border-rose-200 bg-rose-50"
                    : alert.tone === "amber"
                      ? "border-amber-200 bg-amber-50"
                      : "border-sky-200 bg-sky-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-current/15 bg-white/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/72">
                        {alert.severity === "high"
                          ? "High Priority"
                          : alert.severity === "medium"
                            ? "Medium"
                            : "Monitor"}
                      </span>
                      {alert.acknowledged ? (
                        <span className="rounded-full border border-border/20 bg-white/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                          Acknowledged
                        </span>
                      ) : isVisitBasedAlert(alert) ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                          New Since Visit
                        </span>
                      ) : (
                        <span className="rounded-full border border-current/15 bg-white/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                          Ongoing
                        </span>
                      )}
                      <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-foreground/72">{alert.detail}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border border-current/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/72 transition hover:text-foreground"
                    onClick={() =>
                      alert.acknowledged
                        ? void clearWatchlistAlertAcknowledgement(alert)
                        : void acknowledgeWatchlistAlert(alert)
                    }
                  >
                    {alert.acknowledged ? "Re-open" : "Acknowledge"}
                  </button>
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    className="rounded-full border border-current/20 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                    onClick={alert.onAction}
                  >
                    {alert.actionLabel}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {backendEvents.length > 0 ? (
            <div className="mt-5 rounded-[1.6rem] border border-border/60 bg-background px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/52">
                    Recent alert activity
                  </p>
                  <p className="mt-1 text-sm text-foreground/60">
                    Acknowledgements and re-opens recorded from this monetization session.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                {backendEvents.slice(0, 6).map((event) => (
                  <div key={event.id} className="rounded-[1.2rem] border border-border/60 bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border/60 bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/56">
                        {event.action}
                      </span>
                      <p className="text-sm font-semibold text-foreground">{event.alert_title}</p>
                    </div>
                    <p className="mt-1 text-xs text-foreground/56">
                      {event.alert_severity} · {new Date(event.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {visibleAlerts.length === 0 ? (
            <p className="mt-5 rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/66">
              {backendStatus === "error"
                ? "Unable to load monetization watchlist alerts right now."
                : stateFilter === "active"
                  ? "No active monetization watchlist alerts match the current filters."
                  : stateFilter === "acknowledged"
                    ? "No acknowledged monetization watchlist alerts match the current filters."
                    : "No monetization watchlist alerts match the current filters."}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
