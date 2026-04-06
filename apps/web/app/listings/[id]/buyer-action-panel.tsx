"use client";

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

export function BuyerActionPanel({ listing, sellerDisplayName }: BuyerActionPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
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
  const [selectedFulfillment, setSelectedFulfillment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

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
      } catch {
        clearBuyerSession();
        setSession(null);
        setProfile(null);
      } finally {
        setRestoring(false);
      }
    })();
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
          buyer_browse_context: originSliceSummary,
          items: [
            {
              listing_id: listing.id,
              quantity: Number(quantity),
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
          buyer_browse_context: originSliceSummary,
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
    </div>
  );
}
