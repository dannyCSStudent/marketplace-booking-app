"use client";

import { useMemo } from "react";

import {
  applyMonetizationWorkflow,
  applyPromotionDashboardFilter,
  applySubscriptionHistoryFilter,
  triggerMonetizationExportBundle,
} from "@/app/admin/monetization/monetization-activity-actions";
import { useMonetizationActivity } from "@/app/admin/monetization/monetization-activity-context";
import { scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPinnedPresets } from "@/app/admin/monetization/monetization-pinned-presets-context";
import { useMonetizationPreferences, type QuickAccessFilter } from "@/app/admin/monetization/monetization-preferences-context";
import {
  getMonetizationPresetById,
  getMonetizationPresetSourceLabel,
  getMonetizationPresetSourceSectionId,
} from "@/app/admin/monetization/monetization-preset-lookup";

const QUICK_ACCESS_FILTERS: Array<{ value: QuickAccessFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "views", label: "Views" },
  { value: "workflows", label: "Workflows" },
  { value: "exports", label: "Exports" },
];

export default function MonetizationQuickAccess() {
  const {
    preferences: {
      quickAccessFilter: filter,
      toolState: { quickAccessLastUsedPresetId },
    },
    setQuickAccessFilter,
    setToolState,
  } = useMonetizationPreferences();
  const {
    pinnedPresetIds,
    togglePinnedPreset,
    movePinnedPresetEarlier,
    movePinnedPresetLater,
    resetPinnedPresetOrder,
  } = useMonetizationPinnedPresets();
  const { recordActivity } = useMonetizationActivity();

  const pinnedPresets = useMemo(
    () => pinnedPresetIds.map((id) => getMonetizationPresetById(id)).filter((preset) => preset != null),
    [pinnedPresetIds],
  );
  const filteredPresets = useMemo(
    () =>
      pinnedPresets.filter((preset) => {
        if (filter === "all") {
          return true;
        }
        if (filter === "workflows") {
          return preset.kind === "workflow";
        }
        if (filter === "exports") {
          return preset.kind === "export_bundle";
        }
        return preset.kind === "subscription_view" || preset.kind === "promotion_view";
      }),
    [filter, pinnedPresets],
  );
  const lastUsedPreset = useMemo(
    () =>
      quickAccessLastUsedPresetId
        ? pinnedPresets.find((preset) => preset?.id === quickAccessLastUsedPresetId) ?? null
        : null,
    [pinnedPresets, quickAccessLastUsedPresetId],
  );

  const runPreset = async (preset: NonNullable<(typeof pinnedPresets)[number]>) => {
    setToolState((current) => ({
      ...current,
      quickAccessLastUsedPresetId: preset.id,
    }));
    if (preset.kind === "workflow") {
      await applyMonetizationWorkflow({
        subscriptionDetail: preset.subscriptionDetail,
        promotionDetail: preset.promotionDetail,
        targets: preset.targets,
      });
      recordActivity({
        kind: "workflow",
        label: `${preset.label} quick run`,
        summary: `Ran the pinned ${preset.label.toLowerCase()} workflow from quick access.`,
        replay: {
          kind: "workflow",
          subscriptionDetail: preset.subscriptionDetail,
          promotionDetail: preset.promotionDetail,
          targets: preset.targets,
        },
      });
      return;
    }

    if (preset.kind === "export_bundle") {
      await triggerMonetizationExportBundle(preset.targets);
      recordActivity({
        kind: "export",
        label: `${preset.label} quick run`,
        summary: `Exported the pinned ${preset.label.toLowerCase()} bundle from quick access.`,
        replay: {
          kind: "export",
          targets: preset.targets,
        },
      });
      return;
    }

    if (preset.kind === "subscription_view") {
      applySubscriptionHistoryFilter(preset.detail);
      recordActivity({
        kind: "saved_view",
        label: `${preset.label} quick run`,
        summary: `Applied the pinned ${preset.label.toLowerCase()} subscription view from quick access.`,
        replay: {
          kind: "saved_view",
          subscriptionDetail: preset.detail,
        },
      });
      return;
    }

    applyPromotionDashboardFilter(preset.detail);
    recordActivity({
      kind: "saved_view",
      label: `${preset.label} quick run`,
      summary: `Applied the pinned ${preset.label.toLowerCase()} promotion view from quick access.`,
      replay: {
        kind: "saved_view",
        promotionDetail: preset.detail,
      },
    });
  };

  const openPresetSource = (preset: NonNullable<(typeof pinnedPresets)[number]>) => {
    scrollToMonetizationSection(getMonetizationPresetSourceSectionId(preset.kind));
  };

  if (pinnedPresets.length === 0) {
    return null;
  }

  return (
    <section id="monetization-quick-access" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Quick access</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Pinned monetization presets</h2>
          <p className="text-sm text-foreground/66">
            Run your pinned views and workflows directly from the top of the dashboard.
          </p>
          <p className="mt-1 text-[11px] text-foreground/52">
            Pin items from saved views or export bundles to surface them here. Reordering only affects this session.
          </p>
          <p className="mt-1 text-[11px] text-foreground/52">
            {lastUsedPreset
              ? `Last quick run: ${lastUsedPreset.label}.`
              : "Run a pinned item to mark it as your most recent quick access action."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-border bg-background p-1">
            {QUICK_ACCESS_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  filter === option.value
                    ? "bg-foreground text-background"
                    : "text-foreground/66 hover:text-foreground"
                }`}
                onClick={() => setQuickAccessFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={() => resetPinnedPresetOrder()}
          >
            Reset order
          </button>
          <p className="text-[11px] text-foreground/52">
            Resets to workflows, then views, then exports, each sorted by name.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {filteredPresets.length === 0 ? (
          <p className="w-full rounded-[1.4rem] border border-border/60 bg-background px-4 py-4 text-sm text-foreground/66">
            No pinned presets match this filter.
          </p>
        ) : (
          filteredPresets.map((preset, index) => (
          <div
            key={preset.id}
            className="min-w-[240px] flex-1 rounded-[1.5rem] border border-[#caa46a]/50 bg-[#fff7eb] px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  void runPreset(preset);
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#8a5a18]">
                    {preset.kind === "workflow"
                      ? "Workflow"
                      : preset.kind === "export_bundle"
                        ? "Export bundle"
                        : preset.kind === "subscription_view"
                          ? "Subscription view"
                          : "Promotion view"}
                  </p>
                  <span className="rounded-full border border-[#caa46a]/60 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5a18]">
                    #{index + 1}
                  </span>
                  {quickAccessLastUsedPresetId === preset.id ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      Last used
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground">{preset.label}</p>
                <p className="mt-1 text-sm leading-6 text-foreground/66">{preset.description}</p>
              </button>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={index === 0}
                    className="rounded-full border border-[#caa46a] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5a18] transition hover:bg-[#fff2dd] disabled:border-[#caa46a]/30 disabled:text-[#8a5a18]/40 disabled:hover:bg-transparent"
                    onClick={() => movePinnedPresetEarlier(preset.id)}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={index === filteredPresets.length - 1}
                    className="rounded-full border border-[#caa46a] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5a18] transition hover:bg-[#fff2dd] disabled:border-[#caa46a]/30 disabled:text-[#8a5a18]/40 disabled:hover:bg-transparent"
                    onClick={() => movePinnedPresetLater(preset.id)}
                  >
                    Down
                  </button>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-[#caa46a] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5a18] transition hover:bg-[#fff2dd]"
                  onClick={() => togglePinnedPreset(preset.id)}
                >
                  Unpin
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[#caa46a] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5a18] transition hover:bg-[#fff2dd]"
                  onClick={() => openPresetSource(preset)}
                >
                  Open {getMonetizationPresetSourceLabel(preset.kind)}
                </button>
              </div>
            </div>
          </div>
          ))
        )}
      </div>
    </section>
  );
}
