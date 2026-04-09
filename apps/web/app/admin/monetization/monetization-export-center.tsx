"use client";

import { useMemo } from "react";

import { type MonetizationExportTarget } from "@/app/admin/monetization/monetization-export-events";
import {
  applyMonetizationWorkflow,
  triggerMonetizationExport,
  triggerMonetizationExportBundle,
} from "@/app/admin/monetization/monetization-activity-actions";
import {
  MONETIZATION_WORKFLOW_PRESETS,
  PROMOTION_VIEW_PRESETS,
  SUBSCRIPTION_VIEW_PRESETS,
} from "@/app/admin/monetization/monetization-dashboard-presets";
import { useMonetizationActivity } from "@/app/admin/monetization/monetization-activity-context";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { useMonetizationPinnedPresets } from "@/app/admin/monetization/monetization-pinned-presets-context";

const EXPORT_TARGETS: Array<{ target: MonetizationExportTarget; label: string; description: string }> = [
  {
    target: "platform_fee_history",
    label: "Platform fees",
    description: "Daily order and booking fee history.",
  },
  {
    target: "delivery_fee_history",
    label: "Delivery fees",
    description: "Delivery and shipping surcharge history.",
  },
  {
    target: "subscription_summary",
    label: "Subscription summary",
    description: "Topline seller subscription revenue snapshot.",
  },
  {
    target: "subscription_history",
    label: "Subscription history",
    description: "Filtered subscription event audit trail.",
  },
  {
    target: "promotion_heatmap",
    label: "Promotion heatmap",
    description: "Current promoted inventory by listing type.",
  },
  {
    target: "promotion_events",
    label: "Promotion events",
    description: "Promotion adds and removals in the active window.",
  },
  {
    target: "promoted_listings",
    label: "Promoted listings",
    description: "Current promoted inventory list and segment mix.",
  },
];

export const EXPORT_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  targets: MonetizationExportTarget[];
}> = [
  {
    id: "export-fees-30d",
    label: "Fees 30d",
    description: "Platform and delivery fee history exports using each panel's active 30-day view.",
    targets: ["platform_fee_history", "delivery_fee_history"],
  },
  {
    id: "export-promotion-activity",
    label: "Promotion Activity",
    description: "Promotion heatmap, recent event stream, and current promoted inventory.",
    targets: ["promotion_heatmap", "promotion_events", "promoted_listings"],
  },
  {
    id: "export-subscription-risk-review",
    label: "Subscription Risk Review",
    description: "Subscription summary plus the currently filtered subscription audit trail.",
    targets: ["subscription_summary", "subscription_history"],
  },
];

