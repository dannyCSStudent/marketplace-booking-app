"use client";

import { useEffect, useMemo, useState } from "react";

import {
  PROMOTION_LISTING_FOCUS_EVENT,
  type PromotionListingTypeFilter,
} from "@/app/admin/monetization/promotion-listing-focus";
import {
  PROMOTION_DASHBOARD_FILTER_EVENT,
  type PromotionDashboardFilterDetail,
} from "@/app/admin/monetization/promotion-dashboard-filters";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { usePromotionAnalytics } from "@/app/admin/monetization/promotion-analytics-context";
import { formatPromotionListingTypeLabel } from "@/app/admin/monetization/promotion-formatting";
const WINDOW_OPTIONS = [7, 14, 30] as const;
const PROMOTION_OVERVIEW_ACTIVITY_KEY = "admin.promotion-overview.recent-activity";
const PROMOTION_OVERVIEW_ACTIVITY_FILTER_KEY = "admin.promotion-overview.recent-activity-filter";
const MAX_RECENT_ACTIVITY_ENTRIES = 4;

type RecentActivityFilter = "all" | "focus" | "window";

type PromotionOverviewRecentActivityEntry =
  | {
      id: string;
      kind: "focus";
      label: string;
      detail: string;
      createdAt: string;
      type: PromotionListingTypeFilter;
    }
  | {
      id: string;
      kind: "window";
      label: string;
      detail: string;
      createdAt: string;
      windowDays: number;
    };

type PromotionOverviewRecentActivityInput =
  | {
      kind: "focus";
      label: string;
      detail: string;
      type: PromotionListingTypeFilter;
    }
  | {
      kind: "window";
      label: string;
      detail: string;
      windowDays: number;
    };

