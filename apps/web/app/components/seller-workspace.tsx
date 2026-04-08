"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authenticateWithSupabase,
  getSupabaseRealtimeClient,
  refreshSupabaseSession,
} from "@repo/auth";

import { ApiError, buildNotifications, createApiClient, formatCurrency } from "@/app/lib/api";
import type {
  Booking,
  CategoryRead,
  Listing,
  ListingAiAssistSuggestion,
  ListingCreateInput,
  ListingImage,
  ListingPriceInsight,
  ListingType,
  ListingUpdateInput,
  NotificationDelivery,
  NotificationItem,
  Order,
  PlatformFeeRateRead,
  Profile,
  ProfilePayload,
  ProfileUpdateInput,
  ReviewRead,
  SellerCreateInput,
  SellerProfile,
  SellerSubscriptionRead,
  SellerWorkspaceData,
} from "@/app/lib/api";
import type { NotificationDeliveryBulkRetryResult } from "@repo/api-client";

type WorkspaceState = {
  seller: SellerProfile;
  subscription: SellerSubscriptionRead | null;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
  reviews: ReviewRead[];
};

type ListingDraft = {
  category_id: string;
  price_cents: string;
  requires_booking: boolean;
  duration_minutes: string;
  lead_time_hours: string;
  is_local_only: boolean;
  pickup_enabled: boolean;
  meetup_enabled: boolean;
  delivery_enabled: boolean;
  shipping_enabled: boolean;
  is_promoted: boolean;
};

type ListingImageDraft = {
  image_url: string;
  alt_text: string;
};

type ListingAiState = {
  loading: boolean;
  error: string | null;
  suggestion: ListingAiAssistSuggestion | null;
};

type ListingPriceInsightState = {
  loading: boolean;
  error: string | null;
  insight: ListingPriceInsight | null;
};

type ActionFeedback = {
  tone: "success" | "error";
  message: string;
  details?: string[];
};

type PendingBulkAction = {
  kind: "order" | "booking";
  currentStatus: "pending" | "ready" | "requested" | "in_progress";
  nextStatus: "confirmed" | "completed";
  actionKey: string;
  count: number;
  label: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const api = createApiClient(apiBaseUrl);
const SELLER_ACCESS_TOKEN_KEY = "seller_access_token";
const SELLER_REFRESH_TOKEN_KEY = "seller_refresh_token";
const SELLER_NOTIFICATIONS_SEEN_AT_KEY = "seller_notifications_seen_at";

function isExpiredAuthError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403 || error.message.includes("bad_jwt");
  }

  if (error instanceof Error) {
    return error.message.includes("bad_jwt") || error.message.includes("token is expired");
  }

  return false;
}

function formatBulkExecutionMode(mode: "best_effort" | "atomic") {
  return mode === "atomic" ? "validate first" : "best effort";
}

function toggleBulkExecutionMode(mode: "best_effort" | "atomic") {
  return mode === "atomic" ? "best_effort" : "atomic";
}

function getListingOperatingRole(listing: Listing) {
  const hasOrderFlow = listing.type !== "service";
  const hasBookingFlow = Boolean(listing.requires_booking || listing.type !== "product");

  if (hasOrderFlow && hasBookingFlow) {
    return "hybrid";
  }

  if (hasBookingFlow) {
    return "booking-led";
  }

  return "order-led";
}

function getListingOperatingGuidance(listing: Listing) {
  const role = getListingOperatingRole(listing);

  if (role === "booking-led") {
    return "Driven by booking requirements and service timing. Adjust booking, duration, and lead time first.";
  }

  if (role === "hybrid") {
    return "Supports both order and booking flows. Tune booking requirements and fulfillment together.";
  }

  return "Driven by order flow and fulfillment methods. Tune pickup, meetup, delivery, or shipping first.";
}

