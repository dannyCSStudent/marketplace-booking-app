import { EXPORT_PRESETS } from "@/app/admin/monetization/monetization-export-center";
import {
  MONETIZATION_WORKFLOW_PRESETS,
  PROMOTION_VIEW_PRESETS,
  SUBSCRIPTION_VIEW_PRESETS,
} from "@/app/admin/monetization/monetization-dashboard-presets";
import type { MonetizationActivityReplay } from "@/app/admin/monetization/monetization-preferences-types";

export const ALL_MONETIZATION_PRESETS = [
  ...EXPORT_PRESETS.map((preset) => ({
    ...preset,
    kind: "export_bundle" as const,
  })),
  ...MONETIZATION_WORKFLOW_PRESETS.map((preset) => ({
    ...preset,
    kind: "workflow" as const,
  })),
  ...SUBSCRIPTION_VIEW_PRESETS.map((preset) => ({
    ...preset,
    kind: "subscription_view" as const,
  })),
  ...PROMOTION_VIEW_PRESETS.map((preset) => ({
    ...preset,
    kind: "promotion_view" as const,
  })),
];

export function getMonetizationPresetById(id: string) {
  return ALL_MONETIZATION_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function getMonetizationPresetSourceSectionId(
  kind: (typeof ALL_MONETIZATION_PRESETS)[number]["kind"],
) {
  return kind === "subscription_view" || kind === "promotion_view"
    ? "monetization-view-presets"
    : "monetization-export-center";
}

export function getMonetizationPresetSourceLabel(
  kind: (typeof ALL_MONETIZATION_PRESETS)[number]["kind"],
) {
  return kind === "subscription_view" || kind === "promotion_view" ? "Saved views" : "Export center";
}

function stringifyForMatch(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function getMonetizationPresetIdForReplay(replay: MonetizationActivityReplay) {
  if (replay.kind === "export") {
    const targets = stringifyForMatch(replay.targets);
    return (
      EXPORT_PRESETS.find((preset) => stringifyForMatch(preset.targets) === targets)?.id ?? null
    );
  }

  if (replay.kind === "workflow") {
    const subscriptionDetail = stringifyForMatch(replay.subscriptionDetail);
    const promotionDetail = stringifyForMatch(replay.promotionDetail);
    const targets = stringifyForMatch(replay.targets);
    return (
      MONETIZATION_WORKFLOW_PRESETS.find(
        (preset) =>
          stringifyForMatch(preset.subscriptionDetail) === subscriptionDetail &&
          stringifyForMatch(preset.promotionDetail) === promotionDetail &&
          stringifyForMatch(preset.targets) === targets,
      )?.id ?? null
    );
  }

  if (replay.subscriptionDetail) {
    const detail = stringifyForMatch(replay.subscriptionDetail);
    return (
      SUBSCRIPTION_VIEW_PRESETS.find((preset) => stringifyForMatch(preset.detail) === detail)?.id ??
      null
    );
  }

  if (replay.promotionDetail) {
    const detail = stringifyForMatch(replay.promotionDetail);
    return (
      PROMOTION_VIEW_PRESETS.find((preset) => stringifyForMatch(preset.detail) === detail)?.id ??
      null
    );
  }

  return null;
}

function getMonetizationPresetKindRank(kind: (typeof ALL_MONETIZATION_PRESETS)[number]["kind"]) {
  if (kind === "workflow") {
    return 0;
  }
  if (kind === "subscription_view") {
    return 1;
  }
  if (kind === "promotion_view") {
    return 2;
  }
  return 3;
}

export function sortMonetizationPresetIdsByDefaultOrder(ids: string[]) {
  return [...ids].sort((leftId, rightId) => {
    const leftPreset = getMonetizationPresetById(leftId);
    const rightPreset = getMonetizationPresetById(rightId);

    if (!leftPreset && !rightPreset) {
      return leftId.localeCompare(rightId);
    }
    if (!leftPreset) {
      return 1;
    }
    if (!rightPreset) {
      return -1;
    }

    const kindDelta = getMonetizationPresetKindRank(leftPreset.kind) - getMonetizationPresetKindRank(rightPreset.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return leftPreset.label.localeCompare(rightPreset.label);
  });
}
