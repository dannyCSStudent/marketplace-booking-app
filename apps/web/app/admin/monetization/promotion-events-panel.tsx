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
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { usePromotionAnalytics } from "@/app/admin/monetization/promotion-analytics-context";
import {
  escapeCsvValue,
  formatPromotionPlatformFee,
  formatPromotionListingTypeLabel,
  formatPromotionTimestamp,
  truncatePromotionEntityId,
} from "@/app/admin/monetization/promotion-formatting";
const MAX_EVENTS = 12;
const WINDOW_OPTIONS = [7, 14, 30] as const;
const PROMOTION_EVENTS_ACTIVITY_KEY = "admin.promotion-events.recent-activity";
const PROMOTION_EVENTS_ACTIVITY_FILTER_KEY = "admin.promotion-events.recent-activity-filter";
const MAX_RECENT_ACTIVITY_ENTRIES = 4;

type PromotionStatusFilter = "all" | "promoted" | "removed";
type RecentActivityFilter = "all" | "focus" | "export";

type PromotionRecentActivityEntry =
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
      statusFilter: PromotionStatusFilter;
    };

export default function PromotionEventsPanel() {
  const { preferences, setPromotionDashboard } = useMonetizationPreferences();
  const { events, listingTypeById, status, error, lastUpdated, refresh } = usePromotionAnalytics();
  const { windowDays, statusFilter } = preferences.promotionDashboard;
  const [recentActivity, setRecentActivity] = useState<PromotionRecentActivityEntry[]>([]);
  const [recentActivityFilter, setRecentActivityFilter] = useState<RecentActivityFilter>("all");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(PROMOTION_EVENTS_ACTIVITY_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as PromotionRecentActivityEntry[];
      if (Array.isArray(parsed)) {
        setRecentActivity(parsed);
      }
    } catch {
      window.sessionStorage.removeItem(PROMOTION_EVENTS_ACTIVITY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem(PROMOTION_EVENTS_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "focus" || stored === "export") {
      setRecentActivityFilter(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      PROMOTION_EVENTS_ACTIVITY_KEY,
      JSON.stringify(recentActivity),
    );
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PROMOTION_EVENTS_ACTIVITY_FILTER_KEY, recentActivityFilter);
  }, [recentActivityFilter]);

  const windowedEvents = useMemo(
    () =>
      events.filter((event) => {
        const createdAt = new Date(event.created_at).getTime();
        if (Number.isNaN(createdAt)) {
          return true;
        }
        return createdAt >= Date.now() - windowDays * 24 * 60 * 60 * 1000;
      }),
    [events, windowDays],
  );

  const eventSummary = useMemo(
    () => ({
      all: windowedEvents.length,
      promoted: windowedEvents.filter((event) => event.promoted).length,
      removed: windowedEvents.filter((event) => !event.promoted).length,
    }),
    [windowedEvents],
  );

  const filteredEvents = useMemo(() => {
    if (statusFilter === "all") {
      return windowedEvents;
    }
    return windowedEvents.filter((event) =>
      statusFilter === "promoted" ? event.promoted : !event.promoted,
    );
  }, [statusFilter, windowedEvents]);

  const visibleEvents = filteredEvents.slice(0, MAX_EVENTS);

  const pressureByType = useMemo(() => {
    const buckets: Record<PromotionListingTypeFilter, { added: number; removed: number }> = {
      all: { added: 0, removed: 0 },
      product: { added: 0, removed: 0 },
      service: { added: 0, removed: 0 },
      hybrid: { added: 0, removed: 0 },
      unknown: { added: 0, removed: 0 },
    };

    windowedEvents.forEach((event) => {
      const type = listingTypeById[event.listing_id] ?? "unknown";
      if (event.promoted) {
        buckets[type].added += 1;
        buckets.all.added += 1;
      } else {
        buckets[type].removed += 1;
        buckets.all.removed += 1;
      }
    });

    return (["product", "service", "hybrid", "unknown"] as const)
      .map((type) => ({
        type,
        added: buckets[type].added,
        removed: buckets[type].removed,
        net: buckets[type].added - buckets[type].removed,
      }))
      .filter((bucket) => bucket.added > 0 || bucket.removed > 0)
      .sort((left, right) => {
        const rightActivity = right.added + right.removed;
        const leftActivity = left.added + left.removed;
        return rightActivity - leftActivity;
      });
  }, [listingTypeById, windowedEvents]);

  const recordRecentActivity = (entry: Omit<PromotionRecentActivityEntry, "id" | "createdAt">) => {
    setRecentActivity((current) =>
      [
        {
          ...entry,
          id: `${entry.kind}:${Date.now()}`,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, MAX_RECENT_ACTIVITY_ENTRIES),
    );
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

  const exportCsv = () => {
    if (visibleEvents.length === 0) {
      return;
    }
    const rows = visibleEvents.map((event) => [
      event.id,
      event.promoted ? "promoted" : "removed",
      event.listing_id,
      event.seller_id,
      event.platform_fee_rate,
      event.created_at,
    ]);
    const csv = [
      ["event_id", "status", "listing_id", "seller_id", "platform_fee_rate", "created_at"],
      ...rows,
    ]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `promotion-events-${statusFilter}-${windowDays}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runExport = () => {
    recordRecentActivity({
      kind: "export",
      label: `Exported ${visibleEvents.length} promotion events`,
      detail: `${windowDays}d · ${statusFilter}`,
      windowDays,
      statusFilter,
    });
    exportCsv();
  };

  useEffect(() => {
    const handleFilterEvent = (event: Event) => {
      const detail = (event as CustomEvent<PromotionDashboardFilterDetail>).detail;
      if (!detail) {
        return;
      }
      setPromotionDashboard((current) => ({
        ...current,
        windowDays: detail.windowDays ?? current.windowDays,
        statusFilter: detail.statusFilter ?? current.statusFilter,
      }));
    };

    window.addEventListener(PROMOTION_DASHBOARD_FILTER_EVENT, handleFilterEvent);
    return () => {
      window.removeEventListener(PROMOTION_DASHBOARD_FILTER_EVENT, handleFilterEvent);
    };
  }, [setPromotionDashboard]);

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "promotion_events") {
        return;
      }
      highlightMonetizationSection("promotion-events-panel");
      runExport();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [runExport, statusFilter, visibleEvents, windowDays]);

  const renderBody = () => {
    if (status === "loading") {
      return <p className="text-sm text-foreground/66">Loading promotion events…</p>;
    }

    if (error) {
      return <p className="text-sm text-rose-600">{error}</p>;
    }

    if (visibleEvents.length === 0) {
      return <p className="text-sm text-foreground/66">No promotion activity has been recorded yet.</p>;
    }

    return (
      <ul className="space-y-3">
        {visibleEvents.map((event) => {
          const actionLabel = event.promoted ? "Promotion added" : "Promotion removed";
          const badgeColor = event.promoted ? "bg-[#d9f2ff] text-[#00577f]" : "bg-[#ffe5e5] text-[#a12d2d]";
          return (
            <li
              key={event.id}
              className="flex flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-background px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{actionLabel}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-foreground/60">
                  <span className="rounded-full border border-border/60 bg-[#f9f9f9] px-2 py-1">
                    Listing {truncateId(event.listing_id)}
                  </span>
                  <span className="rounded-full border border-border/60 bg-[#f9f9f9] px-2 py-1">
                    Seller {truncatePromotionEntityId(event.seller_id)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 text-xs text-foreground/70 sm:items-end">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${badgeColor}`}>
                  <span>{event.promoted ? "Promoted" : "Removed"}</span>
                </span>
                <p className="text-[11px] text-foreground/60">
                  {formatPromotionPlatformFee(event.platform_fee_rate)} platform fee
                </p>
                <p className="text-[11px] text-foreground/50">{formatPromotionTimestamp(event.created_at)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section id="promotion-events-panel" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Promotion events</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Recent promotion history</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/56">
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
          <p>{lastUpdated ? `Last updated ${lastUpdated}` : "No data yet"}</p>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={runExport}
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
      {recentActivity.length > 0 ? (
        <div className="mt-5 rounded-[1.6rem] border border-border/60 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Recent Activity
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Re-open the latest type focus or rerun the most recent promotion export.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => {
                setRecentActivity([]);
                window.sessionStorage.removeItem(PROMOTION_EVENTS_ACTIVITY_KEY);
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
                ? "No recent promotion activity yet."
                : `No ${recentActivityFilter} activity has been recorded in this session yet.`}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryFilterCard
          label={`All ${windowDays}d`}
          value={String(eventSummary.all)}
          active={statusFilter === "all"}
          onClick={() => setPromotionDashboard((current) => ({ ...current, statusFilter: "all" }))}
        />
        <SummaryFilterCard
          label="Promotions added"
          value={String(eventSummary.promoted)}
          active={statusFilter === "promoted"}
          onClick={() =>
            setPromotionDashboard((current) => ({ ...current, statusFilter: "promoted" }))
          }
        />
        <SummaryFilterCard
          label="Promotions removed"
          value={String(eventSummary.removed)}
          active={statusFilter === "removed"}
          onClick={() =>
            setPromotionDashboard((current) => ({ ...current, statusFilter: "removed" }))
          }
        />
      </div>
      <div className="mt-4 rounded-[1.8rem] border border-border/60 bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Promotion pressure by type
          </p>
          <p className="text-xs text-foreground/56">
            Adds vs removals in the last {windowDays} days
          </p>
        </div>
        <div className="mt-4 space-y-3">
          {pressureByType.length === 0 ? (
            <p className="text-sm text-foreground/66">No typed promotion pressure recorded in this window.</p>
          ) : (
            pressureByType.map((bucket) => (
              <button
                key={bucket.type}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground/72 transition hover:bg-white"
                onClick={() => focusPromotedListings(bucket.type)}
              >
                <span className="uppercase tracking-[0.18em] text-foreground/60">{bucket.type}</span>
                <span className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="text-emerald-700">+{bucket.added}</span>
                  <span className="text-rose-700">-{bucket.removed}</span>
                  <span className="font-semibold text-foreground">
                    Net {bucket.net >= 0 ? `+${bucket.net}` : bucket.net}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="mt-4 space-y-3">{renderBody()}</div>
    </section>
  );
}

function SummaryFilterCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-[1.3rem] border px-4 py-4 text-left transition ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border/60 bg-background hover:border-foreground/40 hover:bg-white"
      }`}
      onClick={onClick}
    >
      <p
        className={`font-mono text-[11px] uppercase tracking-[0.2em] ${
          active ? "text-background/72" : "text-foreground/48"
        }`}
      >
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </button>
  );
}
