import type { SellerSubscriptionEventRead } from "@/app/lib/api";
import type {
  SubscriptionHistoryFilterDetail,
  SubscriptionHistoryReason,
} from "@/app/admin/monetization/subscription-history-filters";

export const SUBSCRIPTION_REASON_OPTIONS: Array<{
  value: SubscriptionHistoryReason;
  label: string;
}> = [
  { value: "all", label: "All reasons" },
  { value: "trial_conversion", label: "Trial conversion" },
  { value: "manual_upgrade", label: "Manual upgrade" },
  { value: "retention_save", label: "Retention save" },
  { value: "support_adjustment", label: "Support adjustment" },
  { value: "plan_reset", label: "Plan reset" },
];

export const SUBSCRIPTION_ASSIGNMENT_REASON_OPTIONS = SUBSCRIPTION_REASON_OPTIONS.filter(
  (option) => option.value !== "all",
);

export function getSubscriptionReasonFilterFromLabel(
  label: string,
): SubscriptionHistoryFilterDetail["reason"] {
  const matched = SUBSCRIPTION_REASON_OPTIONS.find((option) => option.label === label);
  return matched?.value ?? "all";
}

export function formatSubscriptionReasonLabel(
  reason: SellerSubscriptionEventRead["reason_code"] | "all" | null | undefined,
) {
  const matched = SUBSCRIPTION_REASON_OPTIONS.find((option) => option.value === reason);
  return matched?.label ?? "Unspecified";
}

export function formatSubscriptionDirectionLabel(
  direction: SellerSubscriptionEventRead["action"],
) {
  if (direction === "upgrade") {
    return "Upgrade";
  }
  if (direction === "downgrade") {
    return "Downgrade";
  }
  if (direction === "reactivated") {
    return "Reactivated";
  }
  if (direction === "lateral") {
    return "Lateral move";
  }
  return "Started";
}

export function escapeCsvValue(value: string | number | boolean | null | undefined) {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }
  return normalized;
}
