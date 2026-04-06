import Image from "next/image";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListingContextBar } from "@/app/listings/[id]/listing-context-bar";
import { ReviewReportButton } from "@/app/components/review-report-button";
import { BuyerActionPanel } from "@/app/listings/[id]/buyer-action-panel";
import { formatCurrency, getListingDetailData } from "@/app/lib/api";

function getLocationLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ") || "Location pending";
}

function getFulfillmentLabel(listing: {
  pickup_enabled?: boolean;
  meetup_enabled?: boolean;
  delivery_enabled?: boolean;
  shipping_enabled?: boolean;
}) {
  return [
    listing.pickup_enabled ? "Pickup" : null,
    listing.meetup_enabled ? "Meetup" : null,
    listing.delivery_enabled ? "Delivery" : null,
    listing.shipping_enabled ? "Shipping" : null,
  ].filter(Boolean).join(", ") || "Seller has not configured methods yet";
}

function formatSellerRating(rating?: number, reviewCount?: number) {
  const safeRating = rating ?? 0;
  const safeReviewCount = reviewCount ?? 0;

  if (safeReviewCount <= 0) {
    return "New seller";
  }

  return `${safeRating.toFixed(1)} stars · ${safeReviewCount} review${safeReviewCount === 1 ? "" : "s"}`;
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { listing, seller, reviews } = await getListingDetailData(id);

  if (!listing) {
    notFound();
  }

  const canOrder = listing.type !== "service";
  const canBook = Boolean(listing.requires_booking || listing.type !== "product");
  const primaryAction = canBook && !canOrder ? "booking" : "order";

  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow overflow-hidden rounded-[2rem] border border-border bg-surface-strong">
          <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="relative min-h-[360px] bg-[#ead8ba]">
              {listing.images?.[0]?.image_url ? (
                <Image
                  alt={listing.images[0].alt_text ?? listing.title}
                  className="h-full w-full object-cover"
                  fill
                  src={listing.images[0].image_url}
                  unoptimized
                />
              ) : (
                <div className="flex h-full min-h-[360px] items-center justify-center bg-[radial-gradient(circle_at_top,#f6dfb7,transparent_55%),linear-gradient(135deg,#d1b17c,#a77c42)]">
                  <span className="rounded-full border border-white/40 bg-white/20 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-white/90">
                    {listing.type}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-5 px-6 py-8 sm:px-8">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.28em] text-accent-deep/75">
                <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1">
                  Public Listing
                </span>
                <span>{seller?.display_name ?? "Marketplace seller"}</span>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-background">
                    {listing.type}
                  </span>
                  {seller?.is_verified ? (
                    <span className="rounded-full bg-[#e4f1ed] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f5f62]">
                      Verified Seller
                    </span>
                  ) : null}
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                    {canBook ? "Booking Ready" : "Order Flow"}
                  </span>
                  {listing.is_local_only ? (
                    <span className="rounded-full bg-[#f3e1bd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c3a10]">
                      Local Only
                    </span>
                  ) : null}
                </div>
                <h1 className="text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">
                  {listing.title}
                </h1>
                <p className="text-base leading-7 text-foreground/72 sm:text-lg">
                  {listing.description}
                </p>
                <div className="flex flex-wrap items-center gap-4 text-sm text-foreground/68">
                  <span>{getLocationLabel([listing.city, listing.state, listing.country])}</span>
                  <span>Status: {listing.status.replaceAll("_", " ")}</span>
                  {seller ? (
                    <span>{formatSellerRating(seller.average_rating, seller.review_count)}</span>
                  ) : null}
                </div>
                <p className="text-3xl font-semibold tracking-[-0.04em] text-[#8f3f17]">
                  {formatCurrency(listing.price_cents, listing.currency)}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-border bg-white/70 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Primary Action
                </p>
                <p className="mt-3 text-lg font-semibold text-foreground">
                  {primaryAction === "booking" ? "Request Booking" : "Place Order"}
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground/68">
                  {primaryAction === "booking"
                    ? "This listing is tuned for booking-first service flow. Use mobile to request a live booking now."
                    : "This listing is ready for order flow. Use mobile to place a live order against the backend now."}
                </p>
              </div>

              <Suspense fallback={null}>
                <ListingContextBar storefrontHref={seller?.slug ? `/sellers/${seller.slug}` : null} />
              </Suspense>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
              How This Listing Works
            </p>
            <div className="mt-4 grid gap-4 text-sm text-foreground/72 sm:grid-cols-2">
              <InfoCard label="Fulfillment" value={getFulfillmentLabel(listing)} />
              <InfoCard
                label="Booking"
                value={canBook ? "Accepts booking requests" : "Order flow only"}
              />
              <InfoCard
                label="Service Time"
                value={
                  listing.duration_minutes
                    ? `${listing.duration_minutes} minutes`
                    : "No duration set"
                }
              />
              <InfoCard
                label="Lead Time"
                value={
                  listing.lead_time_hours
                    ? `${listing.lead_time_hours} hours`
                    : "Ready without extra lead time"
                }
              />
              <InfoCard
                label="Seller Trust"
                value={
                  seller
                    ? `${seller.is_verified ? "Verified seller" : "Community seller"} · ${formatSellerRating(
                        seller.average_rating,
                        seller.review_count,
                      )}`
                    : "Seller reputation is loading"
                }
              />
            </div>
          </div>

          <BuyerActionPanel
            listing={listing}
            sellerDisplayName={seller?.display_name ?? null}
          />
        </section>

        <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                Recent Reviews
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                Evidence behind the seller trust signals
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
                No public reviews yet. Buyers can still use the seller verification and aggregate rating as trust context.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border border-border bg-white/70 px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
        {label}
      </p>
      <p className="mt-3 leading-6">{value}</p>
    </div>
  );
}
