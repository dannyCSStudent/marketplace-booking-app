"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatCurrency,
  type SellerSubscriptionEventRead,
} from "@/app/lib/api";
import {
  SUBSCRIPTION_HISTORY_FILTER_EVENT,
  type SubscriptionHistoryDirection,
  type SubscriptionHistoryFilterDetail,
  type SubscriptionHistoryReason,
  type SubscriptionHistoryWindowDays,
} from "@/app/admin/monetization/subscription-history-filters";
import { SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT } from "@/app/admin/monetization/subscription-assignment-focus";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { useSubscriptionAnalytics } from "@/app/admin/monetization/subscription-analytics-context";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import {
  buildSubscriptionEventDestructiveMeta,
} from "@/app/admin/monetization/subscription-analytics-helpers";
import {
  escapeCsvValue,
  formatSubscriptionDirectionLabel,
  formatSubscriptionReasonLabel,
  SUBSCRIPTION_REASON_OPTIONS,
} from "@/app/admin/monetization/subscription-formatting";

type ChangeDirection = SellerSubscriptionEventRead["action"];
type DirectionFilter = SubscriptionHistoryDirection;
type ReasonFilter = SubscriptionHistoryReason;
type RecentActivityFilter = "all" | "assignment" | "export";

const WINDOW_OPTIONS: SubscriptionHistoryWindowDays[] = [7, 14, 30];
const SUBSCRIPTION_HISTORY_ACTIVITY_KEY = "admin.subscription-history.recent-activity";
const SUBSCRIPTION_HISTORY_ACTIVITY_FILTER_KEY = "admin.subscription-history.recent-activity-filter";
const MAX_RECENT_ACTIVITY_ENTRIES = 4;

const DIRECTION_OPTIONS: Array<{ value: DirectionFilter; label: string }> = [
  { value: "all", label: "All changes" },
  { value: "started", label: "Started" },
  { value: "upgrade", label: "Upgrades" },
  { value: "downgrade", label: "Downgrades" },
  { value: "reactivated", label: "Reactivated" },
  { value: "lateral", label: "Lateral moves" },
];

function getDirectionBadgeClass(direction: ChangeDirection) {
  if (direction === "upgrade") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (direction === "downgrade") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }
  if (direction === "reactivated") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (direction === "lateral") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border border-border bg-white text-foreground/62";
}

type SubscriptionHistoryRecentActivityEntry =
  | {
      id: string;
      kind: "assignment";
      label: string;
      detail: string;
      createdAt: string;
      sellerSlug?: string;
      tierId?: string;
      tierName?: string;
      reasonCode?: string;
    }
  | {
      id: string;
      kind: "export";
      label: string;
      detail: string;
      createdAt: string;
      windowDays: SubscriptionHistoryWindowDays;
      direction: DirectionFilter;
      reason: ReasonFilter;
      destructiveOnly: boolean;
      destructiveType: "all" | "value_drop" | "perk_removal";
    };

