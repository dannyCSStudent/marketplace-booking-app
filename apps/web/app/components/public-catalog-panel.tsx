"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createApiClient, formatCurrency, type Booking, type Listing, type ListingType, type Order } from "@/app/lib/api";
import { restoreBuyerSession } from "@/app/lib/buyer-auth";

type CatalogTypeFilter = "all" | ListingType;
type CatalogSort = "featured" | "price_low" | "price_high";

const RECENTLY_VIEWED_LISTINGS_KEY = "buyer_recently_viewed_listings";
const LAST_CATALOG_SLICE_KEY = "buyer_last_catalog_slice";
const SELLER_STOREFRONT_LANE_HISTORY_KEY_PREFIX = "seller_storefront_recent_lanes";
const CATALOG_PAGE_SIZE = 12;

type CatalogSliceSnapshot = {
  type: CatalogTypeFilter;
  query: string;
  category: string;
  sort: CatalogSort;
  localOnly: boolean;
  availableToday: boolean;
  quickBookingOnly: boolean;
  popularOnly: boolean;
  promotedOnly: boolean;
};

type SellerStorefrontLaneEntry = {
  label: string;
  snapshot: CatalogSliceSnapshot;
  summary: string;
  createdAt: string;
};

type SellerStorefrontLaneGroup = {
  label: string;
  tone: string;
  entries: SellerStorefrontLaneEntry[];
};

function getLocationLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ") || "Location pending";
}

function getListingSignals(listing: {
  pickup_enabled?: boolean;
  meetup_enabled?: boolean;
  delivery_enabled?: boolean;
  shipping_enabled?: boolean;
  requires_booking?: boolean;
  is_local_only?: boolean;
}) {
  const fulfillment = [
    listing.pickup_enabled ? "Pickup" : null,
    listing.meetup_enabled ? "Meetup" : null,
    listing.delivery_enabled ? "Delivery" : null,
    listing.shipping_enabled ? "Shipping" : null,
  ].filter(Boolean);

  return {
    booking: listing.requires_booking ? "Booking Ready" : "Order Ready",
    local: listing.is_local_only ? "Local Only" : "Wider Reach",
    fulfillment: fulfillment.length > 0 ? fulfillment.join(" · ") : "Fulfillment pending",
  };
}

function getBookingContextLabels(listing: {
  type: string;
  requires_booking?: boolean;
  duration_minutes?: number | null;
  lead_time_hours?: number | null;
}) {
  const labels: string[] = [];
  const supportsBooking = Boolean(listing.requires_booking || listing.type !== "product");

  if (!supportsBooking) {
    return labels;
  }

  if (listing.duration_minutes) {
    labels.push(`${listing.duration_minutes} min session`);
  }

  if (typeof listing.lead_time_hours === "number") {
    labels.push(
      listing.lead_time_hours > 0
        ? `${listing.lead_time_hours} hr notice`
        : "Same-day booking",
    );
  }

  return labels;
}

function getQuickBookingCue(listing: {
  type: string;
  requires_booking?: boolean;
  available_today?: boolean | null;
  lead_time_hours?: number | null;
}) {
  const supportsBooking = Boolean(listing.requires_booking || listing.type !== "product");

  if (!supportsBooking) {
    return null;
  }

  if (listing.available_today || listing.lead_time_hours === 0) {
    return {
      label: "Best for quick booking",
      className: "border border-emerald-300 bg-emerald-50 text-emerald-800",
    };
  }

  if (typeof listing.lead_time_hours === "number" && listing.lead_time_hours <= 4) {
    return {
      label: "Low-notice booking",
      className: "border border-sky-300 bg-sky-50 text-sky-800",
    };
  }

  return null;
}

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getListingSearchScore(listing: Listing, normalizedQuery: string) {
  if (!normalizedQuery) {
    return 0;
  }

  const title = listing.title.toLowerCase();
  const slug = listing.slug.toLowerCase();
  const description = listing.description?.toLowerCase() ?? "";
  const category = listing.category?.toLowerCase() ?? "";
  const location = [listing.city, listing.state, listing.country]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const type = listing.type.toLowerCase();

  let score = 0;
  if (title === normalizedQuery) {
    score += 120;
  } else if (title.startsWith(normalizedQuery)) {
    score += 80;
  } else if (title.includes(normalizedQuery)) {
    score += 60;
  }
  if (slug.startsWith(normalizedQuery)) {
    score += 50;
  } else if (slug.includes(normalizedQuery)) {
    score += 30;
  }
  if (location.startsWith(normalizedQuery)) {
    score += 35;
  } else if (location.includes(normalizedQuery)) {
    score += 20;
  }
  if (type === normalizedQuery) {
    score += 18;
  } else if (type.includes(normalizedQuery)) {
    score += 10;
  }
  if (category === normalizedQuery) {
    score += 22;
  } else if (category.includes(normalizedQuery)) {
    score += 12;
  }
  if (description.includes(normalizedQuery)) {
    score += 8;
  }

  return score;
}

function getSuggestedSearches(listings: Listing[], normalizedQuery: string) {
  const suggestions = new Map<string, number>();

  const pushSuggestion = (label: string | null | undefined, weight: number) => {
    const normalized = label?.trim();
    if (!normalized) {
      return;
    }

    if (normalizedQuery && normalized.toLowerCase().includes(normalizedQuery)) {
      return;
    }

    suggestions.set(normalized, (suggestions.get(normalized) ?? 0) + weight);
  };

  listings.forEach((listing) => {
    pushSuggestion(listing.city ?? null, 3);
    pushSuggestion(listing.state ?? null, 2);
    pushSuggestion(listing.category ?? null, 3);
    pushSuggestion(titleCaseLabel(listing.type), 2);

    const titleTokens = listing.title.match(/[A-Za-z0-9&'-]{4,}/g) ?? [];
    titleTokens.slice(0, 3).forEach((token) => {
      pushSuggestion(token, 1);
    });
  });

  return [...suggestions.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([label]) => label);
}

function getCategoryOptions(listings: Listing[]) {
  const counts = new Map<string, number>();

  listings.forEach((listing) => {
    const label = listing.category?.trim();
    if (!label) {
      return;
    }

    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => ({ label, count }));
}

function getRecommendedBrowsePreset(input: {
  orders: Order[];
  bookings: Booking[];
}) {
  const productScore = input.orders.reduce((count, order) => {
    return (
      count +
      (order.items ?? []).filter(
        (item) => item.listing_type === "product" || item.listing_type === "hybrid",
      ).length
    );
  }, 0);

  const serviceScore = input.bookings.filter(
    (booking) => booking.listing_type === "service" || booking.listing_type === "hybrid",
  ).length;

  const localScore =
    input.orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) =>
        Boolean(item.is_local_only),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) => booking.is_local_only).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        item.listing_type === "hybrid",
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) => booking.listing_type === "hybrid").length;

  if (localScore >= Math.max(productScore, serviceScore, hybridScore) && localScore > 0) {
    return { type: "all" as const, localOnly: true, label: "Local-First" };
  }

  if (serviceScore >= Math.max(productScore, hybridScore) && serviceScore > 0) {
    return { type: "service" as const, localOnly: false, label: "Services" };
  }

  if (hybridScore >= Math.max(productScore, serviceScore) && hybridScore > 0) {
    return { type: "hybrid" as const, localOnly: false, label: "Hybrid" };
  }

  if (productScore > 0) {
    return { type: "product" as const, localOnly: false, label: "Products" };
  }

  return null;
}

