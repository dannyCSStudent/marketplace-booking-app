"use client";

import { useMemo } from "react";

import {
  applyPromotionDashboardFilter,
  applySubscriptionHistoryFilter,
} from "@/app/admin/monetization/monetization-activity-actions";
import {
  PROMOTION_VIEW_PRESETS,
  SUBSCRIPTION_VIEW_PRESETS,
} from "@/app/admin/monetization/monetization-dashboard-presets";
import { useMonetizationActivity } from "@/app/admin/monetization/monetization-activity-context";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { useMonetizationPinnedPresets } from "@/app/admin/monetization/monetization-pinned-presets-context";
import { type SubscriptionHistoryFilterDetail } from "@/app/admin/monetization/subscription-history-filters";
import { type PromotionDashboardFilterDetail } from "@/app/admin/monetization/promotion-dashboard-filters";

export default function MonetizationViewPresets() {
  const { preferences, setToolState } = useMonetizationPreferences();
  const { recordActivity } = useMonetizationActivity();
  const { isPinned, pinnedPresetIds, togglePinnedPreset } = useMonetizationPinnedPresets();
  const lastPreset = preferences.toolState.viewLastPreset;

  const subscriptionPresets = useMemo(
    () =>
      [...SUBSCRIPTION_VIEW_PRESETS].sort((left, right) => {
        const leftPinned = pinnedPresetIds.includes(left.id);
        const rightPinned = pinnedPresetIds.includes(right.id);
        if (leftPinned === rightPinned) {
          return 0;
        }
        return leftPinned ? -1 : 1;
      }),
    [pinnedPresetIds],
  );
  const promotionPresets = useMemo(
    () =>
      [...PROMOTION_VIEW_PRESETS].sort((left, right) => {
        const leftPinned = pinnedPresetIds.includes(left.id);
        const rightPinned = pinnedPresetIds.includes(right.id);
        if (leftPinned === rightPinned) {
          return 0;
        }
        return leftPinned ? -1 : 1;
      }),
    [pinnedPresetIds],
  );

  const applySubscriptionPreset = (label: string, detail: SubscriptionHistoryFilterDetail) => {
    applySubscriptionHistoryFilter(detail);
    setToolState((current) => ({ ...current, viewLastPreset: `Applied ${label}` }));
    recordActivity({
      kind: "saved_view",
      label,
      summary: `Applied a subscription dashboard view with reason and destructive filters updated in the audit panel.`,
      replay: {
        kind: "saved_view",
        subscriptionDetail: detail,
      },
    });
  };

  const applyPromotionPreset = (label: string, detail: PromotionDashboardFilterDetail) => {
    applyPromotionDashboardFilter(detail);
    setToolState((current) => ({ ...current, viewLastPreset: `Applied ${label}` }));
    recordActivity({
      kind: "saved_view",
      label,
      summary: `Applied a promotion dashboard view with updated time window, activity status, and listing focus filters.`,
      replay: {
        kind: "saved_view",
        promotionDetail: detail,
      },
    });
  };

  return (
    <section id="monetization-view-presets" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Saved views</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Open common investigation states</h2>
          <p className="text-sm text-foreground/66">
            Apply preset filters to the subscription and promotion sections before reviewing or exporting.
          </p>
          <p className="mt-1 text-[11px] text-foreground/52">
            Pin views to add them to quick access, where they can be reordered and re-run faster.
          </p>
        </div>
        <p className="text-xs text-foreground/56">{lastPreset ?? "Presets update the live dashboard state."}</p>
      </div>
      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <div className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">Subscriptions</p>
          {subscriptionPresets.map((preset) => (
            <div
              key={preset.id}
              className={`rounded-[1.5rem] border px-4 py-4 transition ${
                isPinned(preset.id)
                  ? "border-[#caa46a]/50 bg-[#fff7eb]"
                  : "border-border/60 bg-background"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => applySubscriptionPreset(preset.label, preset.detail)}
                >
                  <p className="text-sm font-semibold text-foreground">{preset.label}</p>
                  <p className="mt-1 text-sm leading-6 text-foreground/66">{preset.description}</p>
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
        <div className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">Promotions</p>
          {promotionPresets.map((preset) => (
            <div
              key={preset.id}
              className={`rounded-[1.5rem] border px-4 py-4 transition ${
                isPinned(preset.id)
                  ? "border-[#caa46a]/50 bg-[#fff7eb]"
                  : "border-border/60 bg-background"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => applyPromotionPreset(preset.label, preset.detail)}
                >
                  <p className="text-sm font-semibold text-foreground">{preset.label}</p>
                  <p className="mt-1 text-sm leading-6 text-foreground/66">{preset.description}</p>
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
      </div>
    </section>
  );
}
