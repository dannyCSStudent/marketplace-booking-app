import type { PromotionListingTypeFilter } from "@/app/admin/monetization/promotion-listing-focus";

export type PromotionDashboardWindowDays = 7 | 14 | 30;
export type PromotionDashboardStatusFilter = "all" | "promoted" | "removed";
export type PromotionDashboardSegmentFilter = "all" | "multi_listing_sellers" | "single_listing_sellers";

export type PromotionDashboardFilterDetail = {
  windowDays?: PromotionDashboardWindowDays;
  statusFilter?: PromotionDashboardStatusFilter;
  typeFilter?: PromotionListingTypeFilter;
  segmentFilter?: PromotionDashboardSegmentFilter;
};

export const PROMOTION_DASHBOARD_FILTER_EVENT = "admin:promotion-dashboard-filter";