export default function MonetizationExportCenter() {
  const { preferences, setToolState } = useMonetizationPreferences();
  const { recordActivity } = useMonetizationActivity();
  const { isPinned, pinnedPresetIds, togglePinnedPreset } = useMonetizationPinnedPresets();
  const lastAction = preferences.toolState.exportLastAction;

  const workflowPresets = useMemo(
    () =>
      [...MONETIZATION_WORKFLOW_PRESETS].sort((left, right) => {
        const leftPinned = pinnedPresetIds.includes(left.id);
        const rightPinned = pinnedPresetIds.includes(right.id);
        if (leftPinned === rightPinned) {
          return 0;
        }
        return leftPinned ? -1 : 1;
      }),
    [pinnedPresetIds],
  );
  const exportPresets = useMemo(
    () =>
      [...EXPORT_PRESETS].sort((left, right) => {
        const leftPinned = pinnedPresetIds.includes(left.id);
        const rightPinned = pinnedPresetIds.includes(right.id);
        if (leftPinned === rightPinned) {
          return 0;
        }
        return leftPinned ? -1 : 1;
      }),
    [pinnedPresetIds],
  );

  const triggerPresetExport = async (label: string, targets: MonetizationExportTarget[]) => {
    await triggerMonetizationExportBundle(targets);
    setToolState((current) => ({ ...current, exportLastAction: `Exported ${label} bundle` }));
    recordActivity({
      kind: "export",
      label,
      summary: `Exported ${targets.length} CSV reports from the ${label} bundle.`,
      replay: {
        kind: "export",
        targets,
      },
    });
  };

  const applyWorkflowPreset = async (
    label: string,
    options: {
      subscriptionDetail?: (typeof SUBSCRIPTION_VIEW_PRESETS)[number]["detail"];
      promotionDetail?: (typeof PROMOTION_VIEW_PRESETS)[number]["detail"];
      targets: MonetizationExportTarget[];
    },
  ) => {
    await applyMonetizationWorkflow(options);
    setToolState((current) => ({
      ...current,
      exportLastAction: `Applied and exported ${label}`,
    }));
    recordActivity({
      kind: "workflow",
      label,
      summary: `Applied the saved investigation state and exported ${options.targets.length} matching reports.`,
      replay: {
        kind: "workflow",
        subscriptionDetail: options.subscriptionDetail,
        promotionDetail: options.promotionDetail,
        targets: options.targets,
      },
    });
  };

  return (
    <section id="monetization-export-center" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Export center</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Download monetization reports</h2>
          <p className="text-sm text-foreground/66">
            Trigger the existing CSV exports from one place without jumping between panels.
          </p>
          <p className="mt-1 text-[11px] text-foreground/52">
            Pin workflows and bundles to surface them in quick access, where you can reorder them.
          </p>
        </div>
        <p className="text-xs text-foreground/56">{lastAction ?? "Single reports and bundles use each panel's current filters."}</p>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {workflowPresets.map((preset) => (
          <div
            key={preset.id}
            className={`rounded-[1.6rem] border px-4 py-4 text-left transition ${
              isPinned(preset.id)
                ? "border-[#caa46a] bg-[#fff7eb]"
                : "border-[#6b8f72]/40 bg-[#eef8f0]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  void applyWorkflowPreset(preset.label, preset);
                }}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#44604a]">Saved workflow</p>
                <p className="mt-2 text-base font-semibold text-foreground">{preset.label}</p>
                <p className="mt-1 text-sm leading-6 text-foreground/68">{preset.description}</p>
                <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[#44604a]">
                  applies view + {preset.targets.length} exports
                </p>
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  isPinned(preset.id)
                    ? "border-[#caa46a] text-[#8a5a18] hover:bg-[#fff2dd]"
                    : "border-[#6b8f72]/40 text-[#44604a] hover:border-[#6b8f72]"
                }`}
                onClick={() => togglePinnedPreset(preset.id)}
              >
                {isPinned(preset.id) ? "Pinned" : "Pin"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {exportPresets.map((preset) => (
          <div
            key={preset.id}
            className={`rounded-[1.6rem] border px-4 py-4 text-left transition ${
              isPinned(preset.id)
                ? "border-[#caa46a] bg-[#fff7eb]"
                : "border-[#caa46a]/40 bg-[#fff7eb]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  void triggerPresetExport(preset.label, preset.targets);
                }}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#8a5a18]">Preset bundle</p>
                <p className="mt-2 text-base font-semibold text-foreground">{preset.label}</p>
                <p className="mt-1 text-sm leading-6 text-foreground/68">{preset.description}</p>
                <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[#8a5a18]">
                  {preset.targets.length} exports
                </p>
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  isPinned(preset.id)
                    ? "border-[#caa46a] text-[#8a5a18] hover:bg-[#fff2dd]"
                    : "border-border text-foreground/68 hover:border-foreground hover:text-foreground"
                }`}
                onClick={() => togglePinnedPreset(preset.id)}
              >
                {isPinned(preset.id) ? "Pinned" : "Pin"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {EXPORT_TARGETS.map((item) => (
          <button
            key={item.target}
            type="button"
            className="rounded-[1.5rem] border border-border/60 bg-background px-4 py-4 text-left transition hover:border-foreground/30 hover:bg-white"
              onClick={() => {
              triggerMonetizationExport(item.target);
              setToolState((current) => ({
                ...current,
                exportLastAction: `Exported ${item.label}`,
              }));
              recordActivity({
                kind: "export",
                label: item.label,
                summary: `Exported the ${item.label} CSV using the panel's current filters.`,
                replay: {
                  kind: "export",
                  targets: [item.target],
                },
              });
            }}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{item.label}</p>
            <p className="mt-2 text-sm font-semibold text-foreground">Export CSV</p>
            <p className="mt-1 text-sm leading-6 text-foreground/66">{item.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