export default function SubscriptionHistoryPanel() {
  const { preferences, setSubscriptionHistory } = useMonetizationPreferences();
  const { subscriptions, events, tiers, status, error, lastUpdated, refresh } =
    useSubscriptionAnalytics();
  const {
    direction: directionFilter,
    reason: reasonFilter,
    destructiveOnly,
    destructiveType,
    windowDays,
  } = preferences.subscriptionHistory;
  const [recentActivity, setRecentActivity] = useState<SubscriptionHistoryRecentActivityEntry[]>([]);
  const [recentActivityFilter, setRecentActivityFilter] = useState<RecentActivityFilter>("all");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(SUBSCRIPTION_HISTORY_ACTIVITY_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as SubscriptionHistoryRecentActivityEntry[];
      if (Array.isArray(parsed)) {
        setRecentActivity(parsed);
      }
    } catch {
      window.sessionStorage.removeItem(SUBSCRIPTION_HISTORY_ACTIVITY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem(SUBSCRIPTION_HISTORY_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "assignment" || stored === "export") {
      setRecentActivityFilter(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      SUBSCRIPTION_HISTORY_ACTIVITY_KEY,
      JSON.stringify(recentActivity),
    );
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      SUBSCRIPTION_HISTORY_ACTIVITY_FILTER_KEY,
      recentActivityFilter,
    );
  }, [recentActivityFilter]);

  const recentActivityCounts = useMemo(
    () => ({
      all: recentActivity.length,
      assignment: recentActivity.filter((entry) => entry.kind === "assignment").length,
      export: recentActivity.filter((entry) => entry.kind === "export").length,
    }),
    [recentActivity],
  );
  const filteredRecentActivity = useMemo(
    () =>
      recentActivity.filter(
        (entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter,
      ),
    [recentActivity, recentActivityFilter],
  );
  const latestActivity = recentActivity[0] ?? null;

  const recordRecentActivity = (
    entry: Omit<SubscriptionHistoryRecentActivityEntry, "id" | "createdAt">,
  ) => {
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

  const openAssignmentView = (event: SellerSubscriptionEventRead) => {
    const detail = {
      sellerSlug: event.seller_slug || undefined,
      tierId: event.to_tier_id || undefined,
      tierName: event.to_tier_name || event.to_tier_code || undefined,
      reasonCode: event.reason_code ?? undefined,
    };

    recordRecentActivity({
      kind: "assignment",
      label: event.seller_display_name || event.seller_slug || event.seller_id,
      detail: `${event.action} · ${formatSubscriptionReasonLabel(event.reason_code)}`,
      sellerSlug: detail.sellerSlug,
      tierId: detail.tierId,
      tierName: detail.tierName,
      reasonCode: detail.reasonCode,
    });

    highlightMonetizationSection("subscription-assignment-panel");
    window.dispatchEvent(
      new CustomEvent(SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT, {
        detail,
      }),
    );
  };

  const openRecentAssignmentView = (entry: SubscriptionHistoryRecentActivityEntry) => {
    if (entry.kind !== "assignment") {
      return;
    }

    highlightMonetizationSection("subscription-assignment-panel");
    window.dispatchEvent(
      new CustomEvent(SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT, {
        detail: {
          sellerSlug: entry.sellerSlug,
          tierId: entry.tierId,
          tierName: entry.tierName,
          reasonCode: entry.reasonCode,
        },
      }),
    );
  };

  const exportFilteredChanges = () => {
    const rows = summary.filteredChanges.map((event) => {
      const eventId = event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`;
      const destructive = summary.destructiveByEventId[eventId];
      return [
        event.created_at ?? "",
        event.seller_display_name || "",
        event.seller_slug || event.seller_id,
        formatSubscriptionDirectionLabel(event.action),
        formatSubscriptionReasonLabel(event.reason_code),
        event.from_tier_name || event.from_tier_code || event.from_tier_id || "",
        event.to_tier_name || event.to_tier_code || event.to_tier_id || "",
        destructive?.isDestructive ? "yes" : "no",
        destructive?.hasValueDrop ? "yes" : "no",
        destructive?.hasPerkRemoval ? "yes" : "no",
        destructive?.priceDeltaCents != null ? destructive.priceDeltaCents / 100 : "",
        destructive?.lostPerks.join("; ") || "",
        event.actor_name || event.actor_user_id,
        event.note || "",
      ];
    });
    const header = [
      "created_at",
      "seller_display_name",
      "seller_slug",
      "action",
      "reason",
      "from_tier",
      "to_tier",
      "is_destructive",
      "has_value_drop",
      "has_perk_removal",
      "price_delta_dollars",
      "lost_perks",
      "actor",
      "note",
    ];
    const csv = [header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "subscription-history.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const runExport = () => {
    recordRecentActivity({
      kind: "export",
      label: `Exported ${summary.filteredChanges.length} changes`,
      detail: `${windowDays}d · ${formatSubscriptionDirectionLabel(directionFilter)} · ${formatSubscriptionReasonLabel(reasonFilter)}`,
      windowDays,
      direction: directionFilter,
      reason: reasonFilter,
      destructiveOnly,
      destructiveType,
    });
    exportFilteredChanges();
  };

  useEffect(() => {
    const handleFilterEvent = (event: Event) => {
      const detail = (event as CustomEvent<SubscriptionHistoryFilterDetail>).detail;
      if (!detail) {
        return;
      }
      setSubscriptionHistory((current) => ({
        ...current,
        direction: detail.direction,
        reason: detail.reason,
        destructiveOnly: Boolean(detail.destructiveOnly),
        destructiveType: detail.destructiveType ?? "all",
        windowDays: detail.windowDays ?? 30,
      }));
    };

    window.addEventListener(SUBSCRIPTION_HISTORY_FILTER_EVENT, handleFilterEvent);
    return () => {
      window.removeEventListener(SUBSCRIPTION_HISTORY_FILTER_EVENT, handleFilterEvent);
    };
  }, [setSubscriptionHistory]);

  const summary = useMemo(() => {
    const now = Date.now();
    const windowStart = now - windowDays * 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const tiersById = Object.fromEntries(tiers.map((tier) => [tier.id ?? "", tier]));
    const destructiveByEventId = Object.fromEntries(
      events.map((event) => {
        return [
          event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`,
          buildSubscriptionEventDestructiveMeta(event, tiersById),
        ];
      }),
    );
    const endedThisWeek = subscriptions.filter((subscription) => {
      if (!subscription.ended_at) {
        return false;
      }
      const endedAt = new Date(subscription.ended_at).getTime();
      return endedAt >= weekAgo;
    }).length;

    const startedThisWeek = events.filter((event) => {
      if (event.action !== "started" && event.action !== "reactivated") {
        return false;
      }
      const startedAt = new Date(event.created_at ?? "").getTime();
      return startedAt >= weekAgo;
    }).length;

    const upgradesThisWeek = events.filter(
      (event) =>
        event.action === "upgrade" && new Date(event.created_at ?? "").getTime() >= weekAgo,
    ).length;
    const downgradesThisWeek = events.filter(
      (event) =>
        event.action === "downgrade" && new Date(event.created_at ?? "").getTime() >= weekAgo,
    ).length;
    const destructiveChangesThisWeek = events.filter((event) => {
      const eventId = event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`;
      return (
        new Date(event.created_at ?? "").getTime() >= weekAgo &&
        destructiveByEventId[eventId]?.isDestructive
      );
    }).length;

    const windowFilteredChanges = events.filter((event) => {
      const createdAt = new Date(event.created_at ?? "").getTime();
      return Number.isFinite(createdAt) && createdAt >= windowStart;
    });

    return {
      endedThisWeek,
      startedThisWeek,
      upgradesThisWeek,
      downgradesThisWeek,
      destructiveChangesThisWeek,
      destructiveByEventId,
      destructiveQueue: events.filter((event) => {
        const eventId = event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`;
        return (
          new Date(event.created_at ?? "").getTime() >= windowStart &&
          destructiveByEventId[eventId]?.isDestructive
        );
      }),
      filteredChanges: windowFilteredChanges.filter((event) => {
        const eventId = event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`;
        const matchesDirection = directionFilter === "all" || event.action === directionFilter;
        const matchesReason = reasonFilter === "all" || event.reason_code === reasonFilter;
        const matchesDestructive = !destructiveOnly || destructiveByEventId[eventId]?.isDestructive;
        const matchesDestructiveType =
          destructiveType === "all" ||
          (destructiveType === "value_drop" && destructiveByEventId[eventId]?.hasValueDrop) ||
          (destructiveType === "perk_removal" && destructiveByEventId[eventId]?.hasPerkRemoval);
        return matchesDirection && matchesReason && matchesDestructive && matchesDestructiveType;
      }),
    };
  }, [destructiveOnly, destructiveType, directionFilter, events, reasonFilter, subscriptions, tiers, windowDays]);

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "subscription_history") {
        return;
      }
      highlightMonetizationSection("subscription-history-panel");
      runExport();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [destructiveOnly, destructiveType, directionFilter, reasonFilter, runExport, summary, windowDays]);

  return (
    <section
      id="subscription-history-panel"
      className="rounded-4xl border border-border bg-white p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Seller subscriptions
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Recent subscription changes</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated
              ? `Last updated ${lastUpdated} • showing last ${windowDays} days`
              : "Awaiting subscription history…"}
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
                onClick={() =>
                  setSubscriptionHistory((current) => ({ ...current, windowDays: option }))
                }
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={summary.filteredChanges.length === 0}
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
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

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

      {recentActivity.length > 0 ? (
        <div className="mt-5 rounded-[1.4rem] border border-border/60 bg-background px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Recent Activity
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Re-open the last assignment target or rerun the latest exported filter slice.
              </p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/52">
                {latestActivity.label} · {latestActivity.detail}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => {
                setRecentActivity([]);
                window.sessionStorage.removeItem(SUBSCRIPTION_HISTORY_ACTIVITY_KEY);
              }}
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["assignment", "Assignment"],
              ["export", "Export"],
            ] as const).map(([value, label]) => (
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
                {label} ({recentActivityCounts[value]})
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {filteredRecentActivity.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border border-border bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-foreground/58">
                    {entry.kind === "assignment" ? "Assignment" : "Export"} · {entry.detail}
                  </p>
                </div>
                {entry.kind === "assignment" ? (
                  <button
                    className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={() => openRecentAssignmentView(entry)}
                    type="button"
                  >
                    Re-open assignment
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
          {filteredRecentActivity.length === 0 ? (
            <div className="mt-4 rounded-[1.1rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
              {recentActivityFilter === "all"
                ? "No recent subscription actions yet."
                : `No ${recentActivityFilter} activity has been recorded in this session yet.`}
            </div>
          ) : null}
          </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HistoryStat label="Started in last 7d" value={String(summary.startedThisWeek)} />
        <HistoryStat label="Ended in last 7d" value={String(summary.endedThisWeek)} />
        <HistoryStat label="Upgrades in last 7d" value={String(summary.upgradesThisWeek)} />
        <HistoryStat label="Downgrades in last 7d" value={String(summary.downgradesThisWeek)} />
        <HistoryStat
          label="Destructive changes 7d"
          value={String(summary.destructiveChangesThisWeek)}
        />
        <HistoryStat
          label={`Matching changes ${windowDays}d`}
          value={String(summary.filteredChanges.length)}
        />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <label className="rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/72">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Change type
          </span>
          <select
            className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            value={directionFilter}
            onChange={(event) =>
              setSubscriptionHistory((current) => ({
                ...current,
                direction: event.target.value as DirectionFilter,
              }))
            }
          >
            {DIRECTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/72">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Reason code
          </span>
          <select
            className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            value={reasonFilter}
            onChange={(event) =>
              setSubscriptionHistory((current) => ({
                ...current,
                reason: event.target.value as ReasonFilter,
              }))
            }
          >
            {SUBSCRIPTION_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex items-center gap-3 rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/72">
        <input
          type="checkbox"
          className="size-4 rounded border-border"
          checked={destructiveOnly}
          onChange={(event) =>
            setSubscriptionHistory((current) => ({
              ...current,
              destructiveOnly: event.target.checked,
            }))
          }
        />
        <span>
          <span className="block font-semibold text-foreground">Show destructive changes only</span>
          <span className="block text-xs text-foreground/56">
            Limit the history stream to downgrades, value reductions, or perk removals.
          </span>
        </span>
      </label>

      {destructiveOnly ? (
        <label className="mt-3 rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/72">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Destructive subtype
          </span>
          <select
            className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            value={destructiveType}
            onChange={(event) =>
              setSubscriptionHistory((current) => ({
                ...current,
                destructiveType: event.target.value as "all" | "value_drop" | "perk_removal",
              }))
            }
          >
            <option value="all">All destructive changes</option>
            <option value="value_drop">Value drops</option>
            <option value="perk_removal">Perk removals</option>
          </select>
        </label>
      ) : null}

      {summary.destructiveQueue.length > 0 ? (
        <div className="mt-5 rounded-[1.6rem] border border-rose-200 bg-rose-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-rose-700">
                Destructive Review Queue
              </p>
              <p className="mt-1 text-sm text-rose-900/80">
                Recent subscription changes that reduced value or removed seller capabilities.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-rose-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:text-rose-900"
              onClick={() =>
                setSubscriptionHistory((current) => ({ ...current, destructiveOnly: true }))
              }
            >
              Review only these
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {summary.destructiveQueue.slice(0, 3).map((event) => {
              const eventId =
                event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`;
              const destructive = summary.destructiveByEventId[eventId];
              return (
                <button
                  key={eventId}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-[1.1rem] border border-rose-200 bg-white px-4 py-3 text-left transition hover:border-rose-400"
                  onClick={() => openAssignmentView(event)}
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {event.seller_display_name || event.seller_slug || event.seller_id}
                    </p>
                    <p className="mt-1 text-xs text-foreground/60">
                      {event.from_tier_name || event.from_tier_code || event.from_tier_id || "Unknown"} {" -> "}
                      {event.to_tier_name || event.to_tier_code || event.to_tier_id}
                    </p>
                  </div>
                  <div className="text-right text-xs text-rose-800">
                    {destructive?.priceDeltaCents && destructive.priceDeltaCents < 0 ? (
                      <p>{formatCurrency(Math.abs(destructive.priceDeltaCents), "USD")}/mo lower</p>
                    ) : null}
                    {destructive?.lostPerks.length ? (
                      <p className="mt-1">Lost: {destructive.lostPerks.join(", ")}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {summary.filteredChanges.length === 0 ? (
          <p className="text-sm text-foreground/66">
            {status === "loading"
              ? "Loading history…"
              : "No subscription changes match the current filters."}
          </p>
        ) : (
          summary.filteredChanges.slice(0, 12).map((event) => (
            (() => {
              const eventId =
                event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`;
              const destructive = summary.destructiveByEventId[eventId];
              return (
                <div
                  key={eventId}
                  className="rounded-[1.6rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-5"
                >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/52">
                    {event.seller_slug || event.seller_id}
                  </p>
                  <h3 className="text-lg font-semibold text-foreground">
                    {event.seller_display_name || "Unknown seller"}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${getDirectionBadgeClass(event.action)}`}
                  >
                    {formatSubscriptionDirectionLabel(event.action)}
                  </span>
                  {destructive?.isDestructive ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">
                      Destructive
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-foreground/72">
                <p className="font-semibold text-foreground">
                  {event.to_tier_name || event.to_tier_code || event.to_tier_id}
                </p>
                <p>{event.from_tier_name ? `${event.from_tier_name} -> ` : ""}{event.to_tier_name || event.to_tier_code || event.to_tier_id}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-foreground/60">
                <span>
                  Recorded {event.created_at ? new Date(event.created_at).toLocaleString() : "Not available"}
                </span>
                <span>Reason {formatSubscriptionReasonLabel(event.reason_code)}</span>
                <span>Actor {event.actor_name || event.actor_user_id}</span>
                {event.note ? <span>{event.note}</span> : null}
              </div>
              {destructive?.isDestructive ? (
                <div className="mt-3 rounded-[1rem] border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800">
                  <p className="font-semibold">Destructive change summary</p>
                  <p className="mt-1">
                    {destructive.priceDeltaCents < 0
                      ? `Monthly value decreased by ${formatCurrency(Math.abs(destructive.priceDeltaCents), "USD")}/mo.`
                      : "Monthly value did not increase."}
                  </p>
                  {destructive.lostPerks.length > 0 ? (
                    <p className="mt-1">Lost perks: {destructive.lostPerks.join(", ")}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4">
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                  onClick={() => openAssignmentView(event)}
                >
                  Open assignment
                </button>
              </div>
                </div>
              );
            })()
          ))
        )}
      </div>
    </section>
  );
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border border-border/60 bg-background px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
    </div>
  );
}
