export type SubscriptionHistoryDirection =
  | "all"
  | "started"
  | "upgrade"
  | "downgrade"
  | "reactivated"
  | "lateral";

export type SubscriptionHistoryReason =
  | "all"
  | "trial_conversion"
  | "manual_upgrade"
  | "retention_save"
  | "support_adjustment"
  | "plan_reset";

export type SubscriptionHistoryWindowDays = 7 | 14 | 30;

export type SubscriptionHistoryFilterDetail = {
  direction: SubscriptionHistoryDirection;
  reason: SubscriptionHistoryReason;
  destructiveOnly?: boolean;
  destructiveType?: "all" | "value_drop" | "perk_removal";
  windowDays?: SubscriptionHistoryWindowDays;
};

export const SUBSCRIPTION_HISTORY_FILTER_EVENT = "admin:subscription-history-filter";
