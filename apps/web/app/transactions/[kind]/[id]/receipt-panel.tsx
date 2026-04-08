"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type Booking,
  type Listing,
  type Order,
  type ReviewRead,
} from "@/app/lib/api";
import { restoreBuyerSession } from "@/app/lib/buyer-auth";

type ReceiptPanelProps = {
  kind: "order" | "booking";
  id: string;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRecommendedBrowsePreset(input: {
  listings: {
    id: string;
    type: string;
    is_local_only?: boolean | null;
  }[];
  orders: {
    items?: { listing_id: string }[] | null;
  }[];
  bookings: {
    listing_id: string;
    listing_type?: string | null;
  }[];
}) {
  const productScore = input.orders.reduce((count, order) => {
    const matchingListings = (order.items ?? [])
      .map((item) => input.listings.find((listing) => listing.id === item.listing_id))
      .filter((listing): listing is (typeof input.listings)[number] => Boolean(listing));

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
          (itemListing) => itemListing.id === item.listing_id && itemListing.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) =>
      input.listings.some(
        (itemListing) => itemListing.id === booking.listing_id && itemListing.is_local_only,
      ),
    ).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (itemListing) => itemListing.id === item.listing_id && itemListing.type === "hybrid",
        ),
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) => booking.listing_type === "hybrid").length;

  if (localScore >= Math.max(productScore, serviceScore, hybridScore) && localScore > 0) {
    return { label: "Local-First" as const };
  }

  if (serviceScore >= Math.max(productScore, hybridScore) && serviceScore > 0) {
    return { label: "Services" as const };
  }

  if (hybridScore >= Math.max(productScore, serviceScore) && hybridScore > 0) {
    return { label: "Hybrid" as const };
  }

  if (productScore > 0) {
    return { label: "Products" as const };
  }

  return null;
}

function getRecommendationScore(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: "Local-First" | "Services" | "Hybrid" | "Products" } | null,
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

function getRecommendationMatch(
  listing: {
    type: string;
    is_local_only?: boolean | null;
  },
  preset: { label: "Local-First" | "Services" | "Hybrid" | "Products" } | null,
) {
  const score = getRecommendationScore(listing, preset);
  if (score === 0 || !preset) {
    return null;
  }

  if (preset.label === "Local-First") {
    return { score, label: "Local match" };
  }

  if (preset.label === "Services") {
    return { score, label: "Service fit" };
  }

  if (preset.label === "Products") {
    return { score, label: "Product fit" };
  }

  return { score, label: "Hybrid fit" };
}

function getSuggestionSecondarySignal(listing: {
  duration_minutes?: number | null;
  price_cents?: number | null;
  currency?: string | null;
}) {
  if (listing.duration_minutes) {
    return `${listing.duration_minutes} min`;
  }

  if (listing.price_cents != null && listing.currency) {
    return formatCurrency(listing.price_cents, listing.currency);
  }

  return "Open";
}

function getSuggestionActionMode(listing: {
  requires_booking?: boolean | null;
  type: string;
}) {
  return listing.requires_booking || listing.type === "service" ? "Booking ready" : "Order ready";
}

function getSuggestionSellerLabel(
  suggestion: { seller_id: string },
  currentSellerId: string | null,
) {
  if (!currentSellerId) {
    return "Marketplace seller";
  }

  return suggestion.seller_id === currentSellerId ? "Same seller" : "Another seller";
}

function getSuggestionSellerPriority(
  suggestion: { seller_id: string },
  currentSellerId: string | null,
) {
  if (!currentSellerId) {
    return 0;
  }

  return suggestion.seller_id === currentSellerId ? 1 : 0;
}

function buildListingHref(
  listingId: string,
  safeFromHref: string | null,
  followOn: "same-seller" | "cross-seller",
) {
  const params = new URLSearchParams();
  if (safeFromHref) {
    params.set("from", safeFromHref);
  }
  params.set("followOn", followOn);
  const query = params.toString();

  return `/listings/${listingId}${query ? `?${query}` : ""}`;
}

