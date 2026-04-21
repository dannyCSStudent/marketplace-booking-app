"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PROMOTION_LISTING_FOCUS_EVENT,
  type PromotionListingTypeFilter,
} from "@/app/admin/monetization/promotion-listing-focus";
import {
  PROMOTION_DASHBOARD_FILTER_EVENT,
  type PromotionDashboardFilterDetail,
} from "@/app/admin/monetization/promotion-dashboard-filters";
import { usePromotionAnalytics } from "@/app/admin/monetization/promotion-analytics-context";
import { escapeCsvValue, formatPromotionListingTypeLabel } from "@/app/admin/monetization/promotion-formatting";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
const WINDOW_OPTIONS = [7, 14, 30] as const;
const PROMOTION_HEATMAP_ACTIVITY_KEY = "admin.promotion-heatmap.recent-activity";
const PROMOTION_HEATMAP_ACTIVITY_FILTER_KEY = "admin.promotion-heatmap.recent-activity-filter";
const MAX_RECENT_ACTIVITY_ENTRIES = 4;

type RecentActivityFilter = "all" | "focus" | "export";

type PromotionHeatmapRecentActivityEntry =
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
      kind: "export";
      label: string;
      detail: string;
      createdAt: string;
      windowDays: number;
    };

type PromotionHeatmapRecentActivityInput =
  | {
      kind: "focus";
      label: string;
      detail: string;
      type: PromotionListingTypeFilter;
    }
  | {
      kind: "export";
      label: string;
      detail: string;
      windowDays: number;
    };

export default function PromotionHeatmap() {
  const { preferences, setPromotionDashboard } = useMonetizationPreferences();
  const { summary: buckets, events, listingTypeById, status, error } = usePromotionAnalytics();
  const { windowDays } = preferences.promotionDashboard;
  const [recentActivity, setRecentActivity] = useState<PromotionHeatmapRecentActivityEntry[]>(
    () => {
      if (typeof window === "undefined") {
        return [];
      }

      try {
        const stored = window.sessionStorage.getItem(PROMOTION_HEATMAP_ACTIVITY_KEY);
        if (!stored) {
          return [];
        }

        const parsed = JSON.parse(stored) as PromotionHeatmapRecentActivityEntry[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        window.sessionStorage.removeItem(PROMOTION_HEATMAP_ACTIVITY_KEY);
        return [];
      }
    },
  );
  const [recentActivityFilter, setRecentActivityFilter] = useState<RecentActivityFilter>(() => {
    if (typeof window === "undefined") {
      return "all";
    }

    const stored = window.sessionStorage.getItem(PROMOTION_HEATMAP_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "focus" || stored === "export") {
      return stored;
    }

    return "all";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PROMOTION_HEATMAP_ACTIVITY_KEY, JSON.stringify(recentActivity));
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PROMOTION_HEATMAP_ACTIVITY_FILTER_KEY, recentActivityFilter);
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

  const grandTotal = useMemo(() => buckets.reduce((sum, bucket) => sum + bucket.count, 0), [buckets]);

  const trendByType = useMemo(() => {
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

    return counts;
  }, [events, listingTypeById, windowDays]);

  const recordRecentActivity = useCallback((entry: PromotionHeatmapRecentActivityInput) => {
    setRecentActivity((current) =>
      [
        {
          ...entry,
          id: `${entry.kind}:${Date.now()}`,
          createdAt: new Date().toISOString(),
        } as PromotionHeatmapRecentActivityEntry,
        ...current,
      ].slice(0, MAX_RECENT_ACTIVITY_ENTRIES),
    );
  }, []);

  const exportCsv = useCallback(() => {
    if (buckets.length === 0) {
      return;
    }
    const rows = buckets.map((bucket) => {
      const trend = trendByType[bucket.type] ?? { added: 0, removed: 0 };
      return [
        bucket.label,
        bucket.count,
        trend.added,
        trend.removed,
        trend.added - trend.removed,
      ];
    });
    const csv = [["listing_type", "current_count", `adds_${windowDays}d`, `removals_${windowDays}d`, `net_${windowDays}d`], ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `promotion-heatmap-${windowDays}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [buckets, trendByType, windowDays]);

  const runExport = useCallback(() => {
    recordRecentActivity({
      kind: "export",
      label: `Exported ${buckets.length} heatmap buckets`,
      detail: `${windowDays}d · ${grandTotal} boosted listings`,
      windowDays,
    });
    exportCsv();
  }, [buckets.length, exportCsv, grandTotal, recordRecentActivity, windowDays]);

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "promotion_heatmap") {
        return;
      }
      highlightMonetizationSection("promotion-heatmap-panel");
      runExport();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [buckets, runExport, trendByType, windowDays]);

  const focusPromotedListings = (type: PromotionListingTypeFilter) => {
    recordRecentActivity({
      kind: "focus",
      label: `Focused ${formatPromotionListingTypeLabel(type)}`,
      detail: `${formatPromotionListingTypeLabel(type)} heatmap`,
      type,
    });
    window.dispatchEvent(
      new CustomEvent(PROMOTION_LISTING_FOCUS_EVENT, {
        detail: { type },
      }),
    );
  };

  return (
    <section id="promotion-heatmap-panel" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Promotion heatmap</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Promoted inventory by type</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
                onClick={() =>
                  setPromotionDashboard((current) => ({ ...current, windowDays: option }))
                }
              >
                {option}d
              </button>
            ))}
          </div>
          <p className="text-xs text-foreground/56">{grandTotal} boosted listings</p>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={runExport}
          >
            Export CSV
          </button>
        </div>
      </div>
      {recentActivity.length > 0 ? (
        <div className="mt-5 rounded-[1.6rem] border border-border/60 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Recent Activity
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Re-open the latest type focus or rerun the last heatmap export.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => {
                setRecentActivity([]);
                window.sessionStorage.removeItem(PROMOTION_HEATMAP_ACTIVITY_KEY);
              }}
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["focus", "Focus"],
              ["export", "Export"],
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
                      {entry.kind === "focus" ? "Listing focus" : "Export"} · {entry.detail}
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
                      onClick={runExport}
                      type="button"
                    >
                      Re-export slice
                    </button>
                  )}
                </div>
              ))}
          </div>
          {recentActivity.filter((entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter).length === 0 ? (
            <div className="mt-4 rounded-[1.1rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
              {recentActivityFilter === "all"
                ? "No recent heatmap activity yet."
                : `No ${recentActivityFilter} activity has been recorded in this session yet.`}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {status === "error" ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : status === "idle" && buckets.length === 0 ? (
          <p className="text-sm text-foreground/66">Awaiting promoted listing mix…</p>
        ) : buckets.length === 0 ? (
          <p className="text-sm text-foreground/66">No promoted listings yet.</p>
        ) : (
          buckets.map((bucket) => {
            const trend = trendByType[bucket.type] ?? { added: 0, removed: 0 };
            const net = trend.added - trend.removed;
            return (
              <button
                key={bucket.label}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-background"
                onClick={() => focusPromotedListings(bucket.type)}
              >
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-foreground/60">{bucket.label}</p>
                  <p className="mt-1 text-xs text-foreground/56">
                    {trend.added} adds, {trend.removed} removals in the last {windowDays} days
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-semibold text-foreground">{bucket.count}</p>
                  <p
                    className={`text-xs font-semibold ${
                      net > 0 ? "text-emerald-700" : net < 0 ? "text-rose-700" : "text-foreground/56"
                    }`}
                  >
                    {net > 0 ? `+${net}` : net} net
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
