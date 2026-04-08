"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, formatCurrency, type Listing, type Profile } from "@/app/lib/api";
import {
  authenticateBuyer,
  clearBuyerSession,
  ensureBuyerProfile,
  persistBuyerSession,
  restoreBuyerSession,
  type BuyerSession,
} from "@/app/lib/buyer-auth";

type BuyerActionPanelProps = {
  listing: Listing;
  sellerDisplayName: string | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function getFulfillmentOptions(listing: Listing) {
  return [
    listing.pickup_enabled ? { label: "Pickup", value: "pickup" } : null,
    listing.meetup_enabled ? { label: "Meetup", value: "meetup" } : null,
    listing.delivery_enabled ? { label: "Delivery", value: "delivery" } : null,
    listing.shipping_enabled ? { label: "Shipping", value: "shipping" } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
}

function computeBookingWindow(listing: Listing, dayOffset: number) {
  const start = new Date();
  const leadTimeHours = listing.lead_time_hours ?? 24;
  start.setHours(start.getHours() + leadTimeHours + dayOffset * 24);
  start.setMinutes(0, 0, 0);

  const durationMinutes = listing.duration_minutes ?? 90;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  return { start, end };
}

function getSuggestionSecondarySignal(listing: Listing) {
  if (listing.duration_minutes) {
    return `${listing.duration_minutes} min`;
  }

  return formatCurrency(listing.price_cents, listing.currency);
}

function getSuggestionActionMode(listing: Listing) {
  return listing.requires_booking || listing.type === "service" ? "Booking ready" : "Order ready";
}

function getSuggestionSellerLabel(
  suggestion: Listing,
  currentSellerId: string,
  currentSellerName: string | null,
) {
  if (suggestion.seller_id === currentSellerId) {
    return currentSellerName ? `${currentSellerName} · Same seller` : "Same seller";
  }

  return "Another seller";
}

function getSuggestionSellerPriority(
  suggestion: Listing,
  currentSellerId: string,
) {
  return suggestion.seller_id === currentSellerId ? 1 : 0;
}

function normalizeFollowOnContext(value: string | null) {
  if (value === "same-seller" || value === "cross-seller") {
    return value;
  }

  return null;
}

function formatFollowOnContext(value: "same-seller" | "cross-seller" | null) {
  if (value === "same-seller") {
    return "Same seller follow-on";
  }

  if (value === "cross-seller") {
    return "Cross-seller follow-on";
  }

  return null;
}

function buildBuyerBrowseContext(
  originSliceSummary: string | null,
  followOn: "same-seller" | "cross-seller" | null,
) {
  const parts = [originSliceSummary, formatFollowOnContext(followOn)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildListingHref(
  listingId: string,
  fromParam: string | null,
  followOn: "same-seller" | "cross-seller",
) {
  const params = new URLSearchParams();
  if (fromParam) {
    params.set("from", fromParam);
  }
  params.set("followOn", followOn);
  const query = params.toString();

  return `/listings/${listingId}${query ? `?${query}` : ""}`;
}

function formatBuyerActionError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Sign in again before placing an order or requesting a booking.";
    }

    if (error.message.includes("does not support")) {
      const method = error.message.split("does not support ")[1];
      return method
        ? `This listing does not offer ${method}. Choose one of the enabled fulfillment options instead.`
        : "This listing does not support the selected fulfillment method.";
    }

    if (error.message.includes("Service listings must be booked")) {
      return "This seller only accepts booking requests for this listing.";
    }

    if (error.message.includes("lead time of")) {
      return error.message.replace(
        "Booking must respect the seller ",
        "This seller needs ",
      );
    }

    if (error.message.includes("Booking duration must be exactly")) {
      return error.message.replace(
        "Booking duration must be exactly",
        "This service must be booked for exactly",
      );
    }

    if (error.message.includes("does not accept bookings")) {
      return "This listing is not accepting booking requests right now.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to complete this request right now.";
}

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRecommendedBrowsePreset(input: {
  listings: Listing[];
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
      .map((item) => input.listings.find((listingItem) => listingItem.id === item.listing_id))
      .filter((listingItem): listingItem is Listing => Boolean(listingItem));

    return (
      count +
      matchingListings.filter(
        (listingItem) => listingItem.type === "product" || listingItem.type === "hybrid",
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
          (listingItem) => listingItem.id === item.listing_id && listingItem.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) =>
      input.listings.some(
        (listingItem) => listingItem.id === booking.listing_id && listingItem.is_local_only,
      ),
    ).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (listingItem) => listingItem.id === item.listing_id && listingItem.type === "hybrid",
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

function getRecommendationReason(
  listing: Pick<Listing, "type" | "is_local_only">,
  preset: { label: "Local-First" | "Services" | "Hybrid" | "Products" } | null,
) {
  if (!preset) {
    return null;
  }

  if (preset.label === "Local-First" && listing.is_local_only) {
    return "You have been browsing more local-first offers, and this listing is configured for local demand.";
  }

  if (
    preset.label === "Services" &&
    (listing.type === "service" || listing.type === "hybrid")
  ) {
    return "Your recent buyer activity leans toward services, so this listing matches that pattern.";
  }

  if (
    preset.label === "Products" &&
    (listing.type === "product" || listing.type === "hybrid")
  ) {
    return "Your recent buyer activity leans toward product purchases, so this listing matches that pattern.";
  }

  if (preset.label === "Hybrid" && listing.type === "hybrid") {
    return "You have been interacting with hybrid offers, and this listing fits that mixed product-plus-service pattern.";
  }

  return null;
}

function getRecommendationScore(
  listing: Pick<Listing, "type" | "is_local_only">,
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
  listing: Pick<Listing, "type" | "is_local_only">,
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

export function BuyerActionPanel({ listing, sellerDisplayName }: BuyerActionPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const followOnParam = normalizeFollowOnContext(searchParams.get("followOn"));
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [session, setSession] = useState<BuyerSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("Buyer flow test from web.");
  const [bookingDayOffset, setBookingDayOffset] = useState("1");
  const [platformFeeRate, setPlatformFeeRate] = useState(0);
  const [deliveryFeeCents, setDeliveryFeeCents] = useState({
    delivery: 0,
    shipping: 0,
  });
  const [selectedFulfillment, setSelectedFulfillment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recommendationReason, setRecommendationReason] = useState<string | null>(null);
  const [moreLikeThisListings, setMoreLikeThisListings] = useState<
    (Listing & { recommendationLabel: string })[]
  >([]);
  const sameSellerSuggestions = useMemo(
    () => moreLikeThisListings.filter((item) => item.seller_id === listing.seller_id),
    [listing.seller_id, moreLikeThisListings],
  );
  const otherSellerSuggestions = useMemo(
    () => moreLikeThisListings.filter((item) => item.seller_id !== listing.seller_id),
    [listing.seller_id, moreLikeThisListings],
  );

  const fulfillmentOptions = useMemo(() => getFulfillmentOptions(listing), [listing]);
  const canOrder = listing.type !== "service";
  const canBook = Boolean(listing.requires_booking || listing.type !== "product");
  const primaryAction = canBook && !canOrder ? "booking" : "order";
  const originSliceSummary = useMemo(() => {
    const fromParam = searchParams.get("from");
    if (!fromParam || !fromParam.startsWith("/") || fromParam.startsWith("//")) {
      return null;
    }

    const parsedUrl = new URL(fromParam, "https://marketplace.local");
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
  }, [searchParams]);
  const buyerBrowseContext = useMemo(
    () => buildBuyerBrowseContext(originSliceSummary, followOnParam),
    [followOnParam, originSliceSummary],
  );
  const bookingWindow = useMemo(() => {
    const parsedOffset = Number(bookingDayOffset);
    return computeBookingWindow(listing, Number.isFinite(parsedOffset) ? parsedOffset : 1);
  }, [bookingDayOffset, listing]);

  useEffect(() => {
    if (fulfillmentOptions.length > 0) {
      setSelectedFulfillment((current) =>
        current && fulfillmentOptions.some((option) => option.value === current)
          ? current
          : fulfillmentOptions[0].value,
      );
    } else {
      setSelectedFulfillment("");
    }
  }, [fulfillmentOptions]);

  useEffect(() => {
    void (async () => {
      try {
        const refreshedSession = await restoreBuyerSession();
        if (!refreshedSession) {
          setRestoring(false);
          return;
        }
        setSession(refreshedSession);
        const nextProfile = await ensureBuyerProfile(refreshedSession.access_token);
        setProfile(nextProfile);
        const dashboard = await api.loadBuyerDashboard(refreshedSession.access_token);
        const preset = getRecommendedBrowsePreset({
          listings: dashboard.listings,
          orders: dashboard.orders,
          bookings: dashboard.bookings,
        });
        setRecommendationReason(getRecommendationReason(listing, preset));
        setMoreLikeThisListings(
          dashboard.listings
            .filter((item) => item.id !== listing.id)
            .map((item) => ({
              listing: item,
              match: getRecommendationMatch(item, preset),
            }))
            .filter((item): item is { listing: Listing; match: { score: number; label: string } } =>
              Boolean(item.match),
            )
            .sort((left, right) => {
              const rightSellerPriority = getSuggestionSellerPriority(right.listing, listing.seller_id);
              const leftSellerPriority = getSuggestionSellerPriority(left.listing, listing.seller_id);
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
      } catch {
        clearBuyerSession();
        setSession(null);
        setProfile(null);
        setRecommendationReason(null);
        setMoreLikeThisListings([]);
      } finally {
        setRestoring(false);
      }
    })();
  }, [listing]);

  const sanitizedQuantity = Math.max(1, Number(quantity) || 1);
  const unitPrice = listing.price_cents ?? 0;
  const subtotal = unitPrice * sanitizedQuantity;
  const deliveryFeeAmount =
    selectedFulfillment === "delivery"
      ? deliveryFeeCents.delivery
      : selectedFulfillment === "shipping"
        ? deliveryFeeCents.shipping
        : 0;
  const platformFeeAmount = Math.round(subtotal * platformFeeRate);
  const totalWithFee = subtotal + deliveryFeeAmount + platformFeeAmount;
  const platformFeePercentLabel = `${(platformFeeRate * 100).toFixed(2).replace(/\.00$/, "")} %`;
  const deliveryFeeLabel =
    selectedFulfillment === "shipping"
      ? "Platform-added shipping fee"
      : "Platform-added delivery fee";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [platformFeeResponse, deliveryFeeResponse] = await Promise.all([
          api.getPlatformFees({ cache: "no-store" }),
          api.getDeliveryFees({ cache: "no-store" }),
        ]);
        if (!cancelled) {
          setPlatformFeeRate(Number(platformFeeResponse.rate ?? 0));
          setDeliveryFeeCents({
            delivery: deliveryFeeResponse.delivery_fee_cents ?? 0,
            shipping: deliveryFeeResponse.shipping_fee_cents ?? 0,
          });
        }
      } catch {
        if (!cancelled) {
          setPlatformFeeRate(0);
          setDeliveryFeeCents({ delivery: 0, shipping: 0 });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAuthenticate() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const nextSession = await authenticateBuyer(mode, email, password);
      persistBuyerSession(nextSession);
      setSession(nextSession);
      const nextProfile = await ensureBuyerProfile(nextSession.access_token, {
        full_name: fullName || null,
        email,
      });
      setProfile(nextProfile);
      setMessage(mode === "sign-up" ? "Buyer account created and ready." : "Buyer session restored.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Unable to authenticate.");
    } finally {
      setLoading(false);
    }
  }

  function handleSignOut() {
    clearBuyerSession();
    setSession(null);
    setProfile(null);
    setMessage("Signed out.");
    setError(null);
  }

  async function handleOrder() {
    if (!session) {
      setError("Sign in before placing an order.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const order = await api.createOrder(
        {
          seller_id: listing.seller_id,
          fulfillment: selectedFulfillment,
          notes,
          buyer_browse_context: buyerBrowseContext,
          items: [
            {
              listing_id: listing.id,
              quantity: sanitizedQuantity,
            },
          ],
        },
        { accessToken: session.access_token },
      );
      const nextReceiptHref = fromParam
        ? `/transactions/order/${order.id}?from=${encodeURIComponent(fromParam)}`
        : `/transactions/order/${order.id}`;
      router.push(nextReceiptHref);
    } catch (actionError) {
      setError(formatBuyerActionError(actionError));
    } finally {
      setLoading(false);
    }
  }

  async function handleBooking() {
    if (!session) {
      setError("Sign in before requesting a booking.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const booking = await api.createBooking(
        {
          seller_id: listing.seller_id,
          listing_id: listing.id,
          scheduled_start: bookingWindow.start.toISOString(),
          scheduled_end: bookingWindow.end.toISOString(),
          notes,
          buyer_browse_context: buyerBrowseContext,
        },
        { accessToken: session.access_token },
      );
      const nextReceiptHref = fromParam
        ? `/transactions/booking/${booking.id}?from=${encodeURIComponent(fromParam)}`
        : `/transactions/booking/${booking.id}`;
      router.push(nextReceiptHref);
    } catch (actionError) {
      setError(formatBuyerActionError(actionError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card-shadow rounded-[2rem] border border-border bg-[#213018] p-6 text-white">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/60">
        Buyer Checkout Path
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
        Web buyers can now complete the live {primaryAction === "booking" ? "booking" : "order"} flow here.
      </h2>
      <p className="mt-4 text-sm leading-7 text-white/72">
        {originSliceSummary?.includes("Local Only")
          ? `You found this through a local-first browse slice. Sign in as a buyer, then create a real ${primaryAction === "booking" ? "booking request" : "order"} against ${sellerDisplayName ?? "this seller"} without leaving desktop.`
          : originSliceSummary?.includes("Lowest Price") || originSliceSummary?.includes("Highest Price")
            ? `You found this through a price-led browse slice. Sign in as a buyer, then create a real ${primaryAction === "booking" ? "booking request" : "order"} against ${sellerDisplayName ?? "this seller"} without leaving desktop.`
            : `Sign in as a buyer, then create a real ${primaryAction === "booking" ? "booking request" : "order"} against ${sellerDisplayName ?? "this seller"} without leaving desktop.`}
      </p>
      {originSliceSummary ? (
        <div className="mt-4 rounded-[1.2rem] border border-white/12 bg-white/8 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/58">
            Seen In Browse
          </p>
          <div className="mt-2 inline-flex rounded-full border border-white/14 bg-white/12 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/82">
            {originSliceSummary}
          </div>
          {fromParam ? (
            <div className="mt-3">
              <button
                className="rounded-full border border-white/16 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:border-white/36"
                onClick={() => router.push(fromParam)}
                type="button"
              >
                Keep Browsing This Lane
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {recommendationReason ? (
        <div className="mt-4 rounded-[1.2rem] border border-[#9ccfc3]/30 bg-[#edf8f2] px-4 py-3 text-[#24493f]">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#0f5f62]">
            Why Recommended
          </p>
          <p className="mt-2 text-sm leading-6">{recommendationReason}</p>
        </div>
      ) : null}
      {moreLikeThisListings.length > 0 ? (
        <div className="mt-4 rounded-[1.2rem] border border-white/12 bg-white/8 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/58">
            More Like This
          </p>
          {sameSellerSuggestions.length > 0 ? (
            <div className="mt-3 space-y-2">
              {otherSellerSuggestions.length > 0 ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/58">
                  More from this seller
                </p>
              ) : null}
              {sameSellerSuggestions.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-start gap-3 rounded-[1rem] border border-white/12 bg-white/8 px-4 py-3 text-left transition hover:border-white/28"
                  onClick={() =>
                    router.push(buildListingHref(item.id, fromParam, "same-seller"))
                  }
                  type="button"
                >
                  {item.images?.[0]?.image_url ? (
                    <Image
                      alt={item.images[0].alt_text ?? item.title}
                      className="h-[76px] w-[76px] rounded-[0.9rem] object-cover"
                      height={76}
                      src={item.images[0].image_url}
                      unoptimized
                      width={76}
                    />
                  ) : (
                    <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[0.9rem] bg-[#d9c7a8] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4d4338]">
                      {item.type}
                    </div>
                  )}
                  <span className="flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="block text-sm font-semibold text-white">{item.title}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/72">
                        {getSuggestionSecondarySignal(item)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-white/58">
                      {item.type} · {item.is_local_only ? "Local Only" : "Open Reach"}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#bfe7db]">
                        {item.recommendationLabel}
                      </span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f6d999]">
                        {getSuggestionActionMode(item)}
                      </span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d6d0ff]">
                        {getSuggestionSellerLabel(item, listing.seller_id, sellerDisplayName)}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {otherSellerSuggestions.length > 0 ? (
            <div className="mt-3 space-y-2">
              {sameSellerSuggestions.length > 0 ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/58">
                  Explore similar listings
                </p>
              ) : null}
              {otherSellerSuggestions.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-start gap-3 rounded-[1rem] border border-white/12 bg-white/8 px-4 py-3 text-left transition hover:border-white/28"
                  onClick={() =>
                    router.push(buildListingHref(item.id, fromParam, "cross-seller"))
                  }
                  type="button"
                >
                  {item.images?.[0]?.image_url ? (
                    <Image
                      alt={item.images[0].alt_text ?? item.title}
                      className="h-[76px] w-[76px] rounded-[0.9rem] object-cover"
                      height={76}
                      src={item.images[0].image_url}
                      unoptimized
                      width={76}
                    />
                  ) : (
                    <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[0.9rem] bg-[#d9c7a8] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4d4338]">
                      {item.type}
                    </div>
                  )}
                  <span className="flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="block text-sm font-semibold text-white">{item.title}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/72">
                        {getSuggestionSecondarySignal(item)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-white/58">
                      {item.type} · {item.is_local_only ? "Local Only" : "Open Reach"}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#bfe7db]">
                        {item.recommendationLabel}
                      </span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f6d999]">
                        {getSuggestionActionMode(item)}
                      </span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d6d0ff]">
                        {getSuggestionSellerLabel(item, listing.seller_id, sellerDisplayName)}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-[1.3rem] border border-[#f1a5a5]/40 bg-[#8e2d2d]/30 px-4 py-3 text-sm text-[#ffe0e0]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-5 rounded-[1.3rem] border border-white/12 bg-white/8 px-4 py-3 text-sm text-white/82">
          {message}
        </div>
      ) : null}

      <div className="mt-6 rounded-[1.5rem] border border-white/12 bg-white/8 p-4">
        {restoring ? (
          <p className="text-sm text-white/72">Restoring buyer session...</p>
        ) : session ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/58">
                  Signed In Buyer
                </p>
                <p className="mt-2 text-sm text-white/82">
                  {(profile?.full_name ?? email) || "Authenticated buyer"}
                </p>
              </div>
              <button
                className="rounded-full border border-white/16 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:border-white/36"
                onClick={handleSignOut}
                type="button"
              >
                Sign Out
              </button>
            </div>

            {canOrder ? (
              <div className="space-y-3">
                <label className="block text-sm text-white/76">
                  <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                    Fulfillment
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {fulfillmentOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                          selectedFulfillment === option.value
                            ? "border-white bg-white text-[#213018]"
                            : "border-white/16 text-white/78 hover:border-white/36"
                        }`}
                        onClick={() => setSelectedFulfillment(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-white/76">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                  Quantity
                </span>
                <input
                  className="w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-white/36"
                  onChange={(event) => setQuantity(event.target.value)}
                  value={quantity}
                />
              </label>
              <label className="block text-sm text-white/76">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                  Booking Day Offset
                </span>
                <input
                  className="w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-white/36"
                  onChange={(event) => setBookingDayOffset(event.target.value)}
                  value={bookingDayOffset}
                />
              </label>
            </div>

            <label className="block text-sm text-white/76">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                Notes
              </span>
              <textarea
                className="min-h-[108px] w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-white/36"
                onChange={(event) => setNotes(event.target.value)}
                value={notes}
              />
            </label>

            {canBook ? (
              <div className="rounded-[1.2rem] border border-white/12 bg-white/6 px-4 py-3 text-sm text-white/76">
                Booking window preview: {bookingWindow.start.toLocaleString()} to{" "}
                {bookingWindow.end.toLocaleString()}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              {canOrder ? (
                <button
                  className={`rounded-full px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                    primaryAction === "order"
                      ? "bg-white text-[#213018]"
                      : "border border-white/16 text-white/82 hover:border-white/36"
                  }`}
                  disabled={loading}
                  onClick={handleOrder}
                  type="button"
                >
                  {loading && primaryAction === "order" ? "Placing..." : "Place Order"}
                </button>
              ) : null}
              {canBook ? (
                <button
                  className={`rounded-full px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                    primaryAction === "booking"
                      ? "bg-white text-[#213018]"
                      : "border border-white/16 text-white/82 hover:border-white/36"
                  }`}
                  disabled={loading}
                  onClick={handleBooking}
                  type="button"
                >
                  {loading && primaryAction === "booking" ? "Requesting..." : "Request Booking"}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  mode === "sign-in"
                    ? "bg-white text-[#213018]"
                    : "border border-white/16 text-white/82 hover:border-white/36"
                }`}
                onClick={() => setMode("sign-in")}
                type="button"
              >
                Sign In
              </button>
              <button
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  mode === "sign-up"
                    ? "bg-white text-[#213018]"
                    : "border border-white/16 text-white/82 hover:border-white/36"
                }`}
                onClick={() => setMode("sign-up")}
                type="button"
              >
                Create Buyer Account
              </button>
            </div>

            {mode === "sign-up" ? (
              <label className="block text-sm text-white/76">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                  Full Name
                </span>
                <input
                  className="w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-white/36"
                  onChange={(event) => setFullName(event.target.value)}
                  value={fullName}
                />
              </label>
            ) : null}

            <label className="block text-sm text-white/76">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                Email
              </span>
              <input
                className="w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-white/36"
                onChange={(event) => setEmail(event.target.value)}
                value={email}
              />
            </label>

            <label className="block text-sm text-white/76">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/52">
                Password
              </span>
              <input
                className="w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-white/36"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>

            <button
              className="rounded-full bg-white px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#213018] transition hover:opacity-92 disabled:opacity-50"
              disabled={loading}
              onClick={handleAuthenticate}
              type="button"
            >
              {loading
                ? mode === "sign-up"
                  ? "Creating..."
                  : "Signing in..."
                : mode === "sign-up"
                  ? "Create Buyer Account"
                  : "Sign In as Buyer"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-[1.5rem] border border-white/12 bg-white/8 p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">
          Live Price
        </p>
        <p className="mt-3 text-2xl font-semibold text-white">
          {formatCurrency(listing.price_cents, listing.currency)}
        </p>
      </div>
      {canOrder ? (
        <div className="mt-3 rounded-[1.5rem] border border-white/12 bg-white/10 p-4 text-sm text-white/80">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal, listing.currency)}</span>
          </div>
          {selectedFulfillment === "delivery" || selectedFulfillment === "shipping" ? (
            <div className="mt-2 flex items-center justify-between">
              <span>{deliveryFeeLabel}</span>
              <span>{formatCurrency(deliveryFeeAmount, listing.currency)}</span>
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-between">
            <span>Platform fee ({platformFeePercentLabel})</span>
            <span>{formatCurrency(platformFeeAmount, listing.currency)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-white">
            <span className="font-semibold">Total</span>
            <span className="font-semibold">{formatCurrency(totalWithFee, listing.currency)}</span>
          </div>
          <p className="mt-3 text-xs text-white/58">
            Delivery and shipping orders can include a platform-added surcharge before tax.
          </p>
        </div>
      ) : null}
    </div>
  );
}
