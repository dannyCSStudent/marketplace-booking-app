import "server-only";

import { unstable_cache } from "next/cache";

import type {
  Listing,
  ReviewRead,
  SellerListingSummary,
  SellerProfile,
  SellerSubscriptionRead,
} from "@repo/api-client";
import { createApiClient } from "@repo/api-client";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const INITIAL_LISTINGS_PAGE_SIZE = 12;

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function getServerApiBaseUrl() {
  return process.env.INTERNAL_API_BASE_URL ?? getApiBaseUrl();
}

type MarketplaceData = {
  seller: SellerProfile | null;
  sellerListingSummary: SellerListingSummary | null;
  listings: Listing[];
  listingsTotal: number;
  apiBaseUrl: string;
};

export type SellerStorefrontData = {
  seller: SellerProfile | null;
  sellerListingSummary: SellerListingSummary | null;
  subscription: SellerSubscriptionRead | null;
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

async function loadMarketplaceData(): Promise<MarketplaceData> {
  const api = createApiClient(getServerApiBaseUrl());
  const sellerPromise: Promise<SellerProfile | null> = api
    .getSellerBySlug("south-dallas-tamales", { cache: "no-store" })
    .catch(() => null);
  const sellerListingSummaryPromise: Promise<SellerListingSummary | null> = api
    .getSellerListingSummaryBySlug("south-dallas-tamales", { cache: "no-store" })
    .catch(() => null);
  const listingsPromise: Promise<{ items: Listing[]; total: number } | null> = api
    .getSellerListingsBySlug(
      "south-dallas-tamales",
      { cache: "no-store" },
      { limit: INITIAL_LISTINGS_PAGE_SIZE, offset: 0 },
    )
    .catch(() => null);
  const [seller, sellerListingSummary, listings] = await Promise.all([
    sellerPromise,
    sellerListingSummaryPromise,
    listingsPromise,
  ]);

  return {
    seller,
    sellerListingSummary,
    listings: listings?.items ?? [],
    listingsTotal: sellerListingSummary?.total ?? listings?.total ?? 0,
    apiBaseUrl: getApiBaseUrl(),
  };
}

async function loadSellerStorefrontData(slug: string): Promise<SellerStorefrontData> {
  const api = createApiClient(getServerApiBaseUrl());
  const seller = await api.getSellerBySlug(slug, { cache: "no-store" }).catch(() => null);

  if (!seller) {
    return {
      seller: null,
      sellerListingSummary: null,
      subscription: null,
      listings: [],
      reviews: [],
      apiBaseUrl: getApiBaseUrl(),
    };
  }

  const [sellerListingSummary, listingResponse, reviews, subscription] = await Promise.all([
    api.getSellerListingSummaryBySlug(slug, { cache: "no-store" }).catch(() => null),
    api
      .getSellerListingsBySlug(slug, { cache: "no-store" }, { limit: INITIAL_LISTINGS_PAGE_SIZE, offset: 0 })
      .catch(() => ({ items: [], total: 0 })),
    api.getSellerReviewsBySlug(slug, { cache: "no-store" }).catch(() => []),
    api.getSellerSubscriptionBySlug(slug, { cache: "no-store" }).catch(() => null),
  ]);

  return {
    seller,
    sellerListingSummary,
    subscription,
    listings: listingResponse.items,
    reviews,
    apiBaseUrl: getApiBaseUrl(),
  };
}

async function loadListingDetailData(listingId: string): Promise<ListingDetailData> {
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
    .getSellerById(listing.seller_id, { cache: "no-store" })
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

const getMarketplaceDataCached = unstable_cache(loadMarketplaceData, ["marketplace-data"], {
  revalidate: 60,
  tags: ["marketplace-data"],
});

const getSellerStorefrontDataCached = (slug: string) =>
  unstable_cache(
    () => loadSellerStorefrontData(slug),
    ["seller-storefront-data", slug],
    { revalidate: 60, tags: ["seller-storefront-data", `seller-storefront-data:${slug}`] },
  )();

const getListingDetailDataCached = (listingId: string) =>
  unstable_cache(
    () => loadListingDetailData(listingId),
    ["listing-detail-data", listingId],
    { revalidate: 30, tags: ["listing-detail-data", `listing-detail-data:${listingId}`] },
  )();

export async function getMarketplaceData(): Promise<MarketplaceData> {
  return getMarketplaceDataCached();
}

export async function getSellerStorefrontData(slug: string): Promise<SellerStorefrontData> {
  return getSellerStorefrontDataCached(slug);
}

export async function getListingDetailData(listingId: string): Promise<ListingDetailData> {
  return getListingDetailDataCached(listingId);
}
