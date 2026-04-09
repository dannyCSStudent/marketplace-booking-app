"use client";

import type { MonetizationExportTarget } from "@/app/admin/monetization/monetization-export-events";
import type {
  PromotionDashboardFilterDetail,
  PromotionDashboardSegmentFilter,
  PromotionDashboardStatusFilter,
  PromotionDashboardWindowDays,
} from "@/app/admin/monetization/promotion-dashboard-filters";
import type { PromotionListingTypeFilter } from "@/app/admin/monetization/promotion-listing-focus";
import type {
  SubscriptionHistoryFilterDetail,
  SubscriptionHistoryDirection,
  SubscriptionHistoryReason,
  SubscriptionHistoryWindowDays,
} from "@/app/admin/monetization/subscription-history-filters";

export type QuickAccessFilter = "all" | "views" | "workflows" | "exports";

export type MonetizationActivityKind = "saved_view" | "export" | "workflow";

export type MonetizationActivityReplay =
  | {
      kind: "saved_view";
      subscriptionDetail?: SubscriptionHistoryFilterDetail;
      promotionDetail?: PromotionDashboardFilterDetail;
    }
  | {
      kind: "export";
      targets: MonetizationExportTarget[];
    }
  | {
      kind: "workflow";
      subscriptionDetail?: SubscriptionHistoryFilterDetail;
      promotionDetail?: PromotionDashboardFilterDetail;
      targets: MonetizationExportTarget[];
    };

export type MonetizationActivityEntry = {
  id: string;
  kind: MonetizationActivityKind;
  label: string;
  summary: string;
  createdAt: string;
  replay?: MonetizationActivityReplay;
};

export type SubscriptionHistoryPreferences = {
  direction: SubscriptionHistoryDirection;
  reason: SubscriptionHistoryReason;
  destructiveOnly: boolean;
  destructiveType: "all" | "value_drop" | "perk_removal";
  windowDays: SubscriptionHistoryWindowDays;
};

export type PromotionDashboardPreferences = {
  windowDays: PromotionDashboardWindowDays;
  statusFilter: PromotionDashboardStatusFilter;
  typeFilter: PromotionListingTypeFilter;
  segmentFilter: PromotionDashboardSegmentFilter;
};

export type SubscriptionAssignmentDraft = {
  sellerSlug: string;
  selectedTierId: string;
  reasonCode: string;
  note: string;
};

export type MonetizationToolState = {
  exportLastAction: string | null;
  viewLastPreset: string | null;
  quickAccessLastUsedPresetId: string | null;
  dismissedWatchlistAlertSignatures: Record<string, string>;
  lastWatchlistViewedAt: string | null;
  watchlistSeverityFilter: "all" | "high" | "medium" | "monitor";
  watchlistCollapsed: boolean;
  watchlistNewOnly: boolean;
  watchlistLastActionSummary: string | null;
  watchlistLastActionAt: string | null;
  watchlistLastActionReplayKey:
    | "subscription_destructive"
    | "subscription_downgrade"
    | "promotion_removals"
    | "promoted_listings"
    | null;
  activityLogViewFilter: "all" | "watchlist";
  activityLogEntryLimit: 6 | 10;
  activityLogCollapsedGroups: string[];
};

export type MonetizationPreferences = {
  pinnedPresetIds: string[];
  quickAccessFilter: QuickAccessFilter;
  activityLog: MonetizationActivityEntry[];
  subscriptionHistory: SubscriptionHistoryPreferences;
  promotionDashboard: PromotionDashboardPreferences;
  subscriptionAssignmentDraft: SubscriptionAssignmentDraft;
  toolState: MonetizationToolState;
};
