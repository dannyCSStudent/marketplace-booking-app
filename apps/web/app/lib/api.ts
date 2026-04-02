import { ApiError, apiRoutes, buildNotifications, createApiClient } from "@repo/api-client";
import type { Listing, SellerProfile } from "@repo/api-client";
export { formatCurrency } from "@repo/api-client";
export { ApiError, apiRoutes, buildNotifications, createApiClient };
export type {
  Booking,
  Listing,
  ListingCreateInput,
  ListingUpdateInput,
  ListingResponse,
  NotificationItem,
  NotificationDelivery,
  Order,
  Profile,
  ProfilePayload,
  ProfileUpdateInput,
  SellerCreateInput,
  SellerProfile,
  SellerWorkspaceData,
} from "@repo/api-client";

type MarketplaceData = {
  seller: SellerProfile | null;
  listings: Listing[];
  listingsTotal: number;
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