function getListingTractionPill(listing: Listing) {
  const recentCount = listing.recent_transaction_count ?? 0;

  if (recentCount >= 5) {
    return {
      label: `Hot lane · ${recentCount} recent requests`,
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (recentCount >= 3) {
    return {
      label: `Popular near you · ${recentCount} recent requests`,
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }

  if (recentCount > 0) {
    return {
      label: `${recentCount} recent request${recentCount === 1 ? "" : "s"}`,
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (listing.is_new_listing) {
    return {
      label: "New listing",
      className: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }

  return null;
}

function getPriceComparisonScopeBadge(scope: string) {
  if (scope === "Category + local") {
    return {
      label: scope,
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (scope === "Category") {
    return {
      label: scope,
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }

  if (scope === "Type + local") {
    return {
      label: scope,
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (scope === "Type") {
    return {
      label: scope,
      className: "border-border bg-background/60 text-foreground/68",
    };
  }

  return {
    label: scope,
    className: "border-rose-200 bg-rose-50 text-rose-700",
  };
}

function getPricePositionBadge(input: {
  currentPriceCents: number | null;
  suggestedPriceCents: number | null | undefined;
  currency: string;
}) {
  if (
    input.currentPriceCents == null ||
    input.suggestedPriceCents == null ||
    Number.isNaN(input.currentPriceCents)
  ) {
    return null;
  }

  const delta = input.currentPriceCents - input.suggestedPriceCents;
  if (delta === 0) {
    return {
      label: "On suggested price",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  const formattedDelta = formatCurrency(Math.abs(delta), input.currency);
  return delta > 0
    ? {
        label: `${formattedDelta} above suggested`,
        className: "border-amber-200 bg-amber-50 text-amber-700",
      }
    : {
        label: `${formattedDelta} below suggested`,
        className: "border-sky-200 bg-sky-50 text-sky-700",
      };
}

function formatSellerRating(rating?: number, reviewCount?: number) {
  const safeRating = rating ?? 0;
  const safeReviewCount = reviewCount ?? 0;

  if (safeReviewCount <= 0) {
    return "No reviews yet";
  }

  return `${safeRating.toFixed(1)} stars · ${safeReviewCount} review${safeReviewCount === 1 ? "" : "s"}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSubscriptionPlanLabel(subscription: SellerSubscriptionRead | null) {
  if (!subscription) {
    return "No active plan";
  }

  return subscription.tier_name || subscription.tier_code || "Active plan";
}

function getSubscriptionCapabilityPills(subscription: SellerSubscriptionRead | null) {
  if (!subscription) {
    return [];
  }

  const capabilities = [
    subscription.analytics_enabled ? "Analytics enabled" : "Analytics locked",
    subscription.priority_visibility ? "Priority visibility" : "Standard visibility",
    subscription.premium_storefront ? "Premium storefront" : "Standard storefront",
  ];

  return capabilities;
}

function getPremiumStorefrontRecommendations(listing: Listing) {
  const recommendations: string[] = [];

  if ((listing.images?.length ?? 0) === 0) {
    recommendations.push("Add a primary image so the storefront hero has stronger visual pull.");
  }

  if ((listing.description?.trim().length ?? 0) < 90) {
    recommendations.push("Expand the description with process, pickup detail, or service outcome.");
  }

  if ((listing.recent_transaction_count ?? 0) >= 3 && !listing.is_promoted) {
    recommendations.push("This listing already has traction. Consider promoting it for more shelf space.");
  }

  if (!listing.available_today && listing.type !== "product") {
    recommendations.push("Add same-day availability windows to convert storefront traffic faster.");
  }

  if (!listing.is_local_only) {
    recommendations.push("Tighten the local positioning so nearby buyers understand the fulfillment fit.");
  }

  return recommendations.slice(0, 3);
}

function titleCaseWorkspaceLabel(value: string) {
  return value
    .split("-")
    .flatMap((part) => part.split("_"))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPressureLanePillClass(lane: "support" | "drag" | "recovery" | "trust") {
  if (lane === "support") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (lane === "drag") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (lane === "recovery") {
    return "border-lime-200 bg-lime-50 text-lime-700";
  }

  return "border-rose-200 bg-rose-50 text-rose-700";
}

function formatBuyerBrowseContextLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isLocalDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return normalized?.includes("local only") ?? false;
}

function isSearchDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return normalized?.includes('search: "') ?? false;
}

function isPriceDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return (
    normalized?.includes("lowest price") ||
    normalized?.includes("highest price") ||
    false
  );
}

function isSameSellerFollowOnBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return normalized?.includes("same seller follow-on") ?? false;
}

function isCrossSellerFollowOnBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return (
    normalized?.includes("cross-seller follow-on") ||
    normalized?.includes("cross seller follow-on") ||
    false
  );
}

function isRecentTransactionEvent(
  history: Array<{ created_at: string }> | undefined,
  windowDays: number,
) {
  const oldestEvent = history && history.length > 0 ? history[history.length - 1] : null;
  if (!oldestEvent?.created_at) {
    return false;
  }

  const createdAt = new Date(oldestEvent.created_at).getTime();
  if (Number.isNaN(createdAt)) {
    return false;
  }

  return Date.now() - createdAt <= windowDays * 24 * 60 * 60 * 1000;
}

function matchesActivityRecency(
  history: Array<{ created_at: string }> | undefined,
  filter: "7d" | "all",
) {
  if (filter === "all") {
    return true;
  }

  return isRecentTransactionEvent(history, 7);
}

function getLatestTransactionTimestamp(transaction: Order | Booking) {
  const latestHistoryEvent =
    transaction.status_history && transaction.status_history.length > 0
      ? transaction.status_history[0]?.created_at
      : null;

  if (!latestHistoryEvent) {
    return 0;
  }

  return new Date(latestHistoryEvent).getTime();
}

function getListingAdjustmentTimestamp(listing: Listing) {
  if (!listing.last_operating_adjustment_at) {
    return null;
  }

  const parsed = new Date(listing.last_operating_adjustment_at).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getTransactionListingId(transaction: Order | Booking) {
  if ("items" in transaction) {
    return transaction.items?.[0]?.listing_id ?? null;
  }

  if ("listing_id" in transaction) {
    return transaction.listing_id ?? null;
  }

  return null;
}

function getListingRetentionTone(input: {
  sameSellerCount: number;
  crossSellerCount: number;
}) {
  if (input.sameSellerCount === 0 && input.crossSellerCount === 0) {
    return {
      label: "No follow-on yet",
      toneClass: "text-foreground/52",
    };
  }

  if (input.sameSellerCount >= input.crossSellerCount) {
    return {
      label: "Holding repeat demand",
      toneClass: "text-olive",
    };
  }

  return {
    label: "Losing buyers to other sellers",
    toneClass: "text-rose-700",
  };
}

function getListingLeakageLabel(input: {
  localCount: number;
  searchCount: number;
  priceCount: number;
  crossSellerCount: number;
}) {
  if (input.crossSellerCount === 0) {
    return null;
  }

  const rankedSignals = [
    { label: "price-led", count: input.priceCount },
    { label: "search-led", count: input.searchCount },
    { label: "local-fit", count: input.localCount },
  ].sort((left, right) => right.count - left.count);

  const primarySignal = rankedSignals[0];
  if (!primarySignal || primarySignal.count === 0) {
    return "General branching";
  }

  const secondarySignal = rankedSignals[1];
  if (secondarySignal && secondarySignal.count === primarySignal.count && primarySignal.count > 0) {
    return "Mixed leakage";
  }

  return `Mostly ${primarySignal.label}`;
}

function getListingLeakageTuneAction(input: {
  listing: Listing;
  localCount: number;
  searchCount: number;
  priceCount: number;
}) {
  const rankedSignals = [
    {
      label: "price",
      count: input.priceCount,
      actionLabel: "Tune Pricing",
      target: "pricing" as const,
    },
    {
      label: "local",
      count: input.localCount,
      actionLabel: "Tune Local Fit",
      target: "booking" as const,
    },
    {
      label: "search",
      count: input.searchCount,
      actionLabel: "Tune Listing Fit",
      target: getListingOperatingRole(input.listing) === "order-led" ? "fulfillment" as const : "booking" as const,
    },
  ].sort((left, right) => right.count - left.count);

  const primarySignal = rankedSignals[0];
  if (!primarySignal || primarySignal.count === 0) {
    return null;
  }

  return {
    label: primarySignal.actionLabel,
    target: primarySignal.target,
  };
}

function getListingRetentionTrend(input: {
  sameSellerCount: number;
  crossSellerCount: number;
  sameSellerRecentCount: number;
  crossSellerRecentCount: number;
  sameSellerPostAdjustmentCount?: number;
  crossSellerPostAdjustmentCount?: number;
}) {
  const totalPostAdjustment =
    (input.sameSellerPostAdjustmentCount ?? 0) + (input.crossSellerPostAdjustmentCount ?? 0);
  if (totalPostAdjustment > 0) {
    const totalAllTime = input.sameSellerCount + input.crossSellerCount;
    const overallRetentionRate = totalAllTime > 0 ? input.sameSellerCount / totalAllTime : 0;
    const postAdjustmentRetentionRate =
      (input.sameSellerPostAdjustmentCount ?? 0) / totalPostAdjustment;

    if (postAdjustmentRetentionRate - overallRetentionRate >= 0.15) {
      return {
        label: "Improving since change",
        toneClass: "text-olive",
      };
    }

    if (overallRetentionRate - postAdjustmentRetentionRate >= 0.15) {
      return {
        label: "Softening since change",
        toneClass: "text-rose-700",
      };
    }

    return {
      label: "Stable since change",
      toneClass: "text-foreground/68",
    };
  }

  const totalAllTime = input.sameSellerCount + input.crossSellerCount;
  const totalRecent = input.sameSellerRecentCount + input.crossSellerRecentCount;

  if (totalRecent === 0) {
    return {
      label: "No recent signal",
      toneClass: "text-foreground/52",
    };
  }

  if (totalAllTime === 0) {
    return {
      label: "Recent signal only",
      toneClass: "text-sky-700",
    };
  }

  const overallRetentionRate = input.sameSellerCount / totalAllTime;
  const recentRetentionRate = input.sameSellerRecentCount / totalRecent;

  if (recentRetentionRate - overallRetentionRate >= 0.15) {
    return {
      label: "Improving recently",
      toneClass: "text-olive",
    };
  }

  if (overallRetentionRate - recentRetentionRate >= 0.15) {
    return {
      label: "Softening recently",
      toneClass: "text-rose-700",
    };
  }

  return {
    label: "Stable recently",
    toneClass: "text-foreground/68",
  };
}

function getListingRetentionTrendKey(input: {
  sameSellerCount: number;
  crossSellerCount: number;
  sameSellerRecentCount: number;
  crossSellerRecentCount: number;
  sameSellerPostAdjustmentCount?: number;
  crossSellerPostAdjustmentCount?: number;
}): "all" | "improving" | "softening" | "stable" | "no-signal" {
  const trend = getListingRetentionTrend(input);
  if (trend.label.includes("Improving")) {
    return "improving";
  }
  if (trend.label.includes("Softening")) {
    return "softening";
  }
  if (trend.label.includes("Stable")) {
    return "stable";
  }
  return "no-signal";
}

function getListingAdjustmentType(
  summary: string | null | undefined,
): "all" | "pricing" | "local-fit" | "booking" | "fulfillment" | "other" {
  const normalized = summary?.toLowerCase() ?? "";
  if (!normalized) {
    return "other";
  }

  if (normalized.includes("pricing")) {
    return "pricing";
  }

  if (normalized.includes("local fit")) {
    return "local-fit";
  }

  if (
    normalized.includes("booking mode") ||
    normalized.includes("duration") ||
    normalized.includes("lead time")
  ) {
    return "booking";
  }

  if (
    normalized.includes("pickup") ||
    normalized.includes("meetup") ||
    normalized.includes("delivery") ||
    normalized.includes("shipping")
  ) {
    return "fulfillment";
  }

  return "other";
}

function getListingAdjustmentTuneAction(summary: string | null | undefined) {
  const adjustmentType = getListingAdjustmentType(summary);

  if (adjustmentType === "pricing") {
    return {
      label: "Tune Pricing",
      target: "pricing" as const,
    };
  }

  if (adjustmentType === "local-fit") {
    return {
      label: "Tune Local Fit",
      target: "booking" as const,
    };
  }

  if (adjustmentType === "booking") {
    return {
      label: "Tune Booking",
      target: "booking" as const,
    };
  }

  if (adjustmentType === "fulfillment") {
    return {
      label: "Tune Fulfillment",
      target: "fulfillment" as const,
    };
  }

  return null;
}

function getListingPreviewRetentionTrendLabel(input: {
  sameSellerCount: number;
  crossSellerCount: number;
  sameSellerRecentCount: number;
  crossSellerRecentCount: number;
  sameSellerPostAdjustmentCount: number;
  crossSellerPostAdjustmentCount: number;
}) {
  return getListingRetentionTrend(input).label;
}

function getListingPreviewRetentionTrendToneClass(label: string) {
  if (label.includes("Improving")) {
    return "border-olive/20 bg-olive/10 text-olive";
  }

  if (label.includes("Softening")) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (label.includes("Stable")) {
    return "border-border bg-background/40 text-foreground/68";
  }

  return "border-sky-200 bg-sky-50 text-sky-700";
}

function getDeliveryLaneConcentrationLabel(share: number | null, mode: "drag" | "recovery") {
  if (share == null) {
    return null;
  }

  const qualifier =
    share >= 0.7 ? "Highly concentrated" : share >= 0.45 ? "Moderately concentrated" : "Spread out";
  const percent = Math.round(share * 100);

  return `${qualifier} ${mode === "drag" ? "drag" : "recovery"} · top listing ${percent}%`;
}

function getTrustLaneConcentrationLabel(share: number | null) {
  if (share == null) {
    return null;
  }

  const qualifier =
    share >= 0.7 ? "Highly concentrated" : share >= 0.45 ? "Moderately concentrated" : "Spread out";
  const percent = Math.round(share * 100);

  return `${qualifier} trust watch · top listing ${percent}%`;
}

function getSupportLaneConcentrationLabel(share: number | null) {
  if (share == null) {
    return null;
  }

  const qualifier =
    share >= 0.7 ? "Highly concentrated" : share >= 0.45 ? "Moderately concentrated" : "Spread out";
  const percent = Math.round(share * 100);

  return `${qualifier} support watch · top listing ${percent}%`;
}

function getListingSupportPressure(input: {
  failedDeliveryCount: number;
  queuedDeliveryCount: number;
  retentionTrendLabel: string | null;
  hasReviewPressure: boolean;
}) {
  const isSoftening = input.retentionTrendLabel?.toLowerCase().includes("softening") ?? false;

  if (input.failedDeliveryCount > 0 && isSoftening) {
    return {
      label: "Support pressure",
      detail: `Softening + ${input.failedDeliveryCount} failed deliver${input.failedDeliveryCount === 1 ? "y" : "ies"}`,
      toneClass: "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (input.failedDeliveryCount > 0) {
    return {
      label: "Delivery pressure",
      detail: `${input.failedDeliveryCount} failed deliver${input.failedDeliveryCount === 1 ? "y" : "ies"}`,
      toneClass: "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (input.queuedDeliveryCount > 0 && isSoftening) {
    return {
      label: "Support watch",
      detail: `Softening + ${input.queuedDeliveryCount} queued alert${input.queuedDeliveryCount === 1 ? "" : "s"}`,
      toneClass: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (input.hasReviewPressure) {
    return {
      label: "Trust watch",
      detail: "Seller review pressure is elevated",
      toneClass: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  return null;
}

function getListingSupportPressureLaneMode(input: {
  failedDeliveryCount: number;
  queuedDeliveryCount: number;
  supportPressureLabel: string | null;
}) {
  if (input.failedDeliveryCount > 0) {
    return "failed" as const;
  }

  if (input.queuedDeliveryCount > 0) {
    return "queued" as const;
  }

  if (input.supportPressureLabel === "Trust watch") {
    return "trust" as const;
  }

  return null;
}

function getListingSupportPressureLaneLabel(mode: "failed" | "queued" | "trust") {
  if (mode === "failed") {
    return "Open Delivery Pressure Lane";
  }

  if (mode === "queued") {
    return "Open Support Watch Lane";
  }

  return "Open Trust Watch Lane";
}

function getListingSupportPressureLaneCountLabel(
  mode: "failed" | "queued" | "trust",
  count: number,
) {
  if (mode === "failed") {
    return `${count} failed alert${count === 1 ? "" : "s"}`;
  }

  if (mode === "queued") {
    return `${count} queued alert${count === 1 ? "" : "s"}`;
  }

  return `${count} related transaction${count === 1 ? "" : "s"}`;
}

function getListingSupportPressureDriverLabel(mode: "failed" | "queued" | "trust") {
  if (mode === "failed") {
    return "Failed alerts";
  }

  if (mode === "queued") {
    return "Queued alerts";
  }

  return "Trust watch";
}

function getListingSupportPressureLanePriority(mode: "failed" | "queued" | "trust" | null) {
  if (mode === "failed") {
    return 3;
  }

  if (mode === "queued") {
    return 2;
  }

  if (mode === "trust") {
    return 1;
  }

  return 0;
}

export function SellerWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activityRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listingControlRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listingControlHighlightTimeoutRef = useRef<number | null>(null);
  const focusedPanelHighlightTimeoutRef = useRef<number | null>(null);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerSlug, setSellerSlug] = useState("");
  const [city, setCity] = useState("Dallas");
  const [stateRegion, setStateRegion] = useState("TX");
  const [country, setCountry] = useState("USA");
  const [loading, setLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState<string | null>(null);
  const [bulkQueueActionLoading, setBulkQueueActionLoading] = useState<string | null>(null);
  const [listingActionLoading, setListingActionLoading] = useState<string | null>(null);
  const [listingSaveLoading, setListingSaveLoading] = useState<string | null>(null);
  const [listingDrafts, setListingDrafts] = useState<Record<string, ListingDraft>>({});
  const [listingImageDrafts, setListingImageDrafts] = useState<Record<string, ListingImageDraft>>(
    {},
  );
  const [listingAiState, setListingAiState] = useState<Record<string, ListingAiState>>({});
  const [listingCreateAiState, setListingCreateAiState] = useState<ListingAiState | null>(null);
  const [listingPriceInsights, setListingPriceInsights] = useState<
    Record<string, ListingPriceInsightState>
  >({});
  const [listingImageActionLoading, setListingImageActionLoading] = useState<string | null>(null);
  const [reviewResponseLoading, setReviewResponseLoading] = useState<string | null>(null);
  const [responseNotes, setResponseNotes] = useState<Record<string, string>>({});
  const [reviewResponseDrafts, setReviewResponseDrafts] = useState<Record<string, string>>({});
  const [notificationsSeenAt, setNotificationsSeenAt] = useState<string | null>(null);
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([]);
  const [deliveryRetryLoading, setDeliveryRetryLoading] = useState<string | null>(null);
  const [retryingFailedDeliveries, setRetryingFailedDeliveries] = useState(false);
  const [platformFee, setPlatformFee] = useState<PlatformFeeRateRead | null>(null);
  const [platformFeeLoading, setPlatformFeeLoading] = useState(true);
  const [focusedActivityKey, setFocusedActivityKey] = useState<string | null>(
    () => searchParams.get("focus"),
  );
  const [activityTypeFilter, setActivityTypeFilter] = useState<"all" | "order" | "booking">(
    () => (searchParams.get("activityType") as "all" | "order" | "booking") ?? "all",
  );
  useEffect(() => {
    let isMounted = true;

    setPlatformFeeLoading(true);
    api
      .getPlatformFees({ cache: "no-store" })
      .then((fee) => {
        if (isMounted) {
          setPlatformFee(fee);
          setPlatformFeeLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setPlatformFee(null);
          setPlatformFeeLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);
  const platformFeeRateLabel = platformFee
    ? `${(Number(platformFee.rate) * 100).toFixed(2)}%`
    : platformFeeLoading
    ? "Loading…"
    : "Unavailable";
  const platformFeeEffectiveLabel = platformFee?.effective_at
    ? new Date(platformFee.effective_at).toLocaleString()
    : "Not set";
  const [activityStatusFilter, setActivityStatusFilter] = useState<string>(
    () => searchParams.get("activityStatus") ?? "all",
  );
  const [activityDiscoveryFilter, setActivityDiscoveryFilter] = useState<
    "all" | "local" | "search" | "price" | "same-seller" | "cross-seller"
  >(
    () =>
      (
        searchParams.get("activityDiscovery") as
          | "all"
          | "local"
          | "search"
          | "price"
          | "same-seller"
          | "cross-seller"
      ) ?? "all",
  );
  const [activityListingFilter, setActivityListingFilter] = useState<string>(
    () => searchParams.get("activityListing") ?? "all",
  );
  const [activityRecencyFilter, setActivityRecencyFilter] = useState<"7d" | "all">(
    () => (searchParams.get("activityWindow") as "7d" | "all") ?? "all",
  );
  const [activityContextFilter, setActivityContextFilter] = useState<"all" | "unread" | "focused">(
    () => (searchParams.get("activityContext") as "all" | "unread" | "focused") ?? "all",
  );
  type ActivitySortMode = "default" | "pressured" | "drag" | "recovery";
  const [activitySortMode, setActivitySortMode] = useState<ActivitySortMode>(
    () =>
      (
        searchParams.get("activitySort") as ActivitySortMode
      ) ?? "default",
  );
  const [activityPressureFilter, setActivityPressureFilter] = useState<"all" | "delivery" | "trust">(
    () => (searchParams.get("activityPressure") as "all" | "delivery" | "trust") ?? "all",
  );
  const [activityRecoveryFilter, setActivityRecoveryFilter] = useState<"all" | "easing">(
    () => (searchParams.get("activityRecovery") as "all" | "easing") ?? "all",
  );
  type DeliveryStatusFilter = "all" | "queued" | "sent" | "failed";
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<DeliveryStatusFilter>(
    () => (searchParams.get("deliveryStatus") as DeliveryStatusFilter) ?? "all",
  );
  type DeliveryRecencyFilter = "today" | "7d" | "all";
  const [deliveryRecencyFilter, setDeliveryRecencyFilter] = useState<DeliveryRecencyFilter>(
    () => (searchParams.get("deliveryWindow") as DeliveryRecencyFilter) ?? "7d",
  );
  type WorkspacePreset =
    | "default"
    | "needs-action"
    | "recent-failures"
    | "focused-work"
    | "pressure-queue"
    | "delivery-drag"
    | "delivery-pressure"
    | "trust-watch"
    | "recovery-lane"
    | "recovered-recently";

  const [workspacePreset, setWorkspacePreset] = useState<WorkspacePreset>(
    () =>
      (
        searchParams.get("preset") as WorkspacePreset
      ) ?? "default",
  );

  type ListingAdjustmentFilter =
    | "all"
    | "pricing"
    | "local-fit"
    | "booking"
    | "fulfillment"
    | "other";
  type ListingTrendFilter = "all" | "improving" | "softening" | "stable" | "no-signal";

  type ActivityFilterConfig = {
    preset: WorkspacePreset;
    activityType: "all" | "order" | "booking";
    activityStatus: "all";
    activityDiscovery: "all" | "local" | "search" | "price" | "same-seller" | "cross-seller";
    activityListing?: string | null;
    activityRecency: "all" | "7d";
    activityContext: "all" | "unread" | "focused";
    activityPressure: "all" | "delivery" | "trust";
    activitySort: ActivitySortMode;
    activityRecovery: "all" | "easing";
    deliveryStatus: DeliveryStatusFilter;
    deliveryRecency: DeliveryRecencyFilter;
    listingAdjustment: ListingAdjustmentFilter;
    listingTrend: ListingTrendFilter;
  };

  function applyActivityFilters(config: ActivityFilterConfig) {
    // Keep every workspace view in sync by mutating the complete filter bundle in one place.
    setWorkspacePreset(config.preset);
    setActivityTypeFilter(config.activityType);
    setActivityStatusFilter(config.activityStatus);
    setActivityDiscoveryFilter(config.activityDiscovery);
    setActivityListingFilter(config.activityListing ?? "all");
    setActivityRecencyFilter(config.activityRecency);
    setActivityContextFilter(config.activityContext);
    setActivityPressureFilter(config.activityPressure);
    setActivitySortMode(config.activitySort);
    setActivityRecoveryFilter(config.activityRecovery);
    setDeliveryStatusFilter(config.deliveryStatus);
    setDeliveryRecencyFilter(config.deliveryRecency);
    setListingAdjustmentFilter(config.listingAdjustment);
    setListingTrendFilter(config.listingTrend);
  }

  function buildCurrentActivityFilterConfig(): ActivityFilterConfig {
    return {
      preset: workspacePreset,
      activityType: activityTypeFilter,
      activityStatus: activityStatusFilter as "all",
      activityDiscovery: activityDiscoveryFilter,
      activityListing: activityListingFilter,
      activityRecency: activityRecencyFilter,
      activityContext: activityContextFilter,
      activityPressure: activityPressureFilter,
      activitySort: activitySortMode,
      activityRecovery: activityRecoveryFilter,
      deliveryStatus: deliveryStatusFilter,
      deliveryRecency: deliveryRecencyFilter,
      listingAdjustment: listingAdjustmentFilter,
      listingTrend: listingTrendFilter,
    };
  }

  function updateListingAdjustmentFilter(value: ListingAdjustmentFilter) {
    applyActivityFilters({
      ...buildCurrentActivityFilterConfig(),
      listingAdjustment: value,
    });
  }

  function updateListingTrendFilterValue(value: ListingTrendFilter) {
    applyActivityFilters({
      ...buildCurrentActivityFilterConfig(),
      listingTrend: value,
    });
  }
  const [listingAdjustmentFilter, setListingAdjustmentFilter] = useState<
    "all" | "pricing" | "local-fit" | "booking" | "fulfillment" | "other"
  >(
    () =>
      (
        searchParams.get("listingAdjustment") as
          | "all"
          | "pricing"
          | "local-fit"
          | "booking"
          | "fulfillment"
          | "other"
      ) ?? "all",
  );
  const [listingTrendFilter, setListingTrendFilter] = useState<
    "all" | "improving" | "softening" | "stable" | "no-signal"
  >(
    () =>
      (
        searchParams.get("listingTrend") as
          | "all"
          | "improving"
          | "softening"
          | "stable"
          | "no-signal"
      ) ?? "all",
  );
  const [highlightedListingControlKey, setHighlightedListingControlKey] = useState<string | null>(null);
  const [highlightedFocusedPanelKey, setHighlightedFocusedPanelKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [workspaceLinkFeedback, setWorkspaceLinkFeedback] = useState<string | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction | null>(null);
  const [bulkExecutionMode, setBulkExecutionMode] = useState<"best_effort" | "atomic">(
    () => (searchParams.get("bulkMode") as "best_effort" | "atomic") ?? "best_effort",
  );
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [categories, setCategories] = useState<CategoryRead[]>([]);
  const [accountProfile, setAccountProfile] = useState<Profile | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("Weekend Pan Dulce Box");
  const [description, setDescription] = useState(
    "Small-batch sweet bread box for local pickup.",
  );
  const [listingType, setListingType] = useState<ListingType>(
    "product",
  );
  const [listingCategoryId, setListingCategoryId] = useState("");
  const [price, setPrice] = useState("2400");

  const clearSellerSession = useCallback((message?: string) => {
    window.localStorage.removeItem(SELLER_ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(SELLER_REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY);
    setWorkspace(null);
    setAccountProfile(null);
    setNotificationDeliveries([]);
    setNotificationsSeenAt(null);
    setListingDrafts({});
    setResponseNotes({});
    setReviewResponseDrafts({});
    setError(message ?? null);
    setActionFeedback(null);
    setPendingBulkAction(null);
    setCreateError(null);
    setCreateMessage(null);
    setListingPriceInsights({});
  }, []);

  const loadWorkspace = useCallback(async (accessToken: string) => {
    const profile = await api.get<Profile>("/profiles/me", { accessToken });
    setAccountProfile(profile);
    const deliveries = await api.loadMyNotificationDeliveries(accessToken);
    setNotificationDeliveries(deliveries);
    const nextWorkspace: SellerWorkspaceData | null = await api.loadSellerWorkspace(accessToken);
    if (!nextWorkspace) {
      setWorkspace(null);
      setListingDrafts({});
      setListingImageDrafts({});
      setResponseNotes({});
      setReviewResponseDrafts({});
      setNotificationDeliveries([]);
      setListingPriceInsights({});
      return;
    }
    setListingPriceInsights({});
    setWorkspace(nextWorkspace);
    const nextDrafts: Record<string, ListingDraft> = Object.fromEntries(
      nextWorkspace.listings.map((listing) => [
        listing.id,
        {
          category_id: listing.category_id ?? "",
          price_cents: listing.price_cents?.toString() ?? "",
          requires_booking: listing.requires_booking ?? false,
          duration_minutes: listing.duration_minutes?.toString() ?? "",
          lead_time_hours: listing.lead_time_hours?.toString() ?? "",
          is_local_only: listing.is_local_only ?? true,
          pickup_enabled: listing.pickup_enabled ?? false,
          meetup_enabled: listing.meetup_enabled ?? false,
          delivery_enabled: listing.delivery_enabled ?? false,
          shipping_enabled: listing.shipping_enabled ?? false,
          is_promoted: listing.is_promoted ?? false,
        },
      ]),
    );
    setListingDrafts(nextDrafts);
    setListingImageDrafts(
      Object.fromEntries(
        nextWorkspace.listings.map((listing) => [
          listing.id,
          {
            image_url: "",
            alt_text: listing.title,
          },
        ]),
      ),
    );
    setResponseNotes({
      ...Object.fromEntries(
        nextWorkspace.orders.map((order) => [order.id, order.seller_response_note ?? ""]),
      ),
      ...Object.fromEntries(
        nextWorkspace.bookings.map((booking) => [booking.id, booking.seller_response_note ?? ""]),
      ),
    });
    setReviewResponseDrafts(
      Object.fromEntries(
        nextWorkspace.reviews.map((review) => [review.id, review.seller_response ?? ""]),
      ),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextCategories = await api.listCategories();
        if (!cancelled) {
          setCategories(nextCategories);
        }
      } catch {
        if (!cancelled) {
          setCategories([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateResponseNote(id: string, value: string) {
    setResponseNotes((current) => ({
      ...current,
      [id]: value,
    }));
  }

  useEffect(() => {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const refreshToken = window.localStorage.getItem(SELLER_REFRESH_TOKEN_KEY);
    setNotificationsSeenAt(window.localStorage.getItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY));
    if (!accessToken || !refreshToken) {
      return;
    }

    setLoading(true);
    startTransition(async () => {
      try {
        let restoredAccessToken = accessToken;

        try {
          await loadWorkspace(accessToken);
        } catch (err) {
          if (!isExpiredAuthError(err)) {
            throw err;
          }

          const refreshedSession = await refreshSupabaseSession(refreshToken, {
            supabaseUrl,
            anonKey: supabaseAnonKey,
          });

          window.localStorage.setItem(SELLER_ACCESS_TOKEN_KEY, refreshedSession.access_token);
          window.localStorage.setItem(SELLER_REFRESH_TOKEN_KEY, refreshedSession.refresh_token);
          restoredAccessToken = refreshedSession.access_token;
          await loadWorkspace(restoredAccessToken);
        }
      } catch (err) {
        if (isExpiredAuthError(err)) {
          clearSellerSession("Your session expired. Sign in again.");
        } else {
          setError(err instanceof Error ? err.message : "Unable to restore workspace");
        }
      } finally {
        setLoading(false);
      }
    });
  }, [clearSellerSession, loadWorkspace]);

  useEffect(() => {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken || !workspace) {
      return;
    }

    const client = getSupabaseRealtimeClient(
      {
        supabaseUrl,
        anonKey: supabaseAnonKey,
      },
      accessToken,
    );

    const channel = client
      .channel(`seller-notifications-${workspace.seller.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_status_events",
        },
        () => {
          void loadWorkspace(accessToken);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "booking_status_events",
        },
        () => {
          void loadWorkspace(accessToken);
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadWorkspace, workspace]);

  useEffect(() => {
    if (!focusedActivityKey) {
      return;
    }

    const target = activityRefs.current[focusedActivityKey];
    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    setHighlightedFocusedPanelKey(focusedActivityKey);
    if (focusedPanelHighlightTimeoutRef.current) {
      window.clearTimeout(focusedPanelHighlightTimeoutRef.current);
    }
    focusedPanelHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedFocusedPanelKey((current) =>
        current === focusedActivityKey ? null : current,
      );
      focusedPanelHighlightTimeoutRef.current = null;
    }, 1800);
  }, [focusedActivityKey]);

  useEffect(() => {
    const requestedFocus = searchParams.get("focus");
    if (!requestedFocus) {
      return;
    }

    setFocusedActivityKey(requestedFocus);
  }, [searchParams]);

  useEffect(() => {
    setActivityListingFilter(searchParams.get("activityListing") ?? "all");
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (activityTypeFilter === "all") {
      params.delete("activityType");
    } else {
      params.set("activityType", activityTypeFilter);
    }

    if (activityStatusFilter === "all") {
      params.delete("activityStatus");
    } else {
      params.set("activityStatus", activityStatusFilter);
    }

    if (activityDiscoveryFilter === "all") {
      params.delete("activityDiscovery");
    } else {
      params.set("activityDiscovery", activityDiscoveryFilter);
    }

    if (activityListingFilter === "all") {
      params.delete("activityListing");
    } else {
      params.set("activityListing", activityListingFilter);
    }

    if (activityRecencyFilter === "all") {
      params.delete("activityWindow");
    } else {
      params.set("activityWindow", activityRecencyFilter);
    }

    if (activityContextFilter === "all") {
      params.delete("activityContext");
    } else {
      params.set("activityContext", activityContextFilter);
    }

    if (activityPressureFilter === "all") {
      params.delete("activityPressure");
    } else {
      params.set("activityPressure", activityPressureFilter);
    }

    if (activityRecoveryFilter === "all") {
      params.delete("activityRecovery");
    } else {
      params.set("activityRecovery", activityRecoveryFilter);
    }

    if (activitySortMode === "default") {
      params.delete("activitySort");
    } else {
      params.set("activitySort", activitySortMode);
    }

    if (deliveryRecencyFilter === "7d") {
      params.delete("deliveryWindow");
    } else {
      params.set("deliveryWindow", deliveryRecencyFilter);
    }

    if (deliveryStatusFilter === "all") {
      params.delete("deliveryStatus");
    } else {
      params.set("deliveryStatus", deliveryStatusFilter);
    }

    if (workspacePreset === "default") {
      params.delete("preset");
    } else {
      params.set("preset", workspacePreset);
    }

    if (listingAdjustmentFilter === "all") {
      params.delete("listingAdjustment");
    } else {
      params.set("listingAdjustment", listingAdjustmentFilter);
    }

    if (listingTrendFilter === "all") {
      params.delete("listingTrend");
    } else {
      params.set("listingTrend", listingTrendFilter);
    }

    if (bulkExecutionMode === "best_effort") {
      params.delete("bulkMode");
    } else {
      params.set("bulkMode", bulkExecutionMode);
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityListingFilter,
    activityPressureFilter,
    activityRecoveryFilter,
    activityRecencyFilter,
    activitySortMode,
    activityStatusFilter,
    activityTypeFilter,
    bulkExecutionMode,
    deliveryStatusFilter,
    deliveryRecencyFilter,
    listingAdjustmentFilter,
    listingTrendFilter,
    pathname,
    router,
    searchParams,
    workspacePreset,
  ]);

  function handleSignOut() {
    clearSellerSession();
  }

  function handleAuth() {
    setLoading(true);
    setError(null);
    setActionFeedback(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        const session =
          await authenticateWithSupabase({
            mode,
            email,
            password,
            config: {
              supabaseUrl,
              anonKey: supabaseAnonKey,
            },
          });

        try {
          await api.get("/profiles/me", { accessToken: session.access_token });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            const profilePayload: ProfilePayload = {
              full_name: fullName || null,
              username: username || null,
              city,
              state: stateRegion,
              country,
            };
            await api.createProfile(profilePayload, {
              accessToken: session.access_token,
            });
          } else {
            throw err;
          }
        }

        window.localStorage.setItem(SELLER_ACCESS_TOKEN_KEY, session.access_token);
        window.localStorage.setItem(SELLER_REFRESH_TOKEN_KEY, session.refresh_token);
        executeSellerApiAction({
          missingAccessTokenMessage: "Sign in again before loading seller workspace.",
          errorMessage: "Unable to continue",
          onFinally: () => setLoading(false),
          successFeedback: {
            tone: "success",
            message: "Signed in to seller workspace.",
          },
          reloadWorkspace: false,
          execute: () => loadWorkspace(session.access_token),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to continue");
        setLoading(false);
      }
    });
  }

  function handleCreateSellerProfile() {
    executeSellerApiAction({
      missingAccessTokenMessage: "Sign in before creating a seller profile.",
      errorMessage: "Unable to create seller profile",
      onStart: () => {
        setLoading(true);
        setError(null);
        setActionFeedback(null);
      },
      onFinally: () => setLoading(false),
      execute: (accessToken) => {
        const sellerPayload: SellerCreateInput = {
          display_name: sellerName,
          slug: sellerSlug,
          bio: "Independent seller storefront for local commerce.",
          city,
          state: stateRegion,
          country,
          accepts_custom_orders: true,
        };
        return api.createSellerProfile(sellerPayload, { accessToken });
      },
    });
  }

  function handleCreateListing() {
    if (!workspace) {
      return;
    }

    const listingPayload: ListingCreateInput = {
      seller_id: workspace.seller.id,
      category_id: listingCategoryId || undefined,
      title,
      description,
      type: listingType,
      price_cents: Number(price),
      currency: "USD",
      city: workspace.seller.city,
      state: workspace.seller.state,
      country: workspace.seller.country,
      pickup_enabled: listingType !== "service",
      meetup_enabled: true,
      delivery_enabled: listingType === "hybrid",
      shipping_enabled: false,
      requires_booking: listingType !== "product",
    };

    executeSellerApiAction({
      missingAccessTokenMessage: "Sign in again before creating a listing.",
      errorMessage: "Unable to create listing",
      onStart: () => {
        setCreateError(null);
        setCreateMessage(null);
        setLoading(true);
      },
      onFinally: () => setLoading(false),
      onSuccess: () => {
        setCreateMessage("Listing created and workspace refreshed.");
        setListingCategoryId("");
      },
      execute: (accessToken) => api.createListing(listingPayload, { accessToken }),
    });
  }

  function executeTransactionStatusUpdate(args: {
    id: string;
    kind: "order" | "booking";
    status: string;
    missingAccessTokenMessage: string;
    errorMessage: string;
    execute: (accessToken: string) => Promise<unknown>;
  }) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError(args.missingAccessTokenMessage);
      return;
    }

    setQueueLoading(args.id);
    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);

    startTransition(async () => {
      try {
        await args.execute(accessToken);
        await loadWorkspace(accessToken);
        setActionFeedback({
          tone: "success",
          message: `${args.kind === "order" ? "Order" : "Booking"} moved to ${args.status.replaceAll("_", " ")}.`,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : args.errorMessage);
        setActionFeedback(null);
      } finally {
        setQueueLoading(null);
      }
    });
  }

  function executeSellerApiAction<Result = unknown>(args: {
    missingAccessTokenMessage: string;
    errorMessage: string;
    execute: (accessToken: string) => Promise<Result>;
    successFeedback?: ActionFeedback;
    onSuccess?: (result: Result) => ActionFeedback | void;
    onStart?: () => void;
    onFinally?: () => void;
    reloadWorkspace?: boolean;
  }) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError(args.missingAccessTokenMessage);
      return;
    }

    setError(null);
    setActionFeedback(null);
    setPendingBulkAction(null);
    args.onStart?.();

    startTransition(async () => {
      try {
        const result = await args.execute(accessToken);
        if (args.reloadWorkspace ?? true) {
          await loadWorkspace(accessToken);
        }
        const feedback = args.onSuccess?.(result) ?? args.successFeedback;
        if (feedback) {
          setActionFeedback(feedback);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : args.errorMessage);
        setActionFeedback(null);
      } finally {
        args.onFinally?.();
      }
    });
  }

  function updateOrderStatus(orderId: string, status: string) {
    executeTransactionStatusUpdate({
      id: orderId,
      kind: "order",
      status,
      missingAccessTokenMessage: "Sign in again before updating orders.",
      errorMessage: "Unable to update order",
      execute: (accessToken) =>
        api.updateOrderStatus(
          orderId,
          {
            status,
            seller_response_note: responseNotes[orderId] || null,
          },
          {
            accessToken,
          },
        ),
    });
  }

  function updateBookingStatus(bookingId: string, status: string) {
    executeTransactionStatusUpdate({
      id: bookingId,
      kind: "booking",
      status,
      missingAccessTokenMessage: "Sign in again before updating bookings.",
      errorMessage: "Unable to update booking",
      execute: (accessToken) =>
        api.updateBookingStatus(
          bookingId,
          {
            status,
            seller_response_note: responseNotes[bookingId] || null,
          },
          {
            accessToken,
          },
        ),
    });
  }

  function updateListingStatus(listingId: string, status: ListingUpdateInput["status"]) {
    if (!status) {
      setCreateError("Sign in again before updating listings.");
      return;
    }

    executeSellerApiAction({
      missingAccessTokenMessage: "Sign in again before updating listings.",
      errorMessage: "Unable to update listing",
      onStart: () => {
        setListingActionLoading(listingId);
        setCreateError(null);
        setCreateMessage(null);
      },
      onFinally: () => setListingActionLoading(null),
      onSuccess: () => {
        setCreateMessage(`Listing moved to ${status.replaceAll("_", " ")}.`);
      },
      execute: (accessToken) => api.updateListing(listingId, { status }, { accessToken }),
    });
  }

  function updateListingDraft(
    listingId: string,
    updater: (current: ListingDraft) => ListingDraft,
  ) {
    setListingDrafts((current) => {
      const existing = current[listingId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [listingId]: updater(existing),
      };
    });
  }

  function saveListingDetails(listing: Listing) {
    const draft = listingDrafts[listing.id];
    if (!draft) {
      setCreateError("Sign in again before updating listings.");
      return;
    }

    executeSellerApiAction({
      missingAccessTokenMessage: "Sign in again before updating listings.",
      errorMessage: "Unable to save listing details",
      onStart: () => {
        setListingSaveLoading(listing.id);
        setCreateError(null);
        setCreateMessage(null);
      },
      onFinally: () => setListingSaveLoading(null),
      onSuccess: () => {
        setCreateMessage(`Saved operating settings for ${listing.title}.`);
      },
      execute: (accessToken) =>
        api.updateListing(listing.id, {
          category_id: draft.category_id || null,
          price_cents: draft.price_cents === "" ? null : Number(draft.price_cents),
          requires_booking: draft.requires_booking,
          duration_minutes: draft.duration_minutes === "" ? null : Number(draft.duration_minutes),
          lead_time_hours: draft.lead_time_hours === "" ? null : Number(draft.lead_time_hours),
          is_local_only: draft.is_local_only,
          pickup_enabled: draft.pickup_enabled,
          meetup_enabled: draft.meetup_enabled,
          delivery_enabled: draft.delivery_enabled,
          shipping_enabled: draft.shipping_enabled,
          is_promoted: draft.is_promoted,
        }, { accessToken }),
    });
  }

  function requestListingAiAssist(listing: Listing) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before using the AI assistant.");
      return;
    }

    setListingAiState((current) => ({
      ...current,
      [listing.id]: { loading: true, error: null, suggestion: null },
    }));

    void (async () => {
      try {
        const result = await api.assistListing(
          {
            listing_id: listing.id,
            title: listing.title,
            description: listing.description ?? undefined,
            type: listing.type,
            category_id: listing.category_id ?? undefined,
            city: listing.city ?? undefined,
            state: listing.state ?? undefined,
            country: listing.country ?? undefined,
            highlights: listing.last_operating_adjustment_summary ?? undefined,
          },
          { accessToken },
        );

        setListingAiState((current) => ({
          ...current,
          [listing.id]: { loading: false, error: null, suggestion: result.suggestion },
        }));
      } catch (err) {
        setListingAiState((current) => ({
          ...current,
          [listing.id]: {
            loading: false,
            error: err instanceof Error ? err.message : "Unable to generate AI suggestions.",
            suggestion: null,
          },
        }));
      }
    })();
  }

  function requestListingPriceInsight(listing: Listing) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setError("Sign in again before fetching price insights.");
      return;
    }

    setListingPriceInsights((current) => ({
      ...current,
      [listing.id]: { loading: true, error: null, insight: null },
    }));

    void (async () => {
      try {
        const insight = await api.getListingPriceInsight(listing.id, { accessToken });
        setListingPriceInsights((current) => ({
          ...current,
          [listing.id]: { loading: false, error: null, insight },
        }));
      } catch (err) {
        setListingPriceInsights((current) => ({
          ...current,
          [listing.id]: {
            loading: false,
            error: err instanceof Error ? err.message : "Unable to load price insights.",
            insight: null,
          },
        }));
      }
    })();
  }

  function requestCreateListingAiAssist() {
    if (!workspace) {
      return;
    }
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setListingCreateAiState({
        loading: false,
        error: "Sign in again before using the AI assistant.",
        suggestion: null,
      });
      return;
    }

    setListingCreateAiState({ loading: true, error: null, suggestion: null });

    void (async () => {
      try {
        const result = await api.assistListing(
          {
            title,
            description: description?.trim() ? description : undefined,
            type: listingType,
            category_id: listingCategoryId || undefined,
            city: workspace.seller.city ?? undefined,
            state: workspace.seller.state ?? undefined,
            country: workspace.seller.country ?? undefined,
            highlights: description?.trim() || undefined,
          },
          { accessToken },
        );

        setListingCreateAiState({ loading: false, error: null, suggestion: result.suggestion });
      } catch (err) {
        setListingCreateAiState({
          loading: false,
          error: err instanceof Error ? err.message : "Unable to generate AI suggestions.",
          suggestion: null,
        });
      }
    })();
  }

  function applyCreateListingSuggestion(suggestion: ListingAiAssistSuggestion) {
    setTitle(suggestion.suggested_title);
    setDescription(suggestion.suggested_description);
    if (suggestion.suggested_category_id) {
      setListingCategoryId(suggestion.suggested_category_id);
    }
    setListingCreateAiState((current) => (current ? { ...current, suggestion } : current));
  }

  function updateListingImageDraft(
    listingId: string,
    updater: (current: ListingImageDraft) => ListingImageDraft,
  ) {
    setListingImageDrafts((current) => ({
      ...current,
      [listingId]: updater(
        current[listingId] ?? {
          image_url: "",
          alt_text: "",
        },
      ),
    }));
  }

  function addListingImage(listing: Listing) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    const draft = listingImageDrafts[listing.id];
    if (!accessToken || !draft) {
      setCreateError("Sign in again before updating listing images.");
      return;
    }

    if (!draft.image_url.trim()) {
      setCreateError("Paste an image URL before adding listing media.");
      return;
    }

    setListingImageActionLoading(`${listing.id}:add`);
    setCreateError(null);
    setCreateMessage(null);

    startTransition(async () => {
      try {
        await api.addListingImage(
          listing.id,
          {
            image_url: draft.image_url.trim(),
            alt_text: draft.alt_text.trim() || listing.title,
          },
          { accessToken },
        );
        await loadWorkspace(accessToken);
        setCreateMessage(`Added image gallery media to ${listing.title}.`);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Unable to add listing image");
      } finally {
        setListingImageActionLoading(null);
      }
    });
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Unable to read image file."));
          return;
        }

        const [, base64Data = ""] = result.split(",", 2);
        resolve(base64Data);
      };
      reader.onerror = () => reject(new Error("Unable to read image file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadListingImageFile(listing: Listing, file: File) {
    const draft = listingImageDrafts[listing.id];
    if (!draft) {
      setCreateError("Sign in again before uploading listing images.");
      return;
    }

    executeSellerApiAction({
      missingAccessTokenMessage: "Sign in again before uploading listing images.",
      errorMessage: "Unable to upload listing image",
      onStart: () => {
        setListingImageActionLoading(`${listing.id}:upload`);
        setCreateError(null);
        setCreateMessage(null);
      },
      onFinally: () => setListingImageActionLoading(null),
      onSuccess: () => {
        setCreateMessage(`Uploaded image media for ${listing.title}.`);
      },
      execute: async (accessToken) => {
        const base64Data = await fileToBase64(file);
        await api.uploadListingImage(
          listing.id,
          {
            filename: file.name,
            content_type: file.type || "image/jpeg",
            base64_data: base64Data,
            alt_text: draft.alt_text.trim() || listing.title,
          },
          { accessToken },
        );
      },
    });
  }

  function removeListingImage(listing: Listing, image: ListingImage) {
    executeSellerApiAction({
      missingAccessTokenMessage: "Sign in again before updating listing images.",
      errorMessage: "Unable to remove listing image",
      onStart: () => {
        setListingImageActionLoading(image.id);
        setCreateError(null);
        setCreateMessage(null);
      },
      onFinally: () => setListingImageActionLoading(null),
      onSuccess: () => {
        setCreateMessage(`Removed an image from ${listing.title}.`);
      },
      execute: (accessToken) => api.deleteListingImage(listing.id, image.id, { accessToken }),
    });
  }

  function updateReviewResponseDraft(reviewId: string, value: string) {
    setReviewResponseDrafts((current) => ({
      ...current,
      [reviewId]: value,
    }));
  }

  function saveReviewResponse(review: ReviewRead) {
    executeSellerApiAction<Profile>({
      missingAccessTokenMessage: "Sign in again before responding to reviews.",
      errorMessage: "Unable to save seller response",
      onStart: () => setReviewResponseLoading(review.id),
      onFinally: () => setReviewResponseLoading(null),
      successFeedback: {
        tone: "success",
        message: "Seller review response saved.",
      },
      execute: (accessToken) =>
        api.updateReviewSellerResponse(
          review.id,
          {
            seller_response: reviewResponseDrafts[review.id] ?? null,
          },
          { accessToken },
        ),
    });
  }

  const notifications: NotificationItem[] = useMemo(
    () =>
      workspace
        ? buildNotifications({
            audience: "seller",
            orders: workspace.orders,
            bookings: workspace.bookings,
          })
        : [],
    [workspace],
  );
  const unreadNotificationCount = notificationsSeenAt
    ? notifications.filter(
        (item) => new Date(item.createdAt).getTime() > new Date(notificationsSeenAt).getTime(),
      ).length
    : notifications.length;
  const unreadActivityKeys = useMemo(
    () =>
      new Set(
        notifications
          .filter((item) =>
            notificationsSeenAt
              ? new Date(item.createdAt).getTime() > new Date(notificationsSeenAt).getTime()
              : true,
          )
          .map((item) => `${item.transactionKind}:${item.transactionId}`),
      ),
    [notifications, notificationsSeenAt],
  );
  const activityStatusOptions = useMemo(() => {
    if (!workspace) {
      return ["all"];
    }

    return [
      "all",
      ...new Set([
        ...workspace.orders.map((order) => order.status),
        ...workspace.bookings.map((booking) => booking.status),
      ]),
    ];
  }, [workspace]);
  const focusedOrder = focusedActivityKey?.startsWith("order:")
    ? workspace?.orders.find((order) => `order:${order.id}` === focusedActivityKey) ?? null
    : null;
  const focusedBooking = focusedActivityKey?.startsWith("booking:")
    ? workspace?.bookings.find((booking) => `booking:${booking.id}` === focusedActivityKey) ?? null
    : null;
  const listingsById = useMemo(
    () => Object.fromEntries((workspace?.listings ?? []).map((listing) => [listing.id, listing])),
    [workspace?.listings],
  );
  const filteredOrders = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const filtered = workspace.orders.filter((order) => {
      const activityKey = `order:${order.id}`;
      const hasInlineReviewPressure =
        (((workspace.seller.average_rating ?? 0) > 0 && (workspace.seller.average_rating ?? 0) < 4.2) ||
          (workspace.reviews ?? []).some((review) => review.rating <= 3));
      const listingId = getTransactionListingId(order);
      const deliveryPressure = listingId
        ? {
            failed: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "failed" || delivery.transaction_kind !== "order") {
                return false;
              }
              return delivery.transaction_id === order.id;
            }).length,
            queued: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "queued" || delivery.transaction_kind !== "order") {
                return false;
              }
              return delivery.transaction_id === order.id;
            }).length,
          }
        : { failed: 0, queued: 0 };
      const supportPressure = getListingSupportPressure({
        failedDeliveryCount: deliveryPressure.failed,
        queuedDeliveryCount: deliveryPressure.queued,
        retentionTrendLabel: null,
        hasReviewPressure: hasInlineReviewPressure,
      });
      const pressureMode = getListingSupportPressureLaneMode({
        failedDeliveryCount: deliveryPressure.failed,
        queuedDeliveryCount: deliveryPressure.queued,
        supportPressureLabel: supportPressure?.label ?? null,
      });
      const isRecoveryEasing =
        Boolean(listingId) &&
        deliveryPressure.failed === 0 &&
        deliveryPressure.queued === 0 &&
        notificationDeliveries.some(
          (delivery) =>
            delivery.transaction_kind === "order" &&
            delivery.delivery_status === "sent" &&
            delivery.transaction_id === order.id &&
            matchesDeliveryRecency(delivery.created_at, "7d"),
        );
      if (activityTypeFilter === "booking") {
        return false;
      }
      if (activityListingFilter !== "all" && getTransactionListingId(order) !== activityListingFilter) {
        return false;
      }
      if (activityStatusFilter !== "all" && order.status !== activityStatusFilter) {
        return false;
      }
      if (
        activityDiscoveryFilter === "local" &&
        !isLocalDrivenBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "search" &&
        !isSearchDrivenBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "price" &&
        !isPriceDrivenBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "same-seller" &&
        !isSameSellerFollowOnBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "cross-seller" &&
        !isCrossSellerFollowOnBrowseContext(order.buyer_browse_context)
      ) {
        return false;
      }
      if (!matchesActivityRecency(order.status_history, activityRecencyFilter)) {
        return false;
      }
      if (activityContextFilter === "unread" && !unreadActivityKeys.has(activityKey)) {
        return false;
      }
      if (activityContextFilter === "focused" && focusedActivityKey !== activityKey) {
        return false;
      }
      if (activityPressureFilter === "delivery" && pressureMode !== "failed") {
        return false;
      }
      if (activityPressureFilter === "trust" && pressureMode !== "trust") {
        return false;
      }
      if (activityRecoveryFilter === "easing" && !isRecoveryEasing) {
        return false;
      }
      return true;
    });

    if (activitySortMode === "default") {
      return filtered;
    }

    return [...filtered].sort((left, right) => {
      const hasInlineReviewPressure =
        (((workspace.seller.average_rating ?? 0) > 0 && (workspace.seller.average_rating ?? 0) < 4.2) ||
          (workspace.reviews ?? []).some((review) => review.rating <= 3));
      const leftListingId = getTransactionListingId(left);
      const rightListingId = getTransactionListingId(right);
      const leftTransactions = [...workspace.orders, ...workspace.bookings].filter(
        (transaction) => getTransactionListingId(transaction) === leftListingId,
      );
      const rightTransactions = [...workspace.orders, ...workspace.bookings].filter(
        (transaction) => getTransactionListingId(transaction) === rightListingId,
      );
      const leftRetention = leftListingId
        ? {
            sameSellerCount: leftTransactions.filter((transaction) =>
              isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            crossSellerCount: leftTransactions.filter((transaction) =>
              isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            sameSellerRecentCount: leftTransactions.filter(
              (transaction) =>
                isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            crossSellerRecentCount: leftTransactions.filter(
              (transaction) =>
                isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            sameSellerPostAdjustmentCount: 0,
            crossSellerPostAdjustmentCount: 0,
          }
        : null;
      const rightRetention = rightListingId
        ? {
            sameSellerCount: rightTransactions.filter((transaction) =>
              isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            crossSellerCount: rightTransactions.filter((transaction) =>
              isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            sameSellerRecentCount: rightTransactions.filter(
              (transaction) =>
                isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            crossSellerRecentCount: rightTransactions.filter(
              (transaction) =>
                isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            sameSellerPostAdjustmentCount: 0,
            crossSellerPostAdjustmentCount: 0,
          }
        : null;
      const leftRetentionTrend = leftRetention
        ? getListingRetentionTrend({
            sameSellerCount: leftRetention.sameSellerCount,
            crossSellerCount: leftRetention.crossSellerCount,
            sameSellerRecentCount: leftRetention.sameSellerRecentCount,
            crossSellerRecentCount: leftRetention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: leftRetention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: leftRetention.crossSellerPostAdjustmentCount,
          })
        : null;
      const rightRetentionTrend = rightRetention
        ? getListingRetentionTrend({
            sameSellerCount: rightRetention.sameSellerCount,
            crossSellerCount: rightRetention.crossSellerCount,
            sameSellerRecentCount: rightRetention.sameSellerRecentCount,
            crossSellerRecentCount: rightRetention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: rightRetention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: rightRetention.crossSellerPostAdjustmentCount,
          })
        : null;
      const leftDeliveryPressure = leftListingId
        ? {
            failed: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "failed") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === leftListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === leftListingId : false;
            }).length,
            queued: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "queued") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === leftListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === leftListingId : false;
            }).length,
          }
        : { failed: 0, queued: 0 };
      const rightDeliveryPressure = rightListingId
        ? {
            failed: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "failed") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === rightListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === rightListingId : false;
            }).length,
            queued: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "queued") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === rightListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === rightListingId : false;
            }).length,
          }
        : { failed: 0, queued: 0 };
      const leftSupportPressure = getListingSupportPressure({
        failedDeliveryCount: leftDeliveryPressure.failed,
        queuedDeliveryCount: leftDeliveryPressure.queued,
        retentionTrendLabel: leftRetentionTrend?.label ?? null,
        hasReviewPressure: hasInlineReviewPressure,
      });
      const rightSupportPressure = getListingSupportPressure({
        failedDeliveryCount: rightDeliveryPressure.failed,
        queuedDeliveryCount: rightDeliveryPressure.queued,
        retentionTrendLabel: rightRetentionTrend?.label ?? null,
        hasReviewPressure: hasInlineReviewPressure,
      });
      const leftPriority = getListingSupportPressureLanePriority(
        getListingSupportPressureLaneMode({
          failedDeliveryCount: leftDeliveryPressure.failed,
          queuedDeliveryCount: leftDeliveryPressure.queued,
          supportPressureLabel: leftSupportPressure?.label ?? null,
        }),
      );
      const rightPriority = getListingSupportPressureLanePriority(
        getListingSupportPressureLaneMode({
          failedDeliveryCount: rightDeliveryPressure.failed,
          queuedDeliveryCount: rightDeliveryPressure.queued,
          supportPressureLabel: rightSupportPressure?.label ?? null,
        }),
      );
      const leftRecoveryDelta =
        notificationDeliveries.filter((delivery) => {
          if (!leftListingId || !matchesDeliveryRecency(delivery.created_at, "7d")) {
            return false;
          }
          if (delivery.transaction_kind === "order") {
            const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
            return matchingOrder ? getTransactionListingId(matchingOrder) === leftListingId : false;
          }
          const matchingBooking = workspace.bookings.find((booking) => booking.id === delivery.transaction_id);
          return matchingBooking ? getTransactionListingId(matchingBooking) === leftListingId : false;
        }).reduce((sum, delivery) => {
          if (delivery.delivery_status === "sent") {
            return sum + 1;
          }
          if (delivery.delivery_status === "failed") {
            return sum - 1;
          }
          return sum;
        }, 0);
      const rightRecoveryDelta =
        notificationDeliveries.filter((delivery) => {
          if (!rightListingId || !matchesDeliveryRecency(delivery.created_at, "7d")) {
            return false;
          }
          if (delivery.transaction_kind === "order") {
            const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
            return matchingOrder ? getTransactionListingId(matchingOrder) === rightListingId : false;
          }
          const matchingBooking = workspace.bookings.find((booking) => booking.id === delivery.transaction_id);
          return matchingBooking ? getTransactionListingId(matchingBooking) === rightListingId : false;
        }).reduce((sum, delivery) => {
          if (delivery.delivery_status === "sent") {
            return sum + 1;
          }
          if (delivery.delivery_status === "failed") {
            return sum - 1;
          }
          return sum;
        }, 0);

      if (activitySortMode === "drag" && leftRecoveryDelta !== rightRecoveryDelta) {
        return leftRecoveryDelta - rightRecoveryDelta;
      }

      if (activitySortMode === "recovery" && leftRecoveryDelta !== rightRecoveryDelta) {
        return rightRecoveryDelta - leftRecoveryDelta;
      }

      if (activitySortMode === "pressured" && leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      return getLatestTransactionTimestamp(right) - getLatestTransactionTimestamp(left);
    });
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityListingFilter,
    activityPressureFilter,
    activityRecoveryFilter,
    activityRecencyFilter,
    activitySortMode,
    activityStatusFilter,
    activityTypeFilter,
    focusedActivityKey,
    unreadActivityKeys,
    workspace,
    notificationDeliveries,
  ]);
  const filteredBookings = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const filtered = workspace.bookings.filter((booking) => {
      const activityKey = `booking:${booking.id}`;
      const hasInlineReviewPressure =
        (((workspace.seller.average_rating ?? 0) > 0 && (workspace.seller.average_rating ?? 0) < 4.2) ||
          (workspace.reviews ?? []).some((review) => review.rating <= 3));
      const listingId = getTransactionListingId(booking);
      const deliveryPressure = listingId
        ? {
            failed: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "failed" || delivery.transaction_kind !== "booking") {
                return false;
              }
              return delivery.transaction_id === booking.id;
            }).length,
            queued: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "queued" || delivery.transaction_kind !== "booking") {
                return false;
              }
              return delivery.transaction_id === booking.id;
            }).length,
          }
        : { failed: 0, queued: 0 };
      const supportPressure = getListingSupportPressure({
        failedDeliveryCount: deliveryPressure.failed,
        queuedDeliveryCount: deliveryPressure.queued,
        retentionTrendLabel: null,
        hasReviewPressure: hasInlineReviewPressure,
      });
      const pressureMode = getListingSupportPressureLaneMode({
        failedDeliveryCount: deliveryPressure.failed,
        queuedDeliveryCount: deliveryPressure.queued,
        supportPressureLabel: supportPressure?.label ?? null,
      });
      const isRecoveryEasing =
        Boolean(listingId) &&
        deliveryPressure.failed === 0 &&
        deliveryPressure.queued === 0 &&
        notificationDeliveries.some(
          (delivery) =>
            delivery.transaction_kind === "booking" &&
            delivery.delivery_status === "sent" &&
            delivery.transaction_id === booking.id &&
            matchesDeliveryRecency(delivery.created_at, "7d"),
        );
      if (activityTypeFilter === "order") {
        return false;
      }
      if (activityListingFilter !== "all" && getTransactionListingId(booking) !== activityListingFilter) {
        return false;
      }
      if (activityStatusFilter !== "all" && booking.status !== activityStatusFilter) {
        return false;
      }
      if (
        activityDiscoveryFilter === "local" &&
        !isLocalDrivenBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "search" &&
        !isSearchDrivenBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "price" &&
        !isPriceDrivenBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "same-seller" &&
        !isSameSellerFollowOnBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (
        activityDiscoveryFilter === "cross-seller" &&
        !isCrossSellerFollowOnBrowseContext(booking.buyer_browse_context)
      ) {
        return false;
      }
      if (!matchesActivityRecency(booking.status_history, activityRecencyFilter)) {
        return false;
      }
      if (activityContextFilter === "unread" && !unreadActivityKeys.has(activityKey)) {
        return false;
      }
      if (activityContextFilter === "focused" && focusedActivityKey !== activityKey) {
        return false;
      }
      if (activityPressureFilter === "delivery" && pressureMode !== "failed") {
        return false;
      }
      if (activityPressureFilter === "trust" && pressureMode !== "trust") {
        return false;
      }
      if (activityRecoveryFilter === "easing" && !isRecoveryEasing) {
        return false;
      }
      return true;
    });

    if (activitySortMode === "default") {
      return filtered;
    }

    return [...filtered].sort((left, right) => {
      const hasInlineReviewPressure =
        (((workspace.seller.average_rating ?? 0) > 0 && (workspace.seller.average_rating ?? 0) < 4.2) ||
          (workspace.reviews ?? []).some((review) => review.rating <= 3));
      const leftListingId = getTransactionListingId(left);
      const rightListingId = getTransactionListingId(right);
      const leftTransactions = [...workspace.orders, ...workspace.bookings].filter(
        (transaction) => getTransactionListingId(transaction) === leftListingId,
      );
      const rightTransactions = [...workspace.orders, ...workspace.bookings].filter(
        (transaction) => getTransactionListingId(transaction) === rightListingId,
      );
      const leftRetention = leftListingId
        ? {
            sameSellerCount: leftTransactions.filter((transaction) =>
              isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            crossSellerCount: leftTransactions.filter((transaction) =>
              isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            sameSellerRecentCount: leftTransactions.filter(
              (transaction) =>
                isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            crossSellerRecentCount: leftTransactions.filter(
              (transaction) =>
                isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            sameSellerPostAdjustmentCount: 0,
            crossSellerPostAdjustmentCount: 0,
          }
        : null;
      const rightRetention = rightListingId
        ? {
            sameSellerCount: rightTransactions.filter((transaction) =>
              isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            crossSellerCount: rightTransactions.filter((transaction) =>
              isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
            ).length,
            sameSellerRecentCount: rightTransactions.filter(
              (transaction) =>
                isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            crossSellerRecentCount: rightTransactions.filter(
              (transaction) =>
                isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
                isRecentTransactionEvent(transaction.status_history, 7),
            ).length,
            sameSellerPostAdjustmentCount: 0,
            crossSellerPostAdjustmentCount: 0,
          }
        : null;
      const leftRetentionTrend = leftRetention
        ? getListingRetentionTrend({
            sameSellerCount: leftRetention.sameSellerCount,
            crossSellerCount: leftRetention.crossSellerCount,
            sameSellerRecentCount: leftRetention.sameSellerRecentCount,
            crossSellerRecentCount: leftRetention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: leftRetention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: leftRetention.crossSellerPostAdjustmentCount,
          })
        : null;
      const rightRetentionTrend = rightRetention
        ? getListingRetentionTrend({
            sameSellerCount: rightRetention.sameSellerCount,
            crossSellerCount: rightRetention.crossSellerCount,
            sameSellerRecentCount: rightRetention.sameSellerRecentCount,
            crossSellerRecentCount: rightRetention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: rightRetention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: rightRetention.crossSellerPostAdjustmentCount,
          })
        : null;
      const leftDeliveryPressure = leftListingId
        ? {
            failed: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "failed") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === leftListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === leftListingId : false;
            }).length,
            queued: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "queued") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === leftListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === leftListingId : false;
            }).length,
          }
        : { failed: 0, queued: 0 };
      const rightDeliveryPressure = rightListingId
        ? {
            failed: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "failed") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === rightListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === rightListingId : false;
            }).length,
            queued: notificationDeliveries.filter((delivery) => {
              if (delivery.delivery_status !== "queued") {
                return false;
              }

              if (delivery.transaction_kind === "order") {
                const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
                return matchingOrder ? getTransactionListingId(matchingOrder) === rightListingId : false;
              }

              const matchingBooking = workspace.bookings.find(
                (booking) => booking.id === delivery.transaction_id,
              );
              return matchingBooking ? getTransactionListingId(matchingBooking) === rightListingId : false;
            }).length,
          }
        : { failed: 0, queued: 0 };
      const leftSupportPressure = getListingSupportPressure({
        failedDeliveryCount: leftDeliveryPressure.failed,
        queuedDeliveryCount: leftDeliveryPressure.queued,
        retentionTrendLabel: leftRetentionTrend?.label ?? null,
        hasReviewPressure: hasInlineReviewPressure,
      });
      const rightSupportPressure = getListingSupportPressure({
        failedDeliveryCount: rightDeliveryPressure.failed,
        queuedDeliveryCount: rightDeliveryPressure.queued,
        retentionTrendLabel: rightRetentionTrend?.label ?? null,
        hasReviewPressure: hasInlineReviewPressure,
      });
      const leftPriority = getListingSupportPressureLanePriority(
        getListingSupportPressureLaneMode({
          failedDeliveryCount: leftDeliveryPressure.failed,
          queuedDeliveryCount: leftDeliveryPressure.queued,
          supportPressureLabel: leftSupportPressure?.label ?? null,
        }),
      );
      const rightPriority = getListingSupportPressureLanePriority(
        getListingSupportPressureLaneMode({
          failedDeliveryCount: rightDeliveryPressure.failed,
          queuedDeliveryCount: rightDeliveryPressure.queued,
          supportPressureLabel: rightSupportPressure?.label ?? null,
        }),
      );
      const leftRecoveryDelta =
        notificationDeliveries.filter((delivery) => {
          if (!leftListingId || !matchesDeliveryRecency(delivery.created_at, "7d")) {
            return false;
          }
          if (delivery.transaction_kind === "order") {
            const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
            return matchingOrder ? getTransactionListingId(matchingOrder) === leftListingId : false;
          }
          const matchingBooking = workspace.bookings.find((booking) => booking.id === delivery.transaction_id);
          return matchingBooking ? getTransactionListingId(matchingBooking) === leftListingId : false;
        }).reduce((sum, delivery) => {
          if (delivery.delivery_status === "sent") {
            return sum + 1;
          }
          if (delivery.delivery_status === "failed") {
            return sum - 1;
          }
          return sum;
        }, 0);
      const rightRecoveryDelta =
        notificationDeliveries.filter((delivery) => {
          if (!rightListingId || !matchesDeliveryRecency(delivery.created_at, "7d")) {
            return false;
          }
          if (delivery.transaction_kind === "order") {
            const matchingOrder = workspace.orders.find((order) => order.id === delivery.transaction_id);
            return matchingOrder ? getTransactionListingId(matchingOrder) === rightListingId : false;
          }
          const matchingBooking = workspace.bookings.find((booking) => booking.id === delivery.transaction_id);
          return matchingBooking ? getTransactionListingId(matchingBooking) === rightListingId : false;
        }).reduce((sum, delivery) => {
          if (delivery.delivery_status === "sent") {
            return sum + 1;
          }
          if (delivery.delivery_status === "failed") {
            return sum - 1;
          }
          return sum;
        }, 0);

      if (activitySortMode === "drag" && leftRecoveryDelta !== rightRecoveryDelta) {
        return leftRecoveryDelta - rightRecoveryDelta;
      }

      if (activitySortMode === "recovery" && leftRecoveryDelta !== rightRecoveryDelta) {
        return rightRecoveryDelta - leftRecoveryDelta;
      }

      if (activitySortMode === "pressured" && leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      return getLatestTransactionTimestamp(right) - getLatestTransactionTimestamp(left);
    });
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityListingFilter,
    activityPressureFilter,
    activityRecoveryFilter,
    activityRecencyFilter,
    activitySortMode,
    activityStatusFilter,
    activityTypeFilter,
    focusedActivityKey,
    unreadActivityKeys,
    workspace,
    notificationDeliveries,
  ]);
  const filteredNotificationDeliveries = useMemo(
    () =>
      notificationDeliveries.filter((delivery) => {
        if (!matchesDeliveryRecency(delivery.created_at, deliveryRecencyFilter)) {
          return false;
        }

        if (deliveryStatusFilter === "all") {
          return true;
        }

        return delivery.delivery_status === deliveryStatusFilter;
      }),
    [deliveryRecencyFilter, deliveryStatusFilter, notificationDeliveries],
  );
  const queuedDeliveryCount = useMemo(
    () => notificationDeliveries.filter((delivery) => delivery.delivery_status === "queued").length,
    [notificationDeliveries],
  );
  const failedDeliveryCount = useMemo(
    () => notificationDeliveries.filter((delivery) => delivery.delivery_status === "failed").length,
    [notificationDeliveries],
  );
  const failedDeliveryRecentCount = useMemo(
    () =>
      notificationDeliveries.filter(
        (delivery) =>
          delivery.delivery_status === "failed" && matchesDeliveryRecency(delivery.created_at, "7d"),
      ).length,
    [notificationDeliveries],
  );
  const queuedDeliveryRecentCount = useMemo(
    () =>
      notificationDeliveries.filter(
        (delivery) =>
          delivery.delivery_status === "queued" && matchesDeliveryRecency(delivery.created_at, "7d"),
      ).length,
    [notificationDeliveries],
  );
  const sentDeliveryRecentCount = useMemo(
    () =>
      notificationDeliveries.filter(
        (delivery) =>
          delivery.delivery_status === "sent" && matchesDeliveryRecency(delivery.created_at, "7d"),
      ).length,
    [notificationDeliveries],
  );
  const recoveredVsFailedDelta = sentDeliveryRecentCount - failedDeliveryRecentCount;
  const pendingVisibleOrdersCount = useMemo(
    () => filteredOrders.filter((order) => order.status === "pending").length,
    [filteredOrders],
  );
  const readyVisibleOrdersCount = useMemo(
    () => filteredOrders.filter((order) => order.status === "ready").length,
    [filteredOrders],
  );
  const requestedVisibleBookingsCount = useMemo(
    () => filteredBookings.filter((booking) => booking.status === "requested").length,
    [filteredBookings],
  );
  const inProgressVisibleBookingsCount = useMemo(
    () => filteredBookings.filter((booking) => booking.status === "in_progress").length,
    [filteredBookings],
  );
  const focusedItemCount = focusedActivityKey ? 1 : 0;
  const localDrivenOrdersCount = useMemo(
    () =>
      (workspace?.orders ?? []).filter((order) =>
        isLocalDrivenBrowseContext(order.buyer_browse_context),
      ).length,
    [workspace?.orders],
  );
  const localDrivenBookingsCount = useMemo(
    () =>
      (workspace?.bookings ?? []).filter((booking) =>
        isLocalDrivenBrowseContext(booking.buyer_browse_context),
      ).length,
    [workspace?.bookings],
  );
  const searchDrivenBookingsCount = useMemo(
    () =>
      (workspace?.bookings ?? []).filter((booking) =>
        isSearchDrivenBrowseContext(booking.buyer_browse_context),
      ).length,
    [workspace?.bookings],
  );
  const priceDrivenConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter((transaction) =>
        isPriceDrivenBrowseContext(transaction.buyer_browse_context),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const sameSellerFollowOnConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter((transaction) =>
        isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const crossSellerFollowOnConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter((transaction) =>
        isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const localDrivenRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isLocalDrivenBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const searchDrivenRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isSearchDrivenBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const priceDrivenRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isPriceDrivenBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const recentBrowseContextConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          formatBuyerBrowseContextLabel(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const hasSellerReviewPressure = useMemo(() => {
    if (!workspace) {
      return false;
    }

    if ((workspace.seller.average_rating ?? 0) > 0 && (workspace.seller.average_rating ?? 0) < 4.2) {
      return true;
    }

    return workspace.reviews.some((review) => review.rating <= 3);
  }, [workspace]);
  const listingDeliveryPressureById = useMemo(() => {
    if (!workspace) {
      return {};
    }

    const transactionListingByKey = {
      ...Object.fromEntries(
        workspace.orders.map((order) => [`order:${order.id}`, getTransactionListingId(order) ?? ""]),
      ),
      ...Object.fromEntries(
        workspace.bookings.map((booking) => [`booking:${booking.id}`, getTransactionListingId(booking) ?? ""]),
      ),
    };

    return notificationDeliveries.reduce<Record<string, { failed: number; queued: number }>>((acc, delivery) => {
      const listingId = transactionListingByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`];
      if (!listingId) {
        return acc;
      }

      const current = acc[listingId] ?? { failed: 0, queued: 0 };
      if (delivery.delivery_status === "failed") {
        current.failed += 1;
      }
      if (delivery.delivery_status === "queued") {
        current.queued += 1;
      }
      acc[listingId] = current;
      return acc;
    }, {});
  }, [notificationDeliveries, workspace]);
  const listingRecoveryDeltaById = useMemo(() => {
    if (!workspace) {
      return {};
    }

    const transactionListingByKey = {
      ...Object.fromEntries(
        workspace.orders.map((order) => [`order:${order.id}`, getTransactionListingId(order) ?? ""]),
      ),
      ...Object.fromEntries(
        workspace.bookings.map((booking) => [`booking:${booking.id}`, getTransactionListingId(booking) ?? ""]),
      ),
    };

    return notificationDeliveries.reduce<Record<string, number>>((acc, delivery) => {
      if (!matchesDeliveryRecency(delivery.created_at, "7d")) {
        return acc;
      }

      const listingId = transactionListingByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`];
      if (!listingId) {
        return acc;
      }

      const current = acc[listingId] ?? 0;
      if (delivery.delivery_status === "sent") {
        acc[listingId] = current + 1;
        return acc;
      }

      if (delivery.delivery_status === "failed") {
        acc[listingId] = current - 1;
      }

      return acc;
    }, {});
  }, [notificationDeliveries, workspace]);
  const sameSellerFollowOnRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const crossSellerFollowOnRecentConversionsCount = useMemo(
    () =>
      [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) =>
          isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
          isRecentTransactionEvent(transaction.status_history, 7),
      ).length,
    [workspace?.bookings, workspace?.orders],
  );
  const sellerAnalyticsSnapshot = useMemo(() => {
    if (!workspace) {
      return null;
    }

    const orders = workspace.orders ?? [];
    const bookings = workspace.bookings ?? [];
    const reviews = workspace.reviews ?? [];
    const transactions = [...orders, ...bookings];
    const totalRevenueCents = transactions.reduce(
      (sum, transaction) => sum + (transaction.total_cents ?? 0),
      0,
    );
    const averageTicketCents =
      transactions.length > 0 ? Math.round(totalRevenueCents / transactions.length) : 0;
    const recentTransactions = transactions.filter((transaction) =>
      isRecentTransactionEvent(transaction.status_history, 7),
    );
    const totalFollowOn = sameSellerFollowOnConversionsCount + crossSellerFollowOnConversionsCount;
    const repeatShare = totalFollowOn > 0 ? sameSellerFollowOnConversionsCount / totalFollowOn : 0;
    const reviewAverage =
      reviews.length > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
        : workspace.seller.average_rating ?? 0;

    return {
      totalRevenueCents,
      averageTicketCents,
      recentTransactionsCount: recentTransactions.length,
      repeatShare,
      reviewAverage,
    };
  }, [
    crossSellerFollowOnConversionsCount,
    sameSellerFollowOnConversionsCount,
    workspace,
  ]);
  const sellerAnalyticsListingInsights = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const transactions = [...workspace.orders, ...workspace.bookings];

    return workspace.listings
      .map((listing) => {
        const listingTransactions = transactions.filter(
          (transaction) => getTransactionListingId(transaction) === listing.id,
        );
        const revenueCents = listingTransactions.reduce(
          (sum, transaction) => sum + (transaction.total_cents ?? 0),
          0,
        );
        const retention = listingFollowOnBreakdownById[listing.id];
        const totalFollowOn =
          (retention?.sameSellerCount ?? 0) + (retention?.crossSellerCount ?? 0);
        const repeatShare =
          totalFollowOn > 0 ? (retention?.sameSellerCount ?? 0) / totalFollowOn : 0;
        const recoveryDelta = listingRecoveryDeltaById[listing.id] ?? 0;
        const deliveryPressure = listingDeliveryPressureById[listing.id] ?? {
          failed: 0,
          queued: 0,
        };
        const attentionScore =
          deliveryPressure.failed * 3 +
          deliveryPressure.queued * 2 +
          (retention &&
          getListingRetentionTrendKey({
            sameSellerCount: retention.sameSellerCount,
            crossSellerCount: retention.crossSellerCount,
            sameSellerRecentCount: retention.sameSellerRecentCount,
            crossSellerRecentCount: retention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: retention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: retention.crossSellerPostAdjustmentCount,
          }) === "softening"
            ? 3
            : 0);

        return {
          listing,
          revenueCents,
          repeatShare,
          recoveryDelta,
          attentionScore,
        };
      })
      .filter((entry) => entry.revenueCents > 0 || entry.attentionScore > 0 || entry.repeatShare > 0)
      .sort((left, right) => {
        if (left.revenueCents !== right.revenueCents) {
          return right.revenueCents - left.revenueCents;
        }
        if (left.repeatShare !== right.repeatShare) {
          return right.repeatShare - left.repeatShare;
        }
        return left.listing.title.localeCompare(right.listing.title);
      });
  }, [
    listingDeliveryPressureById,
    listingFollowOnBreakdownById,
    listingRecoveryDeltaById,
    workspace,
  ]);
  const listingFollowOnBreakdown = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const transactions = [...workspace.orders, ...workspace.bookings];

    return workspace.listings
      .map((listing) => {
        const matchingTransactions = transactions.filter(
          (transaction) => getTransactionListingId(transaction) === listing.id,
        );
        const sameSellerCount = matchingTransactions.filter((transaction) =>
          isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
        ).length;
        const crossSellerCount = matchingTransactions.filter((transaction) =>
          isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
        ).length;
        const sameSellerRecentCount = matchingTransactions.filter(
          (transaction) =>
            isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
            isRecentTransactionEvent(transaction.status_history, 7),
        ).length;
        const crossSellerRecentCount = matchingTransactions.filter(
          (transaction) =>
            isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
            isRecentTransactionEvent(transaction.status_history, 7),
        ).length;
        const crossSellerLocalCount = matchingTransactions.filter(
          (transaction) =>
            isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
            isLocalDrivenBrowseContext(transaction.buyer_browse_context),
        ).length;
        const crossSellerSearchCount = matchingTransactions.filter(
          (transaction) =>
            isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
            isSearchDrivenBrowseContext(transaction.buyer_browse_context),
        ).length;
        const crossSellerPriceCount = matchingTransactions.filter(
          (transaction) =>
            isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context) &&
            isPriceDrivenBrowseContext(transaction.buyer_browse_context),
        ).length;
        const listingAdjustmentTimestamp = getListingAdjustmentTimestamp(listing);
        const postAdjustmentTransactions =
          listingAdjustmentTimestamp == null
            ? []
            : matchingTransactions.filter(
                (transaction) => getLatestTransactionTimestamp(transaction) >= listingAdjustmentTimestamp,
              );
        const sameSellerPostAdjustmentCount = postAdjustmentTransactions.filter((transaction) =>
          isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context),
        ).length;
        const crossSellerPostAdjustmentCount = postAdjustmentTransactions.filter((transaction) =>
          isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
        ).length;

        return {
          listing,
          sameSellerCount,
          crossSellerCount,
          sameSellerRecentCount,
          crossSellerRecentCount,
          crossSellerLocalCount,
          crossSellerSearchCount,
          crossSellerPriceCount,
          sameSellerPostAdjustmentCount,
          crossSellerPostAdjustmentCount,
          totalFollowOnCount: sameSellerCount + crossSellerCount,
          totalRecentFollowOnCount: sameSellerRecentCount + crossSellerRecentCount,
        };
      })
      .filter((item) => item.totalFollowOnCount > 0)
      .sort((left, right) => {
        if (right.totalFollowOnCount !== left.totalFollowOnCount) {
          return right.totalFollowOnCount - left.totalFollowOnCount;
        }
        if (right.totalRecentFollowOnCount !== left.totalRecentFollowOnCount) {
          return right.totalRecentFollowOnCount - left.totalRecentFollowOnCount;
        }
        return left.listing.title.localeCompare(right.listing.title);
      })
      .slice(0, 6);
  }, [workspace]);
  const listingFollowOnBreakdownById = useMemo(
    () =>
      Object.fromEntries(
        listingFollowOnBreakdown.map((item) => [item.listing.id, item]),
      ),
    [listingFollowOnBreakdown],
  );
  const supportWatchListingIds = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return workspace.listings
      .filter((listing) => {
        const retention = listingFollowOnBreakdownById[listing.id];
        const retentionTrend = retention
          ? getListingRetentionTrend({
              sameSellerCount: retention.sameSellerCount,
              crossSellerCount: retention.crossSellerCount,
              sameSellerRecentCount: retention.sameSellerRecentCount,
              crossSellerRecentCount: retention.crossSellerRecentCount,
              sameSellerPostAdjustmentCount: retention.sameSellerPostAdjustmentCount,
              crossSellerPostAdjustmentCount: retention.crossSellerPostAdjustmentCount,
            })
          : null;
        const deliveryPressure = listingDeliveryPressureById[listing.id] ?? { failed: 0, queued: 0 };
        return Boolean(
          getListingSupportPressure({
            failedDeliveryCount: deliveryPressure.failed,
            queuedDeliveryCount: deliveryPressure.queued,
            retentionTrendLabel: retentionTrend?.label ?? null,
            hasReviewPressure: hasSellerReviewPressure,
          }),
        );
      })
      .map((listing) => listing.id);
  }, [hasSellerReviewPressure, listingDeliveryPressureById, listingFollowOnBreakdownById, workspace]);
  const supportWatchListingsCount = supportWatchListingIds.length;
  const sortedSupportWatchListings = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return [...workspace.listings]
      .filter((listing) => supportWatchListingIds.includes(listing.id))
      .sort((left, right) => {
        const leftPressure = listingDeliveryPressureById[left.id] ?? { failed: 0, queued: 0 };
        const rightPressure = listingDeliveryPressureById[right.id] ?? { failed: 0, queued: 0 };
        const leftPressureWeight = leftPressure.failed * 2 + leftPressure.queued;
        const rightPressureWeight = rightPressure.failed * 2 + rightPressure.queued;
        if (leftPressureWeight !== rightPressureWeight) {
          return rightPressureWeight - leftPressureWeight;
        }

        const leftRetention = listingFollowOnBreakdownById[left.id];
        const rightRetention = listingFollowOnBreakdownById[right.id];
        const leftRecent = leftRetention?.totalRecentFollowOnCount ?? 0;
        const rightRecent = rightRetention?.totalRecentFollowOnCount ?? 0;
        if (leftRecent !== rightRecent) {
          return rightRecent - leftRecent;
        }

        return left.title.localeCompare(right.title);
      });
  }, [listingDeliveryPressureById, listingFollowOnBreakdownById, supportWatchListingIds, workspace]);
  const topSupportWatchListing = sortedSupportWatchListings[0] ?? null;
  const nextSupportWatchListing = sortedSupportWatchListings[1] ?? null;
  const supportWatchConcentrationShare = useMemo(() => {
    if (sortedSupportWatchListings.length === 0) {
      return null;
    }

    const getSupportWeight = (listingId: string) => {
      const deliveryPressure = listingDeliveryPressureById[listingId] ?? { failed: 0, queued: 0 };
      const retention = listingFollowOnBreakdownById[listingId];
      return Math.max(
        deliveryPressure.failed * 2 + deliveryPressure.queued,
        retention?.totalRecentFollowOnCount ?? 0,
        retention?.totalFollowOnCount ?? 1,
        1,
      );
    };

    const totalSupportWeight = sortedSupportWatchListings.reduce(
      (sum, listing) => sum + getSupportWeight(listing.id),
      0,
    );
    if (totalSupportWeight <= 0) {
      return null;
    }

    return getSupportWeight(sortedSupportWatchListings[0]?.id ?? "") / totalSupportWeight;
  }, [listingDeliveryPressureById, listingFollowOnBreakdownById, sortedSupportWatchListings]);
  const deliveryPressureListingIds = useMemo(
    () =>
      (workspace?.listings ?? [])
        .filter((listing) => (listingDeliveryPressureById[listing.id]?.failed ?? 0) > 0)
        .map((listing) => listing.id),
    [listingDeliveryPressureById, workspace?.listings],
  );
  const deliveryPressureListingsCount = deliveryPressureListingIds.length;
  const deliveryDragListingIds = useMemo(
    () =>
      (workspace?.listings ?? [])
        .filter((listing) => (listingRecoveryDeltaById[listing.id] ?? 0) < 0)
        .map((listing) => listing.id),
    [listingRecoveryDeltaById, workspace?.listings],
  );
  const deliveryDragListingsCount = deliveryDragListingIds.length;
  const sortedDeliveryDragListings = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return [...workspace.listings]
      .filter((listing) => (listingRecoveryDeltaById[listing.id] ?? 0) < 0)
      .sort((left, right) => {
        const leftDelta = listingRecoveryDeltaById[left.id] ?? 0;
        const rightDelta = listingRecoveryDeltaById[right.id] ?? 0;
        if (leftDelta !== rightDelta) {
          return leftDelta - rightDelta;
        }
        return left.title.localeCompare(right.title);
      });
  }, [listingRecoveryDeltaById, workspace]);
  const topDeliveryDragListing = sortedDeliveryDragListings[0] ?? null;
  const nextDeliveryDragListing = sortedDeliveryDragListings[1] ?? null;
  const deliveryDragConcentrationShare = useMemo(() => {
    if (sortedDeliveryDragListings.length === 0) {
      return null;
    }

    const totalDragMagnitude = sortedDeliveryDragListings.reduce(
      (sum, listing) => sum + Math.abs(listingRecoveryDeltaById[listing.id] ?? 0),
      0,
    );
    if (totalDragMagnitude <= 0) {
      return null;
    }

    return Math.abs(listingRecoveryDeltaById[sortedDeliveryDragListings[0]?.id ?? ""] ?? 0) / totalDragMagnitude;
  }, [listingRecoveryDeltaById, sortedDeliveryDragListings]);
  const trustWatchListingIds = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return workspace.listings
      .filter((listing) => {
        const retention = listingFollowOnBreakdownById[listing.id];
        const retentionTrend = retention
          ? getListingRetentionTrend({
              sameSellerCount: retention.sameSellerCount,
              crossSellerCount: retention.crossSellerCount,
              sameSellerRecentCount: retention.sameSellerRecentCount,
              crossSellerRecentCount: retention.crossSellerRecentCount,
              sameSellerPostAdjustmentCount: retention.sameSellerPostAdjustmentCount,
              crossSellerPostAdjustmentCount: retention.crossSellerPostAdjustmentCount,
            })
          : null;
        const deliveryPressure = listingDeliveryPressureById[listing.id] ?? { failed: 0, queued: 0 };
        const supportPressure = getListingSupportPressure({
          failedDeliveryCount: deliveryPressure.failed,
          queuedDeliveryCount: deliveryPressure.queued,
          retentionTrendLabel: retentionTrend?.label ?? null,
          hasReviewPressure: hasSellerReviewPressure,
        });

        return (
          getListingSupportPressureLaneMode({
            failedDeliveryCount: deliveryPressure.failed,
            queuedDeliveryCount: deliveryPressure.queued,
            supportPressureLabel: supportPressure?.label ?? null,
          }) === "trust"
        );
      })
      .map((listing) => listing.id);
  }, [hasSellerReviewPressure, listingDeliveryPressureById, listingFollowOnBreakdownById, workspace]);
  const trustWatchListingsCount = trustWatchListingIds.length;
  const sortedTrustWatchListings = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return [...workspace.listings]
      .filter((listing) => trustWatchListingIds.includes(listing.id))
      .sort((left, right) => {
        const leftRetention = listingFollowOnBreakdownById[left.id];
        const rightRetention = listingFollowOnBreakdownById[right.id];
        const leftRecent = leftRetention?.totalRecentFollowOnCount ?? 0;
        const rightRecent = rightRetention?.totalRecentFollowOnCount ?? 0;
        if (leftRecent !== rightRecent) {
          return rightRecent - leftRecent;
        }
        const leftAllTime = leftRetention?.totalFollowOnCount ?? 0;
        const rightAllTime = rightRetention?.totalFollowOnCount ?? 0;
        if (leftAllTime !== rightAllTime) {
          return rightAllTime - leftAllTime;
        }
        return left.title.localeCompare(right.title);
      });
  }, [listingFollowOnBreakdownById, trustWatchListingIds, workspace]);
  const topTrustWatchListing = sortedTrustWatchListings[0] ?? null;
  const nextTrustWatchListing = sortedTrustWatchListings[1] ?? null;
  const trustWatchConcentrationShare = useMemo(() => {
    if (sortedTrustWatchListings.length === 0) {
      return null;
    }

    const totalTrustWeight = sortedTrustWatchListings.reduce((sum, listing) => {
      const retention = listingFollowOnBreakdownById[listing.id];
      return sum + Math.max(retention?.totalRecentFollowOnCount ?? 0, retention?.totalFollowOnCount ?? 1, 1);
    }, 0);
    if (totalTrustWeight <= 0) {
      return null;
    }

    const topRetention = listingFollowOnBreakdownById[sortedTrustWatchListings[0]?.id ?? ""];
    const topWeight = Math.max(topRetention?.totalRecentFollowOnCount ?? 0, topRetention?.totalFollowOnCount ?? 1, 1);
    return topWeight / totalTrustWeight;
  }, [listingFollowOnBreakdownById, sortedTrustWatchListings]);
  const pressureEasingListingIds = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const transactionListingByKey = {
      ...Object.fromEntries(
        workspace.orders.map((order) => [`order:${order.id}`, getTransactionListingId(order) ?? ""]),
      ),
      ...Object.fromEntries(
        workspace.bookings.map((booking) => [`booking:${booking.id}`, getTransactionListingId(booking) ?? ""]),
      ),
    };

    const recentSentListingIds = new Set(
      notificationDeliveries
        .filter(
          (delivery) =>
            delivery.delivery_status === "sent" &&
            matchesDeliveryRecency(delivery.created_at, "7d"),
        )
        .map((delivery) => transactionListingByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`])
        .filter((value): value is string => Boolean(value)),
    );

    return workspace.listings
      .filter((listing) => {
        if (!recentSentListingIds.has(listing.id)) {
          return false;
        }

        const deliveryPressure = listingDeliveryPressureById[listing.id] ?? { failed: 0, queued: 0 };
        return deliveryPressure.failed === 0 && deliveryPressure.queued === 0;
      })
      .map((listing) => listing.id);
  }, [listingDeliveryPressureById, notificationDeliveries, workspace]);
  const pressureEasingListingsCount = pressureEasingListingIds.length;
  const recoveryLaneListingIds = useMemo(
    () =>
      (workspace?.listings ?? [])
        .filter((listing) => (listingRecoveryDeltaById[listing.id] ?? 0) > 0)
        .map((listing) => listing.id),
    [listingRecoveryDeltaById, workspace?.listings],
  );
  const recoveryLaneListingsCount = recoveryLaneListingIds.length;
  const sortedRecoveryLaneListings = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return [...workspace.listings]
      .filter((listing) => (listingRecoveryDeltaById[listing.id] ?? 0) > 0)
      .sort((left, right) => {
        const leftDelta = listingRecoveryDeltaById[left.id] ?? 0;
        const rightDelta = listingRecoveryDeltaById[right.id] ?? 0;
        if (leftDelta !== rightDelta) {
          return rightDelta - leftDelta;
        }
        return left.title.localeCompare(right.title);
      });
  }, [listingRecoveryDeltaById, workspace]);
  const topRecoveryLaneListing = sortedRecoveryLaneListings[0] ?? null;
  const nextRecoveryLaneListing = sortedRecoveryLaneListings[1] ?? null;
  const recoveryLaneConcentrationShare = useMemo(() => {
    if (sortedRecoveryLaneListings.length === 0) {
      return null;
    }

    const totalRecoveryMagnitude = sortedRecoveryLaneListings.reduce(
      (sum, listing) => sum + (listingRecoveryDeltaById[listing.id] ?? 0),
      0,
    );
    if (totalRecoveryMagnitude <= 0) {
      return null;
    }

    return (listingRecoveryDeltaById[sortedRecoveryLaneListings[0]?.id ?? ""] ?? 0) / totalRecoveryMagnitude;
  }, [listingRecoveryDeltaById, sortedRecoveryLaneListings]);
  const filteredListingFollowOnBreakdown = useMemo(
    () =>
      listingFollowOnBreakdown.filter((item) => {
        if (listingAdjustmentFilter === "all") {
          if (listingTrendFilter === "all") {
            return true;
          }
        } else if (
          getListingAdjustmentType(item.listing.last_operating_adjustment_summary) !==
          listingAdjustmentFilter
        ) {
          return false;
        }

        if (listingTrendFilter === "all") {
          return true;
        }

        return (
          getListingRetentionTrendKey({
            sameSellerCount: item.sameSellerCount,
            crossSellerCount: item.crossSellerCount,
            sameSellerRecentCount: item.sameSellerRecentCount,
            crossSellerRecentCount: item.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: item.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: item.crossSellerPostAdjustmentCount,
          }) === listingTrendFilter
        );
      }),
    [listingAdjustmentFilter, listingFollowOnBreakdown, listingTrendFilter],
  );
  const filteredWorkspaceListings = useMemo(
    () =>
      (workspace?.listings ?? []).filter((listing) => {
        if (listingAdjustmentFilter === "all") {
          if (listingTrendFilter === "all") {
            return true;
          }
        } else if (
          getListingAdjustmentType(listing.last_operating_adjustment_summary) !==
          listingAdjustmentFilter
        ) {
          return false;
        }

        if (listingTrendFilter === "all") {
          return true;
        }

        const listingRetention = listingFollowOnBreakdownById[listing.id];
        const trendKey = listingRetention
          ? getListingRetentionTrendKey({
              sameSellerCount: listingRetention.sameSellerCount,
              crossSellerCount: listingRetention.crossSellerCount,
              sameSellerRecentCount: listingRetention.sameSellerRecentCount,
              crossSellerRecentCount: listingRetention.crossSellerRecentCount,
              sameSellerPostAdjustmentCount: listingRetention.sameSellerPostAdjustmentCount,
              crossSellerPostAdjustmentCount: listingRetention.crossSellerPostAdjustmentCount,
            })
          : "no-signal";

        return trendKey === listingTrendFilter;
      }),
    [listingAdjustmentFilter, listingFollowOnBreakdownById, listingTrendFilter, workspace?.listings],
  );
  const listingAdjustmentCounts = useMemo(() => {
    const counts = {
      all: (workspace?.listings ?? []).length,
      pricing: 0,
      "local-fit": 0,
      booking: 0,
      fulfillment: 0,
      other: 0,
    } as Record<"all" | "pricing" | "local-fit" | "booking" | "fulfillment" | "other", number>;

    for (const listing of workspace?.listings ?? []) {
      const adjustmentType = getListingAdjustmentType(listing.last_operating_adjustment_summary);
      if (adjustmentType !== "all") {
        counts[adjustmentType] += 1;
      }
    }

    return counts;
  }, [workspace?.listings]);
  const listingTrendCounts = useMemo(() => {
    const counts = {
      all: (workspace?.listings ?? []).length,
      improving: 0,
      softening: 0,
      stable: 0,
      "no-signal": 0,
    } as Record<"all" | "improving" | "softening" | "stable" | "no-signal", number>;

    for (const listing of workspace?.listings ?? []) {
      const listingRetention = listingFollowOnBreakdownById[listing.id];
      const trendKey = listingRetention
        ? getListingRetentionTrendKey({
            sameSellerCount: listingRetention.sameSellerCount,
            crossSellerCount: listingRetention.crossSellerCount,
            sameSellerRecentCount: listingRetention.sameSellerRecentCount,
            crossSellerRecentCount: listingRetention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: listingRetention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: listingRetention.crossSellerPostAdjustmentCount,
          })
        : "no-signal";
      counts[trendKey] += 1;
    }

    return counts;
  }, [listingFollowOnBreakdownById, workspace?.listings]);
  const listingShortcutCounts = useMemo(() => {
    const counts = {
      "pricing-softening": 0,
      "local-fit-improving": 0,
      "booking-softening": 0,
      "fulfillment-improving": 0,
    } as Record<
      "pricing-softening" | "local-fit-improving" | "booking-softening" | "fulfillment-improving",
      number
    >;

    for (const listing of workspace?.listings ?? []) {
      const adjustmentType = getListingAdjustmentType(listing.last_operating_adjustment_summary);
      const listingRetention = listingFollowOnBreakdownById[listing.id];
      const trendKey = listingRetention
        ? getListingRetentionTrendKey({
            sameSellerCount: listingRetention.sameSellerCount,
            crossSellerCount: listingRetention.crossSellerCount,
            sameSellerRecentCount: listingRetention.sameSellerRecentCount,
            crossSellerRecentCount: listingRetention.crossSellerRecentCount,
            sameSellerPostAdjustmentCount: listingRetention.sameSellerPostAdjustmentCount,
            crossSellerPostAdjustmentCount: listingRetention.crossSellerPostAdjustmentCount,
          })
        : "no-signal";

      if (adjustmentType === "pricing" && trendKey === "softening") {
        counts["pricing-softening"] += 1;
      }
      if (adjustmentType === "local-fit" && trendKey === "improving") {
        counts["local-fit-improving"] += 1;
      }
      if (adjustmentType === "booking" && trendKey === "softening") {
        counts["booking-softening"] += 1;
      }
      if (adjustmentType === "fulfillment" && trendKey === "improving") {
        counts["fulfillment-improving"] += 1;
      }
    }

    return counts;
  }, [listingFollowOnBreakdownById, workspace?.listings]);
  const activeWorkspaceSummary = useMemo(() => {
    const parts: string[] = [];

    if (workspacePreset !== "default") {
      parts.push(titleCaseWorkspaceLabel(workspacePreset));
      if (workspacePreset === "delivery-drag") {
        parts.push("Negative recent delivery net");
      }
      if (workspacePreset === "recovery-lane") {
        parts.push("Positive recent delivery net");
      }
    }
    if (activityTypeFilter !== "all") {
      parts.push(`Type: ${titleCaseWorkspaceLabel(activityTypeFilter)}`);
    }
    if (activityStatusFilter !== "all") {
      parts.push(`Status: ${titleCaseWorkspaceLabel(activityStatusFilter)}`);
    }
    if (activityDiscoveryFilter !== "all") {
      parts.push(`Discovery: ${titleCaseWorkspaceLabel(activityDiscoveryFilter)}`);
    }
    if (activityListingFilter !== "all") {
      const listing = workspace?.listings.find((entry) => entry.id === activityListingFilter);
      parts.push(`Listing: ${listing?.title ?? activityListingFilter.slice(0, 8)}`);
    }
    if (activityRecencyFilter !== "all") {
      parts.push(`Activity Window: ${titleCaseWorkspaceLabel(activityRecencyFilter)}`);
    }
    if (activityContextFilter !== "all") {
      parts.push(`Context: ${titleCaseWorkspaceLabel(activityContextFilter)}`);
    }
    if (activityPressureFilter !== "all") {
      parts.push(`Pressure: ${titleCaseWorkspaceLabel(activityPressureFilter)}`);
    }
    if (activityRecoveryFilter !== "all") {
      parts.push("Recovery: Easing");
    }
    if (activitySortMode !== "default") {
      parts.push(
        activitySortMode === "pressured"
          ? "Queue Order: Pressured First"
          : activitySortMode === "drag"
            ? "Queue Order: Drag First"
            : "Queue Order: Recovery First",
      );
    }
    if (listingAdjustmentFilter !== "all") {
      parts.push(`Last Adjustment: ${titleCaseWorkspaceLabel(listingAdjustmentFilter)}`);
    }
    if (listingTrendFilter !== "all") {
      parts.push(`Trend: ${titleCaseWorkspaceLabel(listingTrendFilter)}`);
    }
    if (deliveryStatusFilter !== "all") {
      parts.push(`Deliveries: ${titleCaseWorkspaceLabel(deliveryStatusFilter)}`);
    }
    if (deliveryRecencyFilter !== "7d") {
      parts.push(`Window: ${titleCaseWorkspaceLabel(deliveryRecencyFilter)}`);
    }
    if (bulkExecutionMode !== "best_effort") {
      parts.push("Batch Mode: Validate First");
    }
    if (focusedActivityKey) {
      const [kind, id] = focusedActivityKey.split(":");
      parts.push(`Focus: ${titleCaseWorkspaceLabel(kind ?? "item")} ${id?.slice(0, 8) ?? ""}`.trim());
    }

    return parts.length > 0 ? parts.join(" · ") : "Default workspace view";
  }, [
    activityContextFilter,
    activityDiscoveryFilter,
    activityListingFilter,
    activityPressureFilter,
    activityRecoveryFilter,
    activityRecencyFilter,
    activitySortMode,
    activityStatusFilter,
    activityTypeFilter,
    bulkExecutionMode,
    deliveryRecencyFilter,
    deliveryStatusFilter,
    focusedActivityKey,
    listingAdjustmentFilter,
    listingTrendFilter,
    workspace?.listings,
    workspacePreset,
  ]);
  const isDefaultWorkspaceView =
    workspacePreset === "default" &&
    activityTypeFilter === "all" &&
    activityStatusFilter === "all" &&
    activityDiscoveryFilter === "all" &&
    activityListingFilter === "all" &&
    activityRecencyFilter === "all" &&
    activityContextFilter === "all" &&
    activityPressureFilter === "all" &&
    activityRecoveryFilter === "all" &&
    activitySortMode === "default" &&
    listingAdjustmentFilter === "all" &&
    listingTrendFilter === "all" &&
    deliveryStatusFilter === "all" &&
    deliveryRecencyFilter === "7d" &&
    bulkExecutionMode === "best_effort" &&
    !focusedActivityKey;

  function isUnreadNotification(notification: NotificationItem) {
    if (!notificationsSeenAt) {
      return true;
    }

    return new Date(notification.createdAt).getTime() > new Date(notificationsSeenAt).getTime();
  }

  function getDeliveryTransactionLabel(delivery: NotificationDelivery) {
    if (!workspace) {
      return `${delivery.transaction_kind} · ${delivery.transaction_id}`;
    }

    if (delivery.transaction_kind === "order") {
      const order = workspace.orders.find((item) => item.id === delivery.transaction_id);
      if (!order) {
        return `order · ${delivery.transaction_id}`;
      }

      const firstItem = order.items?.[0]?.listing_title ?? order.items?.[0]?.listing_id;
      return firstItem ? `order · ${firstItem}` : `order · ${order.id}`;
    }

    const booking = workspace.bookings.find((item) => item.id === delivery.transaction_id);
    if (!booking) {
      return `booking · ${delivery.transaction_id}`;
    }

    return `booking · ${booking.listing_title ?? booking.listing_id}`;
  }

  function focusDeliveryTransaction(delivery: NotificationDelivery) {
    setActivityFocus(`${delivery.transaction_kind}:${delivery.transaction_id}`);
  }

  function getListingTuneRoleTarget(listing: Listing) {
    const role = getListingOperatingRole(listing);
    return role === "order-led" ? "fulfillment" : "booking";
  }

  function focusListingControlTarget(
    listing: Listing,
    target: "pricing" | "booking" | "fulfillment",
  ) {
    const targetKey = `${listing.id}:${target}`;
    setHighlightedListingControlKey(targetKey);
    if (listingControlHighlightTimeoutRef.current) {
      window.clearTimeout(listingControlHighlightTimeoutRef.current);
    }
    listingControlRefs.current[targetKey]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    listingControlHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedListingControlKey((current) => (current === targetKey ? null : current));
      listingControlHighlightTimeoutRef.current = null;
    }, 1800);
  }

  function focusListingRoleControls(listing: Listing) {
    focusListingControlTarget(listing, getListingTuneRoleTarget(listing));
  }

  type ListingTransaction = Order | Booking;

  type ActivitySliceConfig = ActivityFilterConfig & {
    activityStatus: "all";
    activityRecency: "all";
    activityContext: "all";
    activitySort: "default" | "pressured";
    activityRecovery: "all" | "easing";
    deliveryStatus: "all" | "sent" | "failed" | "queued";
    deliveryRecency: "7d";
    transactionPredicate: (transaction: ListingTransaction) => boolean;
    transactionSort?: (transaction: ListingTransaction) => number;
  };

  function focusNextListingTransaction(
    listing: Listing,
    config: ActivitySliceConfig,
  ) {
    const transactionSort = config.transactionSort;
    const transactions = [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])]
      .filter((transaction) => {
        if (getTransactionListingId(transaction) !== listing.id) {
          return false;
        }

        return config.transactionPredicate(transaction);
      })
      .sort(
        transactionSort
          ? (left, right) => transactionSort(right) - transactionSort(left)
          : () => 0,
      );

    const nextTransaction = transactions[0];
    if (nextTransaction) {
      const key = "items" in nextTransaction
        ? `order:${nextTransaction.id}`
        : `booking:${nextTransaction.id}`;
      setActivityFocus(key);
    }

    focusListingRoleControls(listing);
  }

  function openListingLane(listing: Listing, config: ActivitySliceConfig) {
    applyActivityFilters({
      ...config,
      activityListing: config.activityListing ?? listing.id,
    });

    focusNextListingTransaction(listing, config);
  }

  function openListingRetentionLane(
    listing: Listing,
    discovery: "same-seller" | "cross-seller",
  ) {
    openListingLane(listing, {
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: discovery,
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
      transactionPredicate: (transaction) =>
        discovery === "same-seller"
          ? isSameSellerFollowOnBrowseContext(transaction.buyer_browse_context)
          : isCrossSellerFollowOnBrowseContext(transaction.buyer_browse_context),
      transactionSort: getLatestTransactionTimestamp,
    });
  }

  function openListingSupportPressureLane(
    listing: Listing,
    mode: "failed" | "queued" | "trust",
  ) {
    openListingLane(listing, {
      preset:
        mode === "failed"
          ? "delivery-pressure"
          : mode === "trust"
            ? "trust-watch"
            : "pressure-queue",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityListing: listing.id,
      activityRecency: "all",
      activityContext: "all",
      activityPressure: mode === "failed" ? "delivery" : mode === "trust" ? "trust" : "all",
      activitySort: "pressured",
      activityRecovery: "all",
      deliveryStatus: mode === "trust" ? "all" : mode,
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "softening",
      transactionPredicate: (transaction) => {
        if (mode === "trust") {
          return true;
        }

        return notificationDeliveries.some(
          (delivery) =>
            delivery.transaction_kind === ("items" in transaction ? "order" : "booking") &&
            delivery.transaction_id === transaction.id &&
            delivery.delivery_status === mode,
        );
      },
      transactionSort: getLatestTransactionTimestamp,
    });
  }

  function openListingPressureEasingLane(listing: Listing) {
    openListingLane(listing, {
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityListing: listing.id,
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "sent",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "improving",
      transactionPredicate: (transaction) =>
        notificationDeliveries.some(
          (delivery) =>
            delivery.transaction_kind === ("items" in transaction ? "order" : "booking") &&
            delivery.transaction_id === transaction.id &&
            delivery.delivery_status === "sent" &&
            matchesDeliveryRecency(delivery.created_at, "7d"),
        ),
      transactionSort: getLatestTransactionTimestamp,
    });
  }

  function openListingRecentDeliveryNetLane(
    listing: Listing,
    mode: "sent" | "failed",
  ) {
    openListingLane(listing, {
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityListing: listing.id,
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: mode === "sent" ? "easing" : "all",
      deliveryStatus: mode,
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
      transactionPredicate: (transaction) =>
        notificationDeliveries.some(
          (delivery) =>
            delivery.transaction_kind === ("items" in transaction ? "order" : "booking") &&
            delivery.transaction_id === transaction.id &&
            delivery.delivery_status === mode &&
            matchesDeliveryRecency(delivery.created_at, "7d"),
        ),
      transactionSort: getLatestTransactionTimestamp,
    });
  }

  const getListingPressureLaneCount = useCallback(
    (listingId: string, mode: "failed" | "queued" | "trust") => {
      if (mode === "trust") {
        return [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
          (transaction) => getTransactionListingId(transaction) === listingId,
        ).length;
      }

      return notificationDeliveries.filter((delivery) => {
        if (
          delivery.delivery_status !== mode ||
          !matchesDeliveryRecency(delivery.created_at, "7d")
        ) {
          return false;
        }

        if (delivery.transaction_kind === "order") {
          const matchingOrder = (workspace?.orders ?? []).find(
            (order) => order.id === delivery.transaction_id,
          );
          return matchingOrder
            ? getTransactionListingId(matchingOrder) === listingId
            : false;
        }

        const matchingBooking = (workspace?.bookings ?? []).find(
          (booking) => booking.id === delivery.transaction_id,
        );
        return matchingBooking
          ? getTransactionListingId(matchingBooking) === listingId
          : false;
      }).length;
    },
    [notificationDeliveries, workspace?.bookings, workspace?.orders],
  );

  function markNotificationsSeen() {
    const latestTimestamp = notifications[0]?.createdAt ?? new Date().toISOString();
    window.localStorage.setItem(SELLER_NOTIFICATIONS_SEEN_AT_KEY, latestTimestamp);
    setNotificationsSeenAt(latestTimestamp);
  }

  function setActivityFocus(nextFocus: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("focus", nextFocus);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setFocusedActivityKey(nextFocus);
  }

  function focusActivity(notification: NotificationItem) {
    const nextFocus = `${notification.transactionKind}:${notification.transactionId}`;
    setActivityFocus(nextFocus);
    markNotificationsSeen();
  }

  function clearFocusedActivity() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("focus");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    setFocusedActivityKey(null);
  }

  function resetWorkspaceView() {
    applySellerPreset("default");
    setBulkExecutionMode("best_effort");
    if (focusedActivityKey) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("focus");
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
      setFocusedActivityKey(null);
    }
  }

  async function copyWorkspaceLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setWorkspaceLinkFeedback("Link copied");
      window.setTimeout(() => setWorkspaceLinkFeedback(null), 2000);
    } catch {
      setWorkspaceLinkFeedback("Copy failed");
      window.setTimeout(() => setWorkspaceLinkFeedback(null), 2000);
    }
  }

  const presetConfigs: Record<WorkspacePreset, ActivityFilterConfig> = {
    default: {
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "needs-action": {
      preset: "needs-action",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "unread",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "queued",
      deliveryRecency: "today",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "recent-failures": {
      preset: "recent-failures",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "failed",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "pressure-queue": {
      preset: "pressure-queue",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "pressured",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "delivery-drag": {
      preset: "delivery-drag",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "drag",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "delivery-pressure": {
      preset: "delivery-pressure",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "delivery",
      activitySort: "pressured",
      activityRecovery: "all",
      deliveryStatus: "failed",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "trust-watch": {
      preset: "trust-watch",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "trust",
      activitySort: "pressured",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "recovery-lane": {
      preset: "recovery-lane",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "recovery",
      activityRecovery: "easing",
      deliveryStatus: "sent",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
    "recovered-recently": {
      preset: "recovered-recently",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "easing",
      deliveryStatus: "sent",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "improving",
    },
    "focused-work": {
      preset: "focused-work",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "focused",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    },
  };

  function applySellerPreset(preset: WorkspacePreset) {
    applyActivityFilters(presetConfigs[preset]);
  }

  function applyDiscoveryQueueSlice(
    discovery: "local" | "search" | "price" | "same-seller" | "cross-seller",
    type: "all" | "order" | "booking" = "all",
    recency: "7d" | "all" = "all",
  ) {
    applyActivityFilters({
      preset: "default",
      activityType: type,
      activityStatus: "all",
      activityDiscovery: discovery,
      activityRecency: recency,
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    });
  }

  function openDiscoveryDemandLane(
    discovery: "local" | "search" | "price" | "same-seller" | "cross-seller",
    type: "all" | "order" | "booking" = "all",
  ) {
    applyDiscoveryQueueSlice(discovery, type);
  }

  function openRecentDiscoveryLane(
    discovery: "local" | "search" | "price" | "same-seller" | "cross-seller",
  ) {
    applyDiscoveryQueueSlice(discovery, "all", "7d");
  }

  function openSupportWatchLane() {
    applyActivityFilters({
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "softening",
    });
  }

  function openRecentDeliveryStatusLane(status: "failed" | "queued" | "sent") {
    applyActivityFilters({
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: status,
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    });
  }

  function openPressureEasingLane() {
    applyActivityFilters({
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "all",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "sent",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "improving",
    });
  }

  function openTrustWatchLane() {
    applySellerPreset("trust-watch");
  }

  function openRecentBrowseContextLane() {
    applyActivityFilters({
      preset: "default",
      activityType: "all",
      activityStatus: "all",
      activityDiscovery: "all",
      activityRecency: "7d",
      activityContext: "all",
      activityPressure: "all",
      activitySort: "default",
      activityRecovery: "all",
      deliveryStatus: "all",
      deliveryRecency: "7d",
      listingAdjustment: "all",
      listingTrend: "all",
    });
  }

  function openDeliveryDragLane() {
    applySellerPreset("delivery-drag");
  }

  function openRecoveryLane() {
    applySellerPreset("recovery-lane");
  }

  function openRecoveredVsFailedLane() {
    if (recoveredVsFailedDelta >= 0) {
      applySellerPreset("recovered-recently");
      return;
    }

    applySellerPreset("recent-failures");
  }

  function openSupportWatchLaneWithFocus(listing: Listing) {
    openSupportWatchLane();
    focusListingRoleControls(listing);
  }

  function openSupportWatchSummaryLane() {
    openSupportWatchLane();
    focusFirstMatchingListing(supportWatchListingIds);
  }

  function openTopSupportShareLane() {
    if (
      supportWatchConcentrationShare != null &&
      supportWatchConcentrationShare >= 0.7 &&
      topSupportWatchListing
    ) {
      openSupportWatchLaneWithFocus(topSupportWatchListing);
      return;
    }

    openSupportWatchLane();
  }

  function openTopTrustShareLane() {
    if (trustWatchConcentrationShare != null && trustWatchConcentrationShare >= 0.7 && topTrustWatchListing) {
      openTrustWatchLane();
      openListingSupportPressureLane(topTrustWatchListing, "trust");
      return;
    }

    openTrustWatchLane();
  }

  function openPressureEasingSummaryLane() {
    openPressureEasingLane();
    focusFirstMatchingListing(pressureEasingListingIds);
  }

  function getListingSupportPressureAction(
    listingId: string,
    deliveryPressure: { failed: number; queued: number },
    supportPressureLabel: string | null,
  ) {
    const mode = getListingSupportPressureLaneMode({
      failedDeliveryCount: deliveryPressure.failed,
      queuedDeliveryCount: deliveryPressure.queued,
      supportPressureLabel,
    });

    if (!mode) {
      return null;
    }

    const count =
      mode === "failed"
        ? deliveryPressure.failed
        : mode === "queued"
          ? deliveryPressure.queued
          : getListingPressureLaneCount(listingId, "trust");

    return { mode, count };
  }

  function getListingRetentionPreviewTrendLabel(listing: Listing) {
    const retention = listingFollowOnBreakdownById[listing.id];
    if (!retention) {
      return null;
    }

    return getListingPreviewRetentionTrendLabel({
      sameSellerCount: retention.sameSellerCount,
      crossSellerCount: retention.crossSellerCount,
      sameSellerRecentCount: retention.sameSellerRecentCount,
      crossSellerRecentCount: retention.crossSellerRecentCount,
      sameSellerPostAdjustmentCount: retention.sameSellerPostAdjustmentCount,
      crossSellerPostAdjustmentCount: retention.crossSellerPostAdjustmentCount,
    });
  }

  function getListingRetentionTrendSeedLabel(listing: Listing) {
    const retention = listingFollowOnBreakdownById[listing.id];
    if (!retention) {
      return null;
    }

    return getListingRetentionTrend({
      sameSellerCount: retention.sameSellerCount,
      crossSellerCount: retention.crossSellerCount,
      sameSellerRecentCount: retention.sameSellerRecentCount,
      crossSellerRecentCount: retention.crossSellerRecentCount,
      sameSellerPostAdjustmentCount: retention.sameSellerPostAdjustmentCount,
      crossSellerPostAdjustmentCount: retention.crossSellerPostAdjustmentCount,
    }).label;
  }

  function getListingPreviewTuneAction(listing: Listing) {
    return getListingAdjustmentTuneAction(listing.last_operating_adjustment_summary);
  }

  function getListingAdjustmentPreviewLabel(listing: Listing) {
    if (!listing.last_operating_adjustment_summary) {
      return "";
    }

    return titleCaseWorkspaceLabel(
      getListingAdjustmentType(listing.last_operating_adjustment_summary),
    );
  }

  function getSupportPreviewDetail(listing: Listing) {
    const deliveryPressure = listingDeliveryPressureById[listing.id] ?? { failed: 0, queued: 0 };
    return getListingSupportPressure({
      failedDeliveryCount: deliveryPressure.failed,
      queuedDeliveryCount: deliveryPressure.queued,
      retentionTrendLabel: getListingRetentionTrendSeedLabel(listing),
      hasReviewPressure: hasSellerReviewPressure,
    });
  }

  function openDeliveryDragLaneWithListing(listing: Listing) {
    openDeliveryDragLane();
    openListingRecentDeliveryNetLane(listing, "failed");
  }

  function openRecoveryLaneWithListing(listing: Listing) {
    openRecoveryLane();
    openListingRecentDeliveryNetLane(listing, "sent");
  }

  function openTrustWatchLaneWithListing(listing: Listing) {
    openTrustWatchLane();
    openListingSupportPressureLane(listing, "trust");
  }

  function openSupportWatchConcentrationLane() {
    if (supportWatchConcentrationShare != null && supportWatchConcentrationShare >= 0.7 && topSupportWatchListing) {
      openSupportWatchLaneWithFocus(topSupportWatchListing);
      return;
    }

    openSupportWatchLane();
  }

  function openDeliveryDragConcentrationLane() {
    if (deliveryDragConcentrationShare != null && deliveryDragConcentrationShare >= 0.7 && topDeliveryDragListing) {
      openDeliveryDragLaneWithListing(topDeliveryDragListing);
      return;
    }

    openDeliveryDragLane();
  }

  function openRecoveryConcentrationLane() {
    if (recoveryLaneConcentrationShare != null && recoveryLaneConcentrationShare >= 0.7 && topRecoveryLaneListing) {
      openRecoveryLaneWithListing(topRecoveryLaneListing);
      return;
    }

    openRecoveryLane();
  }

  function openTrustConcentrationLane() {
    if (trustWatchConcentrationShare != null && trustWatchConcentrationShare >= 0.7 && topTrustWatchListing) {
      openTrustWatchLaneWithListing(topTrustWatchListing);
      return;
    }

    openTrustWatchLane();
  }

  function getWorkspacePresetChipClass(
    preset:
      | "default"
      | "needs-action"
      | "recent-failures"
      | "pressure-queue"
      | "delivery-drag"
      | "delivery-pressure"
      | "trust-watch"
      | "recovery-lane"
      | "recovered-recently"
      | "focused-work",
  ) {
    if (workspacePreset === preset) {
      return "border-accent bg-accent text-white";
    }

    if (preset === "needs-action" && unreadNotificationCount > 0) {
      return "border-amber-300 bg-amber-50 text-amber-900 hover:border-accent hover:text-accent";
    }

    if (preset === "recent-failures" && failedDeliveryCount > 0) {
      return "border-red-300 bg-red-50 text-red-700 hover:border-accent hover:text-accent";
    }

    if (preset === "pressure-queue" && supportWatchListingsCount > 0) {
      return "border-violet-300 bg-violet-50 text-violet-800 hover:border-accent hover:text-accent";
    }

    if (preset === "delivery-drag" && deliveryDragListingsCount > 0) {
      return "border-orange-300 bg-orange-50 text-orange-800 hover:border-accent hover:text-accent";
    }

    if (preset === "delivery-pressure" && deliveryPressureListingsCount > 0) {
      return "border-red-300 bg-red-50 text-red-700 hover:border-accent hover:text-accent";
    }

    if (preset === "trust-watch" && trustWatchListingsCount > 0) {
      return "border-rose-300 bg-rose-50 text-rose-700 hover:border-accent hover:text-accent";
    }

    if (preset === "recovery-lane" && recoveryLaneListingsCount > 0) {
      return "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-accent hover:text-accent";
    }

    if (preset === "recovered-recently" && pressureEasingListingsCount > 0) {
      return "border-lime-300 bg-lime-50 text-lime-800 hover:border-accent hover:text-accent";
    }

    if (preset === "focused-work" && focusedItemCount > 0) {
      return "border-sky-300 bg-sky-50 text-sky-800 hover:border-accent hover:text-accent";
    }

    return "border-border text-foreground hover:border-accent hover:text-accent";
  }

  function openListingSupportPressureAction(
    listing: Listing,
    action: { mode: "failed" | "queued" | "trust"; count: number } | null,
  ) {
    if (!action) {
      return;
    }

    openListingSupportPressureLane(listing, action.mode);
  }

  const getTransactionListingContext = useCallback((transaction: Order | Booking) => {
    const listing = listingsById[getTransactionListingId(transaction) ?? ""] ?? null;
    const retention = listing ? listingFollowOnBreakdownById[listing.id] : null;
    const retentionTrend = retention
      ? getListingRetentionTrend({
          sameSellerCount: retention.sameSellerCount,
          crossSellerCount: retention.crossSellerCount,
          sameSellerRecentCount: retention.sameSellerRecentCount,
          crossSellerRecentCount: retention.crossSellerRecentCount,
          sameSellerPostAdjustmentCount: retention.sameSellerPostAdjustmentCount,
          crossSellerPostAdjustmentCount: retention.crossSellerPostAdjustmentCount,
        })
      : null;
    const deliveryPressure = listing
      ? listingDeliveryPressureById[listing.id] ?? { failed: 0, queued: 0 }
      : { failed: 0, queued: 0 };
    const supportPressure = listing
      ? getListingSupportPressure({
          failedDeliveryCount: deliveryPressure.failed,
          queuedDeliveryCount: deliveryPressure.queued,
          retentionTrendLabel: retentionTrend?.label ?? null,
          hasReviewPressure: hasSellerReviewPressure,
        })
      : null;
    const pressureLaneMode =
      listing && supportPressure
        ? getListingSupportPressureLaneMode({
            failedDeliveryCount: deliveryPressure.failed,
            queuedDeliveryCount: deliveryPressure.queued,
            supportPressureLabel: supportPressure.label,
          })
        : null;
    const pressureLaneCount =
      listing && pressureLaneMode
        ? getListingPressureLaneCount(listing.id, pressureLaneMode)
        : 0;
    const isPressureEasing = listing ? pressureEasingListingIds.includes(listing.id) : false;
    const recoveryDelta = listing ? listingRecoveryDeltaById[listing.id] ?? 0 : 0;

    return {
      listing,
      retention,
      retentionTrend,
      deliveryPressure,
      supportPressure,
      pressureLaneMode,
      pressureLaneCount,
      isPressureEasing,
      recoveryDelta,
    };
  }, [
    getListingPressureLaneCount,
    hasSellerReviewPressure,
    listingDeliveryPressureById,
    listingFollowOnBreakdownById,
    listingRecoveryDeltaById,
    listingsById,
    pressureEasingListingIds,
  ]);

  const getFocusedSupportPressureLaneCount = useCallback((
    listing: Listing | null,
    pressureLaneMode: "failed" | "queued" | "trust" | null,
  ) => {
    if (!listing || !pressureLaneMode) {
      return 0;
    }

    if (pressureLaneMode === "trust") {
      return [...(workspace?.orders ?? []), ...(workspace?.bookings ?? [])].filter(
        (transaction) => getTransactionListingId(transaction) === listing.id,
      ).length;
    }

    return notificationDeliveries.filter((delivery) => {
      if (
        delivery.delivery_status !== pressureLaneMode ||
        !matchesDeliveryRecency(delivery.created_at, "7d")
      ) {
        return false;
      }

      const matchingOrder = (workspace?.orders ?? []).find((order) => order.id === delivery.transaction_id);
      if (matchingOrder && delivery.transaction_kind === "order") {
        return getTransactionListingId(matchingOrder) === listing.id;
      }

      const matchingBooking = (workspace?.bookings ?? []).find(
        (booking) => booking.id === delivery.transaction_id,
      );
      if (matchingBooking && delivery.transaction_kind === "booking") {
        return getTransactionListingId(matchingBooking) === listing.id;
      }

      return false;
    }).length;
  }, [notificationDeliveries, workspace?.bookings, workspace?.orders]);

  const getFocusedTransactionContext = useCallback((transaction: Order | Booking | null) => {
    if (!transaction) {
      return {
        listing: null,
        supportPressure: null,
        pressureLaneMode: null,
        pressureLaneCount: 0,
        isPressureEasing: false,
        recoveryDelta: 0,
      };
    }

    const context = getTransactionListingContext(transaction);

    return {
      ...context,
      pressureLaneCount: getFocusedSupportPressureLaneCount(
        context.listing,
        context.pressureLaneMode,
      ),
    };
  }, [getFocusedSupportPressureLaneCount, getTransactionListingContext]);

  const focusedOrderContext = useMemo(
    () => getFocusedTransactionContext(focusedOrder),
    [focusedOrder, getFocusedTransactionContext],
  );
  const focusedBookingContext = useMemo(
    () => getFocusedTransactionContext(focusedBooking),
    [focusedBooking, getFocusedTransactionContext],
  );
  const focusedOrderListing = focusedOrderContext.listing;
  const focusedBookingListing = focusedBookingContext.listing;
  const focusedOrderSupportPressure = focusedOrderContext.supportPressure;
  const focusedBookingSupportPressure = focusedBookingContext.supportPressure;
  const focusedOrderSupportPressureLaneMode = focusedOrderContext.pressureLaneMode;
  const focusedBookingSupportPressureLaneMode = focusedBookingContext.pressureLaneMode;
  const focusedOrderSupportPressureLaneCount = focusedOrderContext.pressureLaneCount;
  const focusedBookingSupportPressureLaneCount = focusedBookingContext.pressureLaneCount;

  function getOrderQueueActions(orderId: string) {
    return [
      { key: "confirmed", label: "Confirm", onClick: () => updateOrderStatus(orderId, "confirmed") },
      { key: "preparing", label: "Prep", onClick: () => updateOrderStatus(orderId, "preparing") },
      { key: "ready", label: "Ready", onClick: () => updateOrderStatus(orderId, "ready") },
      { key: "completed", label: "Complete", onClick: () => updateOrderStatus(orderId, "completed") },
    ];
  }

  function getBookingQueueActions(bookingId: string) {
    return [
      { key: "confirmed", label: "Confirm", onClick: () => updateBookingStatus(bookingId, "confirmed") },
      { key: "in_progress", label: "Start", onClick: () => updateBookingStatus(bookingId, "in_progress") },
      { key: "completed", label: "Complete", onClick: () => updateBookingStatus(bookingId, "completed") },
      { key: "declined", label: "Decline", onClick: () => updateBookingStatus(bookingId, "declined") },
    ];
  }

  function buildBulkPendingActionLabel(
    kind: "order" | "booking",
    count: number,
    nextStatus: "confirmed" | "completed",
  ) {
    const noun = count === 1 ? kind : `${kind}s`;
    return nextStatus === "completed"
      ? `Complete ${count} visible ${noun}`
      : `Confirm ${count} visible ${noun}`;
  }

  function buildBulkStatusActionFeedback(args: {
    kind: "order" | "booking";
    nextStatus: "confirmed" | "completed";
    targetCount: number;
    succeededIds: string[];
    failed: Array<{ id: string; detail: string }>;
  }): ActionFeedback {
    const { kind, nextStatus, targetCount, succeededIds, failed } = args;
    const executionModeLabel = formatBulkExecutionMode(bulkExecutionMode);
    const pluralKind = succeededIds.length === 1 ? kind : `${kind}s`;
    const targetPluralKind = targetCount === 1 ? kind : `${kind}s`;

    if (failed.length === 0) {
      return {
        tone: "success",
        message: `${nextStatus === "completed" ? "Completed" : "Updated"} ${
          succeededIds.length
        } visible ${pluralKind} to ${nextStatus.replaceAll("_", " ")} using ${executionModeLabel} mode.`,
      };
    }

    return {
      tone: succeededIds.length > 0 ? "success" : "error",
      message:
        succeededIds.length > 0
          ? `Updated ${succeededIds.length} of ${targetCount} visible ${targetPluralKind} using ${executionModeLabel} mode. ${failed.length} failed.`
          : `Unable to update ${targetCount} visible ${targetPluralKind} using ${executionModeLabel} mode.`,
      details: buildFailedActionDetails(failed),
    };
  }

  function buildFailedActionDetails(failed: Array<{ id: string; detail: string }>) {
    return failed.map((failure) => `${failure.id.slice(0, 8)} · ${failure.detail}`);
  }

  function buildBulkRetryDeliveryFeedback(args: {
    targetCount: number;
    succeededIds: string[];
    failed: Array<{ id: string; detail: string }>;
  }): ActionFeedback {
    const { targetCount, succeededIds, failed } = args;
    const executionModeLabel = formatBulkExecutionMode(bulkExecutionMode);

    if (failed.length === 0) {
      return {
        tone: "success",
        message: `Retried ${succeededIds.length} failed ${
          succeededIds.length === 1 ? "delivery" : "deliveries"
        } in view using ${executionModeLabel} mode.`,
      };
    }

    return {
      tone: succeededIds.length > 0 ? "success" : "error",
      message:
        succeededIds.length > 0
          ? `Retried ${succeededIds.length} of ${targetCount} failed deliveries in view using ${executionModeLabel} mode. ${failed.length} failed again.`
          : `Unable to retry ${targetCount} failed deliveries in view using ${executionModeLabel} mode.`,
      details: buildFailedActionDetails(failed),
    };
  }

  function stageBulkTransactionAction(args: {
    kind: "order" | "booking";
    currentStatus: "pending" | "ready" | "requested" | "in_progress";
    nextStatus: "confirmed" | "completed";
    actionKey: string;
    count: number;
  }) {
    if (args.count === 0) {
      return;
    }

    setActionFeedback(null);
    setPendingBulkAction({
      kind: args.kind,
      currentStatus: args.currentStatus,
      nextStatus: args.nextStatus,
      actionKey: args.actionKey,
      count: args.count,
      label: buildBulkPendingActionLabel(args.kind, args.count, args.nextStatus),
    });
  }

  function buildOrderBulkUpdates(
    orders: Order[],
    nextStatus: "confirmed" | "completed",
  ) {
    return orders.map((order) => ({
      order_id: order.id,
      status: nextStatus,
      seller_response_note: responseNotes[order.id] || null,
    }));
  }

  function buildBookingBulkUpdates(
    bookings: Booking[],
    nextStatus: "confirmed" | "completed",
  ) {
    return bookings.map((booking) => ({
      booking_id: booking.id,
      status: nextStatus,
      seller_response_note: responseNotes[booking.id] || null,
    }));
  }

  function getVisibleOrdersByStatus(currentStatus: "pending" | "ready") {
    return filteredOrders.filter((order) => order.status === currentStatus);
  }

  function getVisibleBookingsByStatus(currentStatus: "requested" | "in_progress") {
    return filteredBookings.filter((booking) => booking.status === currentStatus);
  }

  function executeBulkTransactionStatusAction(args: {
    kind: "order" | "booking";
    actionKey: string;
    nextStatus: "confirmed" | "completed";
    targetCount: number;
    errorMessage: string;
    execute: (accessToken: string) => Promise<{
      succeeded_ids: string[];
      failed: Array<{ id: string; detail: string }>;
    }>;
  }) {
    const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
    if (!accessToken || args.targetCount === 0) {
      return;
    }

    setBulkQueueActionLoading(args.actionKey);
    setError(null);
    setActionFeedback(null);
    startTransition(async () => {
      try {
        const result = await args.execute(accessToken);
        await loadWorkspace(accessToken);
        setPendingBulkAction(null);
        setActionFeedback(
          buildBulkStatusActionFeedback({
            kind: args.kind,
            nextStatus: args.nextStatus,
            targetCount: args.targetCount,
            succeededIds: result.succeeded_ids,
            failed: result.failed,
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : args.errorMessage);
        setActionFeedback(null);
      } finally {
        setBulkQueueActionLoading(null);
      }
    });
  }

  function focusFirstMatchingListing(listingIds: string[]) {
    const nextListing = workspace?.listings.find((listing) => listingIds.includes(listing.id));
    if (nextListing) {
      focusListingRoleControls(nextListing);
    }
  }

  function updateNotificationPreferences(
    changes: Pick<
      ProfileUpdateInput,
      | "email_notifications_enabled"
      | "push_notifications_enabled"
      | "marketing_notifications_enabled"
    >,
  ) {
    executeSellerApiAction<Profile>({
      missingAccessTokenMessage: "Sign in again before updating notification settings.",
      errorMessage: "Unable to update notification settings",
      onStart: () => setLoading(true),
      onFinally: () => setLoading(false),
      onSuccess: (updatedProfile) => {
        setAccountProfile(updatedProfile as Profile);
        return { tone: "success", message: "Notification preferences updated." };
      },
      execute: (accessToken) => api.updateProfile(changes, { accessToken }),
    });
  }

  function retryNotificationDelivery(deliveryId: string) {
    executeSellerApiAction<NotificationDelivery>({
      missingAccessTokenMessage: "Sign in again before retrying notification deliveries.",
      errorMessage: "Unable to retry notification delivery",
      onStart: () => setDeliveryRetryLoading(deliveryId),
      onFinally: () => setDeliveryRetryLoading(null),
      successFeedback: {
        tone: "success",
        message: "Notification delivery requeued.",
      },
      execute: (accessToken) => api.retryNotificationDelivery(deliveryId, accessToken),
    });
  }

  function retryFailedDeliveriesInView() {
    const failedDeliveries = filteredNotificationDeliveries.filter(
      (delivery) => delivery.delivery_status === "failed",
    );
    if (failedDeliveries.length === 0) {
      return;
    }

    executeSellerApiAction<NotificationDeliveryBulkRetryResult>({
      missingAccessTokenMessage: "Sign in again before retrying failed deliveries.",
      errorMessage: "Unable to retry failed deliveries",
      onStart: () => setRetryingFailedDeliveries(true),
      onFinally: () => setRetryingFailedDeliveries(false),
      onSuccess: (result) =>
        buildBulkRetryDeliveryFeedback({
          targetCount: failedDeliveries.length,
          succeededIds: result.succeeded_ids,
          failed: result.failed,
        }),
      execute: (accessToken) =>
        api.bulkRetryNotificationDeliveries(
          failedDeliveries.map((delivery) => delivery.id),
          accessToken,
          bulkExecutionMode,
        ),
    });
  }

  function bulkUpdateVisibleOrders(
    currentStatus: "pending" | "ready",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    const targetOrders = getVisibleOrdersByStatus(currentStatus);
    executeBulkTransactionStatusAction({
      kind: "order",
      actionKey,
      nextStatus,
      targetCount: targetOrders.length,
      errorMessage: "Unable to update visible orders",
      execute: (accessToken) =>
        api.bulkUpdateOrderStatuses(
          {
            execution_mode: bulkExecutionMode,
            updates: buildOrderBulkUpdates(targetOrders, nextStatus),
          },
          { accessToken },
        ),
    });
  }

  function stageBulkOrderAction(
    currentStatus: "pending" | "ready",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    stageBulkTransactionAction({
      kind: "order",
      currentStatus,
      nextStatus,
      actionKey,
      count: getVisibleOrdersByStatus(currentStatus).length,
    });
  }

  function bulkUpdateVisibleBookings(
    currentStatus: "requested" | "in_progress",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    const targetBookings = getVisibleBookingsByStatus(currentStatus);
    executeBulkTransactionStatusAction({
      kind: "booking",
      actionKey,
      nextStatus,
      targetCount: targetBookings.length,
      errorMessage: "Unable to update visible bookings",
      execute: (accessToken) =>
        api.bulkUpdateBookingStatuses(
          {
            execution_mode: bulkExecutionMode,
            updates: buildBookingBulkUpdates(targetBookings, nextStatus),
          },
          { accessToken },
        ),
    });
  }

  function stageBulkBookingAction(
    currentStatus: "requested" | "in_progress",
    nextStatus: "confirmed" | "completed",
    actionKey: string,
  ) {
    stageBulkTransactionAction({
      kind: "booking",
      currentStatus,
      nextStatus,
      actionKey,
      count: getVisibleBookingsByStatus(currentStatus).length,
    });
  }

  function confirmPendingBulkAction() {
    if (!pendingBulkAction) {
      return;
    }

    if (pendingBulkAction.kind === "order") {
      bulkUpdateVisibleOrders(
        pendingBulkAction.currentStatus as "pending" | "ready",
        pendingBulkAction.nextStatus,
        pendingBulkAction.actionKey,
      );
      return;
    }

    bulkUpdateVisibleBookings(
      pendingBulkAction.currentStatus as "requested" | "in_progress",
      pendingBulkAction.nextStatus,
      pendingBulkAction.actionKey,
    );
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
      <div className="card-shadow rounded-4xl border border-border bg-surface p-6">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
          Seller Onboarding
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
          Create a seller account or sign in without relying on seeded demo credentials
        </h2>
        <p className="mt-3 text-sm leading-7 text-foreground/72">
          This uses Supabase Auth in the browser, ensures a profile exists, and then loads the
          live seller workspace from the API.
        </p>

        <div className="mt-6 space-y-4">
          <div className="flex gap-2">
            <button
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                mode === "sign-in" ? "bg-foreground text-background" : "border border-border"
              }`}
              onClick={() => setMode("sign-in")}
              type="button"
            >
              Sign In
            </button>
            <button
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                mode === "sign-up" ? "bg-foreground text-background" : "border border-border"
              }`}
              onClick={() => setMode("sign-up")}
              type="button"
            >
              Create Account
            </button>
          </div>
          <label className="block">
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
              Email
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
              Password
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === "sign-up" ? (
            <>
              <label className="block">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Full Name
                </span>
                <input
                  className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Username
                </span>
                <input
                  className="w-full rounded-2xl border border-border bg-white/70 px-4 py-3 outline-none transition focus:border-accent"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
            </>
          ) : null}

          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-65"
            onClick={handleAuth}
            disabled={loading}
            type="button"
          >
            {loading ? "Working..." : mode === "sign-in" ? "Sign In" : "Create Account"}
          </button>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <p className="text-xs leading-5 text-foreground/56">
            The seller token is cached in local storage so this workspace can restore itself on
            refresh.
          </p>
        </div>
      </div>

      <div className="card-shadow rounded-4xl border border-border bg-[#fff8ed] p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
              Seller Workspace
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
              {workspace ? workspace.seller.display_name : "Sign in to load live seller data"}
            </h2>
          </div>
          {workspace ? (
            <div className="rounded-full border border-olive/25 bg-olive px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white">
              Authenticated
            </div>
          ) : null}
        </div>

        {workspace ? (
          <div className="mt-6 space-y-6">
            <div className="flex justify-end">
              <button
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={handleSignOut}
                type="button"
              >
                Sign Out
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <MiniStat label="Listings" value={String(workspace.listings.length)} />
              <MiniStat label="Orders" value={String(workspace.orders.length)} />
              <MiniStat label="Bookings" value={String(workspace.bookings.length)} />
              <MiniStat label="Reviews" value={String(workspace.reviews.length)} />
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Subscription plan
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {formatSubscriptionPlanLabel(workspace.subscription)}
                  </p>
                </div>
                {workspace.subscription ? (
                  <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
                    {formatCurrency(workspace.subscription.monthly_price_cents, "USD")}/mo
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                    Unassigned
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-foreground/64">
                {workspace.subscription
                  ? `Started ${workspace.subscription.started_at ? new Date(workspace.subscription.started_at).toLocaleDateString() : "recently"}`
                  : "No seller subscription has been assigned yet. Admin can assign one from Monetization."}
              </p>
              {workspace.subscription?.perks_summary ? (
                <p className="mt-2 text-sm leading-6 text-foreground/68">
                  {workspace.subscription.perks_summary}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {getSubscriptionCapabilityPills(workspace.subscription).map((pill) => {
                  const isLocked = pill.includes("locked") || pill.includes("Standard");
                  return (
                    <span
                      key={pill}
                      className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                        isLocked
                          ? "border border-border bg-background text-foreground/62"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {pill}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Seller analytics
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {workspace.subscription?.analytics_enabled
                      ? "Plan-enabled performance snapshot"
                      : "Upgrade to unlock seller analytics"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    workspace.subscription?.analytics_enabled
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border border-border bg-background text-foreground/62"
                  }`}
                >
                  {workspace.subscription?.analytics_enabled ? "Unlocked" : "Locked"}
                </span>
              </div>
              {workspace.subscription?.analytics_enabled && sellerAnalyticsSnapshot ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MiniStat
                      label="Revenue"
                      value={formatCurrency(sellerAnalyticsSnapshot.totalRevenueCents, "USD")}
                      accent="olive"
                    />
                    <MiniStat
                      label="Average Ticket"
                      value={formatCurrency(sellerAnalyticsSnapshot.averageTicketCents, "USD")}
                      accent="sky"
                    />
                    <MiniStat
                      label="Transactions 7d"
                      value={String(sellerAnalyticsSnapshot.recentTransactionsCount)}
                      accent="amber"
                    />
                    <MiniStat
                      label="Repeat Share"
                      value={formatPercent(sellerAnalyticsSnapshot.repeatShare)}
                      accent="rose"
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-border bg-background px-4 py-3 text-sm text-foreground/68">
                    <p>
                      Review average{" "}
                      <span className="font-semibold text-foreground">
                        {sellerAnalyticsSnapshot.reviewAverage > 0
                          ? sellerAnalyticsSnapshot.reviewAverage.toFixed(1)
                          : "No rating yet"}
                      </span>
                    </p>
                    <p>
                      Follow-on retention is based on same-seller vs cross-seller browse context already
                      captured in your workspace.
                    </p>
                  </div>
                  {sellerAnalyticsListingInsights.length > 0 ? (
                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      <AnalyticsListingCard
                        title="Top revenue listing"
                        listing={sellerAnalyticsListingInsights[0]?.listing ?? null}
                        detail={
                          sellerAnalyticsListingInsights[0]
                            ? formatCurrency(sellerAnalyticsListingInsights[0].revenueCents, "USD")
                            : "No sales yet"
                        }
                        note="Highest combined order and booking revenue so far."
                        tone="olive"
                      />
                      <AnalyticsListingCard
                        title="Best repeat-share"
                        listing={
                          [...sellerAnalyticsListingInsights]
                            .sort((left, right) => right.repeatShare - left.repeatShare)[0]?.listing ?? null
                        }
                        detail={
                          formatPercent(
                            [...sellerAnalyticsListingInsights].sort(
                              (left, right) => right.repeatShare - left.repeatShare,
                            )[0]?.repeatShare ?? 0,
                          )
                        }
                        note="Same-seller follow-on share among tracked repeat traffic."
                        tone="sky"
                      />
                      <AnalyticsListingCard
                        title="Needs attention"
                        listing={
                          [...sellerAnalyticsListingInsights]
                            .sort((left, right) => right.attentionScore - left.attentionScore)[0]?.listing ?? null
                        }
                        detail={
                          (() => {
                            const attentionEntry = [...sellerAnalyticsListingInsights].sort(
                              (left, right) => right.attentionScore - left.attentionScore,
                            )[0];
                            if (!attentionEntry || attentionEntry.attentionScore <= 0) {
                              return "No urgent issues";
                            }
                            return attentionEntry.recoveryDelta < 0
                              ? "Delivery drag"
                              : "Retention softening";
                          })()
                        }
                        note="Highlights the listing with the strongest operational or retention drag signal."
                        tone="rose"
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-4 text-sm leading-6 text-foreground/66">
                  Plans with analytics show revenue, average ticket size, recent transaction pace,
                  and repeat-share retention here for day-to-day seller decisions.
                </p>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <MiniStat
                label="Active platform fee"
                value={platformFeeRateLabel}
                accent="rose"
              />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/60">
                Effective {platformFeeEffectiveLabel}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Demand Signals
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Which browse lanes are converting into work
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-foreground/46">
                  Buyer discovery context
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MiniStat
                  label="Local Match Orders"
                  value={String(localDrivenOrdersCount)}
                  accent="amber"
                  onClick={() => openDiscoveryDemandLane("local", "order")}
                />
                <MiniStat
                  label="Local Match Bookings"
                  value={String(localDrivenBookingsCount)}
                  accent="olive"
                  onClick={() => openDiscoveryDemandLane("local", "booking")}
                />
                <MiniStat
                  label="Search-Led Bookings"
                  value={String(searchDrivenBookingsCount)}
                  accent="sky"
                  onClick={() => openDiscoveryDemandLane("search", "booking")}
                />
                <MiniStat
                  label="Price-Led Conversions"
                  value={String(priceDrivenConversionsCount)}
                  accent="rose"
                  onClick={() => openDiscoveryDemandLane("price")}
                />
                <MiniStat
                  label="Same-Seller Follow-On"
                  value={String(sameSellerFollowOnConversionsCount)}
                  accent="sky"
                  onClick={() => openDiscoveryDemandLane("same-seller")}
                />
                <MiniStat
                  label="Cross-Seller Follow-On"
                  value={String(crossSellerFollowOnConversionsCount)}
                  accent="olive"
                  onClick={() => openDiscoveryDemandLane("cross-seller")}
                />
              </div>
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Recent Trend
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Discovery-driven conversions in the last 7 days
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-foreground/46">
                  Recent mix
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MiniStat
                  label="Local 7d"
                  value={String(localDrivenRecentConversionsCount)}
                  accent="amber"
                  onClick={() => openRecentDiscoveryLane("local")}
                />
                <MiniStat
                  label="Search 7d"
                  value={String(searchDrivenRecentConversionsCount)}
                  accent="sky"
                  onClick={() => openRecentDiscoveryLane("search")}
                />
                <MiniStat
                  label="Price 7d"
                  value={String(priceDrivenRecentConversionsCount)}
                  accent="rose"
                  onClick={() => openRecentDiscoveryLane("price")}
                />
                <MiniStat
                  label="Tracked Browse 7d"
                  value={String(recentBrowseContextConversionsCount)}
                  accent="olive"
                  onClick={openRecentBrowseContextLane}
                />
                <MiniStat
                  label="Same Seller 7d"
                  value={String(sameSellerFollowOnRecentConversionsCount)}
                  accent="sky"
                  onClick={() => openRecentDiscoveryLane("same-seller")}
                />
                <MiniStat
                  label="Cross Seller 7d"
                  value={String(crossSellerFollowOnRecentConversionsCount)}
                  accent="rose"
                  onClick={() => openRecentDiscoveryLane("cross-seller")}
                />
              </div>
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Recent Pressure
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Delivery and support pressure in the last 7 days
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-foreground/46">
                  Seller ops watch
                </p>
              </div>
              <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <MiniStat
                  label="Failed Alerts 7d"
                  value={String(failedDeliveryRecentCount)}
                  accent="rose"
                  onClick={() => openRecentDeliveryStatusLane("failed")}
                />
                <MiniStat
                  label="Queued Alerts 7d"
                  value={String(queuedDeliveryRecentCount)}
                  accent="amber"
                  onClick={() => openRecentDeliveryStatusLane("queued")}
                />
                <MiniStat
                  label="Resolved Alerts 7d"
                  value={String(sentDeliveryRecentCount)}
                  accent="olive"
                  onClick={() => openRecentDeliveryStatusLane("sent")}
                />
                <MiniStat
                  label="Delivery Drag"
                  value={String(deliveryDragListingsCount)}
                  accent="rose"
                  onClick={openDeliveryDragLane}
                />
                <MiniStat
                  label="Recovery Lane"
                  value={String(recoveryLaneListingsCount)}
                  accent="olive"
                  onClick={openRecoveryLane}
                />
                <MiniStat
                  label="Recovered vs Failed 7d"
                  value={
                    recoveredVsFailedDelta > 0
                      ? `+${recoveredVsFailedDelta}`
                      : String(recoveredVsFailedDelta)
                  }
                  accent={recoveredVsFailedDelta >= 0 ? "olive" : "rose"}
                  onClick={openRecoveredVsFailedLane}
                />
                <MiniStat
                  label="Support-Watch Listings"
                  value={String(supportWatchListingsCount)}
                  accent="sky"
                  onClick={openSupportWatchSummaryLane}
                />
                <MiniStat
                  label="Top Support Share"
                  value={
                    supportWatchConcentrationShare != null
                      ? `${Math.round(supportWatchConcentrationShare * 100)}%`
                      : "0%"
                  }
                  accent="sky"
                  onClick={openTopSupportShareLane}
                />
                <MiniStat
                  label="Trust Spread"
                  value={String(trustWatchListingsCount)}
                  accent="rose"
                  onClick={openTrustWatchLane}
                />
                <MiniStat
                  label="Top Trust Share"
                  value={
                    trustWatchConcentrationShare != null
                      ? `${Math.round(trustWatchConcentrationShare * 100)}%`
                      : "0%"
                  }
                  accent="rose"
                  onClick={openTopTrustShareLane}
                />
                <MiniStat
                  label="Pressure Easing"
                  value={String(pressureEasingListingsCount)}
                  accent="olive"
                  onClick={openPressureEasingSummaryLane}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-foreground/56">
                <p>Delivery Drag: listings where failed sends are outpacing recent recovery.</p>
                <p>Recovery Lane: listings where recent successful sends are ahead of failures.</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {topSupportWatchListing ? (
                  (() => {
                    const supportPressure = getSupportPreviewDetail(topSupportWatchListing);
                    const trendLabel = getListingRetentionPreviewTrendLabel(topSupportWatchListing);
                    const tuneAction = getListingPreviewTuneAction(topSupportWatchListing);
                    const adjustmentLabel = getListingAdjustmentPreviewLabel(topSupportWatchListing);

                    return (
                      <PressurePreviewRow
                        lane="Support"
                        laneClassName={getPressureLanePillClass("support")}
                        onLaneClick={openSupportWatchLane}
                        primaryClassName="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-accent hover:text-accent"
                        primaryLabel={`Top support listing: ${topSupportWatchListing.title}${
                          adjustmentLabel ? ` · ${adjustmentLabel}` : ""
                        }${supportPressure ? ` · ${supportPressure.detail}` : ""}`}
                        onPrimaryClick={() => openSupportWatchLaneWithFocus(topSupportWatchListing)}
                        trendLabel={trendLabel}
                        tuneLabel={tuneAction?.label}
                        onTuneClick={
                          tuneAction
                            ? () => focusListingControlTarget(topSupportWatchListing, tuneAction.target)
                            : null
                        }
                      />
                    );
                  })()
                ) : null}
                {topDeliveryDragListing ? (
                  (() => {
                    const trendLabel = getListingRetentionPreviewTrendLabel(topDeliveryDragListing);
                    const tuneAction = getListingPreviewTuneAction(topDeliveryDragListing);
                    const adjustmentLabel = getListingAdjustmentPreviewLabel(topDeliveryDragListing);

                    return (
                      <PressurePreviewRow
                        lane="Drag"
                        laneClassName={getPressureLanePillClass("drag")}
                        onLaneClick={openDeliveryDragLane}
                        primaryClassName="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 transition hover:border-accent hover:text-accent"
                        primaryLabel={`Worst drag: ${topDeliveryDragListing.title} · ${
                          listingRecoveryDeltaById[topDeliveryDragListing.id] ?? 0
                        }${adjustmentLabel ? ` · ${adjustmentLabel}` : ""}`}
                        onPrimaryClick={() => openDeliveryDragLaneWithListing(topDeliveryDragListing)}
                        trendLabel={trendLabel}
                        tuneLabel={tuneAction?.label}
                        onTuneClick={
                          tuneAction
                            ? () => focusListingControlTarget(topDeliveryDragListing, tuneAction.target)
                            : null
                        }
                      />
                    );
                  })()
                ) : null}
                {topRecoveryLaneListing ? (
                  (() => {
                    const trendLabel = getListingRetentionPreviewTrendLabel(topRecoveryLaneListing);
                    const tuneAction = getListingPreviewTuneAction(topRecoveryLaneListing);
                    const adjustmentLabel = getListingAdjustmentPreviewLabel(topRecoveryLaneListing);

                    return (
                      <PressurePreviewRow
                        lane="Recovery"
                        laneClassName={getPressureLanePillClass("recovery")}
                        onLaneClick={openRecoveryLane}
                        primaryClassName="rounded-full border border-lime-200 bg-lime-50 px-3 py-1.5 text-xs font-medium text-lime-800 transition hover:border-accent hover:text-accent"
                        primaryLabel={`Strongest recovery: ${topRecoveryLaneListing.title} · +${
                          listingRecoveryDeltaById[topRecoveryLaneListing.id] ?? 0
                        }${adjustmentLabel ? ` · ${adjustmentLabel}` : ""}`}
                        onPrimaryClick={() => openRecoveryLaneWithListing(topRecoveryLaneListing)}
                        trendLabel={trendLabel}
                        tuneLabel={tuneAction?.label}
                        onTuneClick={
                          tuneAction
                            ? () => focusListingControlTarget(topRecoveryLaneListing, tuneAction.target)
                            : null
                        }
                      />
                    );
                  })()
                ) : null}
                {topTrustWatchListing ? (
                  (() => {
                    const trendLabel = getListingRetentionPreviewTrendLabel(topTrustWatchListing);
                    const tuneAction = getListingPreviewTuneAction(topTrustWatchListing);
                    const adjustmentLabel = getListingAdjustmentPreviewLabel(topTrustWatchListing);

                    return (
                      <PressurePreviewRow
                        lane="Trust"
                        laneClassName={getPressureLanePillClass("trust")}
                        onLaneClick={openTrustWatchLane}
                        primaryClassName="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-accent hover:text-accent"
                        primaryLabel={`Top trust listing: ${topTrustWatchListing.title}${
                          adjustmentLabel
                            ? ` · ${adjustmentLabel}`
                            : ""
                        }`}
                        onPrimaryClick={() => openTrustWatchLaneWithListing(topTrustWatchListing)}
                        trendLabel={trendLabel}
                        tuneLabel={tuneAction?.label}
                        onTuneClick={
                          tuneAction
                            ? () => focusListingControlTarget(topTrustWatchListing, tuneAction.target)
                            : null
                        }
                      />
                    );
                  })()
                ) : null}
              </div>
              {nextSupportWatchListing || nextDeliveryDragListing || nextRecoveryLaneListing || nextTrustWatchListing ? (
                <div className="mt-2 flex flex-col gap-2">
                  {nextSupportWatchListing ? (
                    (() => {
                      const supportPressure = getSupportPreviewDetail(nextSupportWatchListing);
                      const trendLabel = getListingRetentionPreviewTrendLabel(nextSupportWatchListing);
                      const tuneAction = getListingPreviewTuneAction(nextSupportWatchListing);

                      return (
                        <PressurePreviewRow
                          lane="Support"
                          laneClassName={getPressureLanePillClass("support")}
                          onLaneClick={openSupportWatchLane}
                          primaryClassName="rounded-full border border-sky-100 bg-sky-50/60 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-accent hover:text-accent"
                          primaryLabel={`Next support listing: ${nextSupportWatchListing.title}${
                            supportPressure ? ` · ${supportPressure.detail}` : ""
                          }`}
                          onPrimaryClick={() => openSupportWatchLaneWithFocus(nextSupportWatchListing)}
                          trendLabel={trendLabel}
                          tuneLabel={tuneAction?.label}
                          onTuneClick={
                            tuneAction
                              ? () => focusListingControlTarget(nextSupportWatchListing, tuneAction.target)
                              : null
                          }
                        />
                      );
                    })()
                  ) : null}
                  {nextDeliveryDragListing ? (
                    (() => {
                      const trendLabel = getListingRetentionPreviewTrendLabel(nextDeliveryDragListing);
                      const tuneAction = getListingPreviewTuneAction(nextDeliveryDragListing);
                      const adjustmentLabel = getListingAdjustmentPreviewLabel(nextDeliveryDragListing);

                      return (
                        <PressurePreviewRow
                          lane="Drag"
                          laneClassName={getPressureLanePillClass("drag")}
                          onLaneClick={openDeliveryDragLane}
                          primaryClassName="rounded-full border border-rose-100 bg-rose-50/60 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-accent hover:text-accent"
                          primaryLabel={`Next drag: ${nextDeliveryDragListing.title} · ${
                            listingRecoveryDeltaById[nextDeliveryDragListing.id] ?? 0
                          }${adjustmentLabel ? ` · ${adjustmentLabel}` : ""}`}
                          onPrimaryClick={() => openDeliveryDragLaneWithListing(nextDeliveryDragListing)}
                          trendLabel={trendLabel}
                          tuneLabel={tuneAction?.label}
                          onTuneClick={
                            tuneAction
                              ? () => focusListingControlTarget(nextDeliveryDragListing, tuneAction.target)
                              : null
                          }
                        />
                      );
                    })()
                  ) : null}
                  {nextRecoveryLaneListing ? (
                    (() => {
                      const trendLabel = getListingRetentionPreviewTrendLabel(nextRecoveryLaneListing);
                      const tuneAction = getListingPreviewTuneAction(nextRecoveryLaneListing);
                      const adjustmentLabel = getListingAdjustmentPreviewLabel(nextRecoveryLaneListing);

                      return (
                        <PressurePreviewRow
                          lane="Recovery"
                          laneClassName={getPressureLanePillClass("recovery")}
                          onLaneClick={openRecoveryLane}
                          primaryClassName="rounded-full border border-lime-100 bg-lime-50/60 px-3 py-1.5 text-xs font-medium text-lime-700 transition hover:border-accent hover:text-accent"
                          primaryLabel={`Next recovery: ${nextRecoveryLaneListing.title} · +${
                            listingRecoveryDeltaById[nextRecoveryLaneListing.id] ?? 0
                          }${adjustmentLabel ? ` · ${adjustmentLabel}` : ""}`}
                          onPrimaryClick={() => openRecoveryLaneWithListing(nextRecoveryLaneListing)}
                          trendLabel={trendLabel}
                          tuneLabel={tuneAction?.label}
                          onTuneClick={
                            tuneAction
                              ? () => focusListingControlTarget(nextRecoveryLaneListing, tuneAction.target)
                              : null
                          }
                        />
                      );
                    })()
                  ) : null}
                  {nextTrustWatchListing ? (
                    (() => {
                      const trendLabel = getListingRetentionPreviewTrendLabel(nextTrustWatchListing);
                      const tuneAction = getListingPreviewTuneAction(nextTrustWatchListing);
                      const adjustmentLabel = getListingAdjustmentPreviewLabel(nextTrustWatchListing);

                      return (
                        <PressurePreviewRow
                          lane="Trust"
                          laneClassName={getPressureLanePillClass("trust")}
                          onLaneClick={openTrustWatchLane}
                          primaryClassName="rounded-full border border-rose-100 bg-rose-50/60 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-accent hover:text-accent"
                          primaryLabel={`Next trust listing: ${nextTrustWatchListing.title}${
                            adjustmentLabel
                              ? ` · ${adjustmentLabel}`
                              : ""
                          }`}
                          onPrimaryClick={() => openTrustWatchLaneWithListing(nextTrustWatchListing)}
                          trendLabel={trendLabel}
                          tuneLabel={tuneAction?.label}
                          onTuneClick={
                            tuneAction
                              ? () => focusListingControlTarget(nextTrustWatchListing, tuneAction.target)
                              : null
                          }
                        />
                      );
                    })()
                  ) : null}
                </div>
              ) : null}
              {supportWatchConcentrationShare != null ||
              deliveryDragConcentrationShare != null ||
              recoveryLaneConcentrationShare != null ||
              trustWatchConcentrationShare != null ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {supportWatchConcentrationShare != null ? (
                    <button
                      className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-sky-700 transition hover:border-accent hover:text-accent"
                      onClick={openSupportWatchConcentrationLane}
                      type="button"
                    >
                      {getSupportLaneConcentrationLabel(supportWatchConcentrationShare)}
                    </button>
                  ) : null}
                  {deliveryDragConcentrationShare != null ? (
                    <button
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-rose-700 transition hover:border-accent hover:text-accent"
                      onClick={openDeliveryDragConcentrationLane}
                      type="button"
                    >
                      {getDeliveryLaneConcentrationLabel(deliveryDragConcentrationShare, "drag")}
                    </button>
                  ) : null}
                  {recoveryLaneConcentrationShare != null ? (
                    <button
                      className="rounded-full border border-lime-200 bg-lime-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-lime-700 transition hover:border-accent hover:text-accent"
                      onClick={openRecoveryConcentrationLane}
                      type="button"
                    >
                      {getDeliveryLaneConcentrationLabel(recoveryLaneConcentrationShare, "recovery")}
                    </button>
                  ) : null}
                  {trustWatchConcentrationShare != null ? (
                    <button
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-rose-700 transition hover:border-accent hover:text-accent"
                      onClick={openTrustConcentrationLane}
                      type="button"
                    >
                      {getTrustLaneConcentrationLabel(trustWatchConcentrationShare)}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Listing Retention
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Which listings keep buyers with this seller vs lose them elsewhere
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-foreground/46">
                  Top follow-on listings
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["all", "All Adjustments"],
                  ["pricing", "Pricing"],
                  ["local-fit", "Local Fit"],
                  ["booking", "Booking"],
                  ["fulfillment", "Fulfillment"],
                  ["other", "Other"],
                ].map(([value, label]) => (
                  <SelectChip
                    key={value}
                    active={listingAdjustmentFilter === value}
                    onClick={() =>
                      updateListingAdjustmentFilter(
                        value as ListingAdjustmentFilter,
                      )
                    }
                  >
                    {label} · {listingAdjustmentCounts[value as keyof typeof listingAdjustmentCounts]}
                  </SelectChip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["all", "All Trends"],
                  ["improving", "Improving"],
                  ["softening", "Softening"],
                  ["stable", "Stable"],
                  ["no-signal", "No Signal"],
                ].map(([value, label]) => (
                  <SelectChip
                    key={value}
                    active={listingTrendFilter === value}
                    onClick={() =>
                      updateListingTrendFilterValue(
                        value as ListingTrendFilter,
                      )
                    }
                  >
                    {label} · {listingTrendCounts[value as keyof typeof listingTrendCounts]}
                  </SelectChip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["pricing", "softening", "Pricing + Softening", listingShortcutCounts["pricing-softening"]],
                  ["local-fit", "improving", "Local Fit + Improving", listingShortcutCounts["local-fit-improving"]],
                  ["booking", "softening", "Booking + Softening", listingShortcutCounts["booking-softening"]],
                  ["fulfillment", "improving", "Fulfillment + Improving", listingShortcutCounts["fulfillment-improving"]],
                ].map(([adjustment, trend, label, count]) => (
                  <SelectChip
                    key={`${adjustment}-${trend}`}
                    active={false}
                    onClick={() => {
                      updateListingAdjustmentFilter(
                        adjustment as ListingAdjustmentFilter,
                      );
                      updateListingTrendFilterValue(
                        trend as ListingTrendFilter,
                      );
                    }}
                  >
                    {label} · {String(count)}
                  </SelectChip>
                ))}
              </div>
              <div className="mt-4 space-y-3">
                {filteredListingFollowOnBreakdown.length > 0 ? (
                  filteredListingFollowOnBreakdown.map((item) => {
                    const retentionTone = getListingRetentionTone({
                      sameSellerCount: item.sameSellerCount,
                      crossSellerCount: item.crossSellerCount,
                    });
                    const retentionTrend = getListingRetentionTrend({
                      sameSellerCount: item.sameSellerCount,
                      crossSellerCount: item.crossSellerCount,
                      sameSellerRecentCount: item.sameSellerRecentCount,
                      crossSellerRecentCount: item.crossSellerRecentCount,
                      sameSellerPostAdjustmentCount: item.sameSellerPostAdjustmentCount,
                      crossSellerPostAdjustmentCount: item.crossSellerPostAdjustmentCount,
                    });
                    const leakageLabel = getListingLeakageLabel({
                      localCount: item.crossSellerLocalCount,
                      searchCount: item.crossSellerSearchCount,
                      priceCount: item.crossSellerPriceCount,
                      crossSellerCount: item.crossSellerCount,
                    });
                    const leakageTuneAction = getListingLeakageTuneAction({
                      listing: item.listing,
                      localCount: item.crossSellerLocalCount,
                      searchCount: item.crossSellerSearchCount,
                      priceCount: item.crossSellerPriceCount,
                    });
                    const deliveryPressure = listingDeliveryPressureById[item.listing.id] ?? {
                      failed: 0,
                      queued: 0,
                    };
                          const supportPressure = getListingSupportPressure({
                            failedDeliveryCount: deliveryPressure.failed,
                            queuedDeliveryCount: deliveryPressure.queued,
                            retentionTrendLabel: retentionTrend.label,
                            hasReviewPressure: hasSellerReviewPressure,
                          });
                          const tractionPill = getListingTractionPill(item.listing);
                          const supportPressureAction = getListingSupportPressureAction(
                            item.listing.id,
                            deliveryPressure,
                            supportPressure?.label ?? null,
                          );
                          const isPressureEasing = pressureEasingListingIds.includes(item.listing.id);
                          const recoveryDelta = listingRecoveryDeltaById[item.listing.id] ?? 0;

                    return (
                      <div
                        key={item.listing.id}
                        className="rounded-[1.2rem] border border-border bg-background/35 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {item.listing.title}
                            </p>
                            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/52">
                              {item.listing.type} · {item.totalFollowOnCount} follow-on conversion
                              {item.totalFollowOnCount === 1 ? "" : "s"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-800">
                              Same seller · {item.sameSellerCount}
                            </span>
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                              Cross seller · {item.crossSellerCount}
                            </span>
                            {item.listing.available_today ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                                Available today
                              </span>
                            ) : null}
                            {tractionPill ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tractionPill.className}`}
                              >
                                {tractionPill.label}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-2">
                            <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${retentionTone.toneClass}`}>
                              {retentionTone.label}
                            </p>
                            <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${retentionTrend.toneClass}`}>
                              {retentionTrend.label}
                            </p>
                            {item.listing.last_operating_adjustment_summary ? (
                              <p className="text-[11px] text-foreground/58">
                                {item.listing.last_operating_adjustment_summary}
                              </p>
                            ) : null}
                            <DeliveryNetActionButton
                              recoveryDelta={recoveryDelta}
                              onClick={() =>
                                openListingRecentDeliveryNetLane(
                                  item.listing,
                                  recoveryDelta >= 0 ? "sent" : "failed",
                                )
                              }
                              tone="compact"
                            />
                            {isPressureEasing ? (
                              <PressureEasingActionBlock
                                description="Recent sends recovered without active failed or queued alerts."
                                onClick={() => openListingPressureEasingLane(item.listing)}
                                tone="compact"
                              />
                            ) : null}
                            {supportPressure ? (
                              <SupportPressureActionBlock
                                action={supportPressureAction}
                                detail={supportPressure.detail}
                                label={supportPressure.label}
                                onActionClick={() =>
                                  openListingSupportPressureAction(item.listing, supportPressureAction)
                                }
                                toneClass={supportPressure.toneClass}
                                tone="compact"
                              />
                            ) : null}
                            {item.crossSellerCount > 0 ? (
                              <LeakageActionRow
                                crossSellerLocalCount={item.crossSellerLocalCount}
                                crossSellerPriceCount={item.crossSellerPriceCount}
                                crossSellerSearchCount={item.crossSellerSearchCount}
                                label={leakageLabel}
                                onTuneClick={
                                  leakageTuneAction
                                    ? () =>
                                        focusListingControlTarget(
                                          item.listing,
                                          leakageTuneAction.target,
                                        )
                                    : null
                                }
                                tuneLabel={leakageTuneAction?.label}
                              />
                            ) : null}
                          </div>
                          <RetentionLaneActions
                            crossSellerCount={item.crossSellerCount}
                            crossSellerRecentCount={item.crossSellerRecentCount}
                            onOpenBranchedLane={() =>
                              openListingRetentionLane(item.listing, "cross-seller")
                            }
                            onOpenRetainedLane={() =>
                              openListingRetentionLane(item.listing, "same-seller")
                            }
                            sameSellerCount={item.sameSellerCount}
                            sameSellerRecentCount={item.sameSellerRecentCount}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-foreground/68">
                    No listings match the current adjustment filter yet.
                  </p>
                )}
              </div>
            </div>

            {actionFeedback ? (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  actionFeedback.tone === "success"
                    ? "border-olive/20 bg-olive/8 text-olive"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <p>{actionFeedback.message}</p>
                {actionFeedback.details?.length ? (
                  <div className="mt-3 space-y-1">
                    {actionFeedback.details.slice(0, 4).map((detail) => (
                      <p
                        key={detail}
                        className={`text-xs ${
                          actionFeedback.tone === "success"
                            ? "text-olive/80"
                            : "text-red-700/90"
                        }`}
                      >
                        {detail}
                      </p>
                    ))}
                    {actionFeedback.details.length > 4 ? (
                      <p
                        className={`text-xs ${
                          actionFeedback.tone === "success"
                            ? "text-olive/80"
                            : "text-red-700/90"
                        }`}
                      >
                        {actionFeedback.details.length - 4} more not shown.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Workspace Views
              </p>
              <div className="mt-4 rounded-[1.15rem] border border-border bg-background/45 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                      Current Slice
                    </p>
                    <p className="mt-2 text-sm text-foreground/72">{activeWorkspaceSummary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {workspaceLinkFeedback ? (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                        {workspaceLinkFeedback}
                      </span>
                    ) : null}
                    <button
                      className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => void copyWorkspaceLink()}
                      type="button"
                    >
                      Copy Link
                    </button>
                    {!isDefaultWorkspaceView ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={resetWorkspaceView}
                        type="button"
                      >
                        Reset View
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["default", "Default"],
                  ["needs-action", `Needs Action · ${unreadNotificationCount}`],
                  ["recent-failures", `Recent Failures · ${failedDeliveryCount}`],
                  ["pressure-queue", `Pressure Queue · ${supportWatchListingsCount}`],
                  ["delivery-drag", `Delivery Drag · ${deliveryDragListingsCount}`],
                  ["delivery-pressure", `Delivery Pressure · ${deliveryPressureListingsCount}`],
                  ["trust-watch", `Trust Watch · ${trustWatchListingsCount}`],
                  ["recovery-lane", `Recovery Lane · ${recoveryLaneListingsCount}`],
                  ["recovered-recently", `Recovered Recently · ${pressureEasingListingsCount}`],
                  ["focused-work", `Focused Work · ${focusedItemCount}`],
                ].map(([preset, label]) => (
                  <SelectChip
                    key={preset}
                    active={workspacePreset === preset}
                    className={getWorkspacePresetChipClass(
                      preset as
                        | "default"
                        | "needs-action"
                        | "recent-failures"
                        | "pressure-queue"
                        | "delivery-drag"
                        | "delivery-pressure"
                        | "trust-watch"
                        | "recovery-lane"
                        | "recovered-recently"
                        | "focused-work",
                    )}
                    onClick={() =>
                      applySellerPreset(
                        preset as
                          | "default"
                          | "needs-action"
                          | "recent-failures"
                          | "pressure-queue"
                          | "delivery-drag"
                          | "delivery-pressure"
                          | "trust-watch"
                          | "recovery-lane"
                          | "recovered-recently"
                          | "focused-work",
                      )
                    }
                  >
                    {label}
                  </SelectChip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {unreadNotificationCount > 0 ? (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={markNotificationsSeen}
                    type="button"
                  >
                    Mark All Seen
                  </button>
                ) : null}
                {focusedActivityKey ? (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={clearFocusedActivity}
                    type="button"
                  >
                    Clear Focus
                  </button>
                ) : null}
              </div>
            </div>

            <div
              className={`rounded-3xl border bg-white px-4 py-4 ${
                unreadNotificationCount > 0
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Notifications
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {unreadNotificationCount} unread seller alerts
                  </p>
                </div>
                <button
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={markNotificationsSeen}
                  type="button"
                >
                  Mark Seen
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {notifications.length > 0 ? (
                  notifications.slice(0, 5).map((notification) => (
                    <button
                      key={notification.id}
                      className={`w-full rounded-[1.1rem] border px-4 py-3 text-left transition ${
                        focusedActivityKey ===
                        `${notification.transactionKind}:${notification.transactionId}`
                          ? "border-accent bg-accent/8"
                          : isUnreadNotification(notification)
                            ? "border-amber-300 bg-amber-50/70 hover:border-accent/50"
                          : "border-border bg-background/35 hover:border-accent/50"
                      }`}
                      onClick={() => focusActivity(notification)}
                      type="button"
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {notification.title}
                      </p>
                      <p className="mt-1 text-sm text-foreground/70">{notification.message}</p>
                      <p className="mt-2 text-xs text-foreground/52">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-foreground/68">
                    Buyer requests and updates will show up here.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Recent Reviews
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {formatSellerRating(
                      workspace.seller.average_rating,
                      workspace.seller.review_count,
                    )}
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
                  {workspace.reviews.length} visible
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {workspace.reviews.length > 0 ? (
                  workspace.reviews.map((review) => (
                    <article
                      key={review.id}
                      className="rounded-[1.1rem] border border-border bg-background/35 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-[#f3e1bd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c3a10]">
                          {review.rating}/5
                        </span>
                        <span className="text-xs text-foreground/52">
                          {new Date(review.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-foreground/72">
                        {review.comment ?? "Buyer left a rating without a written comment."}
                      </p>
                      <div className="mt-4 rounded-[1rem] border border-border bg-white/75 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/48">
                            Seller Response
                          </p>
                          {review.seller_responded_at ? (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45">
                              {new Date(review.seller_responded_at).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        <textarea
                          className="mt-3 min-h-[88px] w-full rounded-[0.9rem] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
                          onChange={(event) => updateReviewResponseDraft(review.id, event.target.value)}
                          placeholder="Reply to this buyer review with context or thanks."
                          value={reviewResponseDrafts[review.id] ?? ""}
                        />
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-foreground/52">
                            Public storefronts will show the latest seller response.
                          </p>
                          <button
                            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                            disabled={reviewResponseLoading === review.id}
                            onClick={() => saveReviewResponse(review)}
                            type="button"
                          >
                            {reviewResponseLoading === review.id ? "Saving..." : "Save Response"}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-foreground/68">
                    Completed orders and bookings can now turn into reviews. They will show up here
                    as buyers submit them.
                  </p>
                )}
              </div>
            </div>

            {accountProfile ? (
              <div className="rounded-3xl border border-border bg-white px-4 py-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                  Delivery Preferences
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    [
                      "Email alerts",
                      accountProfile.email_notifications_enabled ?? true,
                      { email_notifications_enabled: !(accountProfile.email_notifications_enabled ?? true) },
                    ],
                    [
                      "Push alerts",
                      accountProfile.push_notifications_enabled ?? true,
                      { push_notifications_enabled: !(accountProfile.push_notifications_enabled ?? true) },
                    ],
                    [
                      "Marketing updates",
                      accountProfile.marketing_notifications_enabled ?? false,
                      { marketing_notifications_enabled: !(accountProfile.marketing_notifications_enabled ?? false) },
                    ],
                  ].map(([label, value, changes]) => (
                    <button
                      key={label as string}
                      className={`rounded-[1.1rem] border px-4 py-3 text-left transition ${
                        value
                          ? "border-olive/25 bg-olive/8 text-olive"
                          : "border-border bg-background/35 text-foreground/70"
                      }`}
                      onClick={() =>
                        updateNotificationPreferences(
                          changes as Pick<
                            ProfileUpdateInput,
                            | "email_notifications_enabled"
                            | "push_notifications_enabled"
                            | "marketing_notifications_enabled"
                          >,
                        )
                      }
                      type="button"
                    >
                      <p className="text-sm font-semibold">{label as string}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em]">
                        {value ? "On" : "Off"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              className={`rounded-3xl border bg-white px-4 py-4 ${
                queuedDeliveryCount > 0 || failedDeliveryCount > 0
                  ? "border-amber-200 bg-amber-50/30"
                  : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Delivery Jobs
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    Resend and push outbox status · {queuedDeliveryCount} queued
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
                  {filteredNotificationDeliveries.length} shown
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {filteredNotificationDeliveries.some((delivery) => delivery.delivery_status === "failed") ? (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                    disabled={retryingFailedDeliveries}
                    onClick={retryFailedDeliveriesInView}
                    type="button"
                  >
                    {retryingFailedDeliveries ? "Retrying..." : "Retry Failed In View"}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["all", "All Statuses"],
                  ["queued", "Queued"],
                  ["sent", "Sent"],
                  ["failed", "Failed"],
                ].map(([status, label]) => (
                  <SelectChip
                    key={status}
                    active={deliveryStatusFilter === status}
                    onClick={() =>
                      setDeliveryStatusFilter(
                        status as "all" | "queued" | "sent" | "failed",
                      )
                    }
                  >
                    {label}
                  </SelectChip>
                ))}
                <SelectChip
                  active={deliveryRecencyFilter === "today"}
                  onClick={() => setDeliveryRecencyFilter("today")}
                >
                  Today
                </SelectChip>
                <SelectChip
                  active={deliveryRecencyFilter === "7d"}
                  onClick={() => setDeliveryRecencyFilter("7d")}
                >
                  7 Days
                </SelectChip>
                <SelectChip
                  active={deliveryRecencyFilter === "all"}
                  onClick={() => setDeliveryRecencyFilter("all")}
                >
                  All Time
                </SelectChip>
              </div>

              <div className="mt-4 space-y-3">
                {filteredNotificationDeliveries.length > 0 ? (
                  filteredNotificationDeliveries.slice(0, 8).map((delivery) => (
                    <div
                      key={delivery.id}
                      className={`rounded-[1.1rem] border px-4 py-3 ${
                        delivery.delivery_status === "failed"
                          ? "border-red-300 bg-red-50/70"
                          : delivery.delivery_status === "queued"
                            ? "border-amber-300 bg-amber-50/70"
                            : "border-border bg-background/35"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {delivery.channel} · {delivery.transaction_kind}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-foreground/52">
                            {getDeliveryTransactionLabel(delivery)}
                          </p>
                          <p className="mt-1 text-sm text-foreground/70">
                            {String(delivery.payload.subject ?? delivery.payload.status ?? "No payload summary")}
                          </p>
                          {delivery.failure_reason ? (
                            <p className="mt-2 text-sm text-red-700">
                              {delivery.failure_reason}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <span
                            className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                              delivery.delivery_status === "sent"
                                ? "bg-olive text-white"
                                : delivery.delivery_status === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : delivery.delivery_status === "queued"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-stone-200 text-stone-700"
                            }`}
                          >
                            {delivery.delivery_status}
                          </span>
                          <p className="mt-2 text-xs text-foreground/52">
                            Attempts: {delivery.attempts}
                          </p>
                          <p className="mt-1 text-xs text-foreground/52">
                            {new Date(delivery.created_at).toLocaleString()}
                          </p>
                          <button
                            className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                            onClick={() => focusDeliveryTransaction(delivery)}
                            type="button"
                          >
                            Open Queue Item
                          </button>
                          {delivery.delivery_status === "failed" ? (
                            <button
                              className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                              disabled={deliveryRetryLoading === delivery.id}
                              onClick={() => retryNotificationDelivery(delivery.id)}
                              type="button"
                            >
                              {deliveryRetryLoading === delivery.id ? "Retrying..." : "Retry"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-foreground/68">
                    No delivery jobs match the current time filter.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Create Listing</h3>
                <label className="block">
                  <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Title
                  </span>
                  <input
                    className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    Description
                  </span>
                  <textarea
                    className="min-h-28 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                      Type
                    </span>
                    <select
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                      value={listingType}
                      onChange={(event) => setListingType(event.target.value as ListingType)}
                    >
                      <option value="product">Product</option>
                      <option value="service">Service</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                      Category
                    </span>
                    <select
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                      value={listingCategoryId}
                      onChange={(event) => setListingCategoryId(event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                      Price Cents
                    </span>
                    <input
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="w-full rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-65"
                  onClick={handleCreateListing}
                  disabled={loading}
                  type="button"
                >
                  Create Listing
                </button>
                {createError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {createError}
                  </div>
                ) : null}
                {createMessage ? (
                  <div className="rounded-2xl border border-olive/20 bg-olive/8 px-4 py-3 text-sm text-olive">
                    {createMessage}
                  </div>
                ) : null}

                <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        AI listing assistant
                      </p>
                      <p className="text-sm text-foreground/64">
                        Ask the assistant to polish your title and description before creating the listing.
                      </p>
                    </div>
                    <button
                      className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:border-border/50 disabled:text-foreground/50"
                      disabled={listingCreateAiState?.loading}
                      onClick={requestCreateListingAiAssist}
                      type="button"
                    >
                      {listingCreateAiState?.loading ? "Generating..." : "Generate suggestion"}
                    </button>
                  </div>
                  {listingCreateAiState?.error ? (
                    <p className="mt-3 text-xs text-rose-600">{listingCreateAiState.error}</p>
                  ) : null}
                  {listingCreateAiState?.suggestion ? (
                    <div className="mt-3 space-y-2 text-sm text-foreground/70">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Suggested title
                      </p>
                      <p className="text-base font-semibold text-foreground">
                        {listingCreateAiState.suggestion.suggested_title}
                      </p>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Suggested description
                      </p>
                      <p className="text-sm text-foreground/72">
                        {listingCreateAiState.suggestion.suggested_description}
                      </p>
                      <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                        {listingCreateAiState.suggestion.suggested_tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-full border border-foreground/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-foreground/80 hover:bg-foreground/5"
                          onClick={() => applyCreateListingSuggestion(listingCreateAiState.suggestion)}
                          type="button"
                        >
                          Use suggestion
                        </button>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/60">
                          {listingCreateAiState.suggestion.summary}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-foreground/58">
                      Tap the button after entering your current title and description to reveal AI guidance.
                    </p>
                  )}
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-base font-semibold tracking-[-0.03em]">
                      Listing Control Tower
                    </h4>
                    <span className="text-xs uppercase tracking-[0.18em] text-foreground/50">
                      {filteredWorkspaceListings.length} shown · {workspace.listings.length} total
                    </span>
                  </div>

                  {filteredWorkspaceListings.length === 0 ? (
                    <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4 text-sm text-foreground/68">
                      No listings match the current adjustment filter.
                    </div>
                  ) : null}

                  {filteredWorkspaceListings.map((listing) => {
                    const listingRetention = listingFollowOnBreakdownById[listing.id];
                    const listingTrend = listingRetention
                      ? getListingRetentionTrend({
                          sameSellerCount: listingRetention.sameSellerCount,
                          crossSellerCount: listingRetention.crossSellerCount,
                          sameSellerRecentCount: listingRetention.sameSellerRecentCount,
                          crossSellerRecentCount: listingRetention.crossSellerRecentCount,
                          sameSellerPostAdjustmentCount: listingRetention.sameSellerPostAdjustmentCount,
                          crossSellerPostAdjustmentCount: listingRetention.crossSellerPostAdjustmentCount,
                        })
                      : null;
                    const deliveryPressure = listingDeliveryPressureById[listing.id] ?? {
                      failed: 0,
                      queued: 0,
                    };
                    const supportPressure = getListingSupportPressure({
                      failedDeliveryCount: deliveryPressure.failed,
                      queuedDeliveryCount: deliveryPressure.queued,
                      retentionTrendLabel: listingTrend?.label ?? null,
                      hasReviewPressure: hasSellerReviewPressure,
                    });
                    const supportPressureAction = getListingSupportPressureAction(
                      listing.id,
                      deliveryPressure,
                      supportPressure?.label ?? null,
                    );
                    const tractionPill = getListingTractionPill(listing);
                    const isPressureEasing = pressureEasingListingIds.includes(listing.id);
                    const recoveryDelta = listingRecoveryDeltaById[listing.id] ?? 0;
                    const aiState = listingAiState[listing.id];
                    const priceInsightState = listingPriceInsights[listing.id];
                    const draftPriceCents = Number(listingDrafts[listing.id].price_cents);
                    const pricePositionBadge = priceInsightState?.insight
                      ? getPricePositionBadge({
                          currentPriceCents:
                            listingDrafts[listing.id].price_cents.trim() === "" ||
                            Number.isNaN(draftPriceCents)
                              ? null
                              : draftPriceCents,
                          suggestedPriceCents: priceInsightState.insight.suggested_price_cents,
                          currency: priceInsightState.insight.currency,
                        })
                      : null;
                    const premiumRecommendations = getPremiumStorefrontRecommendations(listing);

                    return (
                      <div
                        key={listing.id}
                        className="rounded-[1.3rem] border border-border bg-white px-4 py-4"
                      >
                      {listingDrafts[listing.id] ? (
                        <>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-foreground">
                              {listing.title}
                            </p>
                            <span
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                listing.status === "active"
                                  ? "bg-olive text-white"
                                  : listing.status === "draft"
                                    ? "bg-amber-100 text-amber-800"
                                    : listing.status === "paused"
                                      ? "bg-stone-200 text-stone-700"
                                      : "bg-foreground/10 text-foreground/70"
                              }`}
                            >
                              {listing.status.replaceAll("_", " ")}
                            </span>
                            <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
                              {listing.type}
                            </span>
                            <span
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                getListingOperatingRole(listing) === "booking-led"
                                  ? "bg-[#e4f1ed] text-[#0f5f62]"
                                  : getListingOperatingRole(listing) === "hybrid"
                                    ? "bg-[#f3e1bd] text-[#7c3a10]"
                                    : "bg-[#ece7dc] text-[#4d4338]"
                              }`}
                            >
                              {getListingOperatingRole(listing)}
                            </span>
                            {listingTrend ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                  listingTrend.toneClass === "text-olive"
                                    ? "border-olive/20 bg-olive/10 text-olive"
                                    : listingTrend.toneClass === "text-rose-700"
                                      ? "border-rose-200 bg-rose-50 text-rose-700"
                                      : listingTrend.toneClass === "text-sky-700"
                                        ? "border-sky-200 bg-sky-50 text-sky-700"
                                        : "border-border bg-background/40 text-foreground/68"
                                }`}
                              >
                                {listingTrend.label}
                              </span>
                            ) : null}
                            {listing.available_today ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                Available today
                              </span>
                            ) : null}
                            {tractionPill ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${tractionPill.className}`}
                              >
                                {tractionPill.label}
                              </span>
                            ) : null}
                            {supportPressure ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${supportPressure.toneClass}`}
                              >
                                {supportPressure.label}
                              </span>
                            ) : null}
                            {isPressureEasing ? (
                              <PressureEasingActionBlock
                                onClick={() => openListingPressureEasingLane(listing)}
                              />
                            ) : null}
                          </div>
                          <p className="text-sm text-foreground/68">
                            {listing.description ?? "No seller description yet."}
                          </p>
                          {listingRetention ? (
                            <p className="text-xs leading-5 text-foreground/56">
                              {listing.last_operating_adjustment_summary
                                ? `Since last change: ${listingRetention.sameSellerPostAdjustmentCount} retained · ${listingRetention.crossSellerPostAdjustmentCount} branched.`
                                : `Recent retention: ${listingRetention.sameSellerRecentCount} retained · ${listingRetention.crossSellerRecentCount} branched in the last 7 days.`}
                            </p>
                          ) : null}
                          <DeliveryNetActionButton
                            recoveryDelta={recoveryDelta}
                            onClick={() =>
                              openListingRecentDeliveryNetLane(
                                listing,
                                recoveryDelta >= 0 ? "sent" : "failed",
                              )
                            }
                          />
                          {supportPressure ? (
                            <SupportPressureActionBlock
                              action={supportPressureAction}
                              detail={supportPressure.detail}
                              label={supportPressure.label}
                              onActionClick={() =>
                                openListingSupportPressureAction(listing, supportPressureAction)
                              }
                              toneClass={supportPressure.toneClass}
                            />
                          ) : null}
                          {isPressureEasing ? (
                            <PressureEasingActionBlock
                              description="Recent sends recovered for this listing without active failed or queued alerts."
                              onClick={() => openListingPressureEasingLane(listing)}
                              tone="detail"
                            />
                          ) : null}
                          <p className="text-xs leading-5 text-foreground/56">
                            {getListingOperatingGuidance(listing)}
                          </p>
                          <TuneRoleActionButton onClick={() => focusListingRoleControls(listing)} />
                            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-foreground/58">
                              {listing.category ? <span>Category: {listing.category}</span> : null}
                              {listing.last_pricing_comparison_scope ? (
                                <span
                                  className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                    getPriceComparisonScopeBadge(
                                      listing.last_pricing_comparison_scope,
                                    ).className
                                  }`}
                                >
                                  {
                                    getPriceComparisonScopeBadge(
                                      listing.last_pricing_comparison_scope,
                                    ).label
                                  }
                                </span>
                              ) : null}
                            <span>{formatCurrency(listing.price_cents, listing.currency)}</span>
                            <span>Slug: {listing.slug}</span>
                            <span>
                              Images: {listing.images?.length ?? 0}
                            </span>
                            <span>
                              Fulfillment:
                              {" "}
                              {[
                                listing.pickup_enabled ? "pickup" : null,
                                listing.meetup_enabled ? "meetup" : null,
                                listing.delivery_enabled ? "delivery" : null,
                                listing.shipping_enabled ? "shipping" : null,
                              ]
                                .filter(Boolean)
                                .join(", ") || "not configured"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Category
                          </span>
                          <select
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            value={listingDrafts[listing.id].category_id}
                            onChange={(event) =>
                              updateListingDraft(listing.id, (current) => ({
                                ...current,
                                category_id: event.target.value,
                              }))
                            }
                          >
                            <option value="">Unassigned</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div
                          className={`rounded-2xl border px-4 py-3 transition ${
                            highlightedListingControlKey === `${listing.id}:pricing`
                              ? "border-accent bg-accent/8 ring-2 ring-accent/30"
                              : "border-border bg-background/40"
                          }`}
                          ref={(node) => {
                            listingControlRefs.current[`${listing.id}:pricing`] = node;
                          }}
                        >
                          <label className="block">
                            <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Price Cents
                            </span>
                            <input
                              className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                              value={listingDrafts[listing.id].price_cents}
                              onChange={(event) =>
                                updateListingDraft(listing.id, (current) => ({
                                  ...current,
                                  price_cents: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>
                        <label className="block">
                          <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Duration Minutes
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            value={listingDrafts[listing.id].duration_minutes}
                            onChange={(event) =>
                              updateListingDraft(listing.id, (current) => ({
                                ...current,
                                duration_minutes: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Lead Time Hours
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            value={listingDrafts[listing.id].lead_time_hours}
                            onChange={(event) =>
                              updateListingDraft(listing.id, (current) => ({
                                ...current,
                                lead_time_hours: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div
                          className={`rounded-2xl border px-4 py-3 transition ${
                            highlightedListingControlKey === `${listing.id}:booking`
                              ? "border-accent bg-accent/8 ring-2 ring-accent/30"
                              : "border-border bg-background/40"
                          }`}
                          ref={(node) => {
                            listingControlRefs.current[`${listing.id}:booking`] = node;
                          }}
                        >
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                            Booking
                          </p>
                          <label className="mt-3 flex items-center gap-2 text-sm text-foreground/76">
                            <input
                              checked={listingDrafts[listing.id].requires_booking}
                              onChange={(event) =>
                                updateListingDraft(listing.id, (current) => ({
                                  ...current,
                                  requires_booking: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                            Requires booking
                          </label>
                          <label className="mt-2 flex items-center gap-2 text-sm text-foreground/76">
                            <input
                              checked={listingDrafts[listing.id].is_local_only}
                              onChange={(event) =>
                                updateListingDraft(listing.id, (current) => ({
                                  ...current,
                                  is_local_only: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                            Local only
                          </label>
                          <label className="mt-2 block text-sm text-foreground/76">
                            <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Promoted listing
                            </span>
                            <div className="flex items-center gap-2 text-sm text-foreground/76">
                              <input
                                checked={listingDrafts[listing.id].is_promoted}
                                onChange={(event) =>
                                  updateListingDraft(listing.id, (current) => ({
                                    ...current,
                                    is_promoted: event.target.checked,
                                  }))
                                }
                                type="checkbox"
                              />
                              Feature this listing in the buyer feed
                            </div>
                            <p className="text-[11px] text-foreground/50">
                              Promoted listings are highlighted to buyers and display the “Promoted” badge.
                            </p>
                          </label>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Premium storefront optimization
                            </p>
                            <p className="text-sm text-foreground/64">
                              {workspace.subscription?.premium_storefront
                                ? "Merchandising recommendations for stronger storefront conversion."
                                : "Upgrade to unlock premium storefront recommendations for each listing."}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                              workspace.subscription?.premium_storefront
                                ? "border border-[#0f5f62]/20 bg-[#e4f1ed] text-[#0f5f62]"
                                : "border border-border bg-white text-foreground/62"
                            }`}
                          >
                            {workspace.subscription?.premium_storefront ? "Unlocked" : "Locked"}
                          </span>
                        </div>
                        {workspace.subscription?.premium_storefront ? (
                          premiumRecommendations.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {premiumRecommendations.map((recommendation) => (
                                <div
                                  key={recommendation}
                                  className="rounded-[1rem] border border-[#0f5f62]/12 bg-white px-3 py-3 text-sm leading-6 text-foreground/72"
                                >
                                  {recommendation}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-foreground/66">
                              This listing is in strong shape for the storefront right now. Keep the
                              images fresh and monitor traction before changing positioning.
                            </p>
                          )
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-foreground/66">
                            Premium storefront plans turn listing data into merchandising guidance,
                            including image coverage, description depth, traction-based promotion cues,
                            and local-fit recommendations.
                          </p>
                        )}
                      </div>

                      <div
                        className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4"
                        ref={(node) => {
                          listingControlRefs.current[`${listing.id}:pricing-insight`] = node;
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Pricing insights
                            </p>
                            <p className="text-sm text-foreground/64">
                              {priceInsightState?.insight?.summary ??
                                (priceInsightState?.loading
                                  ? "Analyzing similar listings..."
                                  : "Tap refresh to compare pricing for this checklist.")}
                            </p>
                          </div>
                          <button
                            className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:border-border/50 disabled:text-foreground/50"
                            disabled={priceInsightState?.loading}
                            onClick={() => requestListingPriceInsight(listing)}
                            type="button"
                          >
                            {priceInsightState?.loading ? "Refreshing..." : "Refresh insights"}
                          </button>
                        </div>
                        {priceInsightState?.error ? (
                          <p className="mt-3 text-xs text-rose-600">{priceInsightState.error}</p>
                        ) : null}
                        {priceInsightState?.insight ? (
                          <div className="mt-3 space-y-2 text-sm text-foreground/70">
                            <div className="flex flex-wrap gap-3">
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                                  getPriceComparisonScopeBadge(
                                    priceInsightState.insight.comparison_scope,
                                  ).className
                                }`}
                              >
                                {
                                  getPriceComparisonScopeBadge(
                                    priceInsightState.insight.comparison_scope,
                                  ).label
                                }
                              </span>
                              <span className="text-[11px] uppercase tracking-[0.14em] text-foreground/56">
                                Sample {priceInsightState.insight.sample_size}
                              </span>
                              <span className="text-[11px] uppercase tracking-[0.14em] text-foreground/56">
                                Suggested {formatCurrency(
                                  priceInsightState.insight.suggested_price_cents,
                                  priceInsightState.insight.currency,
                                )}
                              </span>
                              <span className="text-[11px] uppercase tracking-[0.14em] text-foreground/56">
                                Median {formatCurrency(
                                  priceInsightState.insight.median_price_cents,
                                  priceInsightState.insight.currency,
                                )}
                              </span>
                              {pricePositionBadge ? (
                                <span
                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${pricePositionBadge.className}`}
                                >
                                  {pricePositionBadge.label}
                                </span>
                              ) : null}
                            </div>
                            <p className="flex flex-wrap gap-2 text-[11px] text-foreground/60">
                              <span>
                                Range
                                {" "}
                                {formatCurrency(
                                  priceInsightState.insight.min_price_cents,
                                  priceInsightState.insight.currency,
                                )}
                                {" "}
                                –
                                {" "}
                                {formatCurrency(
                                  priceInsightState.insight.max_price_cents,
                                  priceInsightState.insight.currency,
                                )}
                              </span>
                              <span>
                                Avg
                                {" "}
                                {formatCurrency(
                                  priceInsightState.insight.avg_price_cents,
                                  priceInsightState.insight.currency,
                                )}
                              </span>
                            </p>
                          </div>
                        ) : (
                          <p className="mt-3 text-xs text-foreground/58">
                            {priceInsightState?.loading
                              ? "Working through recent price data..."
                              : "No insight loaded yet, so refresh to measure your price curve."}
                          </p>
                        )}
                      </div>

                      <div
                        className={`mt-4 rounded-2xl border px-4 py-4 transition ${
                          highlightedListingControlKey === `${listing.id}:fulfillment`
                            ? "border-accent bg-accent/8 ring-2 ring-accent/30"
                            : "border-border bg-background/40"
                        }`}
                        ref={(node) => {
                          listingControlRefs.current[`${listing.id}:fulfillment`] = node;
                        }}
                      >
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                          Fulfillment Methods
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {[
                            ["pickup_enabled", "Pickup"],
                            ["meetup_enabled", "Meetup"],
                            ["delivery_enabled", "Delivery"],
                            ["shipping_enabled", "Shipping"],
                          ].map(([field, label]) => (
                            <label
                              key={field}
                              className="flex items-center gap-2 text-sm text-foreground/76"
                            >
                              <input
                                checked={
                                  listingDrafts[listing.id][field as keyof ListingDraft] as boolean
                                }
                                onChange={(event) =>
                                  updateListingDraft(listing.id, (current) => ({
                                    ...current,
                                    [field]: event.target.checked,
                                  }))
                                }
                                type="checkbox"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Listing Images
                            </p>
                            <p className="mt-2 text-sm text-foreground/68">
                              Add external image URLs now. Storage uploads can come later without changing the gallery model.
                            </p>
                          </div>
                          <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
                            {listing.images?.length ?? 0} image{(listing.images?.length ?? 0) === 1 ? "" : "s"}
                          </span>
                        </div>

                        {(listing.images?.length ?? 0) > 0 ? (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {(listing.images ?? []).map((image) => (
                              <div
                                key={image.id}
                                className="overflow-hidden rounded-2xl border border-border bg-white"
                              >
                                <Image
                                  alt={image.alt_text ?? listing.title}
                                  className="h-32 w-full object-cover"
                                  height={128}
                                  unoptimized
                                  src={image.image_url}
                                  width={320}
                                />
                                <div className="space-y-2 px-3 py-3">
                                  <p className="text-xs text-foreground/64">
                                    {image.alt_text ?? listing.title}
                                  </p>
                                  <button
                                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                                    disabled={listingImageActionLoading === image.id}
                                    onClick={() => removeListingImage(listing, image)}
                                    type="button"
                                  >
                                    {listingImageActionLoading === image.id ? "Removing..." : "Remove"}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-foreground/60">
                            No listing images yet. Add one below to make the buyer feed feel real.
                          </div>
                        )}

                        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                          <label className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-white px-4 py-3 text-sm text-foreground/68 transition hover:border-accent hover:text-accent">
                            <input
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              disabled={listingImageActionLoading === `${listing.id}:upload`}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) {
                                  return;
                                }

                                void uploadListingImageFile(listing, file);
                                event.currentTarget.value = "";
                              }}
                              type="file"
                            />
                            {listingImageActionLoading === `${listing.id}:upload`
                              ? "Uploading image..."
                              : "Choose image file"}
                          </label>
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            placeholder="https://images.example.com/listing.jpg"
                            value={listingImageDrafts[listing.id]?.image_url ?? ""}
                            onChange={(event) =>
                              updateListingImageDraft(listing.id, (current) => ({
                                ...current,
                                image_url: event.target.value,
                              }))
                            }
                          />
                          <input
                            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                            placeholder="Alt text"
                            value={listingImageDrafts[listing.id]?.alt_text ?? ""}
                            onChange={(event) =>
                              updateListingImageDraft(listing.id, (current) => ({
                                ...current,
                                alt_text: event.target.value,
                              }))
                            }
                          />
                          <button
                            className="rounded-full bg-foreground px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:opacity-45"
                            disabled={listingImageActionLoading === `${listing.id}:add`}
                            onClick={() => addListingImage(listing)}
                            type="button"
                          >
                            {listingImageActionLoading === `${listing.id}:add` ? "Adding..." : "Add Image"}
                          </button>
                        </div>
                        <p className="mt-3 text-xs text-foreground/52">
                          Upload a local image file or keep using an external URL for seeded content and quick demos.
                        </p>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              AI listing assistant
                            </p>
                            <p className="text-sm text-foreground/64">
                              Generate a confident title, description, and tags from your current listing data.
                            </p>
                          </div>
                          <button
                            className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:border-border/50 disabled:text-foreground/50"
                            disabled={aiState?.loading}
                            onClick={() => requestListingAiAssist(listing)}
                            type="button"
                          >
                            {aiState?.loading ? "Generating..." : "Refresh suggestions"}
                          </button>
                        </div>
                        {aiState?.error ? (
                          <p className="mt-3 text-xs text-rose-600">{aiState.error}</p>
                        ) : null}
                        {aiState?.suggestion ? (
                          <div className="mt-3 space-y-2 text-sm text-foreground/70">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Suggested title
                            </p>
                            <p className="text-base font-semibold text-foreground">
                              {aiState.suggestion.suggested_title}
                            </p>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                              Suggested description
                            </p>
                            <p className="text-sm text-foreground/72">
                              {aiState.suggestion.suggested_description}
                            </p>
                            <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                              {aiState.suggestion.suggested_tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <p className="text-[11px] text-foreground/60">
                              {aiState.suggestion.summary}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-3 text-xs text-foreground/58">
                            {aiState?.loading
                              ? "Generating an update from your listing signals..."
                              : "Tap the button to let AI propose a fresh title, description, and tags."}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          ["draft", "Move To Draft"],
                          ["active", "Publish"],
                          ["paused", "Pause"],
                          ["archived", "Archive"],
                        ].map(([status, label]) => (
                          <button
                            key={status}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                            disabled={
                              listingActionLoading === listing.id || listing.status === status
                            }
                            onClick={() =>
                              updateListingStatus(
                                listing.id,
                                status as ListingUpdateInput["status"],
                              )
                            }
                            type="button"
                          >
                            {listingActionLoading === listing.id ? "..." : label}
                          </button>
                        ))}
                        <button
                          className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:opacity-45"
                          disabled={listingSaveLoading === listing.id}
                          onClick={() => saveListingDetails(listing)}
                          type="button"
                        >
                          {listingSaveLoading === listing.id ? "Saving..." : "Save Details"}
                        </button>
                      </div>
                        </>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-semibold tracking-[-0.03em]">Live Activity</h3>
                    <button
                      className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                        bulkExecutionMode === "atomic"
                          ? "border-amber-300 bg-amber-100 text-amber-900 shadow-[0_0_0_1px_rgba(245,158,11,0.14)]"
                          : "border-stone-300 bg-stone-200 text-stone-700"
                      }`}
                      onClick={() =>
                        setBulkExecutionMode(toggleBulkExecutionMode(bulkExecutionMode))
                      }
                      type="button"
                    >
                      Batch Mode · {bulkExecutionMode === "atomic" ? "Validate First" : "Best Effort"} · Click to switch
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                        bulkExecutionMode === "best_effort"
                          ? "border-accent bg-accent text-white"
                          : "border-border text-foreground hover:border-accent hover:text-accent"
                      }`}
                      onClick={() => setBulkExecutionMode("best_effort")}
                      type="button"
                    >
                      Best Effort
                    </button>
                    <button
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                        bulkExecutionMode === "atomic"
                          ? "border-accent bg-accent text-white"
                          : "border-border text-foreground hover:border-accent hover:text-accent"
                      }`}
                      onClick={() => setBulkExecutionMode("atomic")}
                      type="button"
                    >
                      Validate First
                    </button>
                    {pendingVisibleOrdersCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkOrderAction("pending", "confirmed", "confirm-orders")
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "confirm-orders"
                          ? "Confirming..."
                          : `Confirm Orders · ${pendingVisibleOrdersCount}`}
                      </button>
                    ) : null}
                    {requestedVisibleBookingsCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkBookingAction("requested", "confirmed", "confirm-bookings")
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "confirm-bookings"
                          ? "Confirming..."
                          : `Confirm Bookings · ${requestedVisibleBookingsCount}`}
                      </button>
                    ) : null}
                    {readyVisibleOrdersCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkOrderAction("ready", "completed", "complete-orders")
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "complete-orders"
                          ? "Completing..."
                          : `Complete Orders · ${readyVisibleOrdersCount}`}
                      </button>
                    ) : null}
                    {inProgressVisibleBookingsCount > 0 ? (
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() =>
                          stageBulkBookingAction(
                            "in_progress",
                            "completed",
                            "complete-bookings",
                          )
                        }
                        type="button"
                      >
                        {bulkQueueActionLoading === "complete-bookings"
                          ? "Completing..."
                          : `Complete Bookings · ${inProgressVisibleBookingsCount}`}
                      </button>
                    ) : null}
                  </div>
                </div>
                {pendingBulkAction ? (
                  <div
                    className={`rounded-[1.2rem] border px-4 py-4 ${
                      pendingBulkAction.nextStatus === "completed"
                        ? "border-red-200 bg-red-50/70"
                        : "border-amber-200 bg-amber-50/70"
                    }`}
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                      Confirm Bulk Action
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {pendingBulkAction.label}
                    </p>
                    <p className="mt-2 text-sm text-foreground/70">
                      This will move {pendingBulkAction.count} visible{" "}
                      {pendingBulkAction.kind === "order" ? "order" : "booking"}
                      {pendingBulkAction.count === 1 ? "" : "s"} from{" "}
                      {pendingBulkAction.currentStatus.replaceAll("_", " ")} to{" "}
                      {pendingBulkAction.nextStatus.replaceAll("_", " ")} using the current
                      filter view. Mode: {bulkExecutionMode === "atomic" ? "validate first" : "best effort"}.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <label className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
                        <input
                          checked={bulkExecutionMode === "atomic"}
                          onChange={(event) =>
                            setBulkExecutionMode(
                              event.target.checked ? "atomic" : "best_effort",
                            )
                          }
                          type="checkbox"
                        />
                        Validate First
                      </label>
                      <button
                        className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white transition disabled:opacity-45 ${
                          pendingBulkAction.nextStatus === "completed"
                            ? "bg-red-700 hover:bg-red-800"
                            : "bg-accent hover:bg-accent-deep"
                        }`}
                        disabled={bulkQueueActionLoading !== null}
                        onClick={confirmPendingBulkAction}
                        type="button"
                      >
                        {bulkQueueActionLoading === pendingBulkAction.actionKey
                          ? "Applying..."
                          : pendingBulkAction.nextStatus === "completed"
                            ? "Confirm Completion"
                            : "Confirm Bulk Update"}
                      </button>
                      <button
                        className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        disabled={bulkQueueActionLoading !== null}
                        onClick={() => setPendingBulkAction(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4">
                  <div className="flex flex-wrap gap-4">
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Type
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityTypeFilter}
                        onChange={(event) =>
                          setActivityTypeFilter(event.target.value as "all" | "order" | "booking")
                        }
                      >
                        <option value="all">All activity</option>
                        <option value="order">Orders only</option>
                        <option value="booking">Bookings only</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Status
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityStatusFilter}
                        onChange={(event) => setActivityStatusFilter(event.target.value)}
                      >
                        {activityStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status === "all" ? "All statuses" : status.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Discovery
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityDiscoveryFilter}
                        onChange={(event) =>
                          setActivityDiscoveryFilter(
                            event.target.value as
                              | "all"
                              | "local"
                              | "search"
                              | "price"
                              | "same-seller"
                              | "cross-seller",
                          )
                        }
                      >
                        <option value="all">All discovery</option>
                        <option value="local">Local match</option>
                        <option value="search">Search-led</option>
                        <option value="price">Price-led</option>
                        <option value="same-seller">Same-seller follow-on</option>
                        <option value="cross-seller">Cross-seller follow-on</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Activity Window
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityRecencyFilter}
                        onChange={(event) =>
                          setActivityRecencyFilter(event.target.value as "7d" | "all")
                        }
                      >
                        <option value="all">All time</option>
                        <option value="7d">Last 7 days</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Context
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activityContextFilter}
                        onChange={(event) =>
                          setActivityContextFilter(
                            event.target.value as "all" | "unread" | "focused",
                          )
                        }
                      >
                        <option value="all">All queue items</option>
                        <option value="unread">Unread updates</option>
                        <option value="focused">Focused item</option>
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
                        Queue Order
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-accent"
                        value={activitySortMode}
                        onChange={(event) =>
                          setActivitySortMode(
                            event.target.value as
                              | "default"
                              | "pressured"
                              | "drag"
                              | "recovery",
                          )
                        }
                      >
                        <option value="default">Default Order</option>
                        <option value="pressured">Pressured First</option>
                        <option value="drag">Drag First</option>
                        <option value="recovery">Recovery First</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="space-y-3">
                  {focusedOrder ? (
                    <div
                      className={`rounded-[1.5rem] border px-5 py-5 transition ${
                        highlightedFocusedPanelKey === `order:${focusedOrder.id}`
                          ? "border-accent bg-accent/12 ring-2 ring-accent/35"
                          : "border-accent bg-accent/8"
                      }`}
                    >
                      <FocusedTransactionHeader
                        browseContextLabel={
                          formatBuyerBrowseContextLabel(focusedOrder.buyer_browse_context) ?? null
                        }
                        clearLabel="Clear Focus"
                        pressureToneClass={focusedOrderSupportPressure?.toneClass ?? null}
                        pressureLabel={focusedOrderSupportPressure?.label ?? null}
                        subtitle={focusedOrder.notes ?? "No buyer notes"}
                        title="Focused Order"
                        valueLabel={formatCurrency(focusedOrder.total_cents, focusedOrder.currency)}
                        statusLabel={focusedOrder.status.replaceAll("_", " ")}
                        onClear={clearFocusedActivity}
                      />

                      <div className="mt-4 grid gap-4 text-sm text-foreground/72 sm:grid-cols-2">
                        <FocusedTransactionSnapshotCard
                          browseContextLabel={
                            formatBuyerBrowseContextLabel(focusedOrder.buyer_browse_context) ??
                            "No browse context"
                          }
                          listing={focusedOrderListing}
                          pressureDetail={focusedOrderSupportPressure?.detail ?? null}
                          pressureLaneCount={focusedOrderSupportPressureLaneCount}
                          pressureLaneMode={focusedOrderSupportPressureLaneMode}
                          sellerNote={focusedOrder.seller_response_note ?? "No seller note yet"}
                          summaryLines={[
                            `Order ID: ${focusedOrder.id}`,
                            `Fulfillment: ${focusedOrder.fulfillment}`,
                            `Items: ${(focusedOrder.items ?? []).length}`,
                          ]}
                          title="Order Snapshot"
                          onOpenSupportLane={() => {
                            if (!focusedOrderListing || !focusedOrderSupportPressureLaneMode) return;
                            openListingSupportPressureLane(
                              focusedOrderListing,
                              focusedOrderSupportPressureLaneMode,
                            );
                          }}
                        />
                        <FocusedTransactionDetailCard title="Requested Items">
                          <div className="mt-3 space-y-2">
                            {(focusedOrder.items ?? []).length > 0 ? (
                              (focusedOrder.items ?? []).map((item) => (
                                <p key={item.id}>
                                  {item.quantity}x {item.listing_title ?? item.listing_id}
                                  {" · "}
                                  {formatCurrency(item.total_price_cents, focusedOrder.currency)}
                                </p>
                              ))
                            ) : (
                              <p>No item detail is available for this order yet.</p>
                            )}
                          </div>
                        </FocusedTransactionDetailCard>
                        <FocusedTransactionDetailCard title="Fee Breakdown">
                          <FocusedOrderFeeBreakdown order={focusedOrder} />
                        </FocusedTransactionDetailCard>
                      </div>

                      <FocusedTransactionDetailCard className="mt-4" title="Full Timeline">
                        <TransactionTimelineCard
                          events={focusedOrder.status_history ?? []}
                        />
                      </FocusedTransactionDetailCard>
                    </div>
                  ) : null}

                  {focusedBooking ? (
                    <div
                      className={`rounded-[1.5rem] border px-5 py-5 transition ${
                        highlightedFocusedPanelKey === `booking:${focusedBooking.id}`
                          ? "border-accent bg-accent/12 ring-2 ring-accent/35"
                          : "border-accent bg-accent/8"
                      }`}
                    >
                      <FocusedTransactionHeader
                        browseContextLabel={
                          formatBuyerBrowseContextLabel(focusedBooking.buyer_browse_context) ?? null
                        }
                        clearLabel="Clear Focus"
                        pressureToneClass={focusedBookingSupportPressure?.toneClass ?? null}
                        pressureLabel={focusedBookingSupportPressure?.label ?? null}
                        subtitle={focusedBooking.listing_title ?? focusedBooking.listing_id}
                        title="Focused Booking"
                        valueLabel={formatCurrency(focusedBooking.total_cents, focusedBooking.currency)}
                        statusLabel={focusedBooking.status.replaceAll("_", " ")}
                        onClear={clearFocusedActivity}
                      />

                      <div className="mt-4 grid gap-4 text-sm text-foreground/72 sm:grid-cols-2">
                        <FocusedTransactionSnapshotCard
                          browseContextLabel={
                            formatBuyerBrowseContextLabel(focusedBooking.buyer_browse_context) ??
                            "No browse context"
                          }
                          listing={focusedBookingListing}
                          pressureDetail={focusedBookingSupportPressure?.detail ?? null}
                          pressureLaneCount={focusedBookingSupportPressureLaneCount}
                          pressureLaneMode={focusedBookingSupportPressureLaneMode}
                          sellerNote={focusedBooking.seller_response_note ?? "No seller note yet"}
                          summaryLines={[
                            `Booking ID: ${focusedBooking.id}`,
                            `Type: ${focusedBooking.listing_type ?? "Not specified"}`,
                            `Starts: ${new Date(focusedBooking.scheduled_start).toLocaleString()}`,
                            `Ends: ${new Date(focusedBooking.scheduled_end).toLocaleString()}`,
                          ]}
                          title="Booking Snapshot"
                          onOpenSupportLane={() => {
                            if (!focusedBookingListing || !focusedBookingSupportPressureLaneMode) return;
                            openListingSupportPressureLane(
                              focusedBookingListing,
                              focusedBookingSupportPressureLaneMode,
                            );
                          }}
                        />
                        <FocusedTransactionDetailCard title="Buyer Context">
                          <div className="mt-3 space-y-2">
                            <p>{focusedBooking.notes ?? "No buyer notes"}</p>
                          </div>
                        </FocusedTransactionDetailCard>
                      </div>

                      <FocusedTransactionDetailCard className="mt-4" title="Full Timeline">
                        <TransactionTimelineCard
                          events={focusedBooking.status_history ?? []}
                        />
                      </FocusedTransactionDetailCard>
                    </div>
                  ) : null}

                  {filteredOrders.length === 0 && filteredBookings.length === 0 ? (
                    <div className="rounded-[1.3rem] border border-border bg-white px-4 py-4 text-sm text-foreground/68">
                      No activity matches the current filters. Change the queue controls or use the
                      demo buyer to place an order or booking.
                    </div>
                  ) : null}

                  {filteredOrders.map((order) => (
                    (() => {
                      const orderItems = order.items ?? [];
                      const orderContext = getTransactionListingContext(order);
                      const orderListing = orderContext.listing;
                      const orderSupportPressure = orderContext.supportPressure;
                      const orderPressureLaneMode = orderContext.pressureLaneMode;
                      const orderPressureLaneCount = orderContext.pressureLaneCount;
                      const isOrderPressureEasing = orderContext.isPressureEasing;
                      const orderRecoveryDelta = orderContext.recoveryDelta;
                      return (
                    <div
                      key={order.id}
                      ref={(node) => {
                        activityRefs.current[`order:${order.id}`] = node;
                      }}
                      className={`rounded-[1.3rem] border bg-white px-4 py-4 transition ${
                        focusedActivityKey === `order:${order.id}`
                          ? "border-accent ring-2 ring-accent/20"
                          : "border-border"
                      }`}
                      onClick={() => setActivityFocus(`order:${order.id}`)}
                    >
                      <QueueTransactionCardHeader
                        browseContextLabel={formatBuyerBrowseContextLabel(order.buyer_browse_context) ?? null}
                        kindLabel="Order"
                        listing={orderListing}
                        pressureLaneCount={orderPressureLaneCount}
                        pressureLaneMode={orderPressureLaneMode}
                        primaryLine={null}
                        recoveryDelta={orderRecoveryDelta}
                        rightPrimary={formatCurrency(order.total_cents, order.currency)}
                        rightSecondary={formatCompactOrderFeeSummary(order)}
                        secondaryLine={order.notes ?? "No buyer notes"}
                        sellerNote={order.seller_response_note ?? null}
                        statusLabel={order.status.replaceAll("_", " ")}
                        supportPressure={orderSupportPressure}
                        isPressureEasing={isOrderPressureEasing}
                        onOpenDeliveryNet={() => {
                          if (!orderListing) return;
                          openListingRecentDeliveryNetLane(
                            orderListing,
                            orderRecoveryDelta >= 0 ? "sent" : "failed",
                          );
                        }}
                        onOpenPressureEasing={() => {
                          if (!orderListing) return;
                          openListingPressureEasingLane(orderListing);
                        }}
                        onOpenSupportLane={() => {
                          if (!orderListing || !orderPressureLaneMode) return;
                          openListingSupportPressureLane(orderListing, orderPressureLaneMode);
                        }}
                      >
                        <TransactionTimelinePreview events={(order.status_history ?? []).slice(0, 3)} />
                        {orderItems.length > 0 ? (
                          <QueueTransactionDetailList>
                            {orderItems.map((item) => (
                              <p key={item.id}>
                                {item.quantity}x {item.listing_title ?? item.listing_id}
                                {" "}
                                <span className="text-foreground/52">
                                  {formatCurrency(item.total_price_cents, order.currency)}
                                </span>
                              </p>
                            ))}
                          </QueueTransactionDetailList>
                        ) : null}
                      </QueueTransactionCardHeader>
                      <QueueTransactionControls
                        note={responseNotes[order.id] ?? ""}
                        onNoteChange={(value) => updateResponseNote(order.id, value)}
                        notePlaceholder="Add a seller note for this order update"
                        loading={queueLoading === order.id}
                        actions={getOrderQueueActions(order.id)}
                      />
                    </div>
                      );
                    })()
                  ))}

                  {filteredBookings.map((booking) => (
                    (() => {
                      const bookingContext = getTransactionListingContext(booking);
                      const bookingListing = bookingContext.listing;
                      const bookingSupportPressure = bookingContext.supportPressure;
                      const bookingPressureLaneMode = bookingContext.pressureLaneMode;
                      const bookingPressureLaneCount = bookingContext.pressureLaneCount;
                      const isBookingPressureEasing = bookingContext.isPressureEasing;
                      const bookingRecoveryDelta = bookingContext.recoveryDelta;
                      return (
                    <div
                      key={booking.id}
                      ref={(node) => {
                        activityRefs.current[`booking:${booking.id}`] = node;
                      }}
                      className={`rounded-[1.3rem] border bg-white px-4 py-4 transition ${
                        focusedActivityKey === `booking:${booking.id}`
                          ? "border-accent ring-2 ring-accent/20"
                          : "border-border"
                      }`}
                      onClick={() => setActivityFocus(`booking:${booking.id}`)}
                    >
                      <QueueTransactionCardHeader
                        browseContextLabel={formatBuyerBrowseContextLabel(booking.buyer_browse_context) ?? null}
                        kindLabel="Booking"
                        listing={bookingListing}
                        pressureLaneCount={bookingPressureLaneCount}
                        pressureLaneMode={bookingPressureLaneMode}
                        primaryLine={`${booking.listing_title ?? booking.listing_id}${
                          booking.listing_type ? ` · ${booking.listing_type}` : ""
                        }`}
                        recoveryDelta={bookingRecoveryDelta}
                        rightPrimary={new Date(booking.scheduled_start).toLocaleString()}
                        rightSecondary={formatCurrency(booking.total_cents, booking.currency)}
                        secondaryLine={booking.notes ?? "No buyer notes"}
                        sellerNote={booking.seller_response_note ?? null}
                        statusLabel={booking.status.replaceAll("_", " ")}
                        supportPressure={bookingSupportPressure}
                        isPressureEasing={isBookingPressureEasing}
                        onOpenDeliveryNet={() => {
                          if (!bookingListing) return;
                          openListingRecentDeliveryNetLane(
                            bookingListing,
                            bookingRecoveryDelta >= 0 ? "sent" : "failed",
                          );
                        }}
                        onOpenPressureEasing={() => {
                          if (!bookingListing) return;
                          openListingPressureEasingLane(bookingListing);
                        }}
                        onOpenSupportLane={() => {
                          if (!bookingListing || !bookingPressureLaneMode) return;
                          openListingSupportPressureLane(bookingListing, bookingPressureLaneMode);
                        }}
                      >
                        <TransactionTimelinePreview events={(booking.status_history ?? []).slice(0, 3)} />
                      </QueueTransactionCardHeader>
                      <QueueTransactionControls
                        note={responseNotes[booking.id] ?? ""}
                        onNoteChange={(value) => updateResponseNote(booking.id, value)}
                        notePlaceholder="Add a seller note for this booking update"
                        loading={queueLoading === booking.id}
                        actions={getBookingQueueActions(booking.id)}
                      />
                    </div>
                      );
                    })()
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4 rounded-3xl border border-dashed border-border bg-white/55 p-6 text-sm leading-7 text-foreground/68">
            <p>
              Sign in with an existing seller account, or create an account and then publish a
              seller profile here.
            </p>
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Seller Display Name
              </span>
              <input
                className="w-full rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={sellerName}
                onChange={(event) => setSellerName(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Seller Slug
              </span>
              <input
                className="w-full rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={sellerSlug}
                onChange={(event) => setSellerSlug(event.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="City"
              />
              <input
                className="rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={stateRegion}
                onChange={(event) => setStateRegion(event.target.value)}
                placeholder="State"
              />
              <input
                className="rounded-2xl border border-border bg-white/80 px-4 py-3 outline-none transition focus:border-accent"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="Country"
              />
            </div>
            <button
              className="rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-65"
              onClick={handleCreateSellerProfile}
              disabled={loading || !sellerName || !sellerSlug}
              type="button"
            >
              {loading ? "Working..." : "Create Seller Profile"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  accent = "default",
  onClick,
}: {
  label: string;
  value: string;
  accent?: "default" | "amber" | "olive" | "sky" | "rose";
  onClick?: () => void;
}) {
  const accentStyles = {
    default: "border-border bg-white",
    amber: "border-amber-200 bg-amber-50/70",
    olive: "border-lime-200 bg-lime-50/70",
    sky: "border-sky-200 bg-sky-50/70",
    rose: "border-rose-200 bg-rose-50/70",
  } satisfies Record<string, string>;

  const content = (
    <div className={`rounded-[1.3rem] border px-4 py-4 ${accentStyles[accent]}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button
      className="text-left transition hover:-translate-y-0.5"
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

function AnalyticsListingCard({
  title,
  listing,
  detail,
  note,
  tone,
}: {
  title: string;
  listing: Listing | null;
  detail: string;
  note: string;
  tone: "olive" | "sky" | "rose";
}) {
  const toneStyles = {
    olive: "border-lime-200 bg-lime-50/70 text-lime-900",
    sky: "border-sky-200 bg-sky-50/70 text-sky-900",
    rose: "border-rose-200 bg-rose-50/70 text-rose-900",
  } satisfies Record<string, string>;

  return (
    <div className={`rounded-[1.3rem] border px-4 py-4 ${toneStyles[tone]}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] opacity-70">{title}</p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.03em]">
        {listing?.title ?? "No listing yet"}
      </p>
      <p className="mt-2 text-sm font-semibold">{detail}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{note}</p>
    </div>
  );
}

function SelectChip({
  children,
  active,
  onClick,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const resolvedClassName =
    className ??
    (active
      ? "border-accent bg-accent text-white"
      : "border-border text-foreground hover:border-accent hover:text-accent");

  return (
    <button
      className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${resolvedClassName}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function SellerStatusActionChip({
  children,
  loading,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {loading ? "..." : children}
    </button>
  );
}

function TransactionListingPressureInline({
  listing,
  supportPressure,
  isPressureEasing,
  recoveryDelta,
  pressureLaneMode,
  pressureLaneCount,
  onOpenPressureEasing,
  onOpenDeliveryNet,
  onOpenSupportLane,
}: {
  listing: Listing | null;
  supportPressure:
    | {
        label: string;
        detail: string;
        toneClass: string;
      }
    | null;
  isPressureEasing: boolean;
  recoveryDelta: number;
  pressureLaneMode: "failed" | "queued" | "trust" | null;
  pressureLaneCount: number;
  onOpenPressureEasing: () => void;
  onOpenDeliveryNet: () => void;
  onOpenSupportLane: () => void;
}) {
  return (
    <>
      {supportPressure ? (
        <div
          className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${supportPressure.toneClass}`}
        >
          {supportPressure.label}
        </div>
      ) : null}
      {isPressureEasing && listing ? (
        <button
          className="mt-2 inline-flex rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-800 transition hover:border-accent hover:text-accent"
          onClick={(event) => {
            event.stopPropagation();
            onOpenPressureEasing();
          }}
          type="button"
        >
          Pressure easing
        </button>
      ) : null}
      {listing ? (
        <button
          className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition hover:border-accent hover:text-accent ${
            recoveryDelta > 0
              ? "border-lime-200 bg-lime-50 text-lime-800"
              : recoveryDelta < 0
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-border bg-background/40 text-foreground/60"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenDeliveryNet();
          }}
          type="button"
        >
          Delivery net 7d · {recoveryDelta > 0 ? `+${recoveryDelta}` : recoveryDelta}
        </button>
      ) : null}
      {listing && pressureLaneMode ? (
        <div className="mt-2 space-y-1">
          <button
            className="block rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
            onClick={(event) => {
              event.stopPropagation();
              onOpenSupportLane();
            }}
            type="button"
          >
            {getListingSupportPressureLaneLabel(pressureLaneMode)}
            {" · "}
            {getListingSupportPressureLaneCountLabel(pressureLaneMode, pressureLaneCount)}
          </button>
          <p className="text-xs text-foreground/54">
            {listing.title} · {getListingSupportPressureDriverLabel(pressureLaneMode)}
          </p>
        </div>
      ) : null}
    </>
  );
}

function FocusedTransactionSnapshotCard({
  title,
  summaryLines,
  browseContextLabel,
  pressureDetail,
  listing,
  pressureLaneMode,
  pressureLaneCount,
  sellerNote,
  onOpenSupportLane,
}: {
  title: string;
  summaryLines: string[];
  browseContextLabel: string;
  pressureDetail: string | null;
  listing: Listing | null;
  pressureLaneMode: "failed" | "queued" | "trust" | null;
  pressureLaneCount: number;
  sellerNote: string;
  onOpenSupportLane: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white/70 px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
        {title}
      </p>
      <div className="mt-3 space-y-2">
        {summaryLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>Buyer discovery: {browseContextLabel}</p>
        {pressureDetail ? <p>Listing pressure: {pressureDetail}</p> : null}
        {listing && pressureLaneMode ? (
          <button
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
            onClick={onOpenSupportLane}
            type="button"
          >
            {getListingSupportPressureLaneLabel(pressureLaneMode)}
            {" · "}
            {getListingSupportPressureLaneCountLabel(pressureLaneMode, pressureLaneCount)}
          </button>
        ) : null}
        <p>Seller note: {sellerNote}</p>
      </div>
    </div>
  );
}

function FocusedTransactionHeader({
  title,
  statusLabel,
  subtitle,
  browseContextLabel,
  pressureLabel,
  pressureToneClass,
  valueLabel,
  clearLabel,
  onClear,
}: {
  title: string;
  statusLabel: string;
  subtitle: string;
  browseContextLabel: string | null;
  pressureLabel: string | null;
  pressureToneClass: string | null;
  valueLabel: string;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
          {title}
        </p>
        <h4 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
          {statusLabel}
        </h4>
        <p className="mt-2 text-sm text-foreground/72">{subtitle}</p>
        {browseContextLabel ? (
          <div className="mt-3 inline-flex rounded-full border border-[#d7c5a6] bg-[#f6eee2] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
            {browseContextLabel}
          </div>
        ) : null}
        {pressureLabel && pressureToneClass ? (
          <div
            className={`mt-3 inline-flex rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${pressureToneClass}`}
          >
            {pressureLabel}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground">{valueLabel}</p>
        <button
          className="mt-3 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
          onClick={onClear}
          type="button"
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

function FocusedTransactionDetailCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${className} rounded-2xl border border-border bg-white/70 px-4 py-4`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
        {title}
      </p>
      {children}
    </div>
  );
}

function FocusedOrderFeeBreakdown({
  order,
}: {
  order: {
    subtotal_cents: number;
    delivery_fee_cents?: number | null;
    platform_fee_cents?: number | null;
    total_cents: number;
    currency?: string | null;
    fulfillment: string;
  };
}) {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Subtotal",
      value: formatCurrency(order.subtotal_cents, order.currency ?? "USD"),
    },
  ];

  if (order.fulfillment === "delivery" || order.fulfillment === "shipping") {
    rows.push({
      label:
        order.fulfillment === "shipping"
          ? "Platform-added shipping fee"
          : "Platform-added delivery fee",
      value: formatCurrency(order.delivery_fee_cents ?? 0, order.currency ?? "USD"),
    });
  }

  rows.push(
    {
      label: "Platform fee",
      value: formatCurrency(order.platform_fee_cents ?? 0, order.currency ?? "USD"),
    },
    {
      label: "Total",
      value: formatCurrency(order.total_cents, order.currency ?? "USD"),
    },
  );

  return (
    <div className="mt-3 space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-foreground/60">{row.label}</span>
          <span className="font-medium text-foreground">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function formatCompactOrderFeeSummary(order: {
  fulfillment: string;
  delivery_fee_cents?: number | null;
  platform_fee_cents?: number | null;
  currency?: string | null;
}) {
  const parts: string[] = [];
  if (
    (order.fulfillment === "delivery" || order.fulfillment === "shipping") &&
    (order.delivery_fee_cents ?? 0) > 0
  ) {
    parts.push(
      `${order.fulfillment === "shipping" ? "Shipping" : "Delivery"} ${formatCurrency(
        order.delivery_fee_cents ?? 0,
        order.currency ?? "USD",
      )}`,
    );
  }
  if ((order.platform_fee_cents ?? 0) > 0) {
    parts.push(`Platform ${formatCurrency(order.platform_fee_cents ?? 0, order.currency ?? "USD")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function QueueTransactionCardHeader({
  kindLabel,
  statusLabel,
  primaryLine,
  secondaryLine,
  browseContextLabel,
  supportPressure,
  listing,
  isPressureEasing,
  recoveryDelta,
  pressureLaneMode,
  pressureLaneCount,
  sellerNote,
  rightPrimary,
  rightSecondary,
  onOpenPressureEasing,
  onOpenDeliveryNet,
  onOpenSupportLane,
  children,
}: {
  kindLabel: string;
  statusLabel: string;
  primaryLine: string | null;
  secondaryLine: string;
  browseContextLabel: string | null;
  supportPressure:
    | {
        label: string;
        detail: string;
        toneClass: string;
      }
    | null;
  listing: Listing | null;
  isPressureEasing: boolean;
  recoveryDelta: number;
  pressureLaneMode: "failed" | "queued" | "trust" | null;
  pressureLaneCount: number;
  sellerNote: string | null;
  rightPrimary: string;
  rightSecondary: string | null;
  onOpenPressureEasing: () => void;
  onOpenDeliveryNet: () => void;
  onOpenSupportLane: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
          {kindLabel}
        </p>
        <p className="mt-2 text-base font-semibold capitalize text-foreground">{statusLabel}</p>
        {primaryLine ? (
          <p className="mt-1 text-sm font-medium text-foreground/76">{primaryLine}</p>
        ) : null}
        <p className="mt-1 text-sm text-foreground/68">{secondaryLine}</p>
        {browseContextLabel ? (
          <div className="mt-2 inline-flex rounded-full border border-[#d7c5a6] bg-[#f6eee2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c4b20]">
            {browseContextLabel}
          </div>
        ) : null}
        <TransactionListingPressureInline
          isPressureEasing={isPressureEasing}
          listing={listing}
          pressureLaneCount={pressureLaneCount}
          pressureLaneMode={pressureLaneMode}
          recoveryDelta={recoveryDelta}
          supportPressure={supportPressure}
          onOpenDeliveryNet={onOpenDeliveryNet}
          onOpenPressureEasing={onOpenPressureEasing}
          onOpenSupportLane={onOpenSupportLane}
        />
        {sellerNote ? <p className="mt-2 text-sm text-olive">Seller note: {sellerNote}</p> : null}
        {children}
      </div>
      <div className="text-right">
        <span className="text-sm text-foreground/72">{rightPrimary}</span>
        {rightSecondary ? <p className="mt-1 text-xs text-foreground/56">{rightSecondary}</p> : null}
      </div>
    </div>
  );
}

function QueueTransactionDetailList({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 space-y-1 text-sm text-foreground/70">{children}</div>;
}

function QueueTransactionControls({
  note,
  onNoteChange,
  notePlaceholder,
  loading,
  actions,
}: {
  note: string;
  onNoteChange: (value: string) => void;
  notePlaceholder: string;
  loading: boolean;
  actions: Array<{ key: string; label: string; onClick: () => void }>;
}) {
  return (
    <>
      <SellerResponseNoteEditor
        note={note}
        onChange={onNoteChange}
        placeholder={notePlaceholder}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((action) => (
          <SellerStatusActionChip
            key={action.key}
            disabled={loading}
            onClick={action.onClick}
            loading={loading}
          >
            {action.label}
          </SellerStatusActionChip>
        ))}
      </div>
    </>
  );
}

function TransactionTimelineCard({
  events,
}: {
  events: Array<{
    id: string;
    status: string;
    actor_role: string;
    created_at: string;
    note?: string | null;
  }>;
}) {
  return (
    <>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
        Full Timeline
      </p>
      <div className="mt-3 space-y-3 text-sm text-foreground/72">
        {events.length > 0 ? (
          events.map((event) => (
            <div key={event.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
              <p className="font-medium text-foreground">
                {event.status.replaceAll("_", " ")}
                {" · "}
                {event.actor_role}
              </p>
              <p className="text-xs text-foreground/52">
                {new Date(event.created_at).toLocaleString()}
              </p>
              {event.note ? <p className="mt-1">{event.note}</p> : null}
            </div>
          ))
        ) : (
          <p>No timeline events yet.</p>
        )}
      </div>
    </>
  );
}

function TransactionTimelinePreview({
  events,
}: {
  events: Array<{
    id: string;
    status: string;
    actor_role: string;
    created_at: string;
    note?: string | null;
  }>;
}) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-2xl border border-border bg-background/35 px-3 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
        Timeline
      </p>
      <div className="mt-2 space-y-2 text-sm text-foreground/70">
        {events.map((event) => (
          <div key={event.id}>
            <p className="font-medium text-foreground">
              {event.status.replaceAll("_", " ")}
              {" · "}
              {event.actor_role}
            </p>
            <p className="text-xs text-foreground/52">
              {new Date(event.created_at).toLocaleString()}
            </p>
            {event.note ? <p>{event.note}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SellerResponseNoteEditor({
  note,
  onChange,
  placeholder,
}: {
  note: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/48">
        Seller Response Note
      </span>
      <textarea
        className="min-h-24 w-full rounded-2xl border border-border bg-background/35 px-4 py-3 text-sm outline-none transition focus:border-accent"
        value={note}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function PressurePreviewRow({
  lane,
  laneClassName,
  onLaneClick,
  primaryClassName,
  primaryLabel,
  onPrimaryClick,
  trendLabel,
  tuneLabel,
  onTuneClick,
}: {
  lane: string;
  laneClassName: string;
  onLaneClick: () => void;
  primaryClassName: string;
  primaryLabel: string;
  onPrimaryClick: () => void;
  trendLabel?: string | null;
  tuneLabel?: string | null;
  onTuneClick?: (() => void) | null;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <button
        className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${laneClassName}`}
        onClick={onLaneClick}
        type="button"
      >
        {lane}
      </button>
      <button
        className={`${primaryClassName} max-w-full whitespace-normal text-left`}
        onClick={onPrimaryClick}
        type="button"
      >
        {primaryLabel}
      </button>
      {trendLabel ? (
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${getListingPreviewRetentionTrendToneClass(
            trendLabel,
          )}`}
        >
          {trendLabel}
        </span>
      ) : null}
      {tuneLabel && onTuneClick ? (
        <button
          className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-accent hover:text-accent"
          onClick={onTuneClick}
          type="button"
        >
          {tuneLabel}
        </button>
      ) : null}
    </div>
  );
}

function DeliveryNetActionButton({
  recoveryDelta,
  onClick,
  tone = "detail",
}: {
  recoveryDelta: number;
  onClick: () => void;
  tone?: "compact" | "detail";
}) {
  const className =
    tone === "compact"
      ? `text-[11px] font-semibold uppercase tracking-[0.14em] transition hover:text-accent ${
          recoveryDelta > 0
            ? "text-lime-800"
            : recoveryDelta < 0
              ? "text-rose-700"
              : "text-foreground/52"
        }`
      : `text-left text-xs leading-5 transition hover:text-accent ${
          recoveryDelta > 0
            ? "text-lime-800/90"
            : recoveryDelta < 0
              ? "text-rose-700/90"
              : "text-foreground/56"
        }`;

  return (
    <button
      className={className}
      onClick={onClick}
      type="button"
    >
      Delivery net 7d: {recoveryDelta > 0 ? `+${recoveryDelta}` : recoveryDelta}
    </button>
  );
}

function PressureEasingActionBlock({
  onClick,
  description,
  tone = "badge",
}: {
  onClick: () => void;
  description?: string;
  tone?: "badge" | "compact" | "detail";
}) {
  if (tone === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-800 transition hover:border-accent hover:text-accent"
          onClick={onClick}
          type="button"
        >
          Pressure easing
        </button>
        {description ? (
          <button
            className="text-[11px] text-foreground/58 transition hover:text-accent"
            onClick={onClick}
            type="button"
          >
            {description}
          </button>
        ) : null}
      </div>
    );
  }

  if (tone === "detail") {
    return (
      <button
        className="text-left text-xs leading-5 text-lime-800/90 transition hover:text-accent"
        onClick={onClick}
        type="button"
      >
        {description ?? "Recent sends recovered without active failed or queued alerts."}
      </button>
    );
  }

  return (
    <button
      className="rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-800 transition hover:border-accent hover:text-accent"
      onClick={onClick}
      type="button"
    >
      Pressure easing
    </button>
  );
}

function SupportPressureActionBlock({
  label,
  detail,
  toneClass,
  action,
  onActionClick,
  tone = "detail",
}: {
  label: string;
  detail: string;
  toneClass: string;
  action: { mode: "failed" | "queued" | "trust"; count: number } | null;
  onActionClick: () => void;
  tone?: "compact" | "detail";
}) {
  const wrapperClass =
    tone === "compact"
      ? "flex flex-wrap items-center gap-2"
      : "flex flex-wrap items-center gap-2 text-xs leading-5 text-foreground/56";
  const detailClass = tone === "compact" ? "text-[11px] text-foreground/58" : undefined;

  return (
    <div className={wrapperClass}>
      {tone === "compact" ? (
        <span
          className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass}`}
        >
          {label}
        </span>
      ) : null}
      <span className={detailClass}>{detail}</span>
      {action ? (
        <button
          className={`rounded-full border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition hover:border-accent hover:text-accent ${
            action.mode === "failed"
              ? "border-red-200 text-red-700"
              : action.mode === "queued"
                ? "border-amber-200 text-amber-800"
                : "border-rose-200 text-rose-700"
          }`}
          onClick={onActionClick}
          type="button"
        >
          {getListingSupportPressureLaneLabel(action.mode)}
          {" · "}
          {getListingSupportPressureLaneCountLabel(action.mode, action.count)}
        </button>
      ) : null}
    </div>
  );
}

function TuneRoleActionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="w-fit rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
      onClick={onClick}
      type="button"
    >
      Tune Role
    </button>
  );
}

function LeakageActionRow({
  label,
  crossSellerPriceCount,
  crossSellerSearchCount,
  crossSellerLocalCount,
  tuneLabel,
  onTuneClick,
}: {
  label: string | null;
  crossSellerPriceCount: number;
  crossSellerSearchCount: number;
  crossSellerLocalCount: number;
  tuneLabel?: string | null;
  onTuneClick?: (() => void) | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label ? (
        <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">
          {label}
        </span>
      ) : null}
      {crossSellerPriceCount > 0 ? (
        <span className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/68">
          Price-led · {crossSellerPriceCount}
        </span>
      ) : null}
      {crossSellerSearchCount > 0 ? (
        <span className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/68">
          Search-led · {crossSellerSearchCount}
        </span>
      ) : null}
      {crossSellerLocalCount > 0 ? (
        <span className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/68">
          Local-fit · {crossSellerLocalCount}
        </span>
      ) : null}
      {tuneLabel && onTuneClick ? (
        <button
          className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
          onClick={onTuneClick}
          type="button"
        >
          {tuneLabel}
        </button>
      ) : null}
    </div>
  );
}

function RetentionLaneActions({
  sameSellerRecentCount,
  crossSellerRecentCount,
  sameSellerCount,
  crossSellerCount,
  onOpenRetainedLane,
  onOpenBranchedLane,
}: {
  sameSellerRecentCount: number;
  crossSellerRecentCount: number;
  sameSellerCount: number;
  crossSellerCount: number;
  onOpenRetainedLane: () => void;
  onOpenBranchedLane: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-xs text-foreground/58">
        Last 7d: {sameSellerRecentCount} retained · {crossSellerRecentCount} branched
      </p>
      {sameSellerCount > 0 ? (
        <button
          className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-800 transition hover:border-accent hover:text-accent"
          onClick={onOpenRetainedLane}
          type="button"
        >
          Open Retained Lane
        </button>
      ) : null}
      {crossSellerCount > 0 ? (
        <button
          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700 transition hover:border-accent hover:text-accent"
          onClick={onOpenBranchedLane}
          type="button"
        >
          Open Branched Lane
        </button>
      ) : null}
    </div>
  );
}

function matchesDeliveryRecency(value: string, filter: "today" | "7d" | "all") {
  if (filter === "all") {
    return true;
  }

  const createdAt = new Date(value).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (filter === "today") {
    return now - createdAt <= dayMs;
  }

  return now - createdAt <= dayMs * 7;
}
