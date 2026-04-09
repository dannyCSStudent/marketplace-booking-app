"use client";

import { useEffect, useMemo, useState } from "react";

import { applyMonetizationWorkflow, applyPromotionDashboardFilter, applySubscriptionHistoryFilter, triggerMonetizationExportBundle } from "@/app/admin/monetization/monetization-activity-actions";
import { useMonetizationActivity } from "@/app/admin/monetization/monetization-activity-context";
import { scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPinnedPresets } from "@/app/admin/monetization/monetization-pinned-presets-context";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import {
  getMonetizationPresetById,
  getMonetizationPresetIdForReplay,
  getMonetizationPresetSourceLabel,
  getMonetizationPresetSourceSectionId,
} from "@/app/admin/monetization/monetization-preset-lookup";

function formatActivityTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }
  return date.toLocaleString();
}

function getActivityDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfEntryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfEntryDay) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) {
    return "Today";
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  return date.toLocaleDateString();
}

function formatKindLabel(kind: "saved_view" | "export" | "workflow") {
  if (kind === "saved_view") {
    return "Saved view";
  }
  if (kind === "workflow") {
    return "Workflow";
  }
  return "Export";
}

function isWatchlistEntry(entry: { label: string }) {
  return entry.label.startsWith("Watchlist");
}

function getWatchlistActivityTone(entry: { label: string; summary: string }) {
  const normalized = `${entry.label} ${entry.summary}`.toLowerCase();
  if (
    normalized.includes("destructive") ||
    normalized.includes("downgrade") ||
    normalized.includes("removal")
  ) {
    return "high";
  }
  if (normalized.includes("promoted listings") || normalized.includes("thin promoted inventory")) {
    return "medium";
  }
  return "normal";
}

