export type MonetizationExportTarget =
  | "platform_fee_history"
  | "delivery_fee_history"
  | "subscription_summary"
  | "subscription_history"
  | "promotion_heatmap"
  | "promotion_events"
  | "promoted_listings";

export type MonetizationExportDetail = {
  target: MonetizationExportTarget;
};

export const MONETIZATION_EXPORT_EVENT = "admin:monetization-export";
