export type PromotionListingTypeFilter = "all" | "product" | "service" | "hybrid" | "unknown";

export type PromotionListingFocusDetail = {
  type?: PromotionListingTypeFilter;
};

export const PROMOTION_LISTING_FOCUS_EVENT = "admin:promotion-listing-focus";
