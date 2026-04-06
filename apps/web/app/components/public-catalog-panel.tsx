"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createApiClient, formatCurrency, type Booking, type Listing, type Order } from "@/app/lib/api";
import { restoreBuyerSession } from "@/app/lib/buyer-auth";

type CatalogTypeFilter = "all" | "product" | "service" | "hybrid";
type CatalogSort = "featured" | "price_low" | "price_high";

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

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRecommendedBrowsePreset(input: {
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
}) {
  const productScore = input.orders.reduce((count, order) => {
    const matchingListings = (order.items ?? [])
      .map((item) => input.listings.find((listing) => listing.id === item.listing_id))
      .filter((listing): listing is Listing => Boolean(listing));

    return (
      count +
      matchingListings.filter(
        (listing) => listing.type === "product" || listing.type === "hybrid",
      ).length
    );
  }, 0);

  const serviceScore = input.bookings.filter(
    (booking) => booking.listing_type === "service" || booking.listing_type === "hybrid",
  ).length;

  const localScore =
    input.orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (listing) => listing.id === item.listing_id && listing.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) =>
      input.listings.some(
        (listing) => listing.id === booking.listing_id && listing.is_local_only,
      ),
    ).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (listing) => listing.id === item.listing_id && listing.type === "hybrid",
        ),
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
  listing: Listing,
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
  listing: Listing,
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

export function PublicCatalogPanel({
  listings,
  emptyText,
  sellerSlug,
}: {
  listings: Listing[];
  emptyText: string;
  sellerSlug?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const api = useMemo(() => createApiClient(apiBaseUrl), [apiBaseUrl]);
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
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
  const recommendedPresetActive = Boolean(
    recommendedPreset &&
      typeFilter === recommendedPreset.type &&
      localOnly === recommendedPreset.localOnly,
  );
  const availableToday = searchParams.get("available") === "1";
  const popularOnly = searchParams.get("popular") === "1";
  const baseLocationLabel = useMemo(() => {
    const locationCounts = new Map<string, number>();
    listings.forEach((listing) => {
      const label = getLocationLabel([listing.city, listing.state]);
      if (label === "Location pending") {
        return;
      }
      locationCounts.set(label, (locationCounts.get(label) ?? 0) + 1);
    });
    const entries = [...locationCounts.entries()].sort((left, right) => right[1] - left[1]);
    return entries[0]?.[0] ?? null;
  }, [listings]);

  function updateCatalogState(next: {
    type?: CatalogTypeFilter;
    query?: string;
    sort?: CatalogSort;
    localOnly?: boolean;
    availableToday?: boolean;
    popularOnly?: boolean;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextType = next.type ?? typeFilter;
    const nextQuery = next.query ?? query;
    const nextSort = next.sort ?? sortMode;
    const nextLocalOnly = next.localOnly ?? localOnly;
    const nextAvailable = next.availableToday ?? availableToday;
    const nextPopular = next.popularOnly ?? popularOnly;

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
    if (nextPopular) {
      params.set("popular", "1");
    } else {
      params.delete("popular");
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

        const dashboard = await api.loadBuyerDashboard(session.access_token);
        if (!cancelled) {
          setRecommendedPreset(
            getRecommendedBrowsePreset({
              listings: dashboard.listings,
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

    return listings
      .filter((listing) => {
        if (typeFilter !== "all" && listing.type !== typeFilter) {
          return false;
        }

        if (localOnly && !listing.is_local_only) {
          return false;
        }

        if (availableToday && !(listing.available_today ?? false)) {
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
    listings,
    localOnly,
    availableToday,
    popularOnly,
    query,
    recommendedPreset,
    sortMode,
    typeFilter,
    baseLocationLabel,
  ]);

  const dominantLocationLabel = useMemo(() => {
    const locationCounts = new Map<string, number>();

    for (const listing of filteredListings) {
      const label = getLocationLabel([listing.city, listing.state]);
      if (label === "Location pending") {
        continue;
      }
      locationCounts.set(label, (locationCounts.get(label) ?? 0) + 1);
    }

    const dominantEntry = [...locationCounts.entries()].sort((left, right) => right[1] - left[1])[0];
    return dominantEntry?.[0] ?? null;
  }, [filteredListings]);

  const activeSliceSummary = useMemo(() => {
    const parts: string[] = [];
    if (dominantLocationLabel) {
      parts.push(dominantLocationLabel);
    }
    if (typeFilter !== "all") {
      parts.push(titleCaseLabel(typeFilter));
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
    if (popularOnly) {
      parts.push("Popular near you");
    }
    parts.push(`${filteredListings.length} result${filteredListings.length === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [
    dominantLocationLabel,
    filteredListings.length,
    localOnly,
    query,
    sortMode,
    typeFilter,
    availableToday,
    popularOnly,
  ]);

  const isDefaultView =
    typeFilter === "all" && sortMode === "featured" && !localOnly && !query.trim();

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
          <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm text-foreground/72">
            Search
            <input
              value={query}
              onChange={(event) => updateCatalogState({ query: event.target.value })}
              placeholder="Search title, description, or location"
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
            />
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
        </div>

        <div className="mt-4 rounded-[1.15rem] border border-border bg-background/55 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Current Slice
              </p>
              <p className="mt-2 text-sm text-foreground/72">{activeSliceSummary}</p>
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
                      sort: "featured",
                      localOnly: false,
                    });
                  }}
                  type="button"
                >
                  Reset View
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {filteredListings.length > 0 ? (
          filteredListings.map((listing) => {
            const recommendationBadge = getRecommendationBadge(listing, recommendedPreset);
            const isNewListing = Boolean(listing.is_new_listing);
            const locationLabel = getLocationLabel([listing.city, listing.state]);
            const isPopularNearYou =
              baseLocationLabel &&
              locationLabel === baseLocationLabel &&
              (listing.recent_transaction_count ?? 0) >= 3;

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
                  {listing.duration_minutes ? (
                    <span className="rounded-full bg-[#ece7dc] px-3 py-2 text-foreground/70">
                      {listing.duration_minutes} min
                    </span>
                  ) : null}
                  {listing.lead_time_hours ? (
                    <span className="rounded-full bg-[#ece7dc] px-3 py-2 text-foreground/70">
                      {listing.lead_time_hours} hr lead
                    </span>
                  ) : null}
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
          })
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-white/55 p-8 text-sm leading-6 text-foreground/66 lg:col-span-2">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
