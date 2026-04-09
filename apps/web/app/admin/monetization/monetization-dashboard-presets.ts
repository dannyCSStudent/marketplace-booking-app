import type { MonetizationExportTarget } from "@/app/admin/monetization/monetization-export-events";
import type { PromotionDashboardFilterDetail } from "@/app/admin/monetization/promotion-dashboard-filters";
import type { SubscriptionHistoryFilterDetail } from "@/app/admin/monetization/subscription-history-filters";

export const SUBSCRIPTION_VIEW_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  detail: SubscriptionHistoryFilterDetail;
}> = [
  {
    id: "subscription-retention-saves",
    label: "Retention saves",
    description: "Jump to retention-driven subscription changes over the last 30 days.",
    detail: { direction: "all", reason: "retention_save", windowDays: 30 },
  },
  {
    id: "subscription-destructive-changes",
    label: "Destructive changes",
    description: "Open the destructive-only subscription review queue for the last 30 days.",
    detail: { direction: "all", reason: "all", destructiveOnly: true, windowDays: 30 },
  },
  {
    id: "subscription-value-drops-14d",
    label: "Value drops 14d",
    description: "Focus the audit trail on pricing-related destructive changes in the last 14 days.",
    detail: {
      direction: "all",
      reason: "all",
      destructiveOnly: true,
      destructiveType: "value_drop",
      windowDays: 14,
    },
  },
];

export const PROMOTION_VIEW_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  detail: PromotionDashboardFilterDetail;
}> = [
  {
    id: "promotion-removals",
    label: "Promotion removals",
    description: "Review removals over the last 14 days and keep the listings panel broad.",
    detail: { windowDays: 14, statusFilter: "removed", typeFilter: "all", segmentFilter: "all" },
  },
  {
    id: "promotion-adds",
    label: "Promotion adds",
    description: "Focus the promotion stream on newly boosted listings in the last 14 days.",
    detail: { windowDays: 14, statusFilter: "promoted", typeFilter: "all", segmentFilter: "all" },
  },
  {
    id: "promotion-service-pressure",
    label: "Service promotion pressure",
    description: "Shift the promotion views to service inventory and recent activity.",
    detail: { windowDays: 30, statusFilter: "all", typeFilter: "service", segmentFilter: "all" },
  },
];

export const MONETIZATION_WORKFLOW_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  subscriptionDetail?: SubscriptionHistoryFilterDetail;
  promotionDetail?: PromotionDashboardFilterDetail;
  targets: MonetizationExportTarget[];
}> = [
  {
    id: "workflow-subscription-risk-review",
    label: "Subscription risk review",
    description: "Apply destructive subscription filters and export the matching summary plus audit trail.",
    subscriptionDetail: { direction: "all", reason: "all", destructiveOnly: true, windowDays: 30 },
    targets: ["subscription_summary", "subscription_history"],
  },
  {
    id: "workflow-retention-saves-review",
    label: "Retention saves review",
    description: "Focus on retention-driven subscription changes and export the filtered subscription reports.",
    subscriptionDetail: { direction: "all", reason: "retention_save", windowDays: 30 },
    targets: ["subscription_summary", "subscription_history"],
  },
  {
    id: "workflow-promotion-removals-review",
    label: "Promotion removals review",
    description: "Switch the promotion section to recent removals and export the matching promotion bundle.",
    promotionDetail: { windowDays: 14, statusFilter: "removed", typeFilter: "all", segmentFilter: "all" },
    targets: ["promotion_heatmap", "promotion_events", "promoted_listings"],
  },
];
