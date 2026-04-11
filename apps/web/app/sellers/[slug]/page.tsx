import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PublicCatalogPanel } from "@/app/components/public-catalog-panel";
import { ReviewReportButton } from "@/app/components/review-report-button";
import { getSellerStorefrontData } from "@/app/lib/server-data";

function getLocationLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ") || "Location pending";
}

function formatSellerRating(rating?: number, reviewCount?: number) {
  const safeRating = rating ?? 0;
  const safeReviewCount = reviewCount ?? 0;

  if (safeReviewCount <= 0) {
    return "New seller";
  }

  return `${safeRating.toFixed(1)} stars · ${safeReviewCount} review${safeReviewCount === 1 ? "" : "s"}`;
}

function formatSellerTrustScore(trustScore?: { score: number; label: string } | null) {
  if (!trustScore) {
    return "Trust score pending";
  }

  return `${trustScore.score}/100 · ${trustScore.label}`;
}

function buildStorefrontSliceHref(
  slug: string,
  params: Record<string, string | null | undefined | false>,
) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (!value) {
      return;
    }

    searchParams.set(key, value);
  });

  const query = searchParams.toString();
  return query ? `/sellers/${slug}?${query}` : `/sellers/${slug}`;
}

function getActiveStorefrontHighlight(input: {
  availableToday: boolean;
  quickBookingOnly: boolean;
  localOnly: boolean;
  promotedOnly: boolean;
  type: string | null;
}) {
  if (input.promotedOnly) {
    return {
      label: "Promoted Picks",
      description: "Showing this seller's highlighted listings first so you can browse the inventory they want to feature most.",
    };
  }

  if (input.type === "product") {
    return {
      label: "Products First",
      description: "Showing this seller's product inventory first so you can shop physical items without mixing in services.",
    };
  }

  if (input.type === "service") {
    return {
      label: "Services First",
      description: "Showing this seller's service offers first so you can compare bookable work without browsing products.",
    };
  }

  if (input.quickBookingOnly) {
    return {
      label: "Quick Booking",
      description: "Showing this seller's same-day and low-notice services first.",
    };
  }

  if (input.availableToday) {
    return {
      label: "Ready Today",
      description: "Showing listings that can be ordered or requested without waiting for another day.",
    };
  }

  if (input.localOnly) {
    return {
      label: "Local Only",
      description: "Showing this seller's local-first listings for nearby fulfillment and services.",
    };
  }

  return null;
}

