"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatCurrency,
  type SellerSubscriptionEventRead,
} from "@/app/lib/api";
import {
  SUBSCRIPTION_HISTORY_FILTER_EVENT,
  type SubscriptionHistoryFilterDetail,
  type SubscriptionHistoryWindowDays,
} from "@/app/admin/monetization/subscription-history-filters";
import {
  SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT,
  type SubscriptionAssignmentFocusDetail,
} from "@/app/admin/monetization/subscription-assignment-focus";
import { useSubscriptionAnalytics } from "@/app/admin/monetization/subscription-analytics-context";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection, scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import {
  buildSubscriptionEventDestructiveMeta,
} from "@/app/admin/monetization/subscription-analytics-helpers";
import {
  escapeCsvValue,
  formatSubscriptionReasonLabel,
  getSubscriptionReasonFilterFromLabel,
} from "@/app/admin/monetization/subscription-formatting";

const WINDOW_OPTIONS: SubscriptionHistoryWindowDays[] = [7, 14, 30];

export default function SubscriptionSummaryPanel() {
  const [windowDays, setWindowDays] = useState<SubscriptionHistoryWindowDays>(30);
  const {
    tiers,
    subscriptions: allSubscriptions,
    events,
    status,
    error,
    lastUpdated,
    refresh,
  } = useSubscriptionAnalytics();
  const subscriptions = useMemo(
    () => allSubscriptions.filter((subscription) => subscription.is_active),
    [allSubscriptions],
  );

  const openHistoryView = (detail: SubscriptionHistoryFilterDetail) => {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_HISTORY_FILTER_EVENT, { detail }));
    scrollToMonetizationSection("subscription-history-panel");
  };

  const openAssignmentView = (detail: SubscriptionAssignmentFocusDetail) => {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT, { detail }));
  };

  const summary = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const windowStart = now - windowMs;
    const priorWindowStart = windowStart - windowMs;

    const assignedMrrCents = subscriptions.reduce(
      (sum, subscription) => sum + (subscription.monthly_price_cents ?? 0),
      0,
    );

    const tierCounts = subscriptions.reduce<Record<string, number>>((acc, subscription) => {
      const label = subscription.tier_name || subscription.tier_code || "Unknown tier";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});

    const analyticsEnabledCount = subscriptions.filter((subscription) => subscription.analytics_enabled).length;
    const priorityVisibilityCount = subscriptions.filter(
      (subscription) => subscription.priority_visibility,
    ).length;
    const premiumStorefrontCount = subscriptions.filter(
      (subscription) => subscription.premium_storefront,
    ).length;
    const recentEvents = events.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= windowStart,
    );
    const tiersById = Object.fromEntries(tiers.map((tier) => [tier.id ?? "", tier]));
    const reasonCounts = recentEvents.reduce<Record<string, number>>((acc, event) => {
      const label = formatSubscriptionReasonLabel(event.reason_code);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});
    const destructiveReasonCounts: Record<string, number> = {};
    const destructivePerkCounts: Record<string, number> = {};
    const destructiveValueDropEvents: SellerSubscriptionEventRead[] = [];
    const destructivePerkRemovalEvents: SellerSubscriptionEventRead[] = [];
    const destructiveEvents = recentEvents.filter((event) => {
      const destructive = buildSubscriptionEventDestructiveMeta(event, tiersById);

      if (destructive.isDestructive) {
        const reasonLabel = formatSubscriptionReasonLabel(event.reason_code);
        destructiveReasonCounts[reasonLabel] = (destructiveReasonCounts[reasonLabel] ?? 0) + 1;
        destructive.lostPerks.forEach((perk) => {
          destructivePerkCounts[perk] = (destructivePerkCounts[perk] ?? 0) + 1;
        });
        if (destructive.hasValueDrop) {
          destructiveValueDropEvents.push(event);
        }
        if (destructive.hasPerkRemoval) {
          destructivePerkRemovalEvents.push(event);
        }
      }

      return destructive.isDestructive;
    });
    const destructiveEvents7d = events.filter((event) => {
      const createdAt = new Date(event.created_at ?? "").getTime();
      if (createdAt < sevenDaysAgo) {
        return false;
      }
      return buildSubscriptionEventDestructiveMeta(event, tiersById).isDestructive;
    });
    const destructiveEventsPriorWindow = events.filter((event) => {
      const createdAt = new Date(event.created_at ?? "").getTime();
      if (createdAt < priorWindowStart || createdAt >= windowStart) {
        return false;
      }
      return buildSubscriptionEventDestructiveMeta(event, tiersById).isDestructive;
    });
    const destructiveValueDropEventsInWindow = destructiveValueDropEvents.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= windowStart,
    );
    const destructivePerkRemovalEventsInWindow = destructivePerkRemovalEvents.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= windowStart,
    );
    const destructiveValueDropEvents7d = destructiveValueDropEvents.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= sevenDaysAgo,
    );
    const destructivePerkRemovalEvents7d = destructivePerkRemovalEvents.filter(
      (event) => new Date(event.created_at ?? "").getTime() >= sevenDaysAgo,
    );
    const trialConversionCount = recentEvents.filter(
      (event) => event.reason_code === "trial_conversion",
    ).length;
    const retentionSaveCount = recentEvents.filter(
      (event) => event.reason_code === "retention_save",
    ).length;

    return {
      assignedMrrCents,
      activeSubscriptions: subscriptions.length,
      tierCounts: Object.entries(tierCounts).sort((left, right) => right[1] - left[1]),
      recentReasonCounts: Object.entries(reasonCounts).sort((left, right) => right[1] - left[1]),
      destructiveChangeCount: destructiveEvents.length,
      destructiveChangeCount7d: destructiveEvents7d.length,
      destructiveChangeDeltaWindow:
        destructiveEvents.length - destructiveEventsPriorWindow.length,
      destructiveValueDropCount: destructiveValueDropEvents.length,
      destructiveValueDropCountInWindow: destructiveValueDropEventsInWindow.length,
      destructiveValueDropCount7d: destructiveValueDropEvents7d.length,
      destructivePerkRemovalCount: destructivePerkRemovalEvents.length,
      destructivePerkRemovalCountInWindow: destructivePerkRemovalEventsInWindow.length,
      destructivePerkRemovalCount7d: destructivePerkRemovalEvents7d.length,
      destructiveReasonCounts: Object.entries(destructiveReasonCounts).sort(
        (left, right) => right[1] - left[1],
      ),
      destructivePerkCounts: Object.entries(destructivePerkCounts).sort(
        (left, right) => right[1] - left[1],
      ),
      trialConversionCount,
      retentionSaveCount,
      analyticsEnabledCount,
      priorityVisibilityCount,
      premiumStorefrontCount,
      totalTiers: tiers.length,
    };
  }, [events, subscriptions, tiers, windowDays]);

  const exportSummaryCsv = () => {
    const rows: Array<[string, string | number]> = [
      ["assigned_mrr_usd", (summary.assignedMrrCents / 100).toFixed(2)],
      ["active_subscriptions", summary.activeSubscriptions],
      ["live_tiers", summary.totalTiers],
      ["analytics_enabled_sellers", summary.analyticsEnabledCount],
      ["priority_visibility_sellers", summary.priorityVisibilityCount],
      ["premium_storefront_sellers", summary.premiumStorefrontCount],
      [`trial_conversions_${windowDays}d`, summary.trialConversionCount],
      [`retention_saves_${windowDays}d`, summary.retentionSaveCount],
      [`destructive_changes_${windowDays}d`, summary.destructiveChangeCount],
      ["destructive_changes_7d", summary.destructiveChangeCount7d],
      [`destructive_change_delta_${windowDays}d`, summary.destructiveChangeDeltaWindow],
      [`value_drops_${windowDays}d`, summary.destructiveValueDropCount],
      [`value_drops_window_${windowDays}d`, summary.destructiveValueDropCountInWindow],
      ["value_drops_7d", summary.destructiveValueDropCount7d],
      [`perk_removals_${windowDays}d`, summary.destructivePerkRemovalCount],
      [`perk_removals_window_${windowDays}d`, summary.destructivePerkRemovalCountInWindow],
      ["perk_removals_7d", summary.destructivePerkRemovalCount7d],
    ];

    summary.destructiveReasonCounts.forEach(([label, count]) => {
      rows.push([`destructive_reason:${label}`, count]);
    });
    summary.destructivePerkCounts.forEach(([label, count]) => {
      rows.push([`destructive_perk:${label}`, count]);
    });

    const csv = [["metric", "value"], ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "subscription-summary.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "subscription_summary") {
        return;
      }
      highlightMonetizationSection("subscription-summary-panel");
      exportSummaryCsv();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [summary, windowDays]);

  return (
    <section id="subscription-summary-panel" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Seller subscriptions
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Subscription reporting</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting subscription reporting…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-border bg-background p-1">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  windowDays === option
                    ? "bg-foreground text-background"
                    : "text-foreground/66 hover:text-foreground"
                }`}
                onClick={() => setWindowDays(option)}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={exportSummaryCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            disabled={status === "loading"}
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
            onClick={() => {
              if (status !== "loading") {
                void refresh();
              }
            }}
          >
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Assigned MRR" value={formatCurrency(summary.assignedMrrCents, "USD")} />
        <SummaryStat label="Active subscriptions" value={String(summary.activeSubscriptions)} />
        <SummaryStat label="Live tiers" value={String(summary.totalTiers)} />
        <SummaryStat
          label="Analytics-enabled sellers"
          value={String(summary.analyticsEnabledCount)}
        />
        <SummaryActionStat
          label={`Trial conversions ${windowDays}d`}
          value={String(summary.trialConversionCount)}
          onClick={() => openHistoryView({ direction: "all", reason: "trial_conversion", windowDays })}
        />
        <SummaryActionStat
          label={`Retention saves ${windowDays}d`}
          value={String(summary.retentionSaveCount)}
          onClick={() => openHistoryView({ direction: "all", reason: "retention_save", windowDays })}
        />
        <SummaryActionStat
          label={`Destructive changes ${windowDays}d`}
          value={String(summary.destructiveChangeCount)}
          onClick={() =>
            openHistoryView({ direction: "all", reason: "all", destructiveOnly: true, windowDays })
          }
        />
        <SummaryActionStat
          label="Destructive changes 7d"
          value={String(summary.destructiveChangeCount7d)}
          onClick={() =>
            openHistoryView({ direction: "all", reason: "all", destructiveOnly: true, windowDays: 7 })
          }
        />
        <SummaryStat
          label={`Value drops ${windowDays}d`}
          value={String(summary.destructiveValueDropCountInWindow)}
          onClick={() =>
            openHistoryView({
              direction: "all",
              reason: "all",
              destructiveOnly: true,
              destructiveType: "value_drop",
              windowDays,
            })
          }
        />
        <SummaryStat
          label={`Perk removals ${windowDays}d`}
          value={String(summary.destructivePerkRemovalCountInWindow)}
          onClick={() =>
            openHistoryView({
              direction: "all",
              reason: "all",
              destructiveOnly: true,
              destructiveType: "perk_removal",
              windowDays,
            })
          }
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-[1.8rem] border border-border/60 bg-background p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Tier mix
          </p>
          <div className="mt-4 space-y-3">
            {summary.tierCounts.length > 0 ? (
              summary.tierCounts.map(([label, count]) => (
                <button
                  key={label}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-white"
                  onClick={() => openAssignmentView({ tierName: label })}
                >
                  <span>{label}</span>
                  <span className="font-semibold text-foreground">{count}</span>
                </button>
              ))
            ) : (
              <p className="text-sm text-foreground/66">No active seller subscriptions yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Perk adoption
          </p>
          <div className="mt-4 space-y-3 text-sm text-foreground/72">
            <div className="flex items-center justify-between gap-3">
              <span>Priority visibility</span>
              <span className="font-semibold text-foreground">{summary.priorityVisibilityCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Premium storefront</span>
              <span className="font-semibold text-foreground">{summary.premiumStorefrontCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Analytics</span>
              <span className="font-semibold text-foreground">{summary.analyticsEnabledCount}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[1.8rem] border border-border/60 bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Change reasons in last {windowDays} days
          </p>
          <span className="text-xs text-foreground/56">Structured reason codes from admin subscription changes</span>
        </div>
        <div className="mt-4 space-y-3">
          {summary.recentReasonCounts.length > 0 ? (
            summary.recentReasonCounts.map(([label, count]) => (
              <button
                key={label}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-white"
                onClick={() =>
                  openHistoryView({
                    direction: "all",
                    reason: getSubscriptionReasonFilterFromLabel(label),
                    windowDays,
                  })
                }
              >
                <span>{label}</span>
                <span className="font-semibold text-foreground">{count}</span>
              </button>
            ))
          ) : (
            <p className="text-sm text-foreground/66">
              No structured subscription changes recorded in the last {windowDays} days.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[1.8rem] border border-rose-200 bg-white p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Destructive Change Mix
          </p>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-background"
              onClick={() =>
                openHistoryView({
                  direction: "all",
                  reason: "all",
                  destructiveOnly: true,
                  destructiveType: "value_drop",
                  windowDays,
                })
              }
            >
              <span>Value drops {windowDays}d</span>
              <span className="font-semibold text-foreground">{summary.destructiveValueDropCount}</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-background"
              onClick={() =>
                openHistoryView({
                  direction: "all",
                  reason: "all",
                  destructiveOnly: true,
                  destructiveType: "perk_removal",
                  windowDays,
                })
              }
            >
              <span>Perk removals {windowDays}d</span>
              <span className="font-semibold text-foreground">{summary.destructivePerkRemovalCount}</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-background"
              onClick={() =>
                openHistoryView({
                  direction: "all",
                  reason: "all",
                  destructiveOnly: true,
                  destructiveType: "value_drop",
                  windowDays: 7,
                })
              }
            >
              <span>Value drops 7d</span>
              <span className="font-semibold text-foreground">{summary.destructiveValueDropCount7d}</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-background"
              onClick={() =>
                openHistoryView({
                  direction: "all",
                  reason: "all",
                  destructiveOnly: true,
                  destructiveType: "perk_removal",
                  windowDays: 7,
                })
              }
            >
              <span>Perk removals 7d</span>
              <span className="font-semibold text-foreground">
                {summary.destructivePerkRemovalCount7d}
              </span>
            </button>
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-rose-200 bg-rose-50 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-rose-700">
            Destructive Changes By Reason
          </p>
          <p className="mt-2 text-xs text-rose-900/70">
            {windowDays}d trend:{" "}
            {summary.destructiveChangeDeltaWindow === 0
              ? `flat versus the prior ${windowDays}-day window`
              : summary.destructiveChangeDeltaWindow > 0
                ? `up by ${summary.destructiveChangeDeltaWindow}`
                : `down by ${Math.abs(summary.destructiveChangeDeltaWindow)}`}
          </p>
          <div className="mt-4 space-y-3">
            {summary.destructiveReasonCounts.length > 0 ? (
              summary.destructiveReasonCounts.map(([label, count]) => (
                <button
                  key={label}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-rose-900 transition hover:bg-white/70"
                  onClick={() =>
                    openHistoryView({
                      direction: "all",
                      reason: getSubscriptionReasonFilterFromLabel(label),
                      destructiveOnly: true,
                      windowDays,
                    })
                  }
                >
                  <span>{label}</span>
                  <span className="font-semibold">{count}</span>
                </button>
              ))
            ) : (
              <p className="text-sm text-rose-900/70">
                No destructive subscription changes in the last {windowDays} days.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-rose-200 bg-white p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Lost Perks In Destructive Changes
          </p>
          <div className="mt-4 space-y-3">
            {summary.destructivePerkCounts.length > 0 ? (
              summary.destructivePerkCounts.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-sm text-foreground/72">
                  <span>{label}</span>
                  <span className="font-semibold text-foreground">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-foreground/66">
                No perk removals recorded in the last {windowDays} days.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const classes =
    "rounded-[1.3rem] border border-border/60 bg-background px-4 py-4" +
    (onClick ? " text-left transition hover:border-foreground/40 hover:bg-white" : "");

  const content = (
    <>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}

function SummaryActionStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-[1.3rem] border border-border/60 bg-background px-4 py-4 text-left transition hover:border-foreground/40 hover:bg-white"
      onClick={onClick}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
    </button>
  );
}
