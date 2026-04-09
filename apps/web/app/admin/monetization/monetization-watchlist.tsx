"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { applyPromotionDashboardFilter, applySubscriptionHistoryFilter } from "@/app/admin/monetization/monetization-activity-actions";
import { useMonetizationActivity } from "@/app/admin/monetization/monetization-activity-context";
import { scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { usePromotionAnalytics } from "@/app/admin/monetization/promotion-analytics-context";
import { buildSubscriptionEventDestructiveMeta } from "@/app/admin/monetization/subscription-analytics-helpers";
import { useSubscriptionAnalytics } from "@/app/admin/monetization/subscription-analytics-context";

type WatchlistAlert = {
  id: string;
  signature: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "monitor";
  tone: "amber" | "rose" | "sky";
  actionLabel: string;
  onAction: () => void;
};

export default function MonetizationWatchlist() {
  const didMarkViewedRef = useRef(false);
  const {
    preferences: {
      toolState: {
        dismissedWatchlistAlertSignatures,
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
  const { events: promotionEvents, summary: promotionSummary } = usePromotionAnalytics();
  const { events: subscriptionEvents, tiers } = useSubscriptionAnalytics();
  const severityRank: Record<WatchlistAlert["severity"], number> = {
    high: 0,
    medium: 1,
    monitor: 2,
  };

  const alerts = useMemo<WatchlistAlert[]>(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const priorSevenDaysAgo = sevenDaysAgo - 7 * 24 * 60 * 60 * 1000;
    const lastViewedAt = lastWatchlistViewedAt ? new Date(lastWatchlistViewedAt).getTime() : null;
    const hasVisitBaseline = Boolean(lastViewedAt && Number.isFinite(lastViewedAt));
    const tiersById = Object.fromEntries(tiers.map((tier) => [tier.id ?? "", tier]));
    const sinceLastViewedSubscriptionEvents = subscriptionEvents.filter((event) => {
      if (!hasVisitBaseline || !lastViewedAt) {
        return false;
      }
      return new Date(event.created_at ?? "").getTime() >= lastViewedAt;
    });
    const sinceLastViewedPromotionEvents = promotionEvents.filter((event) => {
      if (!hasVisitBaseline || !lastViewedAt) {
        return false;
      }
      return new Date(event.created_at ?? "").getTime() >= lastViewedAt;
    });

    const recentSubscriptionEvents = subscriptionEvents.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= sevenDaysAgo,
    );
    const priorSubscriptionEvents = subscriptionEvents.filter((event) => {
      const createdAt = new Date(event.created_at ?? "").getTime();
      return createdAt >= priorSevenDaysAgo && createdAt < sevenDaysAgo;
    });
    const destructiveRecent = recentSubscriptionEvents.filter(
      (event) => buildSubscriptionEventDestructiveMeta(event, tiersById).isDestructive,
    );
    const destructivePrior = priorSubscriptionEvents.filter(
      (event) => buildSubscriptionEventDestructiveMeta(event, tiersById).isDestructive,
    );
    const downgradesRecent = recentSubscriptionEvents.filter((event) => event.action === "downgrade");
    const destructiveSinceLastViewed = sinceLastViewedSubscriptionEvents.filter(
      (event) => buildSubscriptionEventDestructiveMeta(event, tiersById).isDestructive,
    );
    const downgradesSinceLastViewed = sinceLastViewedSubscriptionEvents.filter(
      (event) => event.action === "downgrade",
    );

    const recentPromotionEvents = promotionEvents.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= sevenDaysAgo,
    );
    const promotionAdds = recentPromotionEvents.filter((event) => event.promoted).length;
    const promotionRemovals = recentPromotionEvents.filter((event) => !event.promoted).length;
    const promotionAddsSinceLastViewed = sinceLastViewedPromotionEvents.filter(
      (event) => event.promoted,
    ).length;
    const promotionRemovalsSinceLastViewed = sinceLastViewedPromotionEvents.filter(
      (event) => !event.promoted,
    ).length;
    const totalPromoted = promotionSummary.reduce((sum, bucket) => sum + bucket.count, 0);

    const nextAlerts: WatchlistAlert[] = [];

    if (
      (hasVisitBaseline && destructiveSinceLastViewed.length > 0) ||
      (destructiveRecent.length >= 3 && destructiveRecent.length > destructivePrior.length)
    ) {
      nextAlerts.push({
        id: "subscription-destructive-spike",
        signature: hasVisitBaseline
          ? `since-visit:${destructiveSinceLastViewed.length}`
          : `rolling:${destructiveRecent.length}:${destructivePrior.length}`,
        title: hasVisitBaseline
          ? "New destructive subscription changes landed since your last visit"
          : "Destructive subscription changes are rising",
        detail: hasVisitBaseline
          ? `${destructiveSinceLastViewed.length} destructive subscription changes were recorded since you last viewed the monetization dashboard.`
          : `${destructiveRecent.length} destructive subscription changes landed in the last 7 days, up from ${destructivePrior.length} in the prior week.`,
        severity: "high",
        tone: "rose",
        actionLabel: "Review subscription history",
        onAction: () => {
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
          recordWatchlistAction("Opened destructive subscription history", "subscription_destructive");
        },
      });
    }

    if ((hasVisitBaseline && downgradesSinceLastViewed.length > 0) || downgradesRecent.length >= 2) {
      nextAlerts.push({
        id: "subscription-downgrade-pressure",
        signature: hasVisitBaseline
          ? `since-visit:${downgradesSinceLastViewed.length}`
          : `rolling:${downgradesRecent.length}`,
        title: "Downgrade pressure needs review",
        detail: hasVisitBaseline
          ? `${downgradesSinceLastViewed.length} seller downgrades have happened since your last visit.`
          : `${downgradesRecent.length} seller downgrades were recorded in the last 7 days. Check whether pricing or perk loss is driving the change.`,
        severity: "medium",
        tone: "amber",
        actionLabel: "Open downgrade slice",
        onAction: () => {
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
          recordWatchlistAction("Opened downgrade review", "subscription_downgrade");
        },
      });
    }

    if (
      (hasVisitBaseline && promotionRemovalsSinceLastViewed > promotionAddsSinceLastViewed) ||
      (promotionRemovals > promotionAdds && promotionRemovals >= 3)
    ) {
      nextAlerts.push({
        id: "promotion-removal-pressure",
        signature: hasVisitBaseline
          ? `since-visit:${promotionRemovalsSinceLastViewed}:${promotionAddsSinceLastViewed}`
          : `rolling:${promotionRemovals}:${promotionAdds}`,
        title: hasVisitBaseline
          ? "Promotion removals outpaced adds since your last visit"
          : "Promotion removals outpaced adds",
        detail: hasVisitBaseline
          ? `${promotionRemovalsSinceLastViewed} removals versus ${promotionAddsSinceLastViewed} adds were recorded since your last visit.`
          : `${promotionRemovals} removals versus ${promotionAdds} adds were recorded in the last 7 days.`,
        severity: "medium",
        tone: "amber",
        actionLabel: "Inspect promotion removals",
        onAction: () => {
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
          recordWatchlistAction("Opened promotion removals", "promotion_removals");
        },
      });
    }

    if (
      totalPromoted < 3 &&
      ((hasVisitBaseline && promotionRemovalsSinceLastViewed > 0) || promotionRemovals > 0)
    ) {
      nextAlerts.push({
        id: "promotion-inventory-thin",
        signature: hasVisitBaseline
          ? `since-visit:${totalPromoted}:${promotionRemovalsSinceLastViewed}`
          : `rolling:${totalPromoted}:${promotionRemovals}`,
        title: "Promoted inventory is getting thin",
        detail: `Only ${totalPromoted} promoted listings are active right now after recent removals.`,
        severity: "monitor",
        tone: "sky",
        actionLabel: "Open promoted listings",
        onAction: () => {
          recordActivity({
            kind: "workflow",
            label: "Watchlist: thin promoted inventory",
            summary: "Jumped from the watchlist into the promoted listings panel.",
          });
          scrollToMonetizationSection("promoted-listings-panel");
          recordWatchlistAction("Opened promoted listings", "promoted_listings");
        },
      });
    }

    return nextAlerts;
  }, [lastWatchlistViewedAt, promotionEvents, promotionSummary, subscriptionEvents, tiers]);

  const visibleAlerts = useMemo(
    () =>
      alerts
        .filter((alert) => dismissedWatchlistAlertSignatures[alert.id] !== alert.signature)
        .filter((alert) => severityFilter === "all" || alert.severity === severityFilter)
        .filter((alert) => !newOnly || isVisitBasedAlert(alert))
        .sort((left, right) => severityRank[left.severity] - severityRank[right.severity]),
    [alerts, dismissedWatchlistAlertSignatures, newOnly, severityFilter, severityRank],
  );

  const alertCounts = useMemo(() => {
    const counts = {
      all: 0,
      high: 0,
      medium: 0,
      monitor: 0,
    };
    for (const alert of alerts) {
      if (dismissedWatchlistAlertSignatures[alert.id] === alert.signature) {
        continue;
      }
      counts.all += 1;
      counts[alert.severity] += 1;
    }
    return counts;
  }, [alerts, dismissedWatchlistAlertSignatures]);

  const newSinceVisitCounts = useMemo(() => {
    const counts = {
      all: 0,
      high: 0,
      medium: 0,
      monitor: 0,
    };
    for (const alert of alerts) {
      if (dismissedWatchlistAlertSignatures[alert.id] === alert.signature) {
        continue;
      }
      if (!alert.signature.startsWith("since-visit:")) {
        continue;
      }
      counts.all += 1;
      counts[alert.severity] += 1;
    }
    return counts;
  }, [alerts, dismissedWatchlistAlertSignatures]);

  const openSeveritySlice = (nextFilter: WatchlistAlert["severity"] | "all") => {
    setSeverityFilter(nextFilter);
    setToolState((current) => ({
      ...current,
      watchlistCollapsed: false,
      watchlistSeverityFilter: nextFilter,
    }));
  };

  const isVisitBasedAlert = (alert: WatchlistAlert) => alert.signature.startsWith("since-visit:");
  const recordWatchlistAction = (
    summary: string,
    replayKey:
      | "subscription_destructive"
      | "subscription_downgrade"
      | "promotion_removals"
      | "promoted_listings"
      | null = null,
  ) => {
    const createdAt = new Date().toISOString();
    setToolState((current) => ({
      ...current,
      watchlistLastActionSummary: summary,
      watchlistLastActionAt: createdAt,
      watchlistLastActionReplayKey: replayKey,
    }));
  };

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

  if (alerts.length === 0) {
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
          {visibleAlerts.length !== alerts.length ? (
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() =>
                setToolState((current) => ({
                  ...current,
                  dismissedWatchlistAlertSignatures: {},
                }))
              }
            >
              Show dismissed
            </button>
          ) : null}
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
                      {isVisitBasedAlert(alert) ? (
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
                    onClick={() => {
                      setToolState((current) => ({
                        ...current,
                        dismissedWatchlistAlertSignatures: {
                          ...current.dismissedWatchlistAlertSignatures,
                          [alert.id]: alert.signature,
                        },
                      }));
                    recordActivity({
                      kind: "workflow",
                      label: `Watchlist dismissed: ${alert.title}`,
                      summary: `Dismissed the ${alert.title.toLowerCase()} alert.`,
                    });
                    recordWatchlistAction(`Dismissed ${alert.title}`, null);
                  }}
                >
                    Dismiss
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
          {visibleAlerts.length === 0 ? (
            <p className="mt-5 rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/66">
              All current watchlist items are dismissed.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
