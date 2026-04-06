"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  type AdminUser,
  type BookingAdminSupportUpdateInput,
  type Listing,
  type NotificationDelivery,
  type OrderAdminSupportUpdateInput,
  type ReviewModerationItem,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type DeliveryStatusFilter = "all" | "failed" | "queued" | "sent";
type DeliveryChannelFilter = "all" | "email" | "push";
type DeliveryKindFilter = "all" | "order" | "booking";
type DeliveryRecencyFilter = "all" | "today" | "week";
type DeliveryTrustFilter = "all" | "trust_driven";
type DeliveryOwnershipFilter = "all" | "mine" | "unassigned" | "assigned";
type DeliveryListingHealthFilter = "all" | "softening" | "recent_pricing" | "trust_flagged";
type DeliveryPreset = "needs_attention" | "failed_only" | "queued_only" | "push_failures" | "trust_driven";
type ExecutionMode = "best_effort" | "atomic";
type ListingAdjustmentType = "pricing" | "local-fit" | "booking" | "fulfillment" | "other";
type ListingRetentionTrendKey = "improving" | "softening" | "stable" | "no-signal";
type ListingOpsContext = {
  listing: Listing;
  adjustmentType: ListingAdjustmentType;
  adjustmentSummary: string | null;
  adjustmentAt: string | null;
  retentionTrendLabel: string;
  retentionTrendKey: ListingRetentionTrendKey;
  sameSellerCount: number;
  crossSellerCount: number;
  sameSellerRecentCount: number;
  crossSellerRecentCount: number;
  sameSellerPostAdjustmentCount: number;
  crossSellerPostAdjustmentCount: number;
};
const TRUST_ESCALATION_MARKER = "Trust escalation trigger:";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString();
}

function formatAgeLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  const hours = Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60));
  if (hours < 1) {
    return "<1h";
  }
  if (hours < 24) {
    return `${Math.floor(hours)}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function isRecentWithinDays(value: string | null | undefined, days: number) {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return Date.now() - parsed.getTime() <= days * 24 * 60 * 60 * 1000;
}

function truncateId(value: string) {
  return value.slice(0, 8);
}

function titleCaseFilterLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBuyerBrowseContextLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isLocalDrivenBrowseContext(value: string | null | undefined) {
  return formatBuyerBrowseContextLabel(value)?.toLowerCase().includes("local only") ?? false;
}

function isSearchDrivenBrowseContext(value: string | null | undefined) {
  return formatBuyerBrowseContextLabel(value)?.toLowerCase().includes('search: "') ?? false;
}

function isPriceDrivenBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return normalized?.includes("lowest price") || normalized?.includes("highest price") || false;
}

function isSameSellerFollowOnBrowseContext(value: string | null | undefined) {
  return formatBuyerBrowseContextLabel(value)?.toLowerCase().includes("same seller follow-on") ?? false;
}

function isCrossSellerFollowOnBrowseContext(value: string | null | undefined) {
  const normalized = formatBuyerBrowseContextLabel(value)?.toLowerCase();
  return (
    normalized?.includes("cross-seller follow-on") ||
    normalized?.includes("cross seller follow-on") ||
    false
  );
}

function getListingAdjustmentTimestamp(listing: Listing) {
  if (!listing.last_operating_adjustment_at) {
    return null;
  }

  const parsed = new Date(listing.last_operating_adjustment_at).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getListingAdjustmentType(summary: string | null | undefined): ListingAdjustmentType {
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

function getListingRetentionTrend(input: {
  sameSellerCount: number;
  crossSellerCount: number;
  sameSellerRecentCount: number;
  crossSellerRecentCount: number;
  sameSellerPostAdjustmentCount: number;
  crossSellerPostAdjustmentCount: number;
}) {
  const totalPostAdjustment = input.sameSellerPostAdjustmentCount + input.crossSellerPostAdjustmentCount;
  if (totalPostAdjustment > 0) {
    const totalAllTime = input.sameSellerCount + input.crossSellerCount;
    const overallRetentionRate = totalAllTime > 0 ? input.sameSellerCount / totalAllTime : 0;
    const postAdjustmentRetentionRate = input.sameSellerPostAdjustmentCount / totalPostAdjustment;
    if (postAdjustmentRetentionRate - overallRetentionRate >= 0.15) {
      return { label: "Improving since change", key: "improving" as const };
    }
    if (overallRetentionRate - postAdjustmentRetentionRate >= 0.15) {
      return { label: "Softening since change", key: "softening" as const };
    }
    return { label: "Stable since change", key: "stable" as const };
  }

  const totalAllTime = input.sameSellerCount + input.crossSellerCount;
  const totalRecent = input.sameSellerRecentCount + input.crossSellerRecentCount;
  if (totalRecent === 0) {
    return { label: "No recent signal", key: "no-signal" as const };
  }
  if (totalAllTime === 0) {
    return { label: "Recent signal only", key: "stable" as const };
  }

  const overallRetentionRate = input.sameSellerCount / totalAllTime;
  const recentRetentionRate = input.sameSellerRecentCount / totalRecent;
  if (recentRetentionRate - overallRetentionRate >= 0.15) {
    return { label: "Improving recently", key: "improving" as const };
  }
  if (overallRetentionRate - recentRetentionRate >= 0.15) {
    return { label: "Softening recently", key: "softening" as const };
  }
  return { label: "Stable recently", key: "stable" as const };
}

function getListingTrendToneClass(key: ListingRetentionTrendKey) {
  if (key === "improving") {
    return "text-olive";
  }
  if (key === "softening") {
    return "text-danger";
  }
  if (key === "stable") {
    return "text-foreground/68";
  }
  return "text-foreground/52";
}

function matchesDeliveryListingHealthFilter(args: {
  listingHealthFilter: DeliveryListingHealthFilter;
  listingOpsContext: ListingOpsContext | null;
  sellerTrustCount: number;
}) {
  if (args.listingHealthFilter === "all") {
    return true;
  }

  if (!args.listingOpsContext) {
    return false;
  }

  if (args.listingHealthFilter === "softening") {
    return args.listingOpsContext.retentionTrendKey === "softening";
  }

  if (args.listingHealthFilter === "recent_pricing") {
    return (
      args.listingOpsContext.adjustmentType === "pricing" &&
      isRecentWithinDays(args.listingOpsContext.adjustmentAt, 7)
    );
  }

  return args.sellerTrustCount > 0;
}

function formatAdminLabel(admin: AdminUser) {
  const primary = admin.full_name?.trim() || admin.username?.trim() || admin.email?.trim() || truncateId(admin.id);
  const secondary = admin.full_name?.trim()
    ? admin.email?.trim() || admin.username?.trim() || truncateId(admin.id)
    : admin.email?.trim() || null;
  const identity = secondary ? `${primary} · ${secondary}` : primary;
  return admin.role?.trim() ? `${identity} · ${admin.role.trim()}` : identity;
}

function matchesRecency(delivery: NotificationDelivery, recency: DeliveryRecencyFilter) {
  if (recency === "all") {
    return true;
  }

  const createdAt = new Date(delivery.created_at).getTime();
  if (Number.isNaN(createdAt)) {
    return false;
  }

  const hours = (Date.now() - createdAt) / (1000 * 60 * 60);
  if (recency === "today") {
    return hours <= 24;
  }

  return hours <= 24 * 7;
}

export function DeliveryOpsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [reviewReports, setReviewReports] = useState<ReviewModerationItem[]>([]);
  const [transactionSellerByKey, setTransactionSellerByKey] = useState<Record<string, string>>({});
  const [transactionListingByKey, setTransactionListingByKey] = useState<Record<string, string>>({});
  const [transactionBrowseContextByKey, setTransactionBrowseContextByKey] = useState<Record<string, string | null>>({});
  const [transactionSupportByKey, setTransactionSupportByKey] = useState<
    Record<string, { trustDriven: boolean; assigned: boolean; escalated: boolean; assigneeUserId: string | null }>
  >({});
  const [preset, setPreset] = useState<DeliveryPreset>("needs_attention");
  const [statusFilter, setStatusFilter] = useState<DeliveryStatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<DeliveryChannelFilter>("all");
  const [kindFilter, setKindFilter] = useState<DeliveryKindFilter>("all");
  const [recencyFilter, setRecencyFilter] = useState<DeliveryRecencyFilter>("week");
  const [trustFilter, setTrustFilter] = useState<DeliveryTrustFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<DeliveryOwnershipFilter>("all");
  const [listingHealthFilter, setListingHealthFilter] = useState<DeliveryListingHealthFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("best_effort");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [pendingBulkRetry, setPendingBulkRetry] = useState<{ targetCount: number; unchangedCount: number } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [currentAdminUserId, setCurrentAdminUserId] = useState<string | null>(null);
  const [supportUpdatingKey, setSupportUpdatingKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [sliceLinkFeedback, setSliceLinkFeedback] = useState<string | null>(null);

  useEffect(() => {
    const nextPreset = searchParams.get("preset");
    const nextStatus = searchParams.get("status");
    const nextChannel = searchParams.get("channel");
    const nextKind = searchParams.get("kind");
    const nextRecency = searchParams.get("recency");
    const nextTrust = searchParams.get("trust");
    const nextOwnership = searchParams.get("owner");
    const nextListingHealth = searchParams.get("listingHealth");
    const nextQuery = searchParams.get("q");
    const nextMode = searchParams.get("mode");

    setPreset(
      nextPreset === "needs_attention" ||
        nextPreset === "failed_only" ||
        nextPreset === "queued_only" ||
        nextPreset === "push_failures" ||
        nextPreset === "trust_driven"
        ? nextPreset
        : "needs_attention",
    );
    setStatusFilter(
      nextStatus === "all" || nextStatus === "failed" || nextStatus === "queued" || nextStatus === "sent"
        ? nextStatus
        : "all",
    );
    setChannelFilter(
      nextChannel === "all" || nextChannel === "email" || nextChannel === "push"
        ? nextChannel
        : "all",
    );
    setKindFilter(
      nextKind === "all" || nextKind === "order" || nextKind === "booking" ? nextKind : "all",
    );
    setRecencyFilter(
      nextRecency === "all" || nextRecency === "today" || nextRecency === "week"
        ? nextRecency
        : "week",
    );
    setTrustFilter(nextTrust === "trust_driven" ? "trust_driven" : "all");
    setOwnershipFilter(
      nextOwnership === "mine" ||
        nextOwnership === "unassigned" ||
        nextOwnership === "assigned"
        ? nextOwnership
        : "all",
    );
    setListingHealthFilter(
      nextListingHealth === "softening" ||
        nextListingHealth === "recent_pricing" ||
        nextListingHealth === "trust_flagged"
        ? nextListingHealth
        : "all",
    );
    setSearchQuery(nextQuery ?? "");
    setExecutionMode(nextMode === "atomic" ? "atomic" : "best_effort");
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "needs_attention") {
      params.set("preset", preset);
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (channelFilter !== "all") {
      params.set("channel", channelFilter);
    }
    if (kindFilter !== "all") {
      params.set("kind", kindFilter);
    }
    if (recencyFilter !== "week") {
      params.set("recency", recencyFilter);
    }
    if (trustFilter !== "all") {
      params.set("trust", trustFilter);
    }
    if (ownershipFilter !== "all") {
      params.set("owner", ownershipFilter);
    }
    if (listingHealthFilter !== "all") {
      params.set("listingHealth", listingHealthFilter);
    }
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }
    if (executionMode !== "best_effort") {
      params.set("mode", executionMode);
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `?${nextQuery}` : "/admin/deliveries", { scroll: false });
    }
  }, [channelFilter, executionMode, kindFilter, listingHealthFilter, ownershipFilter, preset, recencyFilter, router, searchParams, searchQuery, statusFilter, trustFilter]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await restoreAdminSession();
        if (!session) {
          throw new Error("Admin session not available. Sign in through the seller workspace first.");
        }
        setCurrentAdminUserId(session.user_id);
        const [data, transactions, reports] = await Promise.all([
          api.loadAdminNotificationDeliveries(session.access_token),
          api.loadAdminTransactions(session.access_token),
          api.listAdminReviewReports(session.access_token, "all"),
        ]);
        if (!cancelled) {
          setAdmins(data.admins);
          setDeliveries(data.deliveries);
          setListings(transactions.listings);
          setTransactionSellerByKey({
            ...Object.fromEntries(
              transactions.orders.map((order) => [`order:${order.id}`, order.seller_id]),
            ),
            ...Object.fromEntries(
              transactions.bookings.map((booking) => [`booking:${booking.id}`, booking.seller_id]),
            ),
          });
          setTransactionListingByKey({
            ...Object.fromEntries(
              transactions.orders.map((order) => [`order:${order.id}`, order.items?.[0]?.listing_id ?? ""]),
            ),
            ...Object.fromEntries(
              transactions.bookings.map((booking) => [`booking:${booking.id}`, booking.listing_id ?? ""]),
            ),
          });
          setTransactionBrowseContextByKey({
            ...Object.fromEntries(
              transactions.orders.map((order) => [`order:${order.id}`, order.buyer_browse_context ?? null]),
            ),
            ...Object.fromEntries(
              transactions.bookings.map((booking) => [`booking:${booking.id}`, booking.buyer_browse_context ?? null]),
            ),
          });
          setTransactionSupportByKey({
            ...Object.fromEntries(
              transactions.orders.map((order) => [
                `order:${order.id}`,
                {
                  trustDriven: order.admin_handoff_note?.includes(TRUST_ESCALATION_MARKER) ?? false,
                  assigned: Boolean(order.admin_assignee_user_id),
                  escalated: Boolean(order.admin_is_escalated),
                  assigneeUserId: order.admin_assignee_user_id ?? null,
                },
              ]),
            ),
            ...Object.fromEntries(
              transactions.bookings.map((booking) => [
                `booking:${booking.id}`,
                {
                  trustDriven: booking.admin_handoff_note?.includes(TRUST_ESCALATION_MARKER) ?? false,
                  assigned: Boolean(booking.admin_assignee_user_id),
                  escalated: Boolean(booking.admin_is_escalated),
                  assigneeUserId: booking.admin_assignee_user_id ?? null,
                },
              ]),
            ),
          });
          setReviewReports(reports);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof ApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
                : "Unable to load admin deliveries.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyPreset(nextPreset: DeliveryPreset) {
    setPreset(nextPreset);
    setListingHealthFilter("all");
    if (nextPreset === "failed_only") {
      setStatusFilter("failed");
      setChannelFilter("all");
      setOwnershipFilter("all");
    } else if (nextPreset === "queued_only") {
      setStatusFilter("queued");
      setChannelFilter("all");
      setOwnershipFilter("all");
    } else if (nextPreset === "push_failures") {
      setStatusFilter("failed");
      setChannelFilter("push");
      setTrustFilter("all");
      setOwnershipFilter("all");
    } else if (nextPreset === "trust_driven") {
      setStatusFilter("all");
      setChannelFilter("all");
      setTrustFilter("trust_driven");
      setOwnershipFilter("all");
    } else {
      setStatusFilter("all");
      setChannelFilter("all");
      setTrustFilter("all");
      setOwnershipFilter("all");
    }
  }

  function applyQueueState(next: {
    preset?: DeliveryPreset;
    status?: DeliveryStatusFilter;
    channel?: DeliveryChannelFilter;
    kind?: DeliveryKindFilter;
    recency?: DeliveryRecencyFilter;
    trust?: DeliveryTrustFilter;
    ownership?: DeliveryOwnershipFilter;
    listingHealth?: DeliveryListingHealthFilter;
  }) {
    setPreset(next.preset ?? "needs_attention");
    setStatusFilter(next.status ?? "all");
    setChannelFilter(next.channel ?? "all");
    setKindFilter(next.kind ?? "all");
    setRecencyFilter(next.recency ?? "week");
    setTrustFilter(next.trust ?? "all");
    setOwnershipFilter(next.ownership ?? "all");
    setListingHealthFilter(next.listingHealth ?? "all");
  }

  const counts = useMemo(
    () => ({
      total: deliveries.length,
      failed: deliveries.filter((delivery) => delivery.delivery_status === "failed").length,
      queued: deliveries.filter((delivery) => delivery.delivery_status === "queued").length,
      sent: deliveries.filter((delivery) => delivery.delivery_status === "sent").length,
      email: deliveries.filter((delivery) => delivery.channel === "email").length,
      push: deliveries.filter((delivery) => delivery.channel === "push").length,
      order: deliveries.filter((delivery) => delivery.transaction_kind === "order").length,
      booking: deliveries.filter((delivery) => delivery.transaction_kind === "booking").length,
      trustDriven: deliveries.filter(
        (delivery) => transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven,
      ).length,
      trustDrivenOpen: deliveries.filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          delivery.delivery_status !== "sent",
      ).length,
      trustDrivenAssigned: deliveries.filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.assigned,
      ).length,
      trustDrivenAssignedToMe: currentAdminUserId
        ? deliveries.filter(
            (delivery) =>
              transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
              transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.assigneeUserId === currentAdminUserId,
          ).length
        : 0,
      trustDrivenUnassigned: deliveries.filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          !transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.assigned,
      ).length,
      trustDrivenEscalated: deliveries.filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.escalated,
      ).length,
      trustDrivenSent7d: deliveries.filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          delivery.delivery_status === "sent" &&
          isRecentWithinDays(delivery.sent_at ?? delivery.created_at, 7),
      ).length,
    }),
    [currentAdminUserId, deliveries, transactionSupportByKey],
  );

  const listingsById = useMemo(
    () => new Map(listings.map((listing) => [listing.id, listing])),
    [listings],
  );

  const listingOpsContextByTransactionKey = useMemo(() => {
    const transactionKeysByListingId = new Map<string, string[]>();
    for (const [transactionKey, listingId] of Object.entries(transactionListingByKey)) {
      if (!listingId) {
        continue;
      }
      const bucket = transactionKeysByListingId.get(listingId);
      if (bucket) {
        bucket.push(transactionKey);
      } else {
        transactionKeysByListingId.set(listingId, [transactionKey]);
      }
    }

    const contextByTransactionKey = new Map<string, ListingOpsContext>();
    for (const [listingId, transactionKeys] of transactionKeysByListingId) {
      const listing = listingsById.get(listingId);
      if (!listing) {
        continue;
      }

      let sameSellerCount = 0;
      let crossSellerCount = 0;
      let sameSellerRecentCount = 0;
      let crossSellerRecentCount = 0;
      let sameSellerPostAdjustmentCount = 0;
      let crossSellerPostAdjustmentCount = 0;
      const adjustmentTimestamp = getListingAdjustmentTimestamp(listing);

      for (const transactionKey of transactionKeys) {
        const browseContext = transactionBrowseContextByKey[transactionKey];
        const delivery = deliveries.find(
          (entry) => `${entry.transaction_kind}:${entry.transaction_id}` === transactionKey,
        );
        const createdAt = delivery?.created_at ?? null;
        const createdTimestamp = createdAt ? new Date(createdAt).getTime() : NaN;
        const isRecent = isRecentWithinDays(createdAt, 7);
        const isPostAdjustment =
          adjustmentTimestamp !== null &&
          !Number.isNaN(createdTimestamp) &&
          createdTimestamp >= adjustmentTimestamp;

        if (isSameSellerFollowOnBrowseContext(browseContext)) {
          sameSellerCount += 1;
          if (isRecent) {
            sameSellerRecentCount += 1;
          }
          if (isPostAdjustment) {
            sameSellerPostAdjustmentCount += 1;
          }
        }
        if (isCrossSellerFollowOnBrowseContext(browseContext)) {
          crossSellerCount += 1;
          if (isRecent) {
            crossSellerRecentCount += 1;
          }
          if (isPostAdjustment) {
            crossSellerPostAdjustmentCount += 1;
          }
        }
      }

      const trend = getListingRetentionTrend({
        sameSellerCount,
        crossSellerCount,
        sameSellerRecentCount,
        crossSellerRecentCount,
        sameSellerPostAdjustmentCount,
        crossSellerPostAdjustmentCount,
      });

      const context: ListingOpsContext = {
        listing,
        adjustmentType: getListingAdjustmentType(listing.last_operating_adjustment_summary),
        adjustmentSummary: listing.last_operating_adjustment_summary ?? null,
        adjustmentAt: listing.last_operating_adjustment_at ?? null,
        retentionTrendLabel: trend.label,
        retentionTrendKey: trend.key,
        sameSellerCount,
        crossSellerCount,
        sameSellerRecentCount,
        crossSellerRecentCount,
        sameSellerPostAdjustmentCount,
        crossSellerPostAdjustmentCount,
      };

      for (const transactionKey of transactionKeys) {
        contextByTransactionKey.set(transactionKey, context);
      }
    }

    return contextByTransactionKey;
  }, [deliveries, listingsById, transactionBrowseContextByKey, transactionListingByKey]);

  const getSellerTrustSummary = useMemo(
    () => (sellerId: string | null | undefined) => {
      if (!sellerId) {
        return { total: 0, open: 0, escalated: 0, hidden: 0 };
      }
      const sellerReports = reviewReports.filter((report) => report.seller_id === sellerId);
      return {
        total: sellerReports.length,
        open: sellerReports.filter((report) => report.status === "open").length,
        escalated: sellerReports.filter((report) => report.is_escalated).length,
        hidden: sellerReports.filter((report) => report.review.is_hidden).length,
      };
    },
    [reviewReports],
  );

  const listingHealthCounts = useMemo(() => {
    const seen = new Set<string>();
    let softening = 0;
    let recentPricing = 0;
    let trustFlagged = 0;

    for (const delivery of deliveries) {
      const transactionKey = `${delivery.transaction_kind}:${delivery.transaction_id}`;
      const context = listingOpsContextByTransactionKey.get(transactionKey);
      const sellerId = transactionSellerByKey[transactionKey];
      if (!context || seen.has(context.listing.id)) {
        continue;
      }
      seen.add(context.listing.id);

      if (context.retentionTrendKey === "softening") {
        softening += 1;
      }
      if (
        context.adjustmentType === "pricing" &&
        isRecentWithinDays(context.adjustmentAt, 7)
      ) {
        recentPricing += 1;
      }
      if (getSellerTrustSummary(sellerId).total > 0) {
        trustFlagged += 1;
      }
    }

    return {
      softening,
      recentPricing,
      trustFlagged,
    };
  }, [deliveries, getSellerTrustSummary, listingOpsContextByTransactionKey, transactionSellerByKey]);

  const listingHealthDiagnosticCounts = useMemo(() => {
    const baseDeliveries = deliveries.filter((delivery) => {
      const transactionKey = `${delivery.transaction_kind}:${delivery.transaction_id}`;
      const listingOpsContext = listingOpsContextByTransactionKey.get(transactionKey) ?? null;
      const sellerTrustCount = getSellerTrustSummary(transactionSellerByKey[transactionKey]).total;

      if (listingHealthFilter !== "all") {
        return matchesDeliveryListingHealthFilter({
          listingHealthFilter,
          listingOpsContext,
          sellerTrustCount,
        });
      }

      return (
        matchesDeliveryListingHealthFilter({
          listingHealthFilter: "softening",
          listingOpsContext,
          sellerTrustCount,
        }) ||
        matchesDeliveryListingHealthFilter({
          listingHealthFilter: "recent_pricing",
          listingOpsContext,
          sellerTrustCount,
        }) ||
        matchesDeliveryListingHealthFilter({
          listingHealthFilter: "trust_flagged",
          listingOpsContext,
          sellerTrustCount,
        })
      );
    });

    return {
      failed: baseDeliveries.filter((delivery) => delivery.delivery_status === "failed").length,
      queued: baseDeliveries.filter((delivery) => delivery.delivery_status === "queued").length,
      trustDriven: baseDeliveries.filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven,
      ).length,
    };
  }, [deliveries, getSellerTrustSummary, listingHealthFilter, listingOpsContextByTransactionKey, transactionSellerByKey, transactionSupportByKey]);

  const filteredDeliveries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return deliveries.filter((delivery) => {
      const transactionKey = `${delivery.transaction_kind}:${delivery.transaction_id}`;
      const supportState = transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`];
      const listingOpsContext = listingOpsContextByTransactionKey.get(transactionKey) ?? null;
      const sellerId = transactionSellerByKey[transactionKey];

      if (preset === "needs_attention" && !["failed", "queued"].includes(delivery.delivery_status)) {
        return false;
      }
      if (preset === "failed_only" && delivery.delivery_status !== "failed") {
        return false;
      }
      if (preset === "queued_only" && delivery.delivery_status !== "queued") {
        return false;
      }
      if (preset === "push_failures" && (delivery.delivery_status !== "failed" || delivery.channel !== "push")) {
        return false;
      }
      if (!supportState?.trustDriven && preset === "trust_driven") {
        return false;
      }

      if (statusFilter !== "all" && delivery.delivery_status !== statusFilter) {
        return false;
      }
      if (channelFilter !== "all" && delivery.channel !== channelFilter) {
        return false;
      }
      if (kindFilter !== "all" && delivery.transaction_kind !== kindFilter) {
        return false;
      }
      if (!matchesRecency(delivery, recencyFilter)) {
        return false;
      }
      if (trustFilter === "trust_driven" && !supportState?.trustDriven) {
        return false;
      }
      if (ownershipFilter === "mine" && supportState?.assigneeUserId !== currentAdminUserId) {
        return false;
      }
      if (ownershipFilter === "unassigned" && supportState?.assigned) {
        return false;
      }
      if (ownershipFilter === "assigned" && !supportState?.assigned) {
        return false;
      }

      if (listingHealthFilter !== "all") {
        if (
          !matchesDeliveryListingHealthFilter({
            listingHealthFilter,
            listingOpsContext,
            sellerTrustCount: getSellerTrustSummary(sellerId).total,
          })
        ) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        delivery.id,
        delivery.event_id,
        delivery.recipient_user_id,
        delivery.transaction_kind,
        delivery.transaction_id,
        delivery.channel,
        delivery.delivery_status,
        delivery.failure_reason,
        JSON.stringify(delivery.payload),
        listingOpsContext?.listing.title,
        listingOpsContext?.adjustmentSummary,
        listingOpsContext?.adjustmentType,
        listingOpsContext?.retentionTrendLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [channelFilter, currentAdminUserId, deliveries, getSellerTrustSummary, kindFilter, listingHealthFilter, listingOpsContextByTransactionKey, ownershipFilter, preset, recencyFilter, searchQuery, statusFilter, transactionSellerByKey, transactionSupportByKey, trustFilter]);

  const retryableDeliveriesInView = useMemo(
    () =>
      filteredDeliveries.filter(
        (delivery) => delivery.delivery_status === "failed" || delivery.delivery_status === "queued",
      ),
    [filteredDeliveries],
  );
  const supportAdmin = useMemo(
    () => admins.find((admin) => admin.role?.toLowerCase() === "support") ?? null,
    [admins],
  );
  const trustAdmin = useMemo(
    () => admins.find((admin) => admin.role?.toLowerCase() === "trust") ?? null,
    [admins],
  );

  const trustAgingSummary = useMemo(() => {
    const oldestTrustDrivenUnassigned = deliveries
      .filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          !transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.assigned &&
          delivery.delivery_status !== "sent",
      )
      .sort((left, right) => (left.created_at ?? "").localeCompare(right.created_at ?? ""))[0];

    const oldestTrustDrivenAssigned = deliveries
      .filter(
        (delivery) =>
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.trustDriven &&
          transactionSupportByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`]?.assigned &&
          delivery.delivery_status !== "sent",
      )
      .sort((left, right) => (left.created_at ?? "").localeCompare(right.created_at ?? ""))[0];

    return {
      oldestTrustDrivenUnassigned,
      oldestTrustDrivenAssigned,
    };
  }, [deliveries, transactionSupportByKey]);
  const activeSliceSummary = useMemo(() => {
    const parts: string[] = [];

    if (preset !== "needs_attention") {
      parts.push(titleCaseFilterLabel(preset));
    }
    if (statusFilter !== "all") {
      parts.push(`Status: ${titleCaseFilterLabel(statusFilter)}`);
    }
    if (channelFilter !== "all") {
      parts.push(`Channel: ${titleCaseFilterLabel(channelFilter)}`);
    }
    if (kindFilter !== "all") {
      parts.push(`Type: ${titleCaseFilterLabel(kindFilter)}`);
    }
    if (recencyFilter !== "week") {
      parts.push(`Recency: ${titleCaseFilterLabel(recencyFilter)}`);
    }
    if (trustFilter !== "all") {
      parts.push("Trust-Driven");
    }
    if (ownershipFilter !== "all") {
      parts.push(`Owner: ${titleCaseFilterLabel(ownershipFilter)}`);
    }
    if (listingHealthFilter !== "all") {
      parts.push(`Listing Health: ${titleCaseFilterLabel(listingHealthFilter)}`);
    }
    if (searchQuery.trim()) {
      parts.push(`Search: "${searchQuery.trim()}"`);
    }

    return parts.length > 0 ? parts.join(" · ") : "Needs attention in the last 7 days";
  }, [channelFilter, kindFilter, listingHealthFilter, ownershipFilter, preset, recencyFilter, searchQuery, statusFilter, trustFilter]);
  const isDefaultSlice =
    preset === "needs_attention" &&
    statusFilter === "all" &&
    channelFilter === "all" &&
    kindFilter === "all" &&
    recencyFilter === "week" &&
    trustFilter === "all" &&
    ownershipFilter === "all" &&
    listingHealthFilter === "all" &&
    !searchQuery.trim();

  async function copyCurrentSliceLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setSliceLinkFeedback("Link copied");
      window.setTimeout(() => setSliceLinkFeedback(null), 2000);
    } catch {
      setSliceLinkFeedback("Copy failed");
      window.setTimeout(() => setSliceLinkFeedback(null), 2000);
    }
  }

  async function reloadDeliveries(accessToken: string) {
    const data = await api.loadAdminNotificationDeliveries(accessToken);
    setAdmins(data.admins);
    setDeliveries(data.deliveries);
  }

  async function retryDelivery(delivery: NotificationDelivery) {
    const session = await restoreAdminSession();
    if (!session) {
      setFeedback({ tone: "error", message: "Admin session not available. Sign in again." });
      return;
    }

    setRetryingId(delivery.id);
    setFeedback(null);
    try {
      const updated = await api.retryAdminNotificationDelivery(delivery.id, session.access_token);
      setDeliveries((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFeedback({
        tone: "success",
        message: `Retried ${delivery.channel} delivery ${truncateId(delivery.id)}.`,
      });
    } catch (retryError) {
      setFeedback({
        tone: "error",
        message:
          retryError instanceof ApiError
            ? retryError.message
            : retryError instanceof Error
              ? retryError.message
              : "Unable to retry delivery.",
      });
    } finally {
      setRetryingId(null);
    }
  }

  async function updateLinkedTransactionSupport(
    delivery: NotificationDelivery,
    payload: OrderAdminSupportUpdateInput | BookingAdminSupportUpdateInput,
    actionLabel: string,
  ) {
    const session = await restoreAdminSession();
    if (!session) {
      setFeedback({ tone: "error", message: "Admin session not available. Sign in again." });
      return;
    }

    const actionKey = `${delivery.transaction_kind}:${delivery.transaction_id}:${actionLabel}`;
    setSupportUpdatingKey(actionKey);
    setFeedback(null);
    try {
      if (delivery.transaction_kind === "order") {
        await api.updateAdminOrderSupport(delivery.transaction_id, payload as OrderAdminSupportUpdateInput, {
          accessToken: session.access_token,
        });
      } else {
        await api.updateAdminBookingSupport(delivery.transaction_id, payload as BookingAdminSupportUpdateInput, {
          accessToken: session.access_token,
        });
      }

      setFeedback({
        tone: "success",
        message: `${actionLabel} updated for ${delivery.transaction_kind} ${truncateId(delivery.transaction_id)}.`,
      });
    } catch (updateError) {
      setFeedback({
        tone: "error",
        message:
          updateError instanceof ApiError
            ? updateError.message
            : updateError instanceof Error
              ? updateError.message
              : "Unable to update linked transaction support state.",
      });
    } finally {
      setSupportUpdatingKey(null);
    }
  }

  async function escalateLinkedTransactionToTrust(delivery: NotificationDelivery) {
    if (!trustAdmin) {
      setFeedback({ tone: "error", message: "No trust-lane admin is configured right now." });
      return;
    }

    await updateLinkedTransactionSupport(
      delivery,
      {
        admin_is_escalated: true,
        admin_assignee_user_id: trustAdmin.id,
        admin_handoff_note: `${noteDrafts[getTransactionKey(delivery)]?.trim() ? `${noteDrafts[getTransactionKey(delivery)].trim()}\n\n` : ""}Trust escalation trigger: seller has active moderation flags.\nRoute target: ${formatAdminLabel(trustAdmin)}`,
      },
      "Trust escalation",
    );
  }

  function getTransactionKey(delivery: NotificationDelivery) {
    return `${delivery.transaction_kind}:${delivery.transaction_id}`;
  }

  function getSupportPayload(
    delivery: NotificationDelivery,
    extra: Partial<OrderAdminSupportUpdateInput & BookingAdminSupportUpdateInput>,
  ) {
    const note = noteDrafts[getTransactionKey(delivery)]?.trim();
    return {
      ...extra,
      ...(note ? { admin_note: note } : {}),
    };
  }

  async function runBulkRetry() {
    const session = await restoreAdminSession();
    if (!session) {
      setFeedback({ tone: "error", message: "Admin session not available. Sign in again." });
      return;
    }

    setBulkUpdating(true);
    setFeedback(null);
    try {
      const result = await api.bulkRetryAdminNotificationDeliveries(
        retryableDeliveriesInView.map((delivery) => delivery.id),
        session.access_token,
        executionMode,
      );
      await reloadDeliveries(session.access_token);

      if (result.failed.length === 0) {
        setFeedback({
          tone: "success",
          message: `Retried ${result.succeeded_ids.length} deliver${result.succeeded_ids.length === 1 ? "y" : "ies"} in view. Already matched ${filteredDeliveries.length - retryableDeliveriesInView.length}.`,
        });
      } else if (result.succeeded_ids.length > 0) {
        setFeedback({
          tone: "success",
          message: `Retried ${result.succeeded_ids.length} deliver${result.succeeded_ids.length === 1 ? "y" : "ies"} in view. ${result.failed.length} failed preflight or retry.`,
        });
      } else {
        setFeedback({
          tone: "error",
          message: result.failed[0]?.detail ?? "Unable to retry deliveries in view.",
        });
      }
      setPendingBulkRetry(null);
    } catch (retryError) {
      setFeedback({
        tone: "error",
        message:
          retryError instanceof ApiError
            ? retryError.message
            : retryError instanceof Error
              ? retryError.message
              : "Unable to retry deliveries in view.",
      });
    } finally {
      setBulkUpdating(false);
    }
  }

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading delivery operations queue...
      </section>
    );
  }

  if (error) {
    return (
      <section className="card-shadow rounded-[2rem] border border-danger/30 bg-danger/8 p-6 text-sm text-danger">
        {error}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          {
            label: "All Deliveries",
            value: counts.total.toString(),
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
              }),
          },
          {
            label: "Failed",
            value: counts.failed.toString(),
            tone: counts.failed > 0 ? "danger" : "neutral",
            onClick: () =>
              applyQueueState({
                preset: "failed_only",
                status: "failed",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
              }),
          },
          {
            label: "Queued",
            value: counts.queued.toString(),
            tone: counts.queued > 0 ? "warning" : "neutral",
            onClick: () =>
              applyQueueState({
                preset: "queued_only",
                status: "queued",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
              }),
          },
          {
            label: "Sent",
            value: counts.sent.toString(),
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "sent",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
              }),
          },
          {
            label: "Email",
            value: counts.email.toString(),
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "all",
                channel: "email",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
              }),
          },
          {
            label: "Push",
            value: counts.push.toString(),
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "all",
                channel: "push",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
              }),
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className={`card-shadow rounded-[1.5rem] border p-4 ${
              card.tone === "danger"
                ? "border-danger/30 bg-danger/8"
                : card.tone === "warning"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-border bg-surface"
            } text-left transition hover:border-foreground/28`}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{card.value}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Trust-Driven Open",
            value: counts.trustDrivenOpen.toString(),
            detail: "Trust-routed deliveries still unresolved",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "all",
              }),
          },
          {
            label: "Trust-Driven Assigned To Me",
            value: counts.trustDrivenAssignedToMe.toString(),
            detail: "Linked trust-routed transactions owned by me",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "mine",
              }),
          },
          {
            label: "Trust-Driven Unassigned",
            value: counts.trustDrivenUnassigned.toString(),
            detail: "Linked trust-routed transactions without an owner",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "unassigned",
              }),
          },
          {
            label: "Trust-Driven Escalated",
            value: counts.trustDrivenEscalated.toString(),
            detail: "Linked trust-routed transactions still escalated",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "all",
              }),
          },
          {
            label: "Trust-Driven Sent 7d",
            value: counts.trustDrivenSent7d.toString(),
            detail: "Trust-routed deliveries sent in the last 7 days",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "sent",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "all",
              }),
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className="card-shadow rounded-[1.5rem] border border-border bg-surface p-4 text-left transition hover:border-foreground/28"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{card.value}</p>
            <p className="mt-2 text-sm text-foreground/64">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            label: "Softening Listings",
            value: listingHealthCounts.softening.toString(),
            detail: "Linked listings whose retention is currently softening",
            tone: listingHealthCounts.softening > 0 ? "danger" : "neutral",
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
                listingHealth: "softening",
              }),
          },
          {
            label: "Recent Pricing Changes",
            value: listingHealthCounts.recentPricing.toString(),
            detail: "Listings repriced in the last 7 days",
            tone: listingHealthCounts.recentPricing > 0 ? "warning" : "neutral",
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
                listingHealth: "recent_pricing",
              }),
          },
          {
            label: "Trust-Flagged Listings",
            value: listingHealthCounts.trustFlagged.toString(),
            detail: "Listings tied to sellers with active moderation pressure",
            tone: listingHealthCounts.trustFlagged > 0 ? "danger" : "neutral",
            onClick: () =>
              applyQueueState({
                preset: "needs_attention",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "all",
                ownership: "all",
                listingHealth: "trust_flagged",
              }),
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className={`card-shadow rounded-[1.5rem] border p-4 ${
              card.tone === "danger"
                ? "border-danger/30 bg-danger/8"
                : card.tone === "warning"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-border bg-surface"
            } text-left transition hover:border-foreground/28`}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{card.value}</p>
            <p className="mt-2 text-sm text-foreground/64">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            label:
              listingHealthFilter === "all"
                ? "Listing Risk + Failed"
                : `${titleCaseFilterLabel(listingHealthFilter)} + Failed`,
            value: listingHealthDiagnosticCounts.failed.toString(),
            detail: "Deliveries in this listing-risk lane that are currently failed",
            tone: listingHealthDiagnosticCounts.failed > 0 ? "danger" : "neutral",
            onClick: () =>
              applyQueueState({
                preset,
                status: "failed",
                channel: channelFilter,
                kind: kindFilter,
                recency: recencyFilter,
                trust: trustFilter,
                ownership: ownershipFilter,
                listingHealth: listingHealthFilter,
              }),
          },
          {
            label:
              listingHealthFilter === "all"
                ? "Listing Risk + Queued"
                : `${titleCaseFilterLabel(listingHealthFilter)} + Queued`,
            value: listingHealthDiagnosticCounts.queued.toString(),
            detail: "Deliveries in this listing-risk lane that are still queued",
            tone: listingHealthDiagnosticCounts.queued > 0 ? "warning" : "neutral",
            onClick: () =>
              applyQueueState({
                preset,
                status: "queued",
                channel: channelFilter,
                kind: kindFilter,
                recency: recencyFilter,
                trust: trustFilter,
                ownership: ownershipFilter,
                listingHealth: listingHealthFilter,
              }),
          },
          {
            label:
              listingHealthFilter === "all"
                ? "Listing Risk + Trust-Driven"
                : `${titleCaseFilterLabel(listingHealthFilter)} + Trust-Driven`,
            value: listingHealthDiagnosticCounts.trustDriven.toString(),
            detail: "Deliveries in this listing-risk lane tied to trust-routed support work",
            tone: listingHealthDiagnosticCounts.trustDriven > 0 ? "danger" : "neutral",
            onClick: () =>
              applyQueueState({
                preset,
                status: statusFilter,
                channel: channelFilter,
                kind: kindFilter,
                recency: recencyFilter,
                trust: "trust_driven",
                ownership: ownershipFilter,
                listingHealth: listingHealthFilter,
              }),
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className={`card-shadow rounded-[1.5rem] border p-4 ${
              card.tone === "danger"
                ? "border-danger/30 bg-danger/8"
                : card.tone === "warning"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-border bg-surface"
            } text-left transition hover:border-foreground/28`}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{card.value}</p>
            <p className="mt-2 text-sm text-foreground/64">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
        {[
          {
            label: "Oldest Trust-Driven Unassigned",
            detail: trustAgingSummary.oldestTrustDrivenUnassigned
              ? `${formatAgeLabel(trustAgingSummary.oldestTrustDrivenUnassigned.created_at)} · ${trustAgingSummary.oldestTrustDrivenUnassigned.transaction_kind} #${truncateId(trustAgingSummary.oldestTrustDrivenUnassigned.transaction_id)}`
              : "No unresolved unassigned trust-driven deliveries",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "unassigned",
              }),
          },
          {
            label: "Oldest Trust-Driven Assigned",
            detail: trustAgingSummary.oldestTrustDrivenAssigned
              ? `${formatAgeLabel(trustAgingSummary.oldestTrustDrivenAssigned.created_at)} · ${trustAgingSummary.oldestTrustDrivenAssigned.transaction_kind} #${truncateId(trustAgingSummary.oldestTrustDrivenAssigned.transaction_id)}`
              : "No unresolved assigned trust-driven deliveries",
            onClick: () =>
              applyQueueState({
                preset: "trust_driven",
                status: "all",
                channel: "all",
                kind: "all",
                recency: "week",
                trust: "trust_driven",
                ownership: "assigned",
              }),
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className="card-shadow rounded-[1.5rem] border border-border bg-surface p-4 text-left transition hover:border-foreground/28"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-sm leading-6 text-foreground/72">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
          {[
            { label: "Needs Attention", value: "needs_attention" as DeliveryPreset },
            { label: "Failed Only", value: "failed_only" as DeliveryPreset },
            { label: "Queued Only", value: "queued_only" as DeliveryPreset },
            { label: "Push Failures", value: "push_failures" as DeliveryPreset },
            { label: "Trust-Driven", value: "trust_driven" as DeliveryPreset },
          ].map((option) => {
            const active = preset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => applyPreset(option.value)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="mb-4 rounded-[1.25rem] border border-border bg-background px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-foreground/46">Current Slice</p>
              <p className="mt-2 text-sm text-foreground/72">{activeSliceSummary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sliceLinkFeedback ? (
                <span className="text-xs uppercase tracking-[0.18em] text-foreground/46">
                  {sliceLinkFeedback}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void copyCurrentSliceLink()}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
              >
                Copy Link
              </button>
              {!isDefaultSlice ? (
                <button
                  type="button"
                  onClick={() =>
                    applyQueueState({
                      preset: "needs_attention",
                      status: "all",
                      channel: "all",
                      kind: "all",
                      recency: "week",
                      trust: "all",
                      ownership: "all",
                      listingHealth: "all",
                    })
                  }
                  className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
                >
                  Reset To Default
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm text-foreground/72">
            Search
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by transaction, recipient, payload, or failure"
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
            />
          </label>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Status</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.total})` },
                { value: "failed", label: `Failed (${counts.failed})` },
                { value: "queued", label: `Queued (${counts.queued})` },
                { value: "sent", label: `Sent (${counts.sent})` },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatusFilter(option.value as DeliveryStatusFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    statusFilter === option.value
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
            <span>Channel</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.total})` },
                { value: "email", label: `Email (${counts.email})` },
                { value: "push", label: `Push (${counts.push})` },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setChannelFilter(option.value as DeliveryChannelFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    channelFilter === option.value
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
            <span>Transaction</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.total})` },
                { value: "order", label: `Orders (${counts.order})` },
                { value: "booking", label: `Bookings (${counts.booking})` },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKindFilter(option.value as DeliveryKindFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    kindFilter === option.value
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
            <span>Recency</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "today", label: "Today" },
                { value: "week", label: "7 Days" },
                { value: "all", label: "All Time" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRecencyFilter(option.value as DeliveryRecencyFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    recencyFilter === option.value
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
            <span>Trust Context</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.total})` },
                { value: "trust_driven", label: `Trust-Driven (${counts.trustDriven})` },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTrustFilter(option.value as DeliveryTrustFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    trustFilter === option.value
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
            <span>Listing Health</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: "All" },
                { value: "softening", label: `Softening (${listingHealthCounts.softening})` },
                { value: "recent_pricing", label: `Recent Pricing (${listingHealthCounts.recentPricing})` },
                { value: "trust_flagged", label: `Trust-Flagged (${listingHealthCounts.trustFlagged})` },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setListingHealthFilter(option.value as DeliveryListingHealthFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    listingHealthFilter === option.value
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
            <span>Support Ownership</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.total})` },
                { value: "mine", label: `Mine (${counts.trustDrivenAssignedToMe})` },
                { value: "unassigned", label: `Unassigned (${counts.trustDrivenUnassigned})` },
                { value: "assigned", label: `Assigned (${counts.trustDrivenAssigned})` },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOwnershipFilter(option.value as DeliveryOwnershipFilter)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    ownershipFilter === option.value
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
            <span>Retry Mode</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "best_effort", label: "Best Effort" },
                { value: "atomic", label: "Validate First" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setExecutionMode(option.value as ExecutionMode)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    executionMode === option.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-foreground/48">Delivery Queue</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {filteredDeliveries.length} visible deliver{filteredDeliveries.length === 1 ? "y" : "ies"}
            </h2>
          </div>
          <p className="max-w-md text-right text-sm text-foreground/64">
            This queue is for communication failures, retries, and channel-specific delivery triage.
          </p>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-border bg-background px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-foreground/46">Current Slice</p>
              <p className="mt-2 text-sm text-foreground/72">{activeSliceSummary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sliceLinkFeedback ? (
                <span className="text-xs uppercase tracking-[0.18em] text-foreground/46">
                  {sliceLinkFeedback}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void copyCurrentSliceLink()}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
              >
                Copy Link
              </button>
              {!isDefaultSlice ? (
                <button
                  type="button"
                  onClick={() =>
                    applyQueueState({
                      preset: "needs_attention",
                      status: "all",
                      channel: "all",
                      kind: "all",
                      recency: "week",
                      trust: "all",
                      ownership: "all",
                    })
                  }
                  className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
                >
                  Reset To Default
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-4">
          <button
            type="button"
            disabled={bulkUpdating || retryableDeliveriesInView.length === 0}
            onClick={() =>
              setPendingBulkRetry({
                targetCount: retryableDeliveriesInView.length,
                unchangedCount: filteredDeliveries.length - retryableDeliveriesInView.length,
              })
            }
            className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry Deliveries In View
          </button>
          <span className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/64">
            {executionMode === "atomic" ? "Validate First" : "Best Effort"}
          </span>
        </div>

        {feedback ? (
          <div
            className={`mt-4 rounded-[1.25rem] border px-4 py-3 text-sm ${
              feedback.tone === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                : "border-danger/30 bg-danger/8 text-danger"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        {pendingBulkRetry ? (
          <div className="mt-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
            <p className="text-sm font-medium text-foreground">Retry visible deliveries?</p>
            <p className="mt-2 text-sm text-foreground/66">
              This will change {pendingBulkRetry.targetCount} deliver{pendingBulkRetry.targetCount === 1 ? "y" : "ies"}.
              {pendingBulkRetry.unchangedCount > 0
                ? ` ${pendingBulkRetry.unchangedCount} already match the target state.`
                : null}{" "}
              Mode: {executionMode === "atomic" ? "Validate First" : "Best Effort"}.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={bulkUpdating}
                onClick={() => void runBulkRetry()}
                className="rounded-full border border-foreground bg-foreground px-4 py-2 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={bulkUpdating}
                onClick={() => setPendingBulkRetry(null)}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-4">
          {filteredDeliveries.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-border px-4 py-8 text-sm text-foreground/60">
              No deliveries match the current operations filters.
            </div>
          ) : null}

          {filteredDeliveries.map((delivery) => {
            const transactionHref = `/admin/transactions?focus=${delivery.transaction_kind}:${delivery.transaction_id}&delivery=${delivery.delivery_status === "failed" ? "failed" : delivery.delivery_status === "queued" ? "queued" : "all"}`;
            const assignActionKey = `${delivery.transaction_kind}:${delivery.transaction_id}:Assignment`;
            const escalateActionKey = `${delivery.transaction_kind}:${delivery.transaction_id}:Escalation`;
            const trustEscalationActionKey = `${delivery.transaction_kind}:${delivery.transaction_id}:Trust escalation`;
            const saveNoteActionKey = `${delivery.transaction_kind}:${delivery.transaction_id}:Support Note`;
            const transactionKey = getTransactionKey(delivery);
            const listingOpsContext = listingOpsContextByTransactionKey.get(transactionKey) ?? null;
            const listingId = transactionListingByKey[transactionKey];
            const listingLaneHref = listingId
              ? `/admin/transactions?listing=${listingId}&focus=${delivery.transaction_kind}:${delivery.transaction_id}&delivery=${delivery.delivery_status === "failed" ? "failed" : delivery.delivery_status === "queued" ? "queued" : "all"}`
              : null;
            const browseContext = transactionBrowseContextByKey[transactionKey];
            const trustSummary = getSellerTrustSummary(
              transactionSellerByKey[`${delivery.transaction_kind}:${delivery.transaction_id}`],
            );
            return (
              <article
                key={delivery.id}
                className={`rounded-[1.5rem] border p-4 ${
                  delivery.delivery_status === "failed"
                    ? "border-danger/30 bg-danger/8"
                    : delivery.delivery_status === "queued"
                      ? "border-amber-500/30 bg-amber-500/10"
                      : "border-border bg-background/65"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3 lg:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.22em] text-foreground/56">
                        {delivery.channel}
                      </span>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {delivery.transaction_kind}
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${
                          delivery.delivery_status === "failed"
                            ? "border-danger/30 bg-danger/8 text-danger"
                            : delivery.delivery_status === "queued"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                              : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700"
                        }`}
                      >
                        {delivery.delivery_status.replaceAll("_", " ")}
                      </span>
                      <span className="text-xs text-foreground/48">#{truncateId(delivery.id)}</span>
                    </div>

                    <div className="grid gap-3 text-sm text-foreground/68 sm:grid-cols-2 xl:grid-cols-5">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Transaction</p>
                        <p className="mt-1 font-mono text-xs text-foreground">{truncateId(delivery.transaction_id)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Recipient</p>
                        <p className="mt-1 font-mono text-xs text-foreground">{truncateId(delivery.recipient_user_id)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Attempts</p>
                        <p className="mt-1 text-foreground">{delivery.attempts}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Created</p>
                        <p className="mt-1 text-foreground">{formatDateTime(delivery.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Age</p>
                        <p className="mt-1 text-foreground">{formatAgeLabel(delivery.created_at)}</p>
                      </div>
                    </div>

                    {trustSummary.total > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1 text-xs uppercase tracking-[0.18em] text-danger">
                          Seller Trust Flags
                        </span>
                        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          {trustSummary.open} open
                        </span>
                        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          {trustSummary.escalated} escalated
                        </span>
                        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          {trustSummary.hidden} hidden
                        </span>
                      </div>
                    ) : null}

                    {listingOpsContext ? (
                      <div className="rounded-[1.25rem] border border-border bg-background/75 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-foreground/46">
                              Listing Ops Context
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {listingOpsContext.listing.title}
                            </p>
                            <p className="mt-1 text-sm text-foreground/64">
                              {titleCaseFilterLabel(listingOpsContext.adjustmentType)} ·{" "}
                              <span className={getListingTrendToneClass(listingOpsContext.retentionTrendKey)}>
                                {listingOpsContext.retentionTrendLabel}
                              </span>
                            </p>
                          </div>
                          <div className="text-right text-xs text-foreground/50">
                            <p>
                              {listingOpsContext.adjustmentAt
                                ? `Adjusted ${formatAgeLabel(listingOpsContext.adjustmentAt)} ago`
                                : "No adjustment timestamp"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 text-sm text-foreground/68 sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">
                              Last Change
                            </p>
                            <p className="mt-1 text-foreground">
                              {listingOpsContext.adjustmentSummary?.trim() || "No operating adjustment recorded"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">
                              Since Change
                            </p>
                            <p className="mt-1 text-foreground">
                              {listingOpsContext.sameSellerPostAdjustmentCount} retained ·{" "}
                              {listingOpsContext.crossSellerPostAdjustmentCount} branched
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">
                              Follow-On Mix
                            </p>
                            <p className="mt-1 text-foreground">
                              {listingOpsContext.sameSellerCount} same-seller · {listingOpsContext.crossSellerCount} cross-seller
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">
                              Browse Pressure
                            </p>
                            <p className="mt-1 text-foreground">
                              {(() => {
                                const browseSignals = [
                                  isPriceDrivenBrowseContext(browseContext) ? "Price-led" : null,
                                  isSearchDrivenBrowseContext(browseContext) ? "Search-led" : null,
                                  isLocalDrivenBrowseContext(browseContext) ? "Local-fit" : null,
                                ].filter(Boolean);
                                return browseSignals.length > 0 ? browseSignals.join(" · ") : "No browse signal";
                              })()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {delivery.failure_reason ? (
                      <p className="rounded-2xl border border-danger/20 bg-background/70 px-3 py-3 text-sm leading-6 text-danger">
                        {delivery.failure_reason}
                      </p>
                    ) : null}

                    <div className="rounded-[1.25rem] border border-border bg-background/75 p-3 text-xs text-foreground/62">
                      <p className="font-medium uppercase tracking-[0.2em] text-foreground/46">Payload</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-6">
                        {JSON.stringify(delivery.payload, null, 2)}
                      </pre>
                    </div>

                    <div className="rounded-[1.25rem] border border-border bg-background/75 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-foreground/46">
                          Support Note
                        </p>
                        <p className="text-xs text-foreground/48">
                          Travels with assign and escalate actions
                        </p>
                      </div>
                      <textarea
                        value={noteDrafts[transactionKey] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({
                            ...current,
                            [transactionKey]: event.target.value,
                          }))
                        }
                        placeholder="Add support context before assigning or escalating this transaction"
                        className="mt-3 min-h-[96px] w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-[220px]">
                    <Link
                      href={transactionHref}
                      className="rounded-full border border-border bg-surface px-4 py-2 text-center text-sm text-foreground/72 transition hover:border-foreground/28"
                    >
                      Open Transaction
                    </Link>
                    {listingLaneHref ? (
                      <Link
                        href={listingLaneHref}
                        className="rounded-full border border-border bg-surface px-4 py-2 text-center text-sm text-foreground/72 transition hover:border-foreground/28"
                      >
                        Open Listing Lane
                      </Link>
                    ) : null}
                    {currentAdminUserId ? (
                      <button
                        type="button"
                        disabled={supportUpdatingKey === assignActionKey}
                        onClick={() =>
                          void updateLinkedTransactionSupport(
                            delivery,
                            getSupportPayload(delivery, { admin_assignee_user_id: currentAdminUserId }),
                            "Assignment",
                          )
                        }
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Assign Transaction To Me
                      </button>
                    ) : null}
                    {trustSummary.total > 0 && trustAdmin ? (
                      <button
                        type="button"
                        disabled={supportUpdatingKey === trustEscalationActionKey}
                        onClick={() => void escalateLinkedTransactionToTrust(delivery)}
                        className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Escalate To Trust
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={supportUpdatingKey === escalateActionKey}
                      onClick={() =>
                        void updateLinkedTransactionSupport(
                          delivery,
                          getSupportPayload(delivery, { admin_is_escalated: true }),
                          "Escalation",
                        )
                      }
                      className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Escalate Transaction
                    </button>
                    {(delivery.delivery_status === "failed" || delivery.delivery_status === "queued") ? (
                      <button
                        type="button"
                        disabled={retryingId === delivery.id}
                        onClick={() => void retryDelivery(delivery)}
                        className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Retry Delivery
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={supportUpdatingKey === saveNoteActionKey || !(noteDrafts[transactionKey]?.trim())}
                      onClick={() =>
                        void updateLinkedTransactionSupport(
                          delivery,
                          { admin_note: noteDrafts[transactionKey].trim() },
                          "Support Note",
                        )
                      }
                      className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save Support Note
                    </button>
                    <div className="rounded-[1.25rem] border border-border bg-background px-3 py-3 text-xs text-foreground/58">
                      <p>Sent: {delivery.sent_at ? formatDateTime(delivery.sent_at) : "Not yet sent"}</p>
                      <p className="mt-2">
                        Recommended owner:{" "}
                        {supportAdmin ? formatAdminLabel(supportAdmin) : "Support lane not labeled"}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