export default function MonetizationActivityLog() {
  const { entries, recordActivity } = useMonetizationActivity();
  const { isPinned, togglePinnedPreset } = useMonetizationPinnedPresets();
  const {
    preferences: {
      toolState: { activityLogCollapsedGroups, activityLogEntryLimit, activityLogViewFilter },
    },
    setQuickAccessFilter,
    setToolState,
  } = useMonetizationPreferences();
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(activityLogCollapsedGroups);
  const [viewFilter, setViewFilter] = useState<"all" | "watchlist">(activityLogViewFilter);
  const recentEntries = useMemo(
    () =>
      [...entries]
        .filter((entry) => viewFilter === "all" || isWatchlistEntry(entry))
        .sort((left, right) => {
          const leftIsWatchlist = isWatchlistEntry(left);
          const rightIsWatchlist = isWatchlistEntry(right);
          if (leftIsWatchlist !== rightIsWatchlist) {
            return leftIsWatchlist ? -1 : 1;
          }
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        })
        .slice(0, activityLogEntryLimit),
    [activityLogEntryLimit, entries, viewFilter],
  );
  const groupedEntries = useMemo(() => {
    const groups: Array<{ label: string; entries: typeof recentEntries }> = [];
    for (const entry of recentEntries) {
      const label = getActivityDayLabel(entry.createdAt);
      const currentGroup = groups[groups.length - 1];
      if (currentGroup && currentGroup.label === label) {
        currentGroup.entries.push(entry);
        continue;
      }
      groups.push({
        label,
        entries: [entry],
      });
    }
    return groups;
  }, [recentEntries]);

  useEffect(() => {
    setViewFilter(activityLogViewFilter);
  }, [activityLogViewFilter]);

  useEffect(() => {
    setCollapsedGroups(activityLogCollapsedGroups);
  }, [activityLogCollapsedGroups]);

  const revealPinnedPreset = (kind: "workflow" | "export_bundle" | "subscription_view" | "promotion_view") => {
    setQuickAccessFilter(
      kind === "workflow"
        ? "workflows"
        : kind === "export_bundle"
          ? "exports"
          : "views",
    );
    scrollToMonetizationSection("monetization-quick-access");
  };
  const openPresetSource = (kind: "workflow" | "export_bundle" | "subscription_view" | "promotion_view") => {
    scrollToMonetizationSection(getMonetizationPresetSourceSectionId(kind));
  };

  const rerunEntry = async (entry: (typeof entries)[number]) => {
    if (!entry.replay) {
      return;
    }
    if (entry.replay.kind === "saved_view") {
      if (entry.replay.subscriptionDetail) {
        applySubscriptionHistoryFilter(entry.replay.subscriptionDetail);
      }
      if (entry.replay.promotionDetail) {
        applyPromotionDashboardFilter(entry.replay.promotionDetail);
      }
    } else if (entry.replay.kind === "export") {
      await triggerMonetizationExportBundle(entry.replay.targets);
    } else {
      await applyMonetizationWorkflow(entry.replay);
    }

    recordActivity({
      kind: entry.kind,
      label: `${entry.label} rerun`,
      summary: `Re-ran the ${entry.label.toLowerCase()} ${formatKindLabel(entry.kind).toLowerCase()} action.`,
      replay: entry.replay,
    });
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups((current) => {
      const next = current.includes(label)
        ? current.filter((entry) => entry !== label)
        : [...current, label];
      setToolState((toolStateCurrent) => ({
        ...toolStateCurrent,
        activityLogCollapsedGroups: next,
      }));
      return next;
    });
  };

  const collapseOlderDays = () => {
    const next = groupedEntries
      .map((group) => group.label)
      .filter((label) => label !== "Today");
    setCollapsedGroups(next);
    setToolState((current) => ({
      ...current,
      activityLogCollapsedGroups: next,
    }));
  };
  const expandAllDays = () => {
    setCollapsedGroups([]);
    setToolState((current) => ({
      ...current,
      activityLogCollapsedGroups: [],
    }));
  };
  const collapsibleOlderLabels = groupedEntries
    .map((group) => group.label)
    .filter((label) => label !== "Today");
  const canCollapseOlderDays =
    collapsibleOlderLabels.length > 0 &&
    collapsibleOlderLabels.some((label) => !collapsedGroups.includes(label));
  const canExpandAllDays = collapsedGroups.length > 0;

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Report activity</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Recent monetization actions</h2>
          <p className="text-sm text-foreground/66">
            Track the latest saved views, exports, and workflow bundles across admin sessions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {groupedEntries.length > 1 ? (
            <>
              <button
                type="button"
                disabled={!canCollapseOlderDays}
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  canCollapseOlderDays
                    ? "border-border bg-white text-foreground hover:border-foreground hover:text-foreground/90"
                    : "border-border/60 bg-background text-foreground/40"
                }`}
                onClick={collapseOlderDays}
              >
                Collapse older days
              </button>
              <button
                type="button"
                disabled={!canExpandAllDays}
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  canExpandAllDays
                    ? "border-border bg-white text-foreground hover:border-foreground hover:text-foreground/90"
                    : "border-border/60 bg-background text-foreground/40"
                }`}
                onClick={expandAllDays}
              >
                Expand all days
              </button>
            </>
          ) : null}
          {[
            { key: "all" as const, label: "All activity" },
            { key: "watchlist" as const, label: "Watchlist focus" },
          ].map((option) => {
            const isActive = viewFilter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-white text-foreground hover:border-foreground hover:text-foreground/90"
                }`}
                onClick={() => {
                  setViewFilter(option.key);
                  setToolState((current) => ({
                    ...current,
                    activityLogViewFilter: option.key,
                  }));
                }}
              >
                {option.label}
              </button>
            );
          })}
          {[
            { key: 6 as const, label: "Show 6" },
            { key: 10 as const, label: "Show 10" },
          ].map((option) => {
            const isActive = activityLogEntryLimit === option.key;
            return (
              <button
                key={option.key}
                type="button"
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-white text-foreground hover:border-foreground hover:text-foreground/90"
                }`}
                onClick={() =>
                  setToolState((current) => ({
                    ...current,
                    activityLogEntryLimit: option.key,
                  }))
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {recentEntries.length === 0 ? (
          <p className="rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/66">
            {viewFilter === "watchlist"
              ? "No watchlist-driven activity yet."
              : "No report activity yet."}
          </p>
        ) : (
          groupedEntries.map((group) => (
            <div key={group.label} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/46">
                  {group.label}
                </p>
                <button
                  type="button"
                  className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                  onClick={() => toggleGroup(group.label)}
                >
                  {collapsedGroups.includes(group.label) ? "Expand" : "Collapse"}
                </button>
              </div>
              {collapsedGroups.includes(group.label) ? (
                <p className="rounded-[1.2rem] border border-border/60 bg-background px-4 py-3 text-sm text-foreground/60">
                  {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"} hidden.
                </p>
              ) : (
                group.entries.map((entry) => (
                (() => {
              const presetId = entry.replay ? getMonetizationPresetIdForReplay(entry.replay) : null;
              const preset = presetId ? getMonetizationPresetById(presetId) : null;
              const canPin = Boolean(presetId);
              const watchlistTone = getWatchlistActivityTone(entry);
              return (
            <div
              key={entry.id}
              className={`rounded-[1.4rem] border px-4 py-4 ${
                isWatchlistEntry(entry)
                  ? watchlistTone === "high"
                    ? "border-rose-200 bg-rose-50/55"
                    : watchlistTone === "medium"
                      ? "border-amber-200 bg-amber-50/55"
                      : "border-sky-200 bg-sky-50/55"
                  : "border-border/60 bg-background"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
                    {isWatchlistEntry(entry) ? (
                      <span
                        className={`rounded-full border bg-white px-2 py-1 ${
                          watchlistTone === "high"
                            ? "border-rose-200 text-rose-700"
                            : watchlistTone === "medium"
                              ? "border-amber-200 text-amber-700"
                              : "border-sky-200 text-sky-700"
                        }`}
                      >
                        Watchlist
                      </span>
                    ) : null}
                    <span className="rounded-full border border-border bg-white px-2 py-1 text-foreground/60">
                      {formatKindLabel(entry.kind)}
                    </span>
                    <span className="text-foreground/48">{formatActivityTimestamp(entry.createdAt)}</span>
                  </div>
                  {entry.replay ? (
                    <button
                      type="button"
                      className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                      onClick={() => {
                        void rerunEntry(entry);
                      }}
                    >
                      Re-run
                    </button>
                  ) : null}
                  {canPin ? (
                    <button
                      type="button"
                      className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                      onClick={() => {
                        if (presetId) {
                          const wasPinned = isPinned(presetId);
                          togglePinnedPreset(presetId);
                          if (!wasPinned && preset) {
                            revealPinnedPreset(preset.kind);
                          }
                        }
                      }}
                    >
                      {presetId && isPinned(presetId) ? "Unpin" : "Pin"}
                    </button>
                  ) : null}
                  {preset ? (
                    <button
                      type="button"
                      className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
                      onClick={() => openPresetSource(preset.kind)}
                    >
                      Open {getMonetizationPresetSourceLabel(preset.kind)}
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground/66">{entry.summary}</p>
              {canPin && presetId && isPinned(presetId) ? (
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a5a18]">
                  Pinned to quick access
                </p>
              ) : null}
            </div>
              );
            })()
              ))
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