export default function PromotionOverviewCard() {
  const { preferences, setPromotionDashboard } = useMonetizationPreferences();
  const { summary, events, listingTypeById, status, error, lastUpdated } = usePromotionAnalytics();
  const { windowDays } = preferences.promotionDashboard;
  const [recentActivity, setRecentActivity] = useState<PromotionOverviewRecentActivityEntry[]>(
    () => {
      if (typeof window === "undefined") {
        return [];
      }

      try {
        const stored = window.sessionStorage.getItem(PROMOTION_OVERVIEW_ACTIVITY_KEY);
        if (!stored) {
          return [];
        }

        const parsed = JSON.parse(stored) as PromotionOverviewRecentActivityEntry[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        window.sessionStorage.removeItem(PROMOTION_OVERVIEW_ACTIVITY_KEY);
        return [];
      }
    },
  );
  const [recentActivityFilter, setRecentActivityFilter] = useState<RecentActivityFilter>(() => {
    if (typeof window === "undefined") {
      return "all";
    }

    const stored = window.sessionStorage.getItem(PROMOTION_OVERVIEW_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "focus" || stored === "window") {
      return stored;
    }

    return "all";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PROMOTION_OVERVIEW_ACTIVITY_KEY, JSON.stringify(recentActivity));
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PROMOTION_OVERVIEW_ACTIVITY_FILTER_KEY, recentActivityFilter);
  }, [recentActivityFilter]);

  useEffect(() => {
    const handleFilterEvent = (event: Event) => {
      const detail = (event as CustomEvent<PromotionDashboardFilterDetail>).detail;
      if (detail?.windowDays) {
        setPromotionDashboard((current) => ({ ...current, windowDays: detail.windowDays ?? current.windowDays }));
      }
    };

    window.addEventListener(PROMOTION_DASHBOARD_FILTER_EVENT, handleFilterEvent);
    return () => {
      window.removeEventListener(PROMOTION_DASHBOARD_FILTER_EVENT, handleFilterEvent);
    };
  }, [setPromotionDashboard]);

  const metrics = useMemo(() => {
    const totalPromoted = summary.reduce((sum, bucket) => sum + bucket.count, 0);
    const latestTimestamp = events.reduce((currentLatest, event) => {
      const createdAt = new Date(event.created_at).getTime();
      if (Number.isNaN(createdAt)) {
        return currentLatest;
      }
      return Math.max(currentLatest, createdAt);
    }, 0);
    const windowStart = latestTimestamp - windowDays * 24 * 60 * 60 * 1000;
    const counts: Record<PromotionListingTypeFilter, { added: number; removed: number }> = {
      all: { added: 0, removed: 0 },
      product: { added: 0, removed: 0 },
      service: { added: 0, removed: 0 },
      hybrid: { added: 0, removed: 0 },
      unknown: { added: 0, removed: 0 },
    };

    events.forEach((event) => {
      const createdAt = new Date(event.created_at).getTime();
      if (!Number.isNaN(createdAt) && createdAt < windowStart) {
        return;
      }
      const type = listingTypeById[event.listing_id] ?? "unknown";
      if (event.promoted) {
        counts[type].added += 1;
        counts.all.added += 1;
      } else {
        counts[type].removed += 1;
        counts.all.removed += 1;
      }
    });

    const pressureTypes = (["product", "service", "hybrid", "unknown"] as const)
      .map((type) => ({
        type,
        added: counts[type].added,
        removed: counts[type].removed,
        net: counts[type].added - counts[type].removed,
        activity: counts[type].added + counts[type].removed,
      }))
      .filter((bucket) => bucket.activity > 0)
      .sort((left, right) => {
        if (right.activity !== left.activity) {
          return right.activity - left.activity;
        }
        return Math.abs(right.net) - Math.abs(left.net);
      });

    return {
      totalPromoted,
      added: counts.all.added,
      removed: counts.all.removed,
      net: counts.all.added - counts.all.removed,
      topPressureType: pressureTypes[0] ?? null,
    };
  }, [events, listingTypeById, summary, windowDays]);

  const recordRecentActivity = (entry: PromotionOverviewRecentActivityInput) => {
    setRecentActivity((current) =>
      [
        {
          ...entry,
          id: `${entry.kind}:${Date.now()}`,
          createdAt: new Date().toISOString(),
        } as PromotionOverviewRecentActivityEntry,
        ...current,
      ].slice(0, MAX_RECENT_ACTIVITY_ENTRIES),
    );
  };

  const setWindowDaysWithActivity = (nextWindowDays: number) => {
    recordRecentActivity({
      kind: "window",
      label: `${nextWindowDays}d overview`,
      detail: `${metrics.totalPromoted} promoted listings`,
      windowDays: nextWindowDays,
    });
    setPromotionDashboard((current) => ({ ...current, windowDays: nextWindowDays as 7 | 14 | 30 }));
  };

  const focusPromotedListings = (type: PromotionListingTypeFilter) => {
    recordRecentActivity({
      kind: "focus",
      label: `Focused ${formatPromotionListingTypeLabel(type)}`,
      detail: `${formatPromotionListingTypeLabel(type)} pressure`,
      type,
    });
    window.dispatchEvent(
      new CustomEvent(PROMOTION_LISTING_FOCUS_EVENT, {
        detail: { type },
      }),
    );
  };

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Promotion overview
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Promotion pressure snapshot</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting promotion overview…"}
          </p>
        </div>
        <div className="rounded-full border border-border bg-background p-1">
          {WINDOW_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  windowDays === option ? "bg-foreground text-background" : "text-foreground/66 hover:text-foreground"
                }`}
                onClick={() => setWindowDaysWithActivity(option)}
              >
                {option}d
              </button>
            ))}
          </div>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

      {recentActivity.length > 0 ? (
        <div className="mt-5 rounded-[1.8rem] border border-border/60 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Recent Activity
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Re-open the last pressure focus or note the latest overview window you inspected.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => {
                setRecentActivity([]);
                window.sessionStorage.removeItem(PROMOTION_OVERVIEW_ACTIVITY_KEY);
              }}
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["focus", "Focus"],
              ["window", "Window"],
            ] as const).map(([value, label]) => {
              const filteredCount = recentActivity.filter(
                (entry) => value === "all" || entry.kind === value,
              ).length;
              return (
                <button
                  key={value}
                  type="button"
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                    recentActivityFilter === value
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setRecentActivityFilter(value)}
                >
                  {label} ({filteredCount})
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-2">
            {recentActivity
              .filter((entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter)
              .map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border border-border bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-foreground/58">
                      {entry.kind === "focus" ? "Listing focus" : "Window"} · {entry.detail}
                    </p>
                  </div>
                  {entry.kind === "focus" ? (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => focusPromotedListings(entry.type)}
                      type="button"
                    >
                      Re-open focus
                    </button>
                  ) : (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => setWindowDaysWithActivity(entry.windowDays)}
                      type="button"
                    >
                      Re-open window
                    </button>
                  )}
                </div>
              ))}
          </div>
          {recentActivity.filter((entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter).length === 0 ? (
            <div className="mt-4 rounded-[1.1rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
              {recentActivityFilter === "all"
                ? "No recent promotion overview activity yet."
                : `No ${recentActivityFilter} activity has been recorded in this session yet.`}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewStat label="Currently promoted" value={String(metrics.totalPromoted)} />
        <OverviewStat label={`Adds ${windowDays}d`} value={String(metrics.added)} tone="emerald" />
        <OverviewStat label={`Removals ${windowDays}d`} value={String(metrics.removed)} tone="rose" />
        <OverviewStat
          label={`Net movement ${windowDays}d`}
          value={metrics.net > 0 ? `+${metrics.net}` : String(metrics.net)}
          tone={metrics.net > 0 ? "emerald" : metrics.net < 0 ? "rose" : "neutral"}
        />
      </div>

      <div className="mt-4 rounded-[1.8rem] border border-border/60 bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Highest pressure type
          </p>
          {metrics.topPressureType ? (
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => focusPromotedListings(metrics.topPressureType.type)}
            >
              Open in listings
            </button>
          ) : null}
        </div>
        {status === "loading" && !lastUpdated ? (
          <p className="mt-4 text-sm text-foreground/66">Loading promotion overview…</p>
        ) : metrics.topPressureType ? (
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {formatPromotionListingTypeLabel(metrics.topPressureType.type)}
              </p>
              <p className="mt-1 text-sm text-foreground/66">
                {metrics.topPressureType.added} adds and {metrics.topPressureType.removed} removals in the last{" "}
                {windowDays} days
              </p>
            </div>
            <p
              className={`text-sm font-semibold ${
                metrics.topPressureType.net > 0
                  ? "text-emerald-700"
                  : metrics.topPressureType.net < 0
                    ? "text-rose-700"
                    : "text-foreground/56"
              }`}
            >
              {metrics.topPressureType.net > 0
                ? `Net +${metrics.topPressureType.net}`
                : `Net ${metrics.topPressureType.net}`}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-foreground/66">No promotion activity recorded in this window.</p>
        )}
      </div>
    </section>
  );
}

function OverviewStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "emerald" | "rose";
}) {
  return (
    <div className="rounded-[1.3rem] border border-border/60 bg-background px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-[-0.04em] ${
          tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