function getRecommendationBadge(
  listing: Pick<Listing, "type" | "is_local_only">,
  preset: { label: string } | null,
) {
  if (!preset) {
    return null;
  }

  if (preset.label === "Local-First" && listing.is_local_only) {
    return {
      text: "Recommended for local activity",
      className: "border-[#0f5f62]/20 bg-[#e4f1ed] text-[#0f5f62]",
    };
  }

  if (
    preset.label === "Services" &&
    (listing.type === "service" || listing.type === "hybrid")
  ) {
    return {
      text: "Matches your service activity",
      className: "border-sky-300 bg-sky-50 text-sky-800",
    };
  }

  if (
    preset.label === "Products" &&
    (listing.type === "product" || listing.type === "hybrid")
  ) {
    return {
      text: "Matches your product activity",
      className: "border-amber-300 bg-amber-50 text-amber-800",
    };
  }

  if (preset.label === "Hybrid" && listing.type === "hybrid") {
    return {
      text: "Matches your hybrid activity",
      className: "border-[#b7924f] bg-[#f6ecdb] text-[#7a5717]",
    };
  }

  return null;
}

function getRecommendationScore(
  listing: Pick<Listing, "type" | "is_local_only">,
  preset: { label: string } | null,
) {
  if (!preset) {
    return 0;
  }

  if (preset.label === "Local-First" && listing.is_local_only) {
    return 3;
  }

  if (
    preset.label === "Services" &&
    (listing.type === "service" || listing.type === "hybrid")
  ) {
    return listing.type === "service" ? 3 : 2;
  }

  if (
    preset.label === "Products" &&
    (listing.type === "product" || listing.type === "hybrid")
  ) {
    return listing.type === "product" ? 3 : 2;
  }

  if (preset.label === "Hybrid" && listing.type === "hybrid") {
    return 3;
  }

  return 0;
}

