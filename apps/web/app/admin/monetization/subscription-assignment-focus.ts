export type SubscriptionAssignmentFocusDetail = {
  sellerSlug?: string;
  tierId?: string;
  tierName?: string;
  reasonCode?: "trial_conversion" | "manual_upgrade" | "retention_save" | "support_adjustment" | "plan_reset";
};

export const SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT = "admin:subscription-assignment-focus";