function getRankedStorefrontLanes(
  lanes: Array<{ label: string; count: number }>,
) {
  return [...lanes]
    .filter((lane) => lane.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function getStorefrontLaneHref(slug: string, label: string) {
  switch (label) {
    case "Ready Today":
      return buildStorefrontSliceHref(slug, { available: "1" });
    case "Quick Booking":
      return buildStorefrontSliceHref(slug, { quick_booking: "1" });
    case "Products First":
      return buildStorefrontSliceHref(slug, { type: "product" });
    case "Services First":
      return buildStorefrontSliceHref(slug, { type: "service" });
    case "Local Only":
      return buildStorefrontSliceHref(slug, { local: "1" });
    case "Promoted Picks":
      return buildStorefrontSliceHref(slug, { promoted: "1" });
    default:
      return `/sellers/${slug}`;
  }
}

export default async function SellerStorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const { seller, sellerListingSummary, subscription, listings, reviews } =
    await getSellerStorefrontData(slug);

  if (!seller) {
    notFound();
  }

  const productCount = sellerListingSummary?.product_count ?? listings.filter((listing) => listing.type === "product").length;
  const serviceCount = sellerListingSummary?.service_count ?? listings.filter((listing) => listing.type === "service").length;
  const hybridCount = sellerListingSummary?.hybrid_count ?? listings.filter((listing) => listing.type === "hybrid").length;
  const availableTodayCount = sellerListingSummary?.available_today_count ?? listings.filter((listing) => listing.available_today).length;
  const quickBookingCount = sellerListingSummary?.quick_booking_count ?? listings.filter((listing) => {
    const supportsBooking = Boolean(listing.requires_booking || listing.type !== "product");

    if (!supportsBooking) {
      return false;
    }

    return (
      listing.available_today ||
      listing.lead_time_hours === 0 ||
      (typeof listing.lead_time_hours === "number" && listing.lead_time_hours <= 4)
    );
  }).length;
  const localOnlyCount = sellerListingSummary?.local_only_count ?? listings.filter((listing) => listing.is_local_only).length;
  const promotedCount = sellerListingSummary?.promoted_count ?? listings.filter((listing) => listing.is_promoted).length;
  const rankedStorefrontLanes = getRankedStorefrontLanes([
    { label: "Ready Today", count: availableTodayCount },
    { label: "Quick Booking", count: quickBookingCount },
    { label: "Products First", count: productCount },
    { label: "Services First", count: serviceCount },
    { label: "Local Only", count: localOnlyCount },
    { label: "Promoted Picks", count: promotedCount },
  ]);
  const dominantStorefrontLane = rankedStorefrontLanes[0] ?? null;
  const activeStorefrontHighlight = getActiveStorefrontHighlight({
    availableToday: resolvedSearchParams.available === "1",
    quickBookingOnly: resolvedSearchParams.quick_booking === "1",
    localOnly: resolvedSearchParams.local === "1",
    promotedOnly: resolvedSearchParams.promoted === "1",
    type: typeof resolvedSearchParams.type === "string" ? resolvedSearchParams.type : null,
  });
  const suggestedStorefrontLane =
    activeStorefrontHighlight && dominantStorefrontLane?.label === activeStorefrontHighlight.label
      ? rankedStorefrontLanes.find((lane) => lane.label !== activeStorefrontHighlight.label) ?? null
      : null;
  const hasPremiumStorefront = Boolean(subscription?.premium_storefront);
  const highlightedPerks = [
    subscription?.analytics_enabled ? "Seller analytics included" : null,
    subscription?.priority_visibility ? "Priority discovery placement" : null,
    subscription?.premium_storefront ? "Premium storefront presentation" : null,
  ].filter(Boolean) as string[];

  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section
          className={`card-shadow overflow-hidden rounded-[2rem] border border-border ${
            hasPremiumStorefront
              ? "bg-[radial-gradient(circle_at_top_left,_rgba(15,95,98,0.18),_transparent_38%),linear-gradient(135deg,#fffaf1_0%,#f5efe2_45%,#eef7f4_100%)]"
              : "bg-surface-strong"
          }`}
        >
          <div className="grid gap-6 px-6 py-8 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-10">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.28em] text-accent-deep/75">
                <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1">
                  Seller Storefront
                </span>
                <span>Local marketplace + booking</span>
                {hasPremiumStorefront ? (
                  <span className="rounded-full border border-[#0f5f62]/20 bg-[#0f5f62] px-3 py-1 text-white">
                    Premium
                  </span>
                ) : null}
              </div>
              <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                  {seller.is_verified ? (
                    <span className="rounded-full bg-[#e4f1ed] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f5f62]">
                      Verified Seller
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#ece7dc] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/72">
                      Community Seller
                    </span>
                  )}
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                    {formatSellerRating(seller.average_rating, seller.review_count)}
                  </span>
                  <span className="rounded-full border border-[#0f5f62]/15 bg-[#e4f1ed] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f5f62]">
                    {formatSellerTrustScore(seller.trust_score)}
                  </span>
                </div>
                <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">
                  {seller.display_name}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-foreground/72 sm:text-lg">
                  {seller.bio ??
                    "This seller is live in the marketplace. Browse listings, service offers, and hybrid local commerce inventory below."}
                </p>
                {activeStorefrontHighlight ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-accent/20 bg-accent/8 px-4 py-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-deep/72">
                        Active Storefront Lane
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/76">
                        <span className="font-semibold text-foreground">{activeStorefrontHighlight.label}</span>
                        {" · "}
                        {activeStorefrontHighlight.description}
                      </p>
                    </div>
                    <Link
                      href={`/sellers/${seller.slug}`}
                      className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                    >
                      Clear lane
                    </Link>
                  </div>
                ) : null}
                {subscription?.perks_summary ? (
                  <p className="max-w-2xl rounded-[1.2rem] border border-border/70 bg-white/70 px-4 py-3 text-sm leading-6 text-foreground/68">
                    {subscription.perks_summary}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Live Listings" value={String(sellerListingSummary?.total ?? listings.length)} tone="accent" />
                <MetricCard label="Products" value={String(productCount)} tone="olive" />
                <MetricCard label="Services + Hybrid" value={String(serviceCount + hybridCount)} tone="gold" />
              </div>
              {highlightedPerks.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {highlightedPerks.map((perk) => (
                    <span
                      key={perk}
                      className="rounded-full border border-[#0f5f62]/15 bg-[#e4f1ed] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0f5f62]"
                    >
                      {perk}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="card-shadow rounded-[1.6rem] border border-border bg-[#fff8ed] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/55">
                    Public Seller Snapshot
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                    {getLocationLabel([seller.city, seller.state, seller.country])}
                  </h2>
                </div>
                <div className="rounded-2xl border border-accent/20 bg-accent px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white">
                  Live
                </div>
              </div>
              <div className="mt-6 grid gap-3 text-sm text-foreground/72">
                <InfoRow label="Slug" value={seller.slug} />
                <InfoRow
                  label="Verification"
                  value={seller.is_verified ? "Verified seller" : "Not yet verified"}
                />
                <InfoRow
                  label="Reputation"
                  value={formatSellerRating(seller.average_rating, seller.review_count)}
                />
                <InfoRow
                  label="Trust Score"
                  value={formatSellerTrustScore(seller.trust_score)}
                />
                <InfoRow
                  label="Custom Orders"
                  value={seller.accepts_custom_orders ? "Enabled" : "Disabled"}
                />
                <InfoRow
                  label="Storefront tier"
                  value={subscription?.tier_name ?? "Standard"}
                />
                <InfoRow label="Products" value={String(productCount)} />
                <InfoRow label="Services" value={String(serviceCount)} />
                <InfoRow label="Hybrid" value={String(hybridCount)} />
              </div>
              {seller.trust_score ? (
                <div className="mt-6 rounded-[1.2rem] border border-[#0f5f62]/15 bg-[#eef7f4] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0f5f62]/72">
                        Trust Score
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                        {seller.trust_score.score}/100
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#0f5f62]">
                        {seller.trust_score.label}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[#0f5f62]/15 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0f5f62]">
                      Phase 6
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-foreground/72">
                    {seller.trust_score.summary}
                  </p>
                  <div className="mt-4 grid gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/64 sm:grid-cols-2">
                    <TrustScoreStat label="Reviews" value={`${seller.trust_score.review_count}`} />
                    <TrustScoreStat
                      label="Response"
                      value={`${Math.round(seller.trust_score.response_rate * 100)}%`}
                    />
                    <TrustScoreStat
                      label="Completion"
                      value={`${Math.round(seller.trust_score.completion_rate * 100)}%`}
                    />
                    <TrustScoreStat
                      label="Delivery"
                      value={`${Math.round(seller.trust_score.delivery_success_rate * 100)}%`}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                Storefront Highlights
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                Jump into the best ways to shop this seller
              </h2>
              {dominantStorefrontLane && !activeStorefrontHighlight ? (
                <p className="mt-2 text-sm text-foreground/60">
                  Strongest lane right now:{" "}
                  <span className="font-semibold text-foreground">{dominantStorefrontLane.label}</span>
                </p>
              ) : null}
              {suggestedStorefrontLane ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-foreground/60">
                    Next good lane to compare:{" "}
                    <span className="font-semibold text-foreground">{suggestedStorefrontLane.label}</span>
                  </p>
                  <Link
                    href={getStorefrontLaneHref(seller.slug, suggestedStorefrontLane.label)}
                    className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Compare lane
                  </Link>
                </div>
              ) : null}
            </div>
            <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/58">
              Buyer shortcuts
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <StorefrontShortcutCard
              count={availableTodayCount}
              description="Listings that can be ordered or requested without waiting for another day."
              href={buildStorefrontSliceHref(seller.slug, { available: "1" })}
              label="Ready Today"
              isDominant={
                dominantStorefrontLane?.label === "Ready Today" &&
                activeStorefrontHighlight?.label !== "Ready Today"
              }
              tone="emerald"
            />
            <StorefrontShortcutCard
              count={quickBookingCount}
              description="Services and hybrids that support same-day or low-notice booking windows."
              href={buildStorefrontSliceHref(seller.slug, { quick_booking: "1" })}
              label="Quick Booking"
              isDominant={
                dominantStorefrontLane?.label === "Quick Booking" &&
                activeStorefrontHighlight?.label !== "Quick Booking"
              }
              tone="sky"
            />
            <StorefrontShortcutCard
              count={productCount}
              description="Jump into this seller's product inventory without mixing in service offers first."
              href={buildStorefrontSliceHref(seller.slug, { type: "product" })}
              label="Products First"
              isDominant={
                dominantStorefrontLane?.label === "Products First" &&
                activeStorefrontHighlight?.label !== "Products First"
              }
              tone="olive"
            />
            <StorefrontShortcutCard
              count={serviceCount}
              description="Jump into this seller's bookable services without mixing in product inventory first."
              href={buildStorefrontSliceHref(seller.slug, { type: "service" })}
              label="Services First"
              isDominant={
                dominantStorefrontLane?.label === "Services First" &&
                activeStorefrontHighlight?.label !== "Services First"
              }
              tone="gold"
            />
            <StorefrontShortcutCard
              count={localOnlyCount}
              description="Local-first listings that keep fulfillment close to the seller's community."
              href={buildStorefrontSliceHref(seller.slug, { local: "1" })}
              label="Local Only"
              isDominant={
                dominantStorefrontLane?.label === "Local Only" &&
                activeStorefrontHighlight?.label !== "Local Only"
              }
              tone="accent"
            />
            <StorefrontShortcutCard
              count={promotedCount}
              description="Browse the seller's highlighted listings first to see the items and services they are pushing right now."
              href={buildStorefrontSliceHref(seller.slug, { promoted: "1" })}
              label="Promoted Picks"
              isDominant={
                dominantStorefrontLane?.label === "Promoted Picks" &&
                activeStorefrontHighlight?.label !== "Promoted Picks"
              }
              tone="rose"
            />
          </div>
        </section>

        <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                Storefront Catalog
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                Browse what this seller is actively offering
              </h2>
            </div>
            <Link
              href="/"
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
            >
              Back to Marketplace
            </Link>
          </div>

          <Suspense
            fallback={
              <div className="mt-6 rounded-[1.5rem] border border-border bg-white/55 p-8 text-sm leading-6 text-foreground/66">
                Loading catalog...
              </div>
            }
          >
            <PublicCatalogPanel
              emptyText="This seller is live, but there are no active listings on the public marketplace yet."
              listings={listings}
              listingsTotal={sellerListingSummary?.total ?? listings.length}
            />
          </Suspense>
        </section>

        <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                Recent Reviews
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                What buyers have said so far
              </h2>
            </div>
            <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/58">
              {reviews.length} shown
            </span>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {reviews.length > 0 ? (
              reviews.map((review) => (
                <article
                  key={review.id}
                  className="rounded-[1.4rem] border border-border bg-white/70 px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[#f3e1bd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c3a10]">
                      {review.rating}/5
                    </span>
                    <span className="text-xs text-foreground/52">
                      {new Date(review.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-foreground/72">
                    {review.comment ?? "Buyer left a rating without a written comment."}
                  </p>
                  {review.seller_response ? (
                    <div className="mt-4 rounded-[1rem] border border-border bg-[#f7f0e2] px-3 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/48">
                        Seller Response
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/72">
                        {review.seller_response}
                      </p>
                    </div>
                  ) : null}
                  <ReviewReportButton reviewId={review.id} />
                </article>
              ))
            ) : (
              <div className="rounded-[1.4rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66 lg:col-span-3">
                No public reviews yet. The storefront still shows verification and aggregate reputation signals.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "olive" | "gold";
}) {
  const tones = {
    accent: "bg-accent text-white",
    olive: "bg-olive text-white",
    gold: "bg-gold text-foreground",
  };

  return (
    <div className={`rounded-[1.4rem] p-4 ${tones[tone]}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] opacity-80">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/45">
        {label}
      </span>
      <span className="max-w-[65%] text-right">{value}</span>
    </div>
  );
}

function StorefrontShortcutCard({
  label,
  count,
  description,
  href,
  isDominant,
  tone,
}: {
  label: string;
  count: number;
  description: string;
  href: string;
  isDominant?: boolean;
  tone: "emerald" | "sky" | "accent" | "gold" | "olive" | "rose";
}) {
  const tones = {
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
    sky: "border-sky-300 bg-sky-50 text-sky-900",
    accent: "border-accent/25 bg-accent/8 text-accent-deep",
    gold: "border-amber-300 bg-amber-50 text-amber-900",
    olive: "border-[#7f8f54]/25 bg-[#eef3df] text-[#4e5a2a]",
    rose: "border-[#d48b7d]/25 bg-[#fbe8e1] text-[#9a4d3c]",
  };

  return (
    <Link
      href={href}
      className={`rounded-[1.4rem] border bg-white/70 p-5 transition hover:-translate-y-0.5 hover:border-accent ${
        isDominant ? "border-accent/40 shadow-[0_10px_30px_rgba(15,95,98,0.08)]" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
            {label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{count}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isDominant ? (
            <span className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-deep">
              Strongest lane
            </span>
          ) : null}
          <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${tones[tone]}`}>
            Open slice
          </span>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-foreground/68">{description}</p>
    </Link>
  );
}

function TrustScoreStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1rem] border border-[#0f5f62]/12 bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-foreground/48">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