function buildCatalogSliceSummary(snapshot: CatalogSliceSnapshot) {
  const parts: string[] = [];

  if (snapshot.type !== "all") {
    parts.push(titleCaseLabel(snapshot.type));
  }
  if (snapshot.category.trim()) {
    parts.push(snapshot.category.trim());
  }
  if (snapshot.localOnly) {
    parts.push("Local Only");
  }
  if (snapshot.availableToday) {
    parts.push("Available today");
  }
  if (snapshot.quickBookingOnly) {
    parts.push("Quick booking");
  }
  if (snapshot.popularOnly) {
    parts.push("Popular near you");
  }
  if (snapshot.promotedOnly) {
    parts.push("Promoted only");
  }
  if (snapshot.sort !== "featured") {
    parts.push(snapshot.sort === "price_low" ? "Lowest Price" : "Highest Price");
  }
  if (snapshot.query.trim()) {
    parts.push(`Search: "${snapshot.query.trim()}"`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Default browsing";
}

function getSellerStorefrontLaneLabel(snapshot: CatalogSliceSnapshot) {
  if (snapshot.promotedOnly) {
    return "Promoted Picks";
  }

  if (snapshot.type === "product") {
    return "Products First";
  }

  if (snapshot.type === "service") {
    return "Services First";
  }

  if (snapshot.quickBookingOnly) {
    return "Quick Booking";
  }

  if (snapshot.availableToday) {
    return "Ready Today";
  }

  if (snapshot.localOnly) {
    return "Local Only";
  }

  return null;
}

function getSellerStorefrontLaneGroupLabel(label: string) {
  if (label === "Ready Today" || label === "Quick Booking") {
    return "Fast lanes";
  }

  if (label === "Products First" || label === "Services First") {
    return "Catalog lanes";
  }

  return "Merchandising lanes";
}

function getSellerStorefrontLaneGroupTone(label: string) {
  if (label === "Ready Today" || label === "Quick Booking") {
    return "emerald";
  }

  if (label === "Products First" || label === "Services First") {
    return "sky";
  }

  return "rose";
}

export function PublicCatalogPanel({
  listings,
  listingsTotal,
  emptyText,
  sellerSlug,
}: {
  listings: Listing[];
  listingsTotal: number;
  emptyText: string;
  sellerSlug?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const api = useMemo(() => createApiClient(apiBaseUrl), [apiBaseUrl]);
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
  const [resumeBrowseFeedback, setResumeBrowseFeedback] = useState<string | null>(null);
  const [resumeSearchFeedback, setResumeSearchFeedback] = useState<string | null>(null);
  const [storefrontLaneFeedback, setStorefrontLaneFeedback] = useState<string | null>(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>([]);
  const [lastCatalogSlice, setLastCatalogSlice] = useState<CatalogSliceSnapshot | null>(null);
  const [recentStorefrontLanes, setRecentStorefrontLanes] = useState<SellerStorefrontLaneEntry[]>(
    [],
  );
  const [collapsedStorefrontLaneGroups, setCollapsedStorefrontLaneGroups] = useState<
    Record<string, boolean>
  >({});
  const [loadedListings, setLoadedListings] = useState<Listing[]>(listings);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);
  const [visibleListingCount, setVisibleListingCount] = useState(CATALOG_PAGE_SIZE);
  const [recommendedPreset, setRecommendedPreset] = useState<{
    type: CatalogTypeFilter;
    localOnly: boolean;
    label: string;
  } | null>(null);
  const typeParam = searchParams.get("type");
  const typeFilter: CatalogTypeFilter =
    typeParam === "product" || typeParam === "service" || typeParam === "hybrid"
      ? typeParam
      : "all";
  const sortParam = searchParams.get("sort");
  const sortMode: CatalogSort =
    sortParam === "price_low" || sortParam === "price_high" ? sortParam : "featured";
  const localOnly = searchParams.get("local") === "1";
  const query = searchParams.get("q") ?? "";
  const categoryFilter = searchParams.get("category") ?? "";
  const recommendedPresetActive = Boolean(
    recommendedPreset &&
      typeFilter === recommendedPreset.type &&
      localOnly === recommendedPreset.localOnly,
  );
  const availableToday = searchParams.get("available") === "1";
  const quickBookingOnly = searchParams.get("quick_booking") === "1";
  const popularOnly = searchParams.get("popular") === "1";
  const promotedOnly = searchParams.get("promoted") === "1";
  const quickBookingPresetActive =
    quickBookingOnly &&
    typeFilter === "all" &&
    !categoryFilter &&
    sortMode === "featured" &&
    !query.trim();
  const baseLocationLabel = useMemo(() => {
    const locationCounts = new Map<string, number>();
    loadedListings.forEach((listing) => {
      const label = getLocationLabel([listing.city, listing.state]);
      if (label === "Location pending") {
        return;
      }
      locationCounts.set(label, (locationCounts.get(label) ?? 0) + 1);
    });
    const entries = [...locationCounts.entries()].sort((left, right) => right[1] - left[1]);
    return entries[0]?.[0] ?? null;
  }, [loadedListings]);

  function updateCatalogState(next: {
    type?: CatalogTypeFilter;
    query?: string;
    category?: string;
    sort?: CatalogSort;
    localOnly?: boolean;
    availableToday?: boolean;
    quickBookingOnly?: boolean;
    popularOnly?: boolean;
    promotedOnly?: boolean;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextType = next.type ?? typeFilter;
    const nextQuery = next.query ?? query;
    const nextCategory = next.category ?? categoryFilter;
    const nextSort = next.sort ?? sortMode;
    const nextLocalOnly = next.localOnly ?? localOnly;
    const nextAvailable = next.availableToday ?? availableToday;
    const nextQuickBooking = next.quickBookingOnly ?? quickBookingOnly;
    const nextPopular = next.popularOnly ?? popularOnly;
    const nextPromoted = next.promotedOnly ?? promotedOnly;

    if (nextType === "all") {
      params.delete("type");
    } else {
      params.set("type", nextType);
    }

    if (nextQuery.trim()) {
      params.set("q", nextQuery.trim());
    } else {
      params.delete("q");
    }

    if (nextCategory.trim()) {
      params.set("category", nextCategory.trim());
    } else {
      params.delete("category");
    }

    if (nextSort === "featured") {
      params.delete("sort");
    } else {
      params.set("sort", nextSort);
    }

    if (nextLocalOnly) {
      params.set("local", "1");
    } else {
      params.delete("local");
    }

    if (nextAvailable) {
      params.set("available", "1");
    } else {
      params.delete("available");
    }
    if (nextQuickBooking) {
      params.set("quick_booking", "1");
    } else {
      params.delete("quick_booking");
    }
    if (nextPopular) {
      params.set("popular", "1");
    } else {
      params.delete("popular");
    }
    if (nextPromoted) {
      params.set("promoted", "1");
    } else {
      params.delete("promoted");
    }

    const nextQueryString = params.toString();
    router.replace(nextQueryString ? `${pathname}?${nextQueryString}` : pathname, {
      scroll: false,
    });
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await restoreBuyerSession();
        if (!session) {
          if (!cancelled) {
            setRecommendedPreset(null);
          }
          return;
        }

        const dashboard = await api.loadBuyerEngagementContext(session.access_token);
        if (!cancelled) {
          setRecommendedPreset(
            getRecommendedBrowsePreset({
              orders: dashboard.orders,
              bookings: dashboard.bookings,
            }),
          );
        }
      } catch {
        if (!cancelled) {
          setRecommendedPreset(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const filteredListings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return loadedListings
      .filter((listing) => {
        if (typeFilter !== "all" && listing.type !== typeFilter) {
          return false;
        }

        if (localOnly && !listing.is_local_only) {
          return false;
        }

        if (categoryFilter && listing.category !== categoryFilter) {
          return false;
        }

        if (availableToday && !(listing.available_today ?? false)) {
          return false;
        }

        if (quickBookingOnly && !getQuickBookingCue(listing)) {
          return false;
        }

        if (promotedOnly && !listing.is_promoted) {
          return false;
        }

        if (popularOnly) {
          const popularityThreshold = 3;
          const listingLocation = getLocationLabel([listing.city, listing.state]);
          if (
            !baseLocationLabel ||
            listingLocation !== baseLocationLabel ||
            (listing.recent_transaction_count ?? 0) < popularityThreshold
          ) {
            return false;
          }
        }

        if (!normalizedQuery) {
          return true;
        }

      const haystack = [
        listing.title,
        listing.description,
        listing.category,
        listing.type,
        listing.city,
        listing.state,
        listing.slug,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (sortMode === "price_low") {
          return (left.price_cents ?? 0) - (right.price_cents ?? 0);
        }
        if (sortMode === "price_high") {
          return (right.price_cents ?? 0) - (left.price_cents ?? 0);
        }
        const leftPromotion = left.is_promoted ? 1 : 0;
        const rightPromotion = right.is_promoted ? 1 : 0;
        if (leftPromotion !== rightPromotion) {
          return rightPromotion - leftPromotion;
        }
        const rightSearchScore = getListingSearchScore(right, normalizedQuery);
        const leftSearchScore = getListingSearchScore(left, normalizedQuery);
        if (rightSearchScore !== leftSearchScore) {
          return rightSearchScore - leftSearchScore;
        }
        const rightRecommendationScore = getRecommendationScore(right, recommendedPreset);
        const leftRecommendationScore = getRecommendationScore(left, recommendedPreset);
        if (rightRecommendationScore !== leftRecommendationScore) {
          return rightRecommendationScore - leftRecommendationScore;
        }
        const rightPopularity = right.recent_transaction_count ?? 0;
        const leftPopularity = left.recent_transaction_count ?? 0;
        if (rightPopularity !== leftPopularity) {
          return rightPopularity - leftPopularity;
        }
        return 0;
      });
  }, [
    loadedListings,
    localOnly,
    availableToday,
    quickBookingOnly,
    popularOnly,
    promotedOnly,
    query,
    categoryFilter,
    recommendedPreset,
    sortMode,
    typeFilter,
    baseLocationLabel,
  ]);
  const visibleListings = useMemo(
    () => filteredListings.slice(0, visibleListingCount),
    [filteredListings, visibleListingCount],
  );
  const hasMoreListings =
    visibleListings.length < filteredListings.length || loadedListings.length < listingsTotal;

  const dominantLocationLabel = useMemo(() => {
    const locationCounts = new Map<string, number>();

    for (const listing of visibleListings) {
      const label = getLocationLabel([listing.city, listing.state]);
      if (label === "Location pending") {
        continue;
      }
      locationCounts.set(label, (locationCounts.get(label) ?? 0) + 1);
    }

    const dominantEntry = [...locationCounts.entries()].sort((left, right) => right[1] - left[1])[0];
    return dominantEntry?.[0] ?? null;
  }, [visibleListings]);

  const activeSliceSummary = useMemo(() => {
    const parts: string[] = [];
    if (dominantLocationLabel) {
      parts.push(dominantLocationLabel);
    }
    if (typeFilter !== "all") {
      parts.push(titleCaseLabel(typeFilter));
    }
    if (categoryFilter) {
      parts.push(categoryFilter);
    }
    if (localOnly) {
      parts.push("Local Only");
    }
    if (sortMode !== "featured") {
      parts.push(sortMode === "price_low" ? "Lowest Price" : "Highest Price");
    }
    if (query.trim()) {
      parts.push(`Search: "${query.trim()}"`);
    }
    if (availableToday) {
      parts.push("Available today");
    }
    if (quickBookingOnly) {
      parts.push("Quick booking");
    }
    if (popularOnly) {
      parts.push("Popular near you");
    }
    if (promotedOnly) {
      parts.push("Promoted only");
    }
    parts.push(
      `${visibleListings.length} of ${filteredListings.length} result${filteredListings.length === 1 ? "" : "s"}`,
    );
    return parts.join(" · ");
  }, [
    dominantLocationLabel,
    filteredListings.length,
    localOnly,
    query,
    categoryFilter,
    sortMode,
    typeFilter,
    availableToday,
    quickBookingOnly,
    popularOnly,
    promotedOnly,
    visibleListings.length,
  ]);

  const isDefaultView =
    typeFilter === "all" &&
    sortMode === "featured" &&
    !localOnly &&
    !availableToday &&
    !quickBookingOnly &&
    !popularOnly &&
    !promotedOnly &&
    !categoryFilter &&
    !query.trim();
  const normalizedSearchQuery = query.trim().toLowerCase();
  const categoryOptions = useMemo(() => getCategoryOptions(loadedListings), [loadedListings]);
  const quickBookingListingCount = useMemo(
    () => loadedListings.filter((listing) => Boolean(getQuickBookingCue(listing))).length,
    [loadedListings],
  );
  const suggestedSearches = useMemo(
    () =>
      getSuggestedSearches(
        filteredListings.length > 0 ? filteredListings : loadedListings,
        normalizedSearchQuery,
      ),
    [filteredListings, loadedListings, normalizedSearchQuery],
  );
  const recentlyViewedListings = useMemo(
    () =>
      recentlyViewedIds
        .map((listingId) => loadedListings.find((listing) => listing.id === listingId) ?? null)
        .filter((listing): listing is Listing => Boolean(listing))
        .slice(0, 4),
    [loadedListings, recentlyViewedIds],
  );
  const groupedRecentlyViewedListings = useMemo(
    () => ({
      availableToday: recentlyViewedListings.filter((listing) => listing.available_today),
      other: recentlyViewedListings.filter((listing) => !listing.available_today),
    }),
    [recentlyViewedListings],
  );
  const latestStorefrontLane = recentStorefrontLanes[0] ?? null;
  const groupedRecentStorefrontLanes = useMemo<SellerStorefrontLaneGroup[]>(() => {
    const groups = new Map<string, SellerStorefrontLaneEntry[]>();

    recentStorefrontLanes.forEach((entry) => {
      const groupLabel = getSellerStorefrontLaneGroupLabel(entry.label);
      const current = groups.get(groupLabel) ?? [];
      current.push(entry);
      groups.set(groupLabel, current);
    });

    return [...groups.entries()]
      .map(([label, entries]) => ({
        label,
        tone: getSellerStorefrontLaneGroupTone(entries[0]?.label ?? ""),
        entries,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [recentStorefrontLanes]);
  const hasCollapsedStorefrontLaneGroups = useMemo(
    () => Object.values(collapsedStorefrontLaneGroups).some(Boolean),
    [collapsedStorefrontLaneGroups],
  );
  const currentCatalogSlice = useMemo<CatalogSliceSnapshot>(
    () => ({
      type: typeFilter,
      query,
      category: categoryFilter,
      sort: sortMode,
      localOnly,
      availableToday,
      quickBookingOnly,
      popularOnly,
      promotedOnly,
    }),
    [
      availableToday,
      categoryFilter,
      localOnly,
      popularOnly,
      promotedOnly,
      query,
      quickBookingOnly,
      sortMode,
      typeFilter,
    ],
  );

  useEffect(() => {
    setVisibleListingCount(CATALOG_PAGE_SIZE);
  }, [currentCatalogSlice]);
  const sellerStorefrontLaneHistoryKey = useMemo(
    () =>
      sellerSlug
        ? `${SELLER_STOREFRONT_LANE_HISTORY_KEY_PREFIX}:${sellerSlug}`
        : null,
    [sellerSlug],
  );
  const sellerStorefrontLaneGroupStateKey = useMemo(
    () =>
      sellerSlug
        ? `${SELLER_STOREFRONT_LANE_HISTORY_KEY_PREFIX}:${sellerSlug}:groups`
        : null,
    [sellerSlug],
  );
  const currentStorefrontLaneLabel = useMemo(
    () => getSellerStorefrontLaneLabel(currentCatalogSlice),
    [currentCatalogSlice],
  );
  const currentStorefrontLaneSummary = useMemo(
    () => buildCatalogSliceSummary(currentCatalogSlice),
    [currentCatalogSlice],
  );
  const savedSearchQuery = lastCatalogSlice?.query.trim() ?? "";
  const hasSavedSearchQuery = Boolean(savedSearchQuery && savedSearchQuery !== query.trim());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(RECENTLY_VIEWED_LISTINGS_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) {
        setRecentlyViewedIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      window.localStorage.removeItem(RECENTLY_VIEWED_LISTINGS_KEY);
    }

    try {
      const storedSlice = window.localStorage.getItem(LAST_CATALOG_SLICE_KEY);
      if (!storedSlice) {
        return;
      }

      const parsed = JSON.parse(storedSlice) as Partial<CatalogSliceSnapshot>;
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      setLastCatalogSlice({
        type:
          parsed.type === "product" || parsed.type === "service" || parsed.type === "hybrid"
            ? parsed.type
            : "all",
        query: typeof parsed.query === "string" ? parsed.query : "",
        category: typeof parsed.category === "string" ? parsed.category : "",
        sort: parsed.sort === "price_low" || parsed.sort === "price_high" ? parsed.sort : "featured",
        localOnly: Boolean(parsed.localOnly),
        availableToday: Boolean(parsed.availableToday),
        quickBookingOnly: Boolean(parsed.quickBookingOnly),
        popularOnly: Boolean(parsed.popularOnly),
        promotedOnly: Boolean(parsed.promotedOnly),
      });
    } catch {
      window.localStorage.removeItem(LAST_CATALOG_SLICE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!sellerStorefrontLaneHistoryKey) {
      setRecentStorefrontLanes([]);
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(sellerStorefrontLaneHistoryKey);
      if (!stored) {
        setRecentStorefrontLanes([]);
        return;
      }

      const parsed = JSON.parse(stored) as SellerStorefrontLaneEntry[];
      if (Array.isArray(parsed)) {
        setRecentStorefrontLanes(
          parsed.filter(
            (entry): entry is SellerStorefrontLaneEntry =>
              Boolean(
                entry &&
                  typeof entry === "object" &&
                  typeof entry.label === "string" &&
                  typeof entry.summary === "string" &&
                  typeof entry.createdAt === "string" &&
                  entry.snapshot &&
                  typeof entry.snapshot === "object",
              ),
          ),
        );
      }
    } catch {
      if (sellerStorefrontLaneHistoryKey) {
        window.sessionStorage.removeItem(sellerStorefrontLaneHistoryKey);
      }
    }
  }, [sellerStorefrontLaneHistoryKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!sellerStorefrontLaneGroupStateKey) {
      setCollapsedStorefrontLaneGroups({});
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(sellerStorefrontLaneGroupStateKey);
      if (!stored) {
        setCollapsedStorefrontLaneGroups({});
        return;
      }

      const parsed = JSON.parse(stored) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        setCollapsedStorefrontLaneGroups(parsed);
      }
    } catch {
      window.sessionStorage.removeItem(sellerStorefrontLaneGroupStateKey);
    }
  }, [sellerStorefrontLaneGroupStateKey]);

  useEffect(() => {
    setLoadedListings(listings);
    setVisibleListingCount(CATALOG_PAGE_SIZE);
  }, [listings, sellerSlug]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (
      currentCatalogSlice.type === "all" &&
      currentCatalogSlice.sort === "featured" &&
      !currentCatalogSlice.localOnly &&
      !currentCatalogSlice.availableToday &&
      !currentCatalogSlice.quickBookingOnly &&
      !currentCatalogSlice.popularOnly &&
      !currentCatalogSlice.promotedOnly &&
      !currentCatalogSlice.category.trim() &&
      !currentCatalogSlice.query.trim()
    ) {
      return;
    }

    window.localStorage.setItem(LAST_CATALOG_SLICE_KEY, JSON.stringify(currentCatalogSlice));
    setLastCatalogSlice(currentCatalogSlice);
  }, [currentCatalogSlice]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !sellerStorefrontLaneHistoryKey ||
      !currentStorefrontLaneLabel
    ) {
      return;
    }

    const nextEntry: SellerStorefrontLaneEntry = {
      label: currentStorefrontLaneLabel,
      snapshot: currentCatalogSlice,
      summary: currentStorefrontLaneSummary,
      createdAt: new Date().toISOString(),
    };

    setRecentStorefrontLanes((current) => {
      const next = [
        nextEntry,
        ...current.filter((entry) => entry.summary !== nextEntry.summary),
      ].slice(0, 4);
      window.sessionStorage.setItem(sellerStorefrontLaneHistoryKey, JSON.stringify(next));
      return next;
    });
  }, [
    currentCatalogSlice,
    currentStorefrontLaneLabel,
    currentStorefrontLaneSummary,
    sellerStorefrontLaneHistoryKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !sellerStorefrontLaneGroupStateKey) {
      return;
    }

    window.sessionStorage.setItem(
      sellerStorefrontLaneGroupStateKey,
      JSON.stringify(collapsedStorefrontLaneGroups),
    );
  }, [collapsedStorefrontLaneGroups, sellerStorefrontLaneGroupStateKey]);

  async function copyCurrentSliceLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkFeedback("Link copied");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    } catch {
      setLinkFeedback("Copy failed");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    }
  }

  function recordRecentlyViewedListing(listingId: string) {
    if (typeof window === "undefined") {
      return;
    }

    setRecentlyViewedIds((current) => {
      const next = [listingId, ...current.filter((value) => value !== listingId)].slice(0, 8);
      window.localStorage.setItem(RECENTLY_VIEWED_LISTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearRecentlyViewedListings() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(RECENTLY_VIEWED_LISTINGS_KEY);
    setRecentlyViewedIds([]);
  }

  async function loadMoreListings() {
    if (loadingMoreListings) {
      return;
    }

    if (visibleListingCount < loadedListings.length) {
      setVisibleListingCount((current) => current + CATALOG_PAGE_SIZE);
      return;
    }

    if (!sellerSlug || loadedListings.length >= listingsTotal) {
      return;
    }

    setLoadingMoreListings(true);
    try {
      const response = await api.getSellerListingsBySlug(
        sellerSlug,
        { cache: "no-store" },
        { limit: CATALOG_PAGE_SIZE, offset: loadedListings.length },
      );
      setLoadedListings((current) => {
        const next = [
          ...current,
          ...response.items.filter(
            (listing) => !current.some((existing) => existing.id === listing.id),
          ),
        ];
        return next;
      });
      setVisibleListingCount((current) => current + CATALOG_PAGE_SIZE);
    } catch {
      setStorefrontLaneFeedback("Load more failed");
      window.setTimeout(() => setStorefrontLaneFeedback(null), 2000);
    } finally {
      setLoadingMoreListings(false);
    }
  }

  function resumeLastCatalogSlice() {
    if (!lastCatalogSlice) {
      return;
    }

    updateCatalogState(lastCatalogSlice);
    setResumeBrowseFeedback("Browse resumed");
    window.setTimeout(() => setResumeBrowseFeedback(null), 2000);
  }

  function resumeSavedSearch() {
    if (!savedSearchQuery) {
      return;
    }

    updateCatalogState({ query: savedSearchQuery });
    setResumeSearchFeedback("Search resumed");
    window.setTimeout(() => setResumeSearchFeedback(null), 2000);
  }

  function clearLastCatalogSlice() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(LAST_CATALOG_SLICE_KEY);
    setLastCatalogSlice(null);
    setResumeBrowseFeedback("Saved browse cleared");
    window.setTimeout(() => setResumeBrowseFeedback(null), 2000);
  }

  function reopenStorefrontLane(entry: SellerStorefrontLaneEntry) {
    updateCatalogState(entry.snapshot);
    setStorefrontLaneFeedback(`Reopened ${entry.label}`);
    window.setTimeout(() => setStorefrontLaneFeedback(null), 2000);
  }

  function clearStorefrontLaneHistory() {
    if (typeof window === "undefined" || !sellerStorefrontLaneHistoryKey) {
      return;
    }

    window.sessionStorage.removeItem(sellerStorefrontLaneHistoryKey);
    setRecentStorefrontLanes([]);
    setStorefrontLaneFeedback("Storefront lanes cleared");
    window.setTimeout(() => setStorefrontLaneFeedback(null), 2000);
  }

  function toggleStorefrontLaneGroup(groupLabel: string) {
    setCollapsedStorefrontLaneGroups((current) => {
      const next = {
        ...current,
        [groupLabel]: !current[groupLabel],
      };

      if (typeof window !== "undefined" && sellerStorefrontLaneGroupStateKey) {
        window.sessionStorage.setItem(sellerStorefrontLaneGroupStateKey, JSON.stringify(next));
      }

      return next;
    });
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-[1.5rem] border border-border bg-white/70 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          {recommendedPreset ? (
            <div className="flex flex-col gap-2 text-sm text-foreground/72">
              <span>Recommended</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateCatalogState({
                      type: recommendedPreset.type,
                      query: "",
                      category: "",
                      sort: "featured",
                      localOnly: recommendedPreset.localOnly,
                    })
                  }
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    recommendedPresetActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-amber-300 bg-amber-50 text-amber-900 hover:border-foreground/28"
                  }`}
                >
                  Based on your activity · {recommendedPreset.label}
                </button>
              </div>
            </div>
          ) : null}
          {quickBookingListingCount > 0 ? (
            <div className="flex flex-col gap-2 text-sm text-foreground/72">
              <span>Quick start</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateCatalogState({
                      type: "all",
                      query: "",
                      category: "",
                      sort: "featured",
                      quickBookingOnly: true,
                    })
                  }
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    quickBookingPresetActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-foreground/28"
                  }`}
                >
                  Quick booking · {quickBookingListingCount}
                </button>
              </div>
              {quickBookingPresetActive ? (
                <p className="text-xs text-foreground/58">
                  Showing the fastest-to-schedule services first across {filteredListings.length} match
                  {filteredListings.length === 1 ? "" : "es"}.
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm text-foreground/72">
            Search
            <input
              value={query}
              onChange={(event) => updateCatalogState({ query: event.target.value })}
              placeholder="Search title, description, or location"
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
            />
            {suggestedSearches.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestedSearches.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => updateCatalogState({ query: suggestion })}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/64 transition hover:border-accent hover:text-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            {hasSavedSearchQuery ? (
              <button
                type="button"
                onClick={resumeSavedSearch}
                className="inline-flex w-fit rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/72 transition hover:border-accent hover:text-accent"
              >
                Resume search · {savedSearchQuery}
              </button>
            ) : null}
          </label>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Type</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${listings.length})` },
                {
                  value: "product",
                  label: `Products (${listings.filter((listing) => listing.type === "product").length})`,
                },
                {
                  value: "service",
                  label: `Services (${listings.filter((listing) => listing.type === "service").length})`,
                },
                {
                  value: "hybrid",
                  label: `Hybrid (${listings.filter((listing) => listing.type === "hybrid").length})`,
                },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateCatalogState({ type: option.value as CatalogTypeFilter })}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    typeFilter === option.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {categoryOptions.length > 0 ? (
            <div className="flex flex-col gap-2 text-sm text-foreground/72">
              <span>Category</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateCatalogState({ category: "" })}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    !categoryFilter
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                  }`}
                >
                  All Categories
                </button>
                {categoryOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => updateCatalogState({ category: option.label })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      categoryFilter === option.label
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                    }`}
                  >
                    {option.label} ({option.count})
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Sort</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "featured", label: "Featured" },
                { value: "price_low", label: "Lowest Price" },
                { value: "price_high", label: "Highest Price" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateCatalogState({ sort: option.value as CatalogSort })}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    sortMode === option.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Location</span>
            <div className="flex flex-wrap gap-2">
              <button
                key={localOnly ? "local-on" : "local-off"}
                type="button"
                onClick={() => updateCatalogState({ localOnly: !localOnly })}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  localOnly
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {localOnly ? "Local Only On" : "Local Only Off"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Availability</span>
            <div className="flex flex-wrap gap-2">
              <button
                key={availableToday ? "available-on" : "available-off"}
                type="button"
                onClick={() => updateCatalogState({ availableToday: !availableToday })}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  availableToday
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {availableToday ? "Only available today" : "Available today"}
              </button>
              <button
                key={quickBookingOnly ? "quick-booking-on" : "quick-booking-off"}
                type="button"
                onClick={() => updateCatalogState({ quickBookingOnly: !quickBookingOnly })}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  quickBookingOnly
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {quickBookingOnly ? "Quick booking only" : "Show quick booking"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Popularity</span>
            <div className="flex flex-wrap gap-2">
              <button
                key={popularOnly ? "popular-on" : "popular-off"}
                type="button"
                onClick={() => updateCatalogState({ popularOnly: !popularOnly })}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  popularOnly
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {popularOnly ? "Showing popular near you" : "Show popular only"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Promotions</span>
            <div className="flex flex-wrap gap-2">
              <button
                key={promotedOnly ? "promoted-on" : "promoted-off"}
                type="button"
                onClick={() => updateCatalogState({ promotedOnly: !promotedOnly })}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  promotedOnly
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {promotedOnly ? "Promoted only" : "Include promoted"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[1.15rem] border border-border bg-background/55 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Current Slice
              </p>
              <p className="mt-2 text-sm text-foreground/72">{activeSliceSummary}</p>
              {quickBookingOnly ? (
                <p className="mt-2 text-xs text-foreground/58">
                  Quick booking prioritizes same-day and low-notice services so you can find the fastest
                  scheduling options first.
                </p>
              ) : null}
              {dominantLocationLabel ? (
                <button
                  className={`mt-3 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    localOnly
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => updateCatalogState({ localOnly: !localOnly })}
                  type="button"
                >
                  {dominantLocationLabel} · {localOnly ? "Local Slice On" : "Use Local Slice"}
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {linkFeedback ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                  {linkFeedback}
                </span>
              ) : null}
              {resumeBrowseFeedback ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                  {resumeBrowseFeedback}
                </span>
              ) : null}
              {resumeSearchFeedback ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                  {resumeSearchFeedback}
                </span>
              ) : null}
              {sellerSlug && latestStorefrontLane ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={() => reopenStorefrontLane(latestStorefrontLane)}
                  type="button"
                >
                  Open latest storefront lane · {latestStorefrontLane.label}
                </button>
              ) : null}
              {lastCatalogSlice ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={resumeLastCatalogSlice}
                  type="button"
                >
                  Resume browsing
                </button>
              ) : null}
              {lastCatalogSlice ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={clearLastCatalogSlice}
                  type="button"
                >
                  Clear saved browse
                </button>
              ) : null}
              {sellerSlug && hasCollapsedStorefrontLaneGroups ? (
                <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/60">
                  Storefront lanes partially collapsed
                </span>
              ) : null}
              <button
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={() => void copyCurrentSliceLink()}
                type="button"
              >
                Copy Link
              </button>
              {!isDefaultView ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={() => {
                    updateCatalogState({
                      type: "all",
                      query: "",
                      category: "",
                      sort: "featured",
                      localOnly: false,
                      availableToday: false,
                      quickBookingOnly: false,
                      popularOnly: false,
                      promotedOnly: false,
                    });
                  }}
                  type="button"
                >
                  Reset View
                </button>
              ) : null}
            </div>
          </div>
          {lastCatalogSlice ? (
            <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-foreground/50">
              Resume browsing returns to {buildCatalogSliceSummary(lastCatalogSlice)}.
            </p>
          ) : null}
          {sellerSlug && latestStorefrontLane ? (
            <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-foreground/50">
              Latest storefront lane returns to {latestStorefrontLane.summary}.
            </p>
          ) : null}
        </div>
        {sellerSlug && recentStorefrontLanes.length > 0 ? (
          <div className="rounded-[1.5rem] border border-border bg-white/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                  Recently Opened Storefront Lanes
                </p>
                <p className="mt-2 text-sm text-foreground/72">
                  Jump back into seller-specific storefront slices from this browser.
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
                {recentStorefrontLanes.length} saved lane
                {recentStorefrontLanes.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {storefrontLaneFeedback ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                  {storefrontLaneFeedback}
                </span>
              ) : null}
              <button
                type="button"
                onClick={clearStorefrontLaneHistory}
                className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              >
                Clear history
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {groupedRecentStorefrontLanes.map((group) => (
                <div key={group.label} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                      {group.label}
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                          group.tone === "emerald"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : group.tone === "sky"
                              ? "border-sky-300 bg-sky-50 text-sky-800"
                              : "border-[#d48b7d]/25 bg-[#fbe8e1] text-[#9a4d3c]"
                        }`}
                      >
                        {group.entries.length} lane{group.entries.length === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleStorefrontLaneGroup(group.label)}
                        className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                      >
                        {collapsedStorefrontLaneGroups[group.label] ? "Expand" : "Collapse"}
                      </button>
                    </div>
                  </div>
                  {collapsedStorefrontLaneGroups[group.label] ? (
                    <p className="rounded-[1.15rem] border border-dashed border-border bg-background/35 px-4 py-3 text-xs uppercase tracking-[0.14em] text-foreground/54">
                      {group.entries.length} lane{group.entries.length === 1 ? "" : "s"} hidden in
                      this group.
                    </p>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                      {group.entries.map((entry) => (
                        <button
                          key={`${entry.label}:${entry.summary}:${entry.createdAt}`}
                          type="button"
                          onClick={() => reopenStorefrontLane(entry)}
                          className="rounded-[1.15rem] border border-border bg-background/45 px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-accent"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                              {entry.label}
                            </span>
                            <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-deep">
                              Re-open
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-foreground">{entry.summary}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-foreground/50">
                            {new Date(entry.createdAt).toLocaleString()}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {recentlyViewedListings.length > 0 ? (
        <div className="rounded-[1.5rem] border border-border bg-white/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Recently Viewed
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Jump back into listings you opened recently from this browser.
              </p>
            </div>
            <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
              {recentlyViewedListings.length} quick return
              {recentlyViewedListings.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearRecentlyViewedListings}
              className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {groupedRecentlyViewedListings.availableToday.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                    Available Today
                  </p>
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
                    {groupedRecentlyViewedListings.availableToday.length} ready now
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  {groupedRecentlyViewedListings.availableToday.map((listing) => (
                    <Link
                      key={listing.id}
                      href={`/listings/${listing.id}?from=${encodeURIComponent(
                        `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
                      )}`}
                      onClick={() => recordRecentlyViewedListing(listing.id)}
                      className="rounded-[1.15rem] border border-border bg-background/45 px-4 py-4 transition hover:-translate-y-0.5 hover:border-accent"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                          {listing.type}
                        </span>
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
                          Available today
                        </span>
                      </div>
                      <p className="mt-3 text-base font-semibold text-foreground">{listing.title}</p>
                      <p className="mt-2 text-sm text-foreground/68">
                        {getLocationLabel([listing.city, listing.state])}
                      </p>
                      {getBookingContextLabels(listing).length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {getBookingContextLabels(listing).map((label) => (
                            <span
                              key={`${listing.id}:${label}`}
                              className="rounded-full bg-[#ece7dc] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/70"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mt-3 text-sm font-semibold text-foreground">
                        {formatCurrency(listing.price_cents, listing.currency)}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {groupedRecentlyViewedListings.other.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                    More To Revisit
                  </p>
                  <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                    {groupedRecentlyViewedListings.other.length} saved view
                    {groupedRecentlyViewedListings.other.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  {groupedRecentlyViewedListings.other.map((listing) => (
                    <Link
                      key={listing.id}
                      href={`/listings/${listing.id}?from=${encodeURIComponent(
                        `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
                      )}`}
                      onClick={() => recordRecentlyViewedListing(listing.id)}
                      className="rounded-[1.15rem] border border-border bg-background/45 px-4 py-4 transition hover:-translate-y-0.5 hover:border-accent"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                          {listing.type}
                        </span>
                      </div>
                      <p className="mt-3 text-base font-semibold text-foreground">{listing.title}</p>
                      <p className="mt-2 text-sm text-foreground/68">
                        {getLocationLabel([listing.city, listing.state])}
                      </p>
                      {getBookingContextLabels(listing).length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {getBookingContextLabels(listing).map((label) => (
                            <span
                              key={`${listing.id}:${label}`}
                              className="rounded-full bg-[#ece7dc] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/70"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mt-3 text-sm font-semibold text-foreground">
                        {formatCurrency(listing.price_cents, listing.currency)}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {visibleListings.length > 0 ? (
          <>
            {visibleListings.map((listing) => {
              const recommendationBadge = getRecommendationBadge(listing, recommendedPreset);
              const isNewListing = Boolean(listing.is_new_listing);
              const wasViewedRecently = recentlyViewedIds.includes(listing.id);
              const locationLabel = getLocationLabel([listing.city, listing.state]);
              const bookingContextLabels = getBookingContextLabels(listing);
              const quickBookingCue = getQuickBookingCue(listing);
              const isPopularNearYou =
                baseLocationLabel &&
                locationLabel === baseLocationLabel &&
                (listing.recent_transaction_count ?? 0) >= 3;
              const searchScore = getListingSearchScore(listing, normalizedSearchQuery);
              const isBestMatch =
                normalizedSearchQuery.length > 0 &&
                visibleListings[0]?.id === listing.id &&
                searchScore > 0;

              return (
                <article
                  key={listing.id}
                  className="relative overflow-hidden rounded-[1.5rem] border border-border bg-white/70 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <Link
                    aria-label={`Open ${listing.title}`}
                    className="absolute inset-0 z-10"
                    href={`/listings/${listing.id}?from=${encodeURIComponent(
                      `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
                    )}`}
                    onClick={() => recordRecentlyViewedListing(listing.id)}
                  />
                  <div className="relative min-h-[240px] bg-[#ead8ba]">
                    {listing.images?.[0]?.image_url ? (
                      <Image
                        alt={listing.images[0].alt_text ?? listing.title}
                        className="h-full w-full object-cover"
                        fill
                        src={listing.images[0].image_url}
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full min-h-[240px] items-center justify-center bg-[radial-gradient(circle_at_top,#f6dfb7,transparent_55%),linear-gradient(135deg,#d1b17c,#a77c42)]">
                        <span className="rounded-full border border-white/40 bg-white/20 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-white/90">
                          {listing.type}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-background shadow-sm">
                            {listing.type}
                          </span>
                          {listing.category ? (
                            <span className="rounded-full border border-[#b7924f]/25 bg-[#f7ecd7] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7a5717]">
                              {listing.category}
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                              getListingSignals(listing).booking === "Booking Ready"
                                ? "border border-sky-300 bg-sky-50 text-sky-800"
                                : "border border-border text-foreground/60"
                            }`}
                          >
                            {getListingSignals(listing).booking}
                          </span>
                          {listing.is_local_only ? (
                            <span className="rounded-full border border-[#0f5f62]/20 bg-[#e4f1ed] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f5f62]">
                              Local Only
                            </span>
                          ) : null}
                          {listing.is_promoted ? (
                            <span className="rounded-full border border-[#b94c23]/30 bg-[#fbe8dd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b94c23]">
                              Promoted
                            </span>
                          ) : null}
                          <span className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
                            {getLocationLabel([listing.city, listing.state])}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-2xl font-semibold tracking-[-0.04em]">{listing.title}</h3>
                          <p className="mt-2 text-sm leading-6 text-foreground/68">
                            {listing.description}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`rounded-[1.25rem] border px-4 py-3 text-right ${
                          sortMode === "price_low"
                            ? "border-emerald-300 bg-emerald-50"
                            : sortMode === "price_high"
                              ? "border-amber-300 bg-amber-50"
                              : "border-border bg-[#f9f1e2]"
                        }`}
                      >
                        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                          {sortMode === "price_low"
                            ? "Lowest Price"
                            : sortMode === "price_high"
                              ? "Highest Price"
                              : "Starting At"}
                        </p>
                        <p className="mt-1 text-xl font-semibold">
                          {formatCurrency(listing.price_cents, listing.currency)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
                      {recommendationBadge ? (
                        <span
                          className={`rounded-full border px-3 py-2 ${recommendationBadge.className}`}
                        >
                          {recommendationBadge.text}
                        </span>
                      ) : null}
                      {isBestMatch ? (
                        <span className="rounded-full border border-violet-300 bg-violet-50 px-3 py-2 text-violet-800">
                          Best match
                        </span>
                      ) : null}
                      {localOnly ? (
                        <span className="rounded-full border border-accent/25 bg-accent/8 px-3 py-2 text-accent">
                          Local Match
                        </span>
                      ) : null}
                      {listing.available_today ? (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800">
                          Available today
                        </span>
                      ) : null}
                      {quickBookingCue ? (
                        <span className={`rounded-full px-3 py-2 ${quickBookingCue.className}`}>
                          {quickBookingCue.label}
                        </span>
                      ) : null}
                      {isPopularNearYou ? (
                        <span className="rounded-full border border-sky-300 bg-sky-50 px-3 py-2 text-sky-800">
                          Popular near you
                        </span>
                      ) : null}
                      {isNewListing ? (
                        <span className="rounded-full border border-sky-300 bg-sky-50 px-3 py-2 text-sky-800">
                          New listing
                        </span>
                      ) : null}
                      {sortMode === "price_low" ? (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800">
                          Low-Price View
                        </span>
                      ) : null}
                      {sortMode === "price_high" ? (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                          Premium-Price View
                        </span>
                      ) : null}
                      {query.trim() ? (
                        <span className="rounded-full border border-border bg-white px-3 py-2 text-foreground/72">
                          Search Match
                        </span>
                      ) : null}
                      {wasViewedRecently ? (
                        <span className="rounded-full border border-violet-300 bg-violet-50 px-3 py-2 text-violet-800">
                          Viewed recently
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-3 py-2 ${
                          listing.is_local_only
                            ? "bg-[#0f5f62] text-white"
                            : "bg-[#e4f1ed] text-[#0f5f62]"
                        }`}
                      >
                        {getListingSignals(listing).local}
                      </span>
                      <span className="rounded-full bg-[#f3e1bd] px-3 py-2 text-[#7c3a10]">
                        {getListingSignals(listing).fulfillment}
                      </span>
                      {bookingContextLabels.map((label) => (
                        <span
                          key={`${listing.id}:${label}`}
                          className="rounded-full bg-[#ece7dc] px-3 py-2 text-foreground/70"
                        >
                          {label}
                        </span>
                      ))}
                    </div>

                    {sellerSlug ? (
                      <div className="pt-1">
                        <Link
                          href={`/sellers/${sellerSlug}`}
                          className="inline-flex rounded-full border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                        >
                          View Seller Storefront
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {hasMoreListings ? (
              <div className="rounded-[1.5rem] border border-dashed border-border bg-white/55 p-6 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                      More Listings
                    </p>
                    <p className="mt-2 text-sm text-foreground/72">
                      Showing {visibleListings.length} of {filteredListings.length} loaded filtered listing
                      {filteredListings.length === 1 ? "" : "s"}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadMoreListings()}
                    disabled={loadingMoreListings}
                    className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    {loadingMoreListings ? "Loading..." : "Load more listings"}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-white/55 p-8 text-sm leading-6 text-foreground/66 lg:col-span-2">
            {quickBookingOnly ? (
              <div className="space-y-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                    Quick Booking
                  </p>
                  <p className="mt-3">
                    No same-day or low-notice services match the current slice yet.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateCatalogState({ quickBookingOnly: false, availableToday: true })}
                    className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Try available today
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCatalogState({ quickBookingOnly: false })}
                    className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Clear quick booking
                  </button>
                </div>
              </div>
            ) : (
              emptyText
            )}
          </div>
        )}
      </div>
    </div>
  );
}