export function ReceiptPanel({ kind, id }: ReceiptPanelProps) {
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewRead | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [moreLikeThisListings, setMoreLikeThisListings] = useState<
    (Listing & { recommendationLabel: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const safeFromHref = (() => {
    const fromParam = searchParams.get("from");
    if (!fromParam || !fromParam.startsWith("/") || fromParam.startsWith("//")) {
      return null;
    }

    return fromParam;
  })();
  const originSliceSummary = (() => {
    if (!safeFromHref) {
      return null;
    }

    const parsedUrl = new URL(safeFromHref, "https://marketplace.local");
    const params = parsedUrl.searchParams;
    const parts: string[] = [];
    const type = params.get("type");
    const sort = params.get("sort");
    const local = params.get("local");
    const query = params.get("q")?.trim();

    if (type && type !== "all") {
      parts.push(titleCaseLabel(type));
    }
    if (local === "1") {
      parts.push("Local Only");
    }
    if (sort === "price_low") {
      parts.push("Lowest Price");
    }
    if (sort === "price_high") {
      parts.push("Highest Price");
    }
    if (query) {
      parts.push(`Search: "${query}"`);
    }

    return parts.length > 0 ? parts.join(" · ") : "Default marketplace slice";
  })();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await restoreBuyerSession();
        if (!session) {
          if (!cancelled) {
            setError("Buyer session is not available. Sign in again from a listing page.");
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setAccessToken(session.access_token);
          setReviewLoading(true);
        }

        if (kind === "order") {
          const nextOrder = await api.getOrderById(id, { accessToken: session.access_token });
          const reviewLookup = await api.getMyReviewLookup(
            { orderId: id },
            session.access_token,
          );
          const dashboard = await api.loadBuyerDashboard(session.access_token);
          const preset = getRecommendedBrowsePreset({
            listings: dashboard.listings,
            orders: dashboard.orders,
            bookings: dashboard.bookings,
          });
          if (!cancelled) {
            setOrder(nextOrder);
            setReview(reviewLookup.review ?? null);
            setMoreLikeThisListings(
              dashboard.listings
                .filter((item) => item.id !== nextOrder.items?.[0]?.listing_id)
                .map((item) => ({
                  listing: item,
                  match: getRecommendationMatch(item, preset),
                }))
                .filter((item): item is {
                  listing: (typeof dashboard.listings)[number];
                  match: { score: number; label: string };
                } => Boolean(item.match))
                .sort((left, right) => {
                  const rightSellerPriority = getSuggestionSellerPriority(
                    right.listing,
                    nextOrder.seller_id,
                  );
                  const leftSellerPriority = getSuggestionSellerPriority(
                    left.listing,
                    nextOrder.seller_id,
                  );
                  if (rightSellerPriority !== leftSellerPriority) {
                    return rightSellerPriority - leftSellerPriority;
                  }

                  if (right.match.score !== left.match.score) {
                    return right.match.score - left.match.score;
                  }

                  return new Date(right.listing.created_at).getTime() - new Date(left.listing.created_at).getTime();
                })
                .slice(0, 3)
                .map((item) => ({ ...item.listing, recommendationLabel: item.match.label })),
            );
          }
        } else {
          const nextBooking = await api.getBookingById(id, { accessToken: session.access_token });
          const reviewLookup = await api.getMyReviewLookup(
            { bookingId: id },
            session.access_token,
          );
          const dashboard = await api.loadBuyerDashboard(session.access_token);
          const preset = getRecommendedBrowsePreset({
            listings: dashboard.listings,
            orders: dashboard.orders,
            bookings: dashboard.bookings,
          });
          if (!cancelled) {
            setBooking(nextBooking);
            setReview(reviewLookup.review ?? null);
            setMoreLikeThisListings(
              dashboard.listings
                .filter((item) => item.id !== nextBooking.listing_id)
                .map((item) => ({
                  listing: item,
                  match: getRecommendationMatch(item, preset),
                }))
                .filter((item): item is {
                  listing: (typeof dashboard.listings)[number];
                  match: { score: number; label: string };
                } => Boolean(item.match))
                .sort((left, right) => {
                  const rightSellerPriority = getSuggestionSellerPriority(
                    right.listing,
                    nextBooking.seller_id,
                  );
                  const leftSellerPriority = getSuggestionSellerPriority(
                    left.listing,
                    nextBooking.seller_id,
                  );
                  if (rightSellerPriority !== leftSellerPriority) {
                    return rightSellerPriority - leftSellerPriority;
                  }

                  if (right.match.score !== left.match.score) {
                    return right.match.score - left.match.score;
                  }

                  return new Date(right.listing.created_at).getTime() - new Date(left.listing.created_at).getTime();
                })
                .slice(0, 3)
                .map((item) => ({ ...item.listing, recommendationLabel: item.match.label })),
            );
          }
        }
      } catch (receiptError) {
        if (!cancelled) {
          setError(
            receiptError instanceof Error
              ? receiptError.message
              : "Unable to load this transaction receipt.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setReviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, kind]);

  if (loading) {
    return (
      <div className="rounded-[1.5rem] border border-border bg-white/70 p-6 text-sm text-foreground/66">
        Loading receipt...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[1.5rem] border border-[#efb4ae] bg-[#fff0ef] p-6 text-sm text-[#9a3428]">
        {error}
      </div>
    );
  }

  if (kind === "order" && order) {
    return (
      <div className="space-y-6">
        <ReceiptContextBar originSliceSummary={originSliceSummary} safeFromHref={safeFromHref} />
        <ReceiptHero
          eyebrow="Order Receipt"
          title="Order submitted successfully."
          subtitle="The seller queue now has this order and can move it through the workflow."
        />
        <ReceiptCard
          title="Summary"
          rows={[
            ["Order ID", order.id],
            ["Status", order.status.replaceAll("_", " ")],
            ["Fulfillment", order.fulfillment],
            ["Subtotal", formatCurrency(order.subtotal_cents, order.currency)],
            ...(order.fulfillment === "delivery" || order.fulfillment === "shipping"
              ? [[
                  order.fulfillment === "shipping"
                    ? "Platform-added shipping fee"
                    : "Platform-added delivery fee",
                  formatCurrency(order.delivery_fee_cents, order.currency),
                ] as [string, string]]
              : []),
            ["Platform fee", formatCurrency(order.platform_fee_cents, order.currency)],
            ["Total", formatCurrency(order.total_cents, order.currency)],
            ["Seller update", order.seller_response_note ?? "No seller note yet"],
            ["Notes", order.notes ?? "No notes added"],
          ]}
        />
        <ReceiptCard
          title="Requested Items"
          rows={(order.items ?? []).length > 0
            ? (order.items ?? []).map((item) => [
                `${item.quantity}x ${item.listing_title ?? item.listing_id}`,
                formatCurrency(item.total_price_cents, order.currency),
              ])
            : [["Items", "No item detail is available for this order yet."]]}
        />
        {moreLikeThisListings.length > 0 ? (
          <ReceiptMoreLikeThis
            currentSellerId={order.seller_id}
            listings={moreLikeThisListings}
            safeFromHref={safeFromHref}
          />
        ) : null}
        <ReviewSection
          accessToken={accessToken}
          comment={comment}
          kind="order"
          onCommentChange={setComment}
          onFeedbackChange={setReviewFeedback}
          onRatingChange={setRating}
          onReviewCreated={setReview}
          rating={rating}
          review={review}
          reviewFeedback={reviewFeedback}
          reviewLoading={reviewLoading}
          reviewSubmitting={reviewSubmitting}
          setReviewSubmitting={setReviewSubmitting}
          transactionId={order.id}
          transactionStatus={order.status}
        />
      </div>
    );
  }

  if (kind === "booking" && booking) {
    return (
      <div className="space-y-6">
        <ReceiptContextBar originSliceSummary={originSliceSummary} safeFromHref={safeFromHref} />
        <ReceiptHero
          eyebrow="Booking Receipt"
          title="Booking requested successfully."
          subtitle="The seller queue now has this booking request and can confirm or decline it."
        />
        <ReceiptCard
          title="Summary"
          rows={[
            ["Booking ID", booking.id],
            ["Status", booking.status.replaceAll("_", " ")],
            ["Listing", booking.listing_title ?? booking.listing_id],
            ["Starts", new Date(booking.scheduled_start).toLocaleString()],
            ["Ends", new Date(booking.scheduled_end).toLocaleString()],
            ["Total", formatCurrency(booking.total_cents, booking.currency)],
            ["Seller update", booking.seller_response_note ?? "No seller note yet"],
            ["Notes", booking.notes ?? "No notes added"],
          ]}
        />
        {moreLikeThisListings.length > 0 ? (
          <ReceiptMoreLikeThis
            currentSellerId={booking.seller_id}
            listings={moreLikeThisListings}
            safeFromHref={safeFromHref}
          />
        ) : null}
        <ReviewSection
          accessToken={accessToken}
          comment={comment}
          kind="booking"
          onCommentChange={setComment}
          onFeedbackChange={setReviewFeedback}
          onRatingChange={setRating}
          onReviewCreated={setReview}
          rating={rating}
          review={review}
          reviewFeedback={reviewFeedback}
          reviewLoading={reviewLoading}
          reviewSubmitting={reviewSubmitting}
          setReviewSubmitting={setReviewSubmitting}
          transactionId={booking.id}
          transactionStatus={booking.status}
        />
      </div>
    );
  }

  return (
    <div className="rounded-[1.5rem] border border-border bg-white/70 p-6 text-sm text-foreground/66">
      Receipt data is not available yet.
    </div>
  );
}

function ReceiptMoreLikeThis({
  currentSellerId,
  listings,
  safeFromHref,
}: {
  currentSellerId: string | null;
  listings: (Listing & { recommendationLabel: string })[];
  safeFromHref: string | null;
}) {
  const sameSellerListings = currentSellerId
    ? listings.filter((listing) => listing.seller_id === currentSellerId)
    : [];
  const otherSellerListings = currentSellerId
    ? listings.filter((listing) => listing.seller_id !== currentSellerId)
    : listings;

  return (
    <div className="rounded-[1.5rem] border border-border bg-white/72 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
        More Like This
      </p>
      {sameSellerListings.length > 0 ? (
        <div className="mt-3 space-y-2">
          {otherSellerListings.length > 0 ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
              More from this seller
            </p>
          ) : null}
          {sameSellerListings.map((listing) => (
            <Link
              key={listing.id}
              className="flex items-start gap-3 rounded-[1rem] border border-border bg-[#f9f1e2] px-4 py-3 transition hover:border-accent hover:text-accent"
              href={buildListingHref(listing.id, safeFromHref, "same-seller")}
            >
              {listing.images?.[0]?.image_url ? (
                <Image
                  alt={listing.images[0].alt_text ?? listing.title}
                  className="h-[76px] w-[76px] rounded-[0.9rem] object-cover"
                  height={76}
                  src={listing.images[0].image_url}
                  unoptimized
                  width={76}
                />
              ) : (
                <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[0.9rem] bg-[#d9c7a8] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4d4338]">
                  {listing.type}
                </div>
              )}
              <span className="flex-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="block text-sm font-semibold text-foreground">{listing.title}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
                    {getSuggestionSecondarySignal(listing)}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
                  {listing.type} · {listing.is_local_only ? "Local Only" : "Open Reach"}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0f5f62]">
                    {listing.recommendationLabel}
                  </span>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7c3a10]">
                    {getSuggestionActionMode(listing)}
                  </span>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5d5a7a]">
                    {getSuggestionSellerLabel(listing, currentSellerId)}
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      {otherSellerListings.length > 0 ? (
        <div className="mt-3 space-y-2">
          {sameSellerListings.length > 0 ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
              Explore similar listings
            </p>
          ) : null}
          {otherSellerListings.map((listing) => (
            <Link
              key={listing.id}
              className="flex items-start gap-3 rounded-[1rem] border border-border bg-[#f9f1e2] px-4 py-3 transition hover:border-accent hover:text-accent"
              href={buildListingHref(listing.id, safeFromHref, "cross-seller")}
            >
              {listing.images?.[0]?.image_url ? (
                <Image
                  alt={listing.images[0].alt_text ?? listing.title}
                  className="h-[76px] w-[76px] rounded-[0.9rem] object-cover"
                  height={76}
                  src={listing.images[0].image_url}
                  unoptimized
                  width={76}
                />
              ) : (
                <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[0.9rem] bg-[#d9c7a8] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4d4338]">
                  {listing.type}
                </div>
              )}
              <span className="flex-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="block text-sm font-semibold text-foreground">{listing.title}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
                    {getSuggestionSecondarySignal(listing)}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
                  {listing.type} · {listing.is_local_only ? "Local Only" : "Open Reach"}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0f5f62]">
                    {listing.recommendationLabel}
                  </span>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7c3a10]">
                    {getSuggestionActionMode(listing)}
                  </span>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5d5a7a]">
                    {getSuggestionSellerLabel(listing, currentSellerId)}
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReceiptContextBar({
  originSliceSummary,
  safeFromHref,
}: {
  originSliceSummary: string | null;
  safeFromHref: string | null;
}) {
  if (!originSliceSummary && !safeFromHref) {
    return null;
  }

  return (
    <div className="rounded-[1.5rem] border border-border bg-white/72 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
            Browse Context
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
            You completed this from a filtered marketplace view.
          </h2>
          {originSliceSummary ? (
            <div className="mt-3 inline-flex rounded-full border border-border bg-[#f3eadf] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
              {originSliceSummary}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {safeFromHref ? (
            <Link
              className="rounded-full border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
              href={safeFromHref}
            >
              Keep Browsing This Lane
            </Link>
          ) : null}
          <Link
            className="rounded-full border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
            href={safeFromHref ? `/buyer?from=${encodeURIComponent(safeFromHref)}` : "/buyer"}
          >
            Buyer Activity
          </Link>
        </div>
      </div>
    </div>
  );
}

function ReviewSection({
  accessToken,
  comment,
  kind,
  onCommentChange,
  onFeedbackChange,
  onRatingChange,
  onReviewCreated,
  rating,
  review,
  reviewFeedback,
  reviewLoading,
  reviewSubmitting,
  setReviewSubmitting,
  transactionId,
  transactionStatus,
}: {
  accessToken: string | null;
  comment: string;
  kind: "order" | "booking";
  onCommentChange: (value: string) => void;
  onFeedbackChange: (value: string | null) => void;
  onRatingChange: (value: number) => void;
  onReviewCreated: (review: ReviewRead) => void;
  rating: number;
  review: ReviewRead | null;
  reviewFeedback: string | null;
  reviewLoading: boolean;
  reviewSubmitting: boolean;
  setReviewSubmitting: (value: boolean) => void;
  transactionId: string;
  transactionStatus: string;
}) {
  const canReview = transactionStatus === "completed";

  async function handleSubmit() {
    if (!accessToken || reviewSubmitting || !canReview) {
      return;
    }

    setReviewSubmitting(true);
    onFeedbackChange(null);
    try {
      const createdReview = await api.createReview(
        {
          rating,
          comment: comment.trim() || null,
          order_id: kind === "order" ? transactionId : null,
          booking_id: kind === "booking" ? transactionId : null,
        },
        { accessToken },
      );
      onReviewCreated(createdReview);
      onFeedbackChange("Review submitted. Public trust signals will refresh from this rating.");
    } catch (reviewError) {
      onFeedbackChange(
        reviewError instanceof ApiError
          ? reviewError.message
          : reviewError instanceof Error
            ? reviewError.message
            : "Unable to submit your review right now.",
      );
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (reviewLoading) {
    return (
      <div className="rounded-[1.5rem] border border-border bg-white/70 p-5 text-sm text-foreground/66">
        Loading review state...
      </div>
    );
  }

  if (review) {
    return (
      <div className="rounded-[1.5rem] border border-border bg-white/70 p-5">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
          Your Review
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="rounded-full bg-[#f3e1bd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c3a10]">
            {review.rating}/5
          </span>
          <span className="text-xs text-foreground/52">
            {new Date(review.created_at).toLocaleDateString()}
          </span>
        </div>
        <p className="mt-4 text-sm leading-6 text-foreground/72">
          {review.comment ?? "You left a rating without a written comment."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[1.5rem] border border-border bg-white/70 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
            Leave A Review
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
            Share how this {kind} went
          </h3>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/58">
          {canReview ? "Ready for review" : "Available after completion"}
        </span>
      </div>

      {canReview ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            {[5, 4, 3, 2, 1].map((value) => (
              <button
                key={value}
                className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  rating === value
                    ? "bg-foreground text-background"
                    : "border border-border text-foreground/70 hover:border-accent hover:text-accent"
                }`}
                onClick={() => onRatingChange(value)}
                type="button"
              >
                {value}/5
              </button>
            ))}
          </div>
          <textarea
            className="mt-4 min-h-[120px] w-full rounded-[1.2rem] border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder="What went well? What should future buyers know?"
            value={comment}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-foreground/56">
              Reviews become part of the seller’s public trust signal.
            </p>
            <button
              className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-background transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55"
              disabled={reviewSubmitting || !accessToken}
              onClick={() => void handleSubmit()}
              type="button"
            >
              {reviewSubmitting ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-foreground/68">
          This review form unlocks once the seller marks the {kind} as completed.
        </p>
      )}

      {reviewFeedback ? (
        <div className="mt-4 rounded-[1.2rem] border border-border bg-[#f7f0e2] px-4 py-3 text-sm text-foreground/72">
          {reviewFeedback}
        </div>
      ) : null}
    </div>
  );
}

function ReceiptHero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-[2rem] border border-border bg-surface-strong p-6">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-7 text-foreground/72">{subtitle}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/buyer"
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
        >
          Buyer Activity
        </Link>
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
        >
          Marketplace Home
        </Link>
      </div>
    </div>
  );
}

function ReceiptCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-[1.5rem] border border-border bg-white/70 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">{title}</p>
      <div className="mt-4 space-y-3 text-sm text-foreground/72">
        {rows.map(([label, value]) => (
          <div
            key={`${title}:${label}`}
            className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/46">
              {label}
            </span>
            <span className="max-w-[65%] text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
