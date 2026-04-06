import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PublicCatalogPanel } from "@/app/components/public-catalog-panel";
import { ReviewReportButton } from "@/app/components/review-report-button";
import { getSellerStorefrontData } from "@/app/lib/api";

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

export default async function SellerStorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { seller, listings, reviews } = await getSellerStorefrontData(slug);

  if (!seller) {
    notFound();
  }

  const productCount = listings.filter((listing) => listing.type === "product").length;
  const serviceCount = listings.filter((listing) => listing.type === "service").length;
  const hybridCount = listings.filter((listing) => listing.type === "hybrid").length;

  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="card-shadow overflow-hidden rounded-[2rem] border border-border bg-surface-strong">
          <div className="grid gap-6 px-6 py-8 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-10">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.28em] text-accent-deep/75">
                <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1">
                  Seller Storefront
                </span>
                <span>Local marketplace + booking</span>
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
                </div>
                <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">
                  {seller.display_name}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-foreground/72 sm:text-lg">
                  {seller.bio ??
                    "This seller is live in the marketplace. Browse listings, service offers, and hybrid local commerce inventory below."}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Live Listings" value={String(listings.length)} tone="accent" />
                <MetricCard label="Products" value={String(productCount)} tone="olive" />
                <MetricCard label="Services + Hybrid" value={String(serviceCount + hybridCount)} tone="gold" />
              </div>
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
                  label="Custom Orders"
                  value={seller.accepts_custom_orders ? "Enabled" : "Disabled"}
                />
                <InfoRow label="Products" value={String(productCount)} />
                <InfoRow label="Services" value={String(serviceCount)} />
                <InfoRow label="Hybrid" value={String(hybridCount)} />
              </div>
            </div>
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
