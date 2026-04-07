import { ApiError, apiRoutes, buildNotifications, createApiClient } from "@repo/api-client";
import type { Listing, ReviewRead, SellerProfile } from "@repo/api-client";
export { formatCurrency } from "@repo/api-client";
export { ApiError, apiRoutes, buildNotifications, createApiClient };
export type {
  AdminUser,
  CategoryRead,
  BookingAdmin,
  Booking,
  Listing,
  ListingType,
  ListingImage,
  ListingCreateInput,
  ListingImageCreateInput,
  ListingImageUploadCreateInput,
  ListingUpdateInput,
  ListingAiAssistRequest,
  ListingAiAssistResponse,
  ListingAiAssistSuggestion,
  ListingPriceInsight,
  ListingPricingScopeCount,
  ListingResponse,
  PlatformFeeRateRead,
  NotificationItem,
  NotificationDelivery,
  OrderAdmin,
  Order,
  OrderAdminSupportUpdateInput,
  BookingAdminSupportUpdateInput,
  Profile,
  ProfilePayload,
  ProfileUpdateInput,
  ReviewCreateInput,
  ReviewLookup,
  ReviewModerationItem,
  ReviewReportCreateInput,
  ReviewReportRead,
  ReviewRead,
  ReviewSellerResponseUpdateInput,
  SellerCreateInput,
  SellerProfile,
  SellerWorkspaceData,
  ListingPromotionDetail,
  ListingPromotionSummary,
  ListingPromotionEvent,
  PlatformFeeHistoryPoint,
} from "@repo/api-client";

type MarketplaceData = {
  seller: SellerProfile | null;
  listings: Listing[];
  listingsTotal: number;
  apiBaseUrl: string;
};

export type SellerStorefrontData = {
  seller: SellerProfile | null;
  listings: Listing[];
  reviews: ReviewRead[];
  apiBaseUrl: string;
};

export type ListingDetailData = {
  listing: Listing | null;
  seller: SellerProfile | null;
  reviews: ReviewRead[];
  apiBaseUrl: string;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function getServerApiBaseUrl() {
  return process.env.INTERNAL_API_BASE_URL ?? getApiBaseUrl();
}

export async function getMarketplaceData(): Promise<MarketplaceData> {
  const api = createApiClient(getServerApiBaseUrl());
  const sellerPromise: Promise<SellerProfile | null> = api.getSellerBySlug(
    "south-dallas-tamales",
    { cache: "no-store" },
  ).catch(() => null);
  const listingsPromise: Promise<{ items: Listing[]; total: number } | null> = api
    .get<{ items: Listing[]; total: number }>("/listings", { cache: "no-store" })
    .catch(() => null);
  const [seller, listings] = await Promise.all([
    sellerPromise,
    listingsPromise,
  ]);

  return {
    seller,
    listings: listings?.items ?? [],
    listingsTotal: listings?.total ?? 0,
    apiBaseUrl: getApiBaseUrl(),
  };
}

export async function getSellerStorefrontData(slug: string): Promise<SellerStorefrontData> {
  const api = createApiClient(getServerApiBaseUrl());
  const seller = await api.getSellerBySlug(slug, { cache: "no-store" }).catch(() => null);

  if (!seller) {
    return {
      seller: null,
      listings: [],
      reviews: [],
      apiBaseUrl: getApiBaseUrl(),
    };
  }

  const [listings, reviews] = await Promise.all([
    api
      .get<{ items: Listing[]; total: number }>("/listings", { cache: "no-store" })
      .then((response) => response.items.filter((listing) => listing.seller_id === seller.id))
      .catch(() => []),
    api.getSellerReviewsBySlug(slug, { cache: "no-store" }).catch(() => []),
  ]);

  return {
    seller,
    listings,
    reviews,
    apiBaseUrl: getApiBaseUrl(),
  };
}

export async function getListingDetailData(listingId: string): Promise<ListingDetailData> {
  const api = createApiClient(getServerApiBaseUrl());
  const listing = await api.getListingById(listingId, { cache: "no-store" }).catch(() => null);

  if (!listing) {
    return {
      listing: null,
      seller: null,
      reviews: [],
      apiBaseUrl: getApiBaseUrl(),
    };
  }

  const seller = (await api
    .get<{ items: Listing[]; total: number }>("/listings", { cache: "no-store" })
    .then(async (response) => {
      const ownerListing = response.items.find((item) => item.id === listing.id);
      if (!ownerListing) {
        return null;
      }

      const storefrontCandidates = await Promise.all([
        api.getSellerBySlug("south-dallas-tamales", { cache: "no-store" }).catch(() => null),
      ]);
      return storefrontCandidates.find((candidate) => candidate?.id === ownerListing.seller_id) ?? null;
    })
    .catch(() => null)) as SellerProfile | null;

  const reviews = seller?.slug
    ? await api.getSellerReviewsBySlug(seller.slug, { cache: "no-store" }).catch(() => [])
    : [];

  return {
    listing,
    seller,
    reviews,
    apiBaseUrl: getApiBaseUrl(),
  };
}
