"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { formatCurrency, type Listing } from "@/app/lib/api";

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
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
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

  function updateCatalogState(next: {
    type?: CatalogTypeFilter;
    query?: string;
    sort?: CatalogSort;
    localOnly?: boolean;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextType = next.type ?? typeFilter;
    const nextQuery = next.query ?? query;
    const nextSort = next.sort ?? sortMode;
    const nextLocalOnly = next.localOnly ?? localOnly;

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

    const nextQueryString = params.toString();
    router.replace(nextQueryString ? `${pathname}?${nextQueryString}` : pathname, {
      scroll: false,
    });
  }

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
        return 0;
      });
  }, [listings, localOnly, query, sortMode, typeFilter]);

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
    parts.push(`${filteredListings.length} result${filteredListings.length === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [dominantLocationLabel, filteredListings.length, localOnly, query, sortMode, typeFilter]);

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
          filteredListings.map((listing) => (
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
                  {localOnly ? (
                    <span className="rounded-full border border-accent/25 bg-accent/8 px-3 py-2 text-accent">
                      Local Match
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
          ))
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-white/55 p-8 text-sm leading-6 text-foreground/66 lg:col-span-2">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
