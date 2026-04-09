"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  createApiClient,
  type AdminUser,
  type BookingAdminSupportUpdateInput,
  type Listing,
  type NotificationDelivery,
  type NotificationDeliverySummary,
  type NotificationWorkerHealth,
  type OrderAdminSupportUpdateInput,
  type Profile,
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
type DeliveryWatchlistSeverityFilter = "all" | "high" | "medium" | "monitor";
type DeliveryWatchlistViewState = {
  severityFilter: DeliveryWatchlistSeverityFilter;
  newOnly: boolean;
  viewedAt: string;
};
type DeliveryOpsPreferences = {
  preset: DeliveryPreset;
  status: DeliveryStatusFilter;
  channel: DeliveryChannelFilter;
  kind: DeliveryKindFilter;
  recency: DeliveryRecencyFilter;
  trust: DeliveryTrustFilter;
  ownership: DeliveryOwnershipFilter;
  listingHealth: DeliveryListingHealthFilter;
  query: string;
  mode: ExecutionMode;
  watchlistLastViewedAt: string | null;
  watchlistSeverityFilter: DeliveryWatchlistSeverityFilter;
  watchlistNewOnly: boolean;
  watchlistCollapsed: boolean;
  watchlistLastView: DeliveryWatchlistViewState | null;
  watchlistLastClearedView: DeliveryWatchlistViewState | null;
  pinnedPresetIds: string[];
  lastAppliedPresetId: string | null;
  activityFilter: DeliveryActivityFilter;
  activityEntryLimit: 6 | 10;
  activityCollapsedGroups: string[];
  activityLog: DeliveryOpsActivityEntry[];
};
type DeliverySavedPresetId =
  | "needs_attention"
  | "failed_only"
  | "queued_only"
  | "push_failures"
  | "trust_queue"
  | "trust_unassigned"
  | "listing_softening";
type DeliveryOpsActivityEntry = {
  id: string;
  label: string;
  summary: string;
  createdAt: string;
  tone: "neutral" | "success" | "warning" | "danger";
  presetId?: DeliverySavedPresetId | null;
  transactionKind?: DeliveryKindFilter | null;
  transactionId?: string | null;
  watchlistTarget?: "delivery-watchlist" | null;
  watchlistSeverityFilter?: DeliveryWatchlistSeverityFilter | null;
  watchlistNewOnly?: boolean;
  activityFilterSnapshot?: DeliveryActivityFilter | null;
  activityEntryLimitSnapshot?: 6 | 10;
};
type DeliveryActivityFilter = "all" | "views" | "operations" | "watchlist";
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

const DEFAULT_DELIVERY_OPS_PREFERENCES: DeliveryOpsPreferences = {
  preset: "needs_attention",
  status: "all",
  channel: "all",
  kind: "all",
  recency: "week",
  trust: "all",
  ownership: "all",
  listingHealth: "all",
  query: "",
  mode: "best_effort",
  watchlistLastViewedAt: null,
  watchlistSeverityFilter: "all",
  watchlistNewOnly: false,
  watchlistCollapsed: false,
  watchlistLastView: null,
  watchlistLastClearedView: null,
  pinnedPresetIds: [],
  lastAppliedPresetId: null,
  activityFilter: "all",
  activityEntryLimit: 6,
  activityCollapsedGroups: [],
  activityLog: [],
};

function normalizeDeliveryOpsPreferences(value: unknown): DeliveryOpsPreferences {
  const candidate = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    preset:
      candidate.preset === "failed_only" ||
      candidate.preset === "queued_only" ||
      candidate.preset === "push_failures" ||
      candidate.preset === "trust_driven"
        ? candidate.preset
        : "needs_attention",
    status:
      candidate.status === "failed" || candidate.status === "queued" || candidate.status === "sent"
        ? candidate.status
        : "all",
    channel: candidate.channel === "email" || candidate.channel === "push" ? candidate.channel : "all",
    kind: candidate.kind === "order" || candidate.kind === "booking" ? candidate.kind : "all",
    recency: candidate.recency === "all" || candidate.recency === "today" ? candidate.recency : "week",
    trust: candidate.trust === "trust_driven" ? "trust_driven" : "all",
    ownership:
      candidate.ownership === "mine" ||
      candidate.ownership === "unassigned" ||
      candidate.ownership === "assigned"
        ? candidate.ownership
        : "all",
    listingHealth:
      candidate.listingHealth === "softening" ||
      candidate.listingHealth === "recent_pricing" ||
      candidate.listingHealth === "trust_flagged"
        ? candidate.listingHealth
        : "all",
    query: typeof candidate.query === "string" ? candidate.query : "",
    mode: candidate.mode === "atomic" ? "atomic" : "best_effort",
    watchlistLastViewedAt:
      typeof candidate.watchlistLastViewedAt === "string" ? candidate.watchlistLastViewedAt : null,
    watchlistSeverityFilter:
      candidate.watchlistSeverityFilter === "high" ||
      candidate.watchlistSeverityFilter === "medium" ||
      candidate.watchlistSeverityFilter === "monitor"
        ? candidate.watchlistSeverityFilter
        : "all",
    watchlistNewOnly: candidate.watchlistNewOnly === true,
    watchlistCollapsed: candidate.watchlistCollapsed === true,
    watchlistLastView: normalizeWatchlistViewState(candidate.watchlistLastView),
    watchlistLastClearedView: normalizeWatchlistViewState(candidate.watchlistLastClearedView),
    pinnedPresetIds: Array.isArray(candidate.pinnedPresetIds)
      ? candidate.pinnedPresetIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    lastAppliedPresetId:
      typeof candidate.lastAppliedPresetId === "string" ? candidate.lastAppliedPresetId : null,
    activityFilter:
      candidate.activityFilter === "views" ||
      candidate.activityFilter === "operations" ||
      candidate.activityFilter === "watchlist"
        ? candidate.activityFilter
        : "all",
    activityEntryLimit: candidate.activityEntryLimit === 10 ? 10 : 6,
    activityCollapsedGroups: Array.isArray(candidate.activityCollapsedGroups)
      ? candidate.activityCollapsedGroups.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    activityLog: Array.isArray(candidate.activityLog)
      ? candidate.activityLog
          .filter(
            (entry): entry is DeliveryOpsActivityEntry =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as DeliveryOpsActivityEntry).id === "string" &&
              typeof (entry as DeliveryOpsActivityEntry).label === "string" &&
              typeof (entry as DeliveryOpsActivityEntry).summary === "string" &&
              typeof (entry as DeliveryOpsActivityEntry).createdAt === "string" &&
              ((entry as DeliveryOpsActivityEntry).tone === "neutral" ||
                (entry as DeliveryOpsActivityEntry).tone === "success" ||
                (entry as DeliveryOpsActivityEntry).tone === "warning" ||
                (entry as DeliveryOpsActivityEntry).tone === "danger") &&
              (typeof (entry as DeliveryOpsActivityEntry).presetId === "undefined" ||
                (entry as DeliveryOpsActivityEntry).presetId === null ||
                (entry as DeliveryOpsActivityEntry).presetId === "needs_attention" ||
                (entry as DeliveryOpsActivityEntry).presetId === "failed_only" ||
                (entry as DeliveryOpsActivityEntry).presetId === "queued_only" ||
                (entry as DeliveryOpsActivityEntry).presetId === "push_failures" ||
                (entry as DeliveryOpsActivityEntry).presetId === "trust_queue" ||
                (entry as DeliveryOpsActivityEntry).presetId === "trust_unassigned" ||
                (entry as DeliveryOpsActivityEntry).presetId === "listing_softening") &&
              (typeof (entry as DeliveryOpsActivityEntry).watchlistTarget === "undefined" ||
                (entry as DeliveryOpsActivityEntry).watchlistTarget === null ||
                (entry as DeliveryOpsActivityEntry).watchlistTarget === "delivery-watchlist") &&
              (typeof (entry as DeliveryOpsActivityEntry).watchlistSeverityFilter === "undefined" ||
                (entry as DeliveryOpsActivityEntry).watchlistSeverityFilter === null ||
                (entry as DeliveryOpsActivityEntry).watchlistSeverityFilter === "all" ||
                (entry as DeliveryOpsActivityEntry).watchlistSeverityFilter === "high" ||
                (entry as DeliveryOpsActivityEntry).watchlistSeverityFilter === "medium" ||
                (entry as DeliveryOpsActivityEntry).watchlistSeverityFilter === "monitor") &&
              (typeof (entry as DeliveryOpsActivityEntry).watchlistNewOnly === "undefined" ||
                typeof (entry as DeliveryOpsActivityEntry).watchlistNewOnly === "boolean") &&
              (typeof (entry as DeliveryOpsActivityEntry).transactionKind === "undefined" ||
                (entry as DeliveryOpsActivityEntry).transactionKind === null ||
                (entry as DeliveryOpsActivityEntry).transactionKind === "order" ||
                (entry as DeliveryOpsActivityEntry).transactionKind === "booking") &&
              (typeof (entry as DeliveryOpsActivityEntry).transactionId === "undefined" ||
                (entry as DeliveryOpsActivityEntry).transactionId === null ||
                typeof (entry as DeliveryOpsActivityEntry).transactionId === "string") &&
              (typeof (entry as DeliveryOpsActivityEntry).activityFilterSnapshot === "undefined" ||
                (entry as DeliveryOpsActivityEntry).activityFilterSnapshot === null ||
                (entry as DeliveryOpsActivityEntry).activityFilterSnapshot === "all" ||
                (entry as DeliveryOpsActivityEntry).activityFilterSnapshot === "views" ||
                (entry as DeliveryOpsActivityEntry).activityFilterSnapshot === "operations" ||
                (entry as DeliveryOpsActivityEntry).activityFilterSnapshot === "watchlist") &&
              (typeof (entry as DeliveryOpsActivityEntry).activityEntryLimitSnapshot === "undefined" ||
                (entry as DeliveryOpsActivityEntry).activityEntryLimitSnapshot === 6 ||
                (entry as DeliveryOpsActivityEntry).activityEntryLimitSnapshot === 10),
          )
          .slice(0, 8)
      : [],
  };
}

function escapeCsvValue(value: string | number | boolean | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  const normalized = String(value).replaceAll('"', '""');
  return `"${normalized}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | boolean | null | undefined>>) {
  const csv = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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

function happenedAfterTimestamp(value: string | null | undefined, baseline: string | null) {
  if (!value || !baseline) {
    return false;
  }

  const parsedValue = new Date(value);
  const parsedBaseline = new Date(baseline);
  if (Number.isNaN(parsedValue.getTime()) || Number.isNaN(parsedBaseline.getTime())) {
    return false;
  }

  return parsedValue.getTime() > parsedBaseline.getTime();
}

function getActivityDayLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  const diffDays = Math.round((today - target) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }

  return parsed.toLocaleDateString();
}

function formatWatchlistActivityLabel(entry: Pick<DeliveryOpsActivityEntry, "watchlistSeverityFilter" | "watchlistNewOnly">) {
  const parts: string[] = [];
  if (entry.watchlistSeverityFilter && entry.watchlistSeverityFilter !== "all") {
    parts.push(entry.watchlistSeverityFilter);
  }
  if (entry.watchlistNewOnly) {
    parts.push("new since review");
  }
  return parts.length > 0 ? parts.join(" · ") : "all alerts";
}

function formatWatchlistBadgeLabel(entry: Pick<DeliveryOpsActivityEntry, "watchlistSeverityFilter" | "watchlistNewOnly">) {
  const parts: string[] = [];
  if (entry.watchlistSeverityFilter && entry.watchlistSeverityFilter !== "all") {
    parts.push(entry.watchlistSeverityFilter[0].toUpperCase() + entry.watchlistSeverityFilter.slice(1));
  }
  if (entry.watchlistNewOnly) {
    parts.push("New since review");
  }
  return parts.length > 0 ? parts.join(" + ") : "All alerts";
}

function formatWatchlistSliceLabel(entry: Pick<DeliveryOpsActivityEntry, "watchlistSeverityFilter" | "watchlistNewOnly">) {
  if (entry.watchlistNewOnly) {
    return "new watchlist alerts";
  }
  if (entry.watchlistSeverityFilter && entry.watchlistSeverityFilter !== "all") {
    return `${entry.watchlistSeverityFilter} watchlist alerts`;
  }
  return "all watchlist alerts";
}

function formatWatchlistResumeLabel(entry: Pick<DeliveryOpsActivityEntry, "watchlistSeverityFilter" | "watchlistNewOnly">) {
  return `Re-open ${formatWatchlistSliceLabel(entry)}`;
}

function watchlistViewMatchesActivityEntry(
  view: DeliveryWatchlistViewState | null,
  entry: Pick<DeliveryOpsActivityEntry, "watchlistSeverityFilter" | "watchlistNewOnly">,
) {
  if (!view) {
    return false;
  }

  return (
    view.severityFilter === (entry.watchlistSeverityFilter ?? "all") &&
    view.newOnly === (entry.watchlistNewOnly ?? false)
  );
}

function isSavedViewActivity(entry: DeliveryOpsActivityEntry) {
  return (
    Boolean(entry.presetId) ||
    entry.label === "Clear saved watchlist view" ||
    entry.label === "Dismiss cleared watchlist view" ||
    entry.label === "Restore saved watchlist view"
  );
}

function getSavedViewActivityLabel(entry: DeliveryOpsActivityEntry) {
  if (entry.presetId) {
    return "Saved preset";
  }
  return "Saved watchlist";
}

function getOperationActivityLabel(entry: DeliveryOpsActivityEntry) {
  const label = entry.label.toLowerCase();

  if (label.includes("bulk retry")) {
    return "Bulk retry";
  }
  if (label.includes("retry")) {
    return "Retry";
  }
  if (label.includes("trust")) {
    return "Trust";
  }
  return "Support";
}

function normalizeWatchlistViewState(value: unknown): DeliveryWatchlistViewState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<DeliveryWatchlistViewState>;
  if (typeof candidate.viewedAt !== "string") {
    return null;
  }

  return {
    severityFilter:
      candidate.severityFilter === "high" ||
      candidate.severityFilter === "medium" ||
      candidate.severityFilter === "monitor"
        ? candidate.severityFilter
        : "all",
    newOnly: candidate.newOnly === true,
    viewedAt: candidate.viewedAt,
  };
}

function scrollToDeliverySection(sectionId: string) {
  if (typeof window === "undefined") {
    return;
  }
  const element = document.getElementById(sectionId);
  if (!element) {
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "start" });
  if (typeof element.animate === "function") {
    element.animate(
      [
        {
          boxShadow: "0 0 0 0 rgba(14, 165, 233, 0)",
          backgroundColor: "rgba(14, 165, 233, 0)",
        },
        {
          boxShadow: "0 0 0 3px rgba(14, 165, 233, 0.28)",
          backgroundColor: "rgba(14, 165, 233, 0.08)",
        },
        {
          boxShadow: "0 0 0 0 rgba(14, 165, 233, 0)",
          backgroundColor: "rgba(14, 165, 233, 0)",
        },
      ],
      {
        duration: 1400,
        easing: "ease-out",
      },
    );
  }
}

const DELIVERY_SAVED_PRESETS: Array<{
  id: DeliverySavedPresetId;
  label: string;
  description: string;
  apply: Omit<DeliveryOpsPreferences, "watchlistLastViewedAt" | "pinnedPresetIds" | "lastAppliedPresetId">;
}> = [
  {
    id: "needs_attention",
    label: "Needs attention",
    description: "Failed and queued deliveries from the last week.",
    apply: {
      preset: "needs_attention",
      status: "all",
      channel: "all",
      kind: "all",
      recency: "week",
      trust: "all",
      ownership: "all",
      listingHealth: "all",
      query: "",
      mode: "best_effort",
    },
  },
  {
    id: "failed_only",
    label: "Failed only",
    description: "Focus on failed deliveries across all channels.",
    apply: {
      preset: "failed_only",
      status: "failed",
      channel: "all",
      kind: "all",
      recency: "all",
      trust: "all",
      ownership: "all",
      listingHealth: "all",
      query: "",
      mode: "best_effort",
    },
  },
  {
    id: "queued_only",
    label: "Queued only",
    description: "Review the queued backlog without sent noise.",
    apply: {
      preset: "queued_only",
      status: "queued",
      channel: "all",
      kind: "all",
      recency: "all",
      trust: "all",
      ownership: "all",
      listingHealth: "all",
      query: "",
      mode: "best_effort",
    },
  },
  {
    id: "push_failures",
    label: "Push failures",
    description: "Failed push deliveries for token and provider triage.",
    apply: {
      preset: "push_failures",
      status: "failed",
      channel: "push",
      kind: "all",
      recency: "all",
      trust: "all",
      ownership: "all",
      listingHealth: "all",
      query: "",
      mode: "best_effort",
    },
  },
  {
    id: "trust_queue",
    label: "Trust queue",
    description: "Open trust-routed deliveries across the lane.",
    apply: {
      preset: "trust_driven",
      status: "all",
      channel: "all",
      kind: "all",
      recency: "week",
      trust: "trust_driven",
      ownership: "all",
      listingHealth: "all",
      query: "",
      mode: "best_effort",
    },
  },
  {
    id: "trust_unassigned",
    label: "Trust unassigned",
    description: "Trust-routed deliveries still waiting on ownership.",
    apply: {
      preset: "trust_driven",
      status: "all",
      channel: "all",
      kind: "all",
      recency: "week",
      trust: "trust_driven",
      ownership: "unassigned",
      listingHealth: "all",
      query: "",
      mode: "best_effort",
    },
  },
  {
    id: "listing_softening",
    label: "Softening listings",
    description: "Deliveries tied to listings with softening retention.",
    apply: {
      preset: "needs_attention",
      status: "all",
      channel: "all",
      kind: "all",
      recency: "week",
      trust: "all",
      ownership: "all",
      listingHealth: "softening",
      query: "",
      mode: "best_effort",
    },
  },
];

function truncateId(value: string) {
  return value.slice(0, 8);
}

function titleCaseFilterLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function getListingComparisonScopeBadge(scope: string | null | undefined) {
  if (!scope) {
    return null;
  }

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
  const [deliverySummary, setDeliverySummary] = useState<NotificationDeliverySummary | null>(null);
  const [workerHealth, setWorkerHealth] = useState<NotificationWorkerHealth | null>(null);
  const [summaryFetchedAt, setSummaryFetchedAt] = useState<string | null>(null);
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
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [watchlistBaselineAt, setWatchlistBaselineAt] = useState<string | null>(null);
  const [watchlistLastViewedAt, setWatchlistLastViewedAt] = useState<string | null>(null);
  const [watchlistSeverityFilter, setWatchlistSeverityFilter] =
    useState<DeliveryWatchlistSeverityFilter>("all");
  const [watchlistNewOnly, setWatchlistNewOnly] = useState(false);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [watchlistLastView, setWatchlistLastView] = useState<DeliveryWatchlistViewState | null>(null);
  const [watchlistLastClearedView, setWatchlistLastClearedView] = useState<DeliveryWatchlistViewState | null>(null);
  const [pinnedPresetIds, setPinnedPresetIds] = useState<DeliverySavedPresetId[]>([]);
  const [lastAppliedPresetId, setLastAppliedPresetId] = useState<DeliverySavedPresetId | null>(null);
  const [activityLog, setActivityLog] = useState<DeliveryOpsActivityEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<DeliveryActivityFilter>("all");
  const [activityEntryLimit, setActivityEntryLimit] = useState<6 | 10>(6);
  const [collapsedActivityGroups, setCollapsedActivityGroups] = useState<string[]>([]);
  const hydratedFromProfileRef = useRef(false);
  const didMarkWatchlistViewedRef = useRef(false);

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
  }, []);

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
    if (!preferencesReady) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const session = await restoreAdminSession();
          if (!session) {
            return;
          }

          await api.patch(
            "/profiles/me",
            {
              admin_delivery_ops_preferences: {
                preset,
                status: statusFilter,
                channel: channelFilter,
                kind: kindFilter,
                recency: recencyFilter,
                trust: trustFilter,
                ownership: ownershipFilter,
                listingHealth: listingHealthFilter,
                query: searchQuery,
                mode: executionMode,
                watchlistLastViewedAt,
                watchlistSeverityFilter,
                watchlistNewOnly,
                watchlistCollapsed,
                watchlistLastView,
                watchlistLastClearedView,
                pinnedPresetIds,
                lastAppliedPresetId,
                activityFilter,
                activityEntryLimit,
                activityCollapsedGroups: collapsedActivityGroups,
                activityLog,
              },
            },
            { accessToken: session.access_token },
          );
        } catch {
          // Keep local delivery ops state even if remote persistence fails.
        }
      })();
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    channelFilter,
    executionMode,
    kindFilter,
    listingHealthFilter,
    ownershipFilter,
    preferencesReady,
    preset,
    recencyFilter,
    searchQuery,
    statusFilter,
    trustFilter,
    watchlistLastViewedAt,
    watchlistSeverityFilter,
    watchlistNewOnly,
    watchlistCollapsed,
    watchlistLastView,
    watchlistLastClearedView,
    pinnedPresetIds,
    lastAppliedPresetId,
    activityFilter,
    activityEntryLimit,
    collapsedActivityGroups,
    activityLog,
  ]);

  useEffect(() => {
    if (loading || !preferencesReady || didMarkWatchlistViewedRef.current) {
      return;
    }

    didMarkWatchlistViewedRef.current = true;
    setWatchlistLastViewedAt(new Date().toISOString());
  }, [loading, preferencesReady]);

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
        const [data, transactions, reports, profile] = await Promise.all([
          api.loadAdminNotificationDeliveries(session.access_token),
          api.loadAdminTransactions(session.access_token),
          api.listAdminReviewReports(session.access_token, "all"),
          api.get<Profile>("/profiles/me", { accessToken: session.access_token }).catch(() => null),
        ]);
        if (!cancelled) {
          setAdmins(data.admins);
          setDeliveries(data.deliveries);
          setDeliverySummary(data.summary);
          setWorkerHealth(data.workerHealth);
          setSummaryFetchedAt(new Date().toLocaleString());
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
          const savedPreferences = normalizeDeliveryOpsPreferences(
            profile?.admin_delivery_ops_preferences ?? DEFAULT_DELIVERY_OPS_PREFERENCES,
          );
          setWatchlistBaselineAt(savedPreferences.watchlistLastViewedAt);
          setWatchlistLastViewedAt(savedPreferences.watchlistLastViewedAt);
          setWatchlistSeverityFilter(savedPreferences.watchlistSeverityFilter);
          setWatchlistNewOnly(savedPreferences.watchlistNewOnly);
          setWatchlistCollapsed(savedPreferences.watchlistCollapsed);
          setWatchlistLastView(savedPreferences.watchlistLastView);
          setWatchlistLastClearedView(savedPreferences.watchlistLastClearedView);
          setPinnedPresetIds(
            savedPreferences.pinnedPresetIds.filter((presetId): presetId is DeliverySavedPresetId =>
              DELIVERY_SAVED_PRESETS.some((preset) => preset.id === presetId),
            ),
          );
          setLastAppliedPresetId(
            DELIVERY_SAVED_PRESETS.some((preset) => preset.id === savedPreferences.lastAppliedPresetId)
              ? (savedPreferences.lastAppliedPresetId as DeliverySavedPresetId)
              : null,
          );
          setActivityFilter(savedPreferences.activityFilter);
          setActivityEntryLimit(savedPreferences.activityEntryLimit);
          setCollapsedActivityGroups(savedPreferences.activityCollapsedGroups);
          setActivityLog(savedPreferences.activityLog);
          if (!hydratedFromProfileRef.current && searchParams.toString().length === 0 && profile) {
            applyQueueState({
              preset: savedPreferences.preset,
              status: savedPreferences.status,
              channel: savedPreferences.channel,
              kind: savedPreferences.kind,
              recency: savedPreferences.recency,
              trust: savedPreferences.trust,
              ownership: savedPreferences.ownership,
              listingHealth: savedPreferences.listingHealth,
            });
            setSearchQuery(savedPreferences.query);
            setExecutionMode(savedPreferences.mode);
            hydratedFromProfileRef.current = true;
          }
          setPreferencesReady(true);
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
          setPreferencesReady(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

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

  function applySavedPreset(presetDefinition: (typeof DELIVERY_SAVED_PRESETS)[number]) {
    applyQueueState({
      preset: presetDefinition.apply.preset,
      status: presetDefinition.apply.status,
      channel: presetDefinition.apply.channel,
      kind: presetDefinition.apply.kind,
      recency: presetDefinition.apply.recency,
      trust: presetDefinition.apply.trust,
      ownership: presetDefinition.apply.ownership,
      listingHealth: presetDefinition.apply.listingHealth,
    });
    setSearchQuery(presetDefinition.apply.query);
    setExecutionMode(presetDefinition.apply.mode);
    setLastAppliedPresetId(presetDefinition.id);
    recordActivity({
      label: presetDefinition.label,
      summary: `Opened the ${presetDefinition.label.toLowerCase()} saved delivery view.`,
      tone: "neutral",
      presetId: presetDefinition.id,
    });
  }

  function reopenSavedPreset(presetId: DeliverySavedPresetId) {
    const presetDefinition = DELIVERY_SAVED_PRESETS.find((preset) => preset.id === presetId);
    if (!presetDefinition) {
      return;
    }
    applySavedPreset(presetDefinition);
  }

  function focusTransaction(transactionKind: DeliveryKindFilter, transactionId: string) {
    applyQueueState({
      preset: "needs_attention",
      status: "all",
      channel: "all",
      kind: transactionKind,
      recency: "all",
      trust: "all",
      ownership: "all",
      listingHealth: "all",
    });
    setSearchQuery(transactionId);
  }
  function reopenActivityLane(entry: Pick<DeliveryOpsActivityEntry, "activityFilterSnapshot" | "activityEntryLimitSnapshot">) {
    setActivityFilter(entry.activityFilterSnapshot ?? "all");
    setActivityEntryLimit(entry.activityEntryLimitSnapshot ?? 6);
    scrollToDeliverySection("delivery-activity-log");
  }

  function togglePinnedPreset(presetId: DeliverySavedPresetId) {
    setPinnedPresetIds((current) =>
      current.includes(presetId) ? current.filter((id) => id !== presetId) : [...current, presetId],
    );
  }

  function recordActivity(entry: Omit<DeliveryOpsActivityEntry, "id" | "createdAt">) {
    setActivityLog((current) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 8));
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
  const executionModeLabel = executionMode === "atomic" ? "Validate First" : "Best Effort";
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
  const failureDiagnostics = useMemo(() => {
    const failedDeliveries = deliveries.filter((delivery) => delivery.delivery_status === "failed");
    const reasons = new Map<string, number>();

    for (const delivery of failedDeliveries) {
      const reason = delivery.failure_reason?.trim() || "Unknown failure";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }

    return {
      failedEmail: failedDeliveries.filter((delivery) => delivery.channel === "email").length,
      failedPush: failedDeliveries.filter((delivery) => delivery.channel === "push").length,
      recentFailures: failedDeliveries.filter((delivery) => isRecentWithinDays(delivery.created_at, 1)).length,
      topReasons: Array.from(reasons.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count })),
    };
  }, [deliveries]);
  const reliabilityStatus = useMemo(() => {
    const stuckProcessing = workerHealth?.stuck_processing_deliveries ?? 0;
    const dueQueued = workerHealth?.due_queued_deliveries ?? 0;
    const batchSize = workerHealth?.batch_size ?? Number.MAX_SAFE_INTEGER;
    const recentWorkerFailures = workerHealth?.recent_failure_deliveries ?? 0;
    const failedDeliveries = deliverySummary?.failed_deliveries ?? 0;
    const staleQueued = deliverySummary?.queued_older_than_1h ?? 0;
    const trustUnassigned = counts.trustDrivenUnassigned;
    const trustOpen = counts.trustDrivenOpen;
    const newFailedSinceVisit = deliveries.filter(
      (delivery) =>
        delivery.delivery_status === "failed" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt),
    ).length;
    const newQueuedSinceVisit = deliveries.filter(
      (delivery) =>
        delivery.delivery_status === "queued" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt),
    ).length;
    const newTrustOpenSinceVisit = deliveries.filter((delivery) => {
      const transactionKey = `${delivery.transaction_kind}:${delivery.transaction_id}`;
      return (
        transactionSupportByKey[transactionKey]?.trustDriven &&
        delivery.delivery_status !== "sent" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt)
      );
    }).length;
    const workerStuckSinceVisit = happenedAfterTimestamp(
      workerHealth?.oldest_stuck_processing_last_attempt_at,
      watchlistBaselineAt,
    );
    const workerDueSinceVisit = happenedAfterTimestamp(
      workerHealth?.oldest_due_queued_created_at,
      watchlistBaselineAt,
    );

    const highSignals: string[] = [];
    const mediumSignals: string[] = [];

    if (stuckProcessing > 0) {
      highSignals.push(
        stuckProcessing === 1
          ? "1 delivery is stuck in processing"
          : `${stuckProcessing} deliveries are stuck in processing`,
      );
    }
    if (dueQueued >= batchSize && dueQueued > 0) {
      highSignals.push(
        `${dueQueued} queued deliveries are due now and exceed the current worker batch size`,
      );
    } else if (dueQueued > 0) {
      mediumSignals.push(
        dueQueued === 1
          ? "1 queued delivery is due now"
          : `${dueQueued} queued deliveries are due now`,
      );
    }
    if (failedDeliveries >= 5) {
      highSignals.push(`${failedDeliveries} deliveries are still failed`);
    } else if (failedDeliveries > 0) {
      mediumSignals.push(
        failedDeliveries === 1
          ? "1 delivery is still failed"
          : `${failedDeliveries} deliveries are still failed`,
      );
    }
    if (staleQueued >= 3) {
      highSignals.push(
        `${staleQueued} queued deliveries are older than one hour`,
      );
    } else if (staleQueued > 0) {
      mediumSignals.push(
        staleQueued === 1
          ? "1 queued delivery is older than one hour"
          : `${staleQueued} queued deliveries are older than one hour`,
      );
    }
    if (trustUnassigned >= 3) {
      highSignals.push(`${trustUnassigned} trust-routed deliveries are still unassigned`);
    } else if (trustOpen > 0) {
      mediumSignals.push(
        trustOpen === 1
          ? "1 trust-routed delivery is still open"
          : `${trustOpen} trust-routed deliveries are still open`,
      );
    }
    if (recentWorkerFailures > 0) {
      mediumSignals.push(
        recentWorkerFailures === 1
          ? "1 recent worker-side delivery failure is visible"
          : `${recentWorkerFailures} recent worker-side delivery failures are visible`,
      );
    }

    const newIssueCount = [
      workerStuckSinceVisit,
      workerDueSinceVisit,
      newFailedSinceVisit > 0,
      newQueuedSinceVisit > 0,
      newTrustOpenSinceVisit > 0,
    ].filter(Boolean).length;
    const sinceReviewSummary = watchlistBaselineAt
      ? newIssueCount > 0
        ? `${newIssueCount} alert area${newIssueCount === 1 ? "" : "s"} worsened since ${formatDateTime(watchlistBaselineAt)}.`
        : `No new delivery regressions since ${formatDateTime(watchlistBaselineAt)}.`
      : "No saved review baseline yet.";

    if (highSignals.length > 0) {
      const primaryAction =
        stuckProcessing > 0
          ? {
              label: "Inspect worker health",
              onClick: () => scrollToDeliverySection("delivery-worker-health"),
            }
          : failedDeliveries >= 5
            ? {
                label: "Open failed deliveries",
                onClick: () =>
                  applyQueueState({
                    preset: "failed_only",
                    status: "failed",
                    channel: "all",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
              }
            : staleQueued > 0 || dueQueued > 0
              ? {
                  label: "Open queued queue",
                  onClick: () =>
                    applyQueueState({
                      preset: "queued_only",
                      status: "queued",
                      channel: "all",
                      kind: "all",
                      recency: "all",
                      trust: "all",
                      ownership: "all",
                    }),
                }
              : trustUnassigned > 0
                ? {
                    label: "Open trust queue",
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
                  }
                : null;

      return {
        label: "Needs attention",
        toneClass: "border-danger/30 bg-danger/8 text-danger",
        summary: "Worker or queue pressure is high enough to risk delayed notification delivery.",
        drivers: highSignals.slice(0, 3),
        primaryAction,
        newIssueCount,
        sinceReviewSummary,
      };
    }

    if (mediumSignals.length > 0) {
      const primaryAction =
        failedDeliveries > 0
          ? {
              label: "Open failed deliveries",
              onClick: () =>
                applyQueueState({
                  preset: "failed_only",
                  status: "failed",
                  channel: "all",
                  kind: "all",
                  recency: "all",
                  trust: "all",
                  ownership: "all",
                }),
            }
          : staleQueued > 0 || dueQueued > 0
            ? {
                label: "Open queued queue",
                onClick: () =>
                  applyQueueState({
                    preset: "queued_only",
                    status: "queued",
                    channel: "all",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
              }
            : trustOpen > 0
              ? {
                  label: "Open trust queue",
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
                }
              : recentWorkerFailures > 0
                ? {
                    label: "Inspect worker health",
                    onClick: () => scrollToDeliverySection("delivery-worker-health"),
                  }
                : null;

      return {
        label: "Degraded",
        toneClass: "border-amber-500/30 bg-amber-500/10 text-amber-700",
        summary: "The queue is still moving, but there are active delivery issues that need review.",
        drivers: mediumSignals.slice(0, 3),
        primaryAction,
        newIssueCount,
        sinceReviewSummary,
      };
    }

    return {
      label: "Healthy",
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      summary: "No significant queue backlog or worker trouble is currently visible.",
      drivers: [
        "No failed-delivery spike is currently visible",
        "Queued backlog is within a healthy range",
        "No trust-routed delivery is waiting unassigned",
      ],
      primaryAction: null,
      newIssueCount,
      sinceReviewSummary,
    };
  }, [
    counts.trustDrivenOpen,
    counts.trustDrivenUnassigned,
    deliveries,
    deliverySummary,
    transactionSupportByKey,
    watchlistBaselineAt,
    workerHealth,
  ]);
  const watchlistAlerts = useMemo(() => {
    if (!deliverySummary) {
      return [];
    }

    const newFailedSinceVisit = deliveries.filter(
      (delivery) =>
        delivery.delivery_status === "failed" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt),
    ).length;
    const newQueuedSinceVisit = deliveries.filter(
      (delivery) =>
        delivery.delivery_status === "queued" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt),
    ).length;
    const newPushFailuresSinceVisit = deliveries.filter(
      (delivery) =>
        delivery.channel === "push" &&
        delivery.delivery_status === "failed" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt),
    ).length;
    const newTrustOpenSinceVisit = deliveries.filter((delivery) => {
      const transactionKey = `${delivery.transaction_kind}:${delivery.transaction_id}`;
      return (
        transactionSupportByKey[transactionKey]?.trustDriven &&
        delivery.delivery_status !== "sent" &&
        happenedAfterTimestamp(delivery.created_at, watchlistBaselineAt)
      );
    }).length;
    const workerStuckSinceVisit = happenedAfterTimestamp(
      workerHealth?.oldest_stuck_processing_last_attempt_at,
      watchlistBaselineAt,
    );
    const workerDueSinceVisit = happenedAfterTimestamp(
      workerHealth?.oldest_due_queued_created_at,
      watchlistBaselineAt,
    );

    const alerts: Array<{
      id: string;
      severity: "high" | "medium" | "monitor";
      title: string;
      detail: string;
      actionLabel: string;
      isNewSinceVisit: boolean;
      onClick: () => void;
    }> = [];

    if (workerHealth?.stuck_processing_deliveries && workerHealth.stuck_processing_deliveries > 0) {
      alerts.push({
        id: "worker-stuck-processing",
        severity: workerHealth.stuck_processing_deliveries >= 3 ? "high" : "medium",
        title: "Worker has stuck processing deliveries",
        detail:
          workerStuckSinceVisit && watchlistBaselineAt
            ? workerHealth.stuck_processing_deliveries === 1
              ? "1 delivery became stuck in processing since your last review."
              : `${workerHealth.stuck_processing_deliveries} deliveries became stuck in processing since your last review.`
            : workerHealth.stuck_processing_deliveries === 1
              ? "1 delivery has been stuck in processing for more than 10 minutes."
              : `${workerHealth.stuck_processing_deliveries} deliveries have been stuck in processing for more than 10 minutes.`,
        actionLabel: "Inspect worker health",
        isNewSinceVisit: workerStuckSinceVisit,
        onClick: () => {
          recordWatchlistAlertAction(
            "worker health",
            workerHealth.stuck_processing_deliveries >= 3 ? "warning" : "neutral",
            "Opened worker health from the watchlist to review stuck processing deliveries.",
          );
          scrollToDeliverySection("delivery-worker-health");
        },
      });
    }

    if (workerHealth?.due_queued_deliveries && workerHealth.due_queued_deliveries > 0) {
      alerts.push({
        id: "worker-due-backlog",
        severity: workerHealth.due_queued_deliveries >= workerHealth.batch_size ? "high" : "monitor",
        title: "Queued work is due right now",
        detail:
          workerDueSinceVisit && watchlistBaselineAt
            ? `${workerHealth.due_queued_deliveries} queued deliveries became due since your last review.`
            : workerHealth.oldest_due_queued_created_at
              ? `${workerHealth.due_queued_deliveries} queued deliveries are due now. Oldest due item is ${formatAgeLabel(workerHealth.oldest_due_queued_created_at)} old.`
              : `${workerHealth.due_queued_deliveries} queued deliveries are due now.`,
        actionLabel: "Open queued queue",
        isNewSinceVisit: workerDueSinceVisit,
        onClick: () => {
          recordWatchlistAlertAction(
            "queued queue",
            workerHealth.due_queued_deliveries >= workerHealth.batch_size ? "warning" : "neutral",
            "Opened the queued delivery slice from the watchlist to review due queued work.",
          );
          applyQueueState({
            preset: "queued_only",
            status: "queued",
            channel: "all",
            kind: "all",
            recency: "all",
            trust: "all",
            ownership: "all",
          });
        },
      });
    }

    if (deliverySummary.failed_last_24h >= 3 || deliverySummary.failed_deliveries >= 5 || newFailedSinceVisit > 0) {
      alerts.push({
        id: "failure-spike",
        severity: deliverySummary.failed_last_24h >= 3 || deliverySummary.failed_deliveries >= 5 ? "high" : "medium",
        title: "Failure spike needs review",
        detail:
          newFailedSinceVisit > 0 && watchlistBaselineAt
            ? `${newFailedSinceVisit} new failure${newFailedSinceVisit === 1 ? "" : "s"} since your last review, with ${deliverySummary.failed_deliveries} still failed overall.`
            : `${deliverySummary.failed_last_24h} failures landed in the last 24h and ${deliverySummary.failed_deliveries} are still failed.`,
        actionLabel: "Open failed deliveries",
        isNewSinceVisit: newFailedSinceVisit > 0,
        onClick: () => {
          recordWatchlistAlertAction(
            "failed deliveries",
            deliverySummary.failed_last_24h >= 3 || deliverySummary.failed_deliveries >= 5 ? "warning" : "neutral",
            "Opened failed deliveries from the watchlist to review the failure spike.",
          );
          applyQueueState({
            preset: "failed_only",
            status: "failed",
            channel: "all",
            kind: "all",
            recency: "all",
            trust: "all",
            ownership: "all",
          });
        },
      });
    }

    if (deliverySummary.queued_older_than_1h > 0) {
      alerts.push({
        id: "stale-queue",
        severity: deliverySummary.queued_older_than_1h >= 3 ? "high" : "medium",
        title: "Queued deliveries are aging",
        detail:
          newQueuedSinceVisit > 0 && watchlistBaselineAt
            ? `${newQueuedSinceVisit} new queued deliver${newQueuedSinceVisit === 1 ? "y was" : "ies were"} added since your last review, and ${deliverySummary.queued_older_than_1h} are now older than one hour.`
            : `${deliverySummary.queued_older_than_1h} queued deliver${deliverySummary.queued_older_than_1h === 1 ? "y is" : "ies are"} older than one hour.`,
        actionLabel: "Open queued queue",
        isNewSinceVisit: newQueuedSinceVisit > 0,
        onClick: () => {
          recordWatchlistAlertAction(
            "queued deliveries",
            deliverySummary.queued_older_than_1h >= 3 ? "warning" : "neutral",
            "Opened queued deliveries from the watchlist to review stale queue items.",
          );
          applyQueueState({
            preset: "queued_only",
            status: "queued",
            channel: "all",
            kind: "all",
            recency: "all",
            trust: "all",
            ownership: "all",
          });
        },
      });
    }

    const pushFailures = deliveries.filter(
      (delivery) => delivery.channel === "push" && delivery.delivery_status === "failed",
    ).length;
    if (pushFailures > 0) {
      alerts.push({
        id: "push-failures",
        severity: pushFailures >= 3 ? "high" : "medium",
        title: "Push delivery failures need triage",
        detail:
          newPushFailuresSinceVisit > 0 && watchlistBaselineAt
            ? `${newPushFailuresSinceVisit} new push failure${newPushFailuresSinceVisit === 1 ? "" : "s"} appeared since your last review, with ${pushFailures} still failed overall.`
            : `${pushFailures} push deliver${pushFailures === 1 ? "y has" : "ies have"} failed and may indicate token or provider issues.`,
        actionLabel: "Open push failures",
        isNewSinceVisit: newPushFailuresSinceVisit > 0,
        onClick: () => {
          recordWatchlistAlertAction(
            "push failures",
            pushFailures >= 3 ? "warning" : "neutral",
            "Opened push failures from the watchlist to review delivery provider or token issues.",
          );
          applyPreset("push_failures");
        },
      });
    }

    if (counts.trustDrivenOpen > 0) {
      alerts.push({
        id: "trust-backlog",
        severity: counts.trustDrivenUnassigned > 0 ? "high" : "monitor",
        title: "Trust-driven notifications are still open",
        detail:
          newTrustOpenSinceVisit > 0 && watchlistBaselineAt
            ? `${newTrustOpenSinceVisit} new trust-routed deliver${newTrustOpenSinceVisit === 1 ? "y opened" : "ies opened"} since your last review, with ${counts.trustDrivenUnassigned} still unassigned.`
            : `${counts.trustDrivenOpen} trust-routed deliver${counts.trustDrivenOpen === 1 ? "y remains" : "ies remain"} open, including ${counts.trustDrivenUnassigned} unassigned.`,
        actionLabel: "Open trust queue",
        isNewSinceVisit: newTrustOpenSinceVisit > 0,
        onClick: () => {
          recordWatchlistAlertAction(
            "trust queue",
            counts.trustDrivenUnassigned > 0 ? "warning" : "neutral",
            "Opened the trust-driven delivery queue from the watchlist to review open trust-routed notifications.",
          );
          applyQueueState({
            preset: "trust_driven",
            status: "all",
            channel: "all",
            kind: "all",
            recency: "week",
            trust: "trust_driven",
            ownership: "all",
          });
        },
      });
    }

    return alerts.sort((left, right) => {
      const severityRank = { high: 0, medium: 1, monitor: 2 };
      return severityRank[left.severity] - severityRank[right.severity];
    });
  }, [
    counts.trustDrivenOpen,
    counts.trustDrivenUnassigned,
    deliveries,
    deliverySummary,
    transactionSupportByKey,
    watchlistBaselineAt,
    workerHealth,
  ]);
  const filteredWatchlistAlerts = useMemo(() => {
    let nextAlerts = watchlistAlerts;
    if (watchlistSeverityFilter !== "all") {
      nextAlerts = nextAlerts.filter((alert) => alert.severity === watchlistSeverityFilter);
    }
    if (watchlistNewOnly) {
      nextAlerts = nextAlerts.filter((alert) => alert.isNewSinceVisit);
    }
    return nextAlerts;
  }, [watchlistAlerts, watchlistNewOnly, watchlistSeverityFilter]);
  const watchlistFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (watchlistSeverityFilter !== "all") {
      parts.push(`${watchlistSeverityFilter} only`);
    }
    if (watchlistNewOnly) {
      parts.push("new since review");
    }
    return parts.length > 0 ? parts.join(" · ") : "all active alerts";
  }, [watchlistNewOnly, watchlistSeverityFilter]);
  function exportActivityLogCsv() {
    if (filteredActivityLog.length === 0) {
      return;
    }

    const rows: Array<Array<string | number | boolean | null | undefined>> = [
      [
        "label",
        "lane",
        "subtype",
        "summary",
        "tone",
        "created_at",
        "preset_id",
        "transaction_kind",
        "transaction_id",
        "watchlist_slice",
      ],
      ...filteredActivityLog.map((entry) => [
        entry.label,
        entry.watchlistTarget ? "watchlist" : isSavedViewActivity(entry) ? "view" : "operation",
        entry.watchlistTarget
          ? formatWatchlistBadgeLabel(entry)
          : isSavedViewActivity(entry)
            ? getSavedViewActivityLabel(entry)
            : getOperationActivityLabel(entry),
        entry.summary,
        entry.tone,
        entry.createdAt,
        entry.presetId ?? "",
        entry.transactionKind ?? "",
        entry.transactionId ?? "",
        entry.watchlistTarget ? formatWatchlistActivityLabel(entry) : "",
      ]),
    ];

    downloadCsv(`delivery-activity-${activityFilter}-${activityEntryLimit}.csv`, rows);
    recordActivity({
      label: "Export delivery activity CSV",
      summary: `Exported ${filteredActivityLog.length} delivery activity entr${filteredActivityLog.length === 1 ? "y" : "ies"} from the ${activityFilter} lane view.`,
      tone: "neutral",
      activityFilterSnapshot: activityFilter,
      activityEntryLimitSnapshot: activityEntryLimit,
    });
  }
  function exportWatchlistCsv() {
    if (filteredWatchlistAlerts.length === 0) {
      return;
    }

    const rows: Array<Array<string | number | boolean | null | undefined>> = [
      ["title", "severity", "status", "detail", "action_label", "current_filter"],
      ...filteredWatchlistAlerts.map((alert) => [
        alert.title,
        alert.severity,
        alert.isNewSinceVisit ? "new_since_review" : "ongoing",
        alert.detail,
        alert.actionLabel,
        watchlistFilterSummary,
      ]),
    ];

    downloadCsv(
      `delivery-watchlist-${watchlistSeverityFilter}-${watchlistNewOnly ? "new" : "all"}.csv`,
      rows,
    );
    recordActivity({
      label: "Export delivery watchlist CSV",
      summary: `Exported ${filteredWatchlistAlerts.length} watchlist alert${filteredWatchlistAlerts.length === 1 ? "" : "s"} from the ${watchlistFilterSummary} slice.`,
      tone: "neutral",
      watchlistTarget: "delivery-watchlist",
      watchlistSeverityFilter,
      watchlistNewOnly,
    });
  }
  const hasActiveWatchlistFilters = watchlistSeverityFilter !== "all" || watchlistNewOnly;
  const watchlistCounts = useMemo(
    () => ({
      all: watchlistAlerts.length,
      high: watchlistAlerts.filter((alert) => alert.severity === "high").length,
      medium: watchlistAlerts.filter((alert) => alert.severity === "medium").length,
      monitor: watchlistAlerts.filter((alert) => alert.severity === "monitor").length,
      newSinceReview: watchlistAlerts.filter((alert) => alert.isNewSinceVisit).length,
    }),
    [watchlistAlerts],
  );
  const watchlistSummaryOptions = useMemo(
    () =>
      [
        {
          key: "all",
          label: `All alerts: ${watchlistCounts.all}`,
          active: !hasActiveWatchlistFilters,
          onClick: () => applyWatchlistFilter("all", false, "summary"),
          classNameWhenInactive: "border-border bg-background/80 hover:border-foreground/28 hover:text-foreground",
          classNameWhenActive: "border-foreground bg-foreground text-background",
        },
        {
          key: "new",
          label: `New since review: ${watchlistCounts.newSinceReview}`,
          active: watchlistNewOnly,
          onClick: () => applyWatchlistFilter("all", true, "summary"),
          hidden: !watchlistBaselineAt,
          classNameWhenInactive: "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100",
          classNameWhenActive: "border-sky-600 bg-sky-600 text-white",
        },
        {
          key: "high",
          label: `High: ${watchlistCounts.high}`,
          active: watchlistSeverityFilter === "high" && !watchlistNewOnly,
          onClick: () => applyWatchlistFilter("high", false, "summary"),
          classNameWhenInactive: "border-danger/25 bg-danger/8 hover:bg-danger/12",
          classNameWhenActive: "border-danger bg-danger text-white",
        },
        {
          key: "medium",
          label: `Medium: ${watchlistCounts.medium}`,
          active: watchlistSeverityFilter === "medium" && !watchlistNewOnly,
          onClick: () => applyWatchlistFilter("medium", false, "summary"),
          classNameWhenInactive: "border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/15",
          classNameWhenActive: "border-amber-600 bg-amber-600 text-white",
        },
        {
          key: "monitor",
          label: `Monitor: ${watchlistCounts.monitor}`,
          active: watchlistSeverityFilter === "monitor" && !watchlistNewOnly,
          onClick: () => applyWatchlistFilter("monitor", false, "summary"),
          classNameWhenInactive: "border-border bg-background/80 hover:border-foreground/28 hover:text-foreground",
          classNameWhenActive: "border-foreground bg-foreground text-background",
        },
      ] as const,
    [hasActiveWatchlistFilters, watchlistBaselineAt, watchlistCounts, watchlistNewOnly, watchlistSeverityFilter],
  );
  const watchlistFilterOptions = useMemo(
    () =>
      [
        { key: "all" as const, label: `All alerts (${watchlistCounts.all})`, value: "all" as DeliveryWatchlistSeverityFilter },
        { key: "high" as const, label: `High (${watchlistCounts.high})`, value: "high" as DeliveryWatchlistSeverityFilter },
        { key: "medium" as const, label: `Medium (${watchlistCounts.medium})`, value: "medium" as DeliveryWatchlistSeverityFilter },
        { key: "monitor" as const, label: `Monitor (${watchlistCounts.monitor})`, value: "monitor" as DeliveryWatchlistSeverityFilter },
      ] as const,
    [watchlistCounts],
  );
  const pinnedPresets = useMemo(
    () =>
      pinnedPresetIds
        .map((presetId) => DELIVERY_SAVED_PRESETS.find((preset) => preset.id === presetId) ?? null)
        .filter((preset): preset is (typeof DELIVERY_SAVED_PRESETS)[number] => preset !== null),
    [pinnedPresetIds],
  );
  const activityCounts = useMemo(
    () => ({
      all: activityLog.length,
      watchlist: activityLog.filter((entry) => Boolean(entry.watchlistTarget)).length,
      views: activityLog.filter((entry) => isSavedViewActivity(entry)).length,
      operations: activityLog.filter((entry) => !entry.watchlistTarget && !isSavedViewActivity(entry)).length,
    }),
    [activityLog],
  );
  const activityFilterOptions = useMemo(
    () =>
      [
        {
          value: "all" as DeliveryActivityFilter,
          label: `All lanes (${activityCounts.all})`,
          legendLabel: `All lanes (${activityCounts.all})`,
          activeClassName: "border-foreground bg-foreground text-background",
        },
        {
          value: "watchlist" as DeliveryActivityFilter,
          label: `Watchlist (${activityCounts.watchlist})`,
          legendLabel: `1. Watchlist (${activityCounts.watchlist})`,
          activeClassName: "border-sky-200 bg-sky-50 text-sky-700",
        },
        {
          value: "views" as DeliveryActivityFilter,
          label: `Views (${activityCounts.views})`,
          legendLabel: `2. Views (${activityCounts.views})`,
          activeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
        },
        {
          value: "operations" as DeliveryActivityFilter,
          label: `Operations (${activityCounts.operations})`,
          legendLabel: `3. Operations (${activityCounts.operations})`,
          activeClassName: "border-amber-200 bg-amber-50 text-amber-700",
        },
      ] as const,
    [activityCounts],
  );
  const activityEntryLimitOptions = useMemo(
    () =>
      [
        { value: 6 as const, label: "Show 6" },
        { value: 10 as const, label: "Show 10" },
      ] as const,
    [],
  );
  const filteredActivityLog = useMemo(() => {
    if (activityFilter === "views") {
      return activityLog.filter((entry) => isSavedViewActivity(entry)).slice(0, activityEntryLimit);
    }
    if (activityFilter === "watchlist") {
      return activityLog.filter((entry) => Boolean(entry.watchlistTarget)).slice(0, activityEntryLimit);
    }
    if (activityFilter === "operations") {
      return activityLog
        .filter((entry) => !entry.watchlistTarget && !isSavedViewActivity(entry))
        .slice(0, activityEntryLimit);
    }
    return [...activityLog]
      .sort((left, right) => {
        const leftRank = left.watchlistTarget ? 0 : isSavedViewActivity(left) ? 1 : 2;
        const rightRank = right.watchlistTarget ? 0 : isSavedViewActivity(right) ? 1 : 2;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      })
      .slice(0, activityEntryLimit);
  }, [activityEntryLimit, activityFilter, activityLog]);
  const groupedActivityLog = useMemo(() => {
    const groups: Array<{ label: string; entries: DeliveryOpsActivityEntry[] }> = [];
    for (const entry of filteredActivityLog) {
      const label = getActivityDayLabel(entry.createdAt);
      const existing = groups.find((group) => group.label === label);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ label, entries: [entry] });
      }
    }
    return groups;
  }, [filteredActivityLog]);
  const latestWatchlistActivity = useMemo(
    () => activityLog.find((entry) => Boolean(entry.watchlistTarget)) ?? null,
    [activityLog],
  );
  const latestClearedWatchlistActivity = useMemo(
    () =>
      activityLog.find(
        (entry) => entry.label === "Clear saved watchlist view" && Boolean(entry.watchlistTarget),
      ) ?? null,
    [activityLog],
  );
  function renderActivityFilterButton(
    option: (typeof activityFilterOptions)[number],
    label: string,
    size: "compact" | "full",
  ) {
    const active = activityFilter === option.value;
    return (
      <button
        key={`${size}-${option.value}`}
        type="button"
        onClick={() => setActivityFilter(option.value)}
        className={`rounded-full border font-semibold uppercase tracking-[0.18em] transition ${
          size === "compact" ? "px-2 py-1 text-[10px]" : "px-3 py-1 text-[11px]"
        } ${
          active
            ? option.activeClassName
            : "border-border bg-background/80 text-foreground/62 hover:border-foreground/28 hover:text-foreground"
        }`}
      >
        {label}
      </button>
    );
  }
  function renderActivityEntryLimitButton(option: (typeof activityEntryLimitOptions)[number]) {
    const active = activityEntryLimit === option.value;
    return (
      <button
        key={option.value}
        type="button"
        onClick={() => setActivityEntryLimit(option.value)}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
          active
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background/80 text-foreground/62 hover:border-foreground/28 hover:text-foreground"
        }`}
      >
        {option.label}
      </button>
    );
  }
  function renderActivityToolbarButton(
    key: string,
    label: string,
    onClick: () => void,
    disabled: boolean,
  ) {
    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
          disabled
            ? "cursor-not-allowed border-border/60 bg-background/40 text-foreground/38"
            : "border-border bg-background/80 text-foreground/62 hover:border-foreground/28 hover:text-foreground"
        }`}
      >
        {label}
      </button>
    );
  }
  function renderActivitySecondaryActionButton(
    key: string,
    label: string,
    onClick: () => void,
  ) {
    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className="rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/62 transition hover:border-foreground/28 hover:text-foreground"
      >
        {label}
      </button>
    );
  }
  function renderSurfaceActionButton(
    key: string,
    label: string,
    onClick: () => void,
    tone: "primary" | "muted" = "primary",
  ) {
    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className={`rounded-full border bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition hover:border-foreground/28 ${
          tone === "primary"
            ? "border-border text-foreground"
            : "border-border text-foreground/72 hover:text-foreground"
        }`}
      >
        {label}
      </button>
    );
  }
  function renderReliabilityActionButton(
    key: string,
    label: string,
    onClick: () => void,
  ) {
    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className="rounded-full border border-current/20 bg-background/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-current transition hover:bg-background"
      >
        {label}
      </button>
    );
  }
  function renderReliabilityPill(
    key: string,
    label: string,
    onClick?: () => void,
    tone: "default" | "muted" = "default",
  ) {
    const className =
      tone === "muted"
        ? "rounded-full border border-current/15 bg-background/60 px-3 py-1 text-current/80"
        : "rounded-full border border-current/15 bg-background/60 px-3 py-1 text-current";

    if (!onClick) {
      return <span key={key} className={className}>{label}</span>;
    }

    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className={`${className} transition hover:bg-background`}
      >
        {label}
      </button>
    );
  }
  function renderMetricButtonCard({
    key,
    label,
    value,
    detail,
    onClick,
    tone = "neutral",
    surface = "elevated",
    detailSize = "sm",
  }: {
    key: string;
    label: string;
    value: string;
    detail?: string;
    onClick: () => void;
    tone?: "danger" | "warning" | "neutral";
    surface?: "elevated" | "muted";
    detailSize?: "xs" | "sm";
  }) {
    const toneClassName =
      tone === "danger"
        ? "border-danger/30 bg-danger/8"
        : tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10"
          : surface === "muted"
            ? "border-border bg-background/70"
            : "border-border bg-surface";

    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className={`rounded-[1.5rem] border p-4 text-left transition hover:border-foreground/28 ${
          surface === "elevated" ? "card-shadow " : ""
        }${toneClassName}`}
      >
        <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{value}</p>
        {detail ? (
          <p className={`mt-2 text-foreground/64 ${detailSize === "xs" ? "text-xs" : "text-sm"}`}>
            {detail}
          </p>
        ) : null}
      </button>
    );
  }
  function renderDetailButtonCard({
    key,
    label,
    detail,
    onClick,
  }: {
    key: string;
    label: string;
    detail: string;
    onClick: () => void;
  }) {
    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className="card-shadow rounded-[1.5rem] border border-border bg-surface p-4 text-left transition hover:border-foreground/28"
      >
        <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{label}</p>
        <p className="mt-3 text-sm leading-6 text-foreground/72">{detail}</p>
      </button>
    );
  }
  function renderLabeledValueBlock({
    key,
    label,
    value,
    valueClassName = "mt-1 text-foreground",
  }: {
    key: string;
    label: string;
    value: React.ReactNode;
    valueClassName?: string;
  }) {
    return (
      <div key={key}>
        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">{label}</p>
        <p className={valueClassName}>{value}</p>
      </div>
    );
  }
  function renderInsetPanel({
    key,
    title,
    subtitle,
    padding = "md",
    bodyClassName,
    children,
  }: {
    key: string;
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    padding?: "md" | "sm";
    bodyClassName?: string;
    children: React.ReactNode;
  }) {
    const paddingClassName = padding === "sm" ? "p-3" : "p-4";
    return (
      <div
        key={key}
        className={`rounded-[1.25rem] border border-border bg-background/75 ${paddingClassName}${bodyClassName ? ` ${bodyClassName}` : ""}`}
      >
        {title || subtitle ? (
          <div className="flex items-center justify-between gap-3">
            {title ? (
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-foreground/46">
                {title}
              </p>
            ) : <span />}
            {subtitle ? <p className="text-xs text-foreground/48">{subtitle}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    );
  }
  function renderDangerMessagePanel(
    key: string,
    message: string,
  ) {
    return (
      <p
        key={key}
        className="rounded-2xl border border-danger/20 bg-background/70 px-3 py-3 text-sm leading-6 text-danger"
      >
        {message}
      </p>
    );
  }
  function renderInfoSummaryPanel({
    key,
    lines,
  }: {
    key: string;
    lines: string[];
  }) {
    return (
      <div
        key={key}
        className="rounded-[1.25rem] border border-border bg-background px-3 py-3 text-xs text-foreground/58"
      >
        {lines.map((line, index) => (
          <p key={`${key}-${index}`} className={index === 0 ? undefined : "mt-2"}>
            {line}
          </p>
        ))}
      </div>
    );
  }
  function renderDashedStatePanel({
    key,
    message,
    className = "bg-background/60 px-4 py-4 text-sm text-foreground/62",
  }: {
    key: string;
    message: React.ReactNode;
    className?: string;
  }) {
    return (
      <div key={key} className={`rounded-[1.5rem] border border-dashed border-border ${className}`}>
        {message}
      </div>
    );
  }
  function renderFeedbackBanner({
    key,
    tone,
    message,
  }: {
    key: string;
    tone: "success" | "error";
    message: string;
  }) {
    return (
      <div
        key={key}
        className={`mt-4 rounded-[1.25rem] border px-4 py-3 text-sm ${
          tone === "success"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
            : "border-danger/30 bg-danger/8 text-danger"
        }`}
      >
        {message}
      </div>
    );
  }
  function renderQueueConfirmationPanel({
    key,
    title,
    description,
    actions,
  }: {
    key: string;
    title: string;
    description: React.ReactNode;
    actions: React.ReactNode;
  }) {
    return renderInsetPanel({
      key,
      bodyClassName: "mt-4",
      children: (
        <>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <div className="mt-2 text-sm text-foreground/66">{description}</div>
          <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
        </>
      ),
    });
  }
  function renderQueueModePill(key: string, label: string) {
    return (
      <span
        key={key}
        className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/64"
      >
        {label}
      </span>
    );
  }
  function renderMetricStaticCard({
    key,
    label,
    value,
    detail,
    tone = "neutral",
    surface = "muted",
    detailSize = "xs",
  }: {
    key: string;
    label: string;
    value: string;
    detail?: string;
    tone?: "danger" | "warning" | "neutral";
    surface?: "elevated" | "muted";
    detailSize?: "xs" | "sm";
  }) {
    const toneClassName =
      tone === "danger"
        ? "border-danger/30 bg-danger/8"
        : tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10"
          : surface === "muted"
            ? "border-border bg-background/70"
            : "border-border bg-surface";

    return (
      <article
        key={key}
        className={`rounded-[1.5rem] border p-4 ${
          surface === "elevated" ? "card-shadow " : ""
        }${toneClassName}`}
      >
        <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">{value}</p>
        {detail ? (
          <p className={`mt-2 text-foreground/62 ${detailSize === "xs" ? "text-xs" : "text-sm"}`}>
            {detail}
          </p>
        ) : null}
      </article>
    );
  }
  function renderInfoPill(
    key: string,
    label: string,
    onClick?: () => void,
  ) {
    if (!onClick) {
      return (
        <span key={key} className="rounded-full border border-border bg-background/80 px-3 py-1">
          {label}
        </span>
      );
    }

    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className="rounded-full border border-border bg-background/80 px-3 py-1 transition hover:border-foreground/28 hover:text-foreground"
      >
        {label}
      </button>
    );
  }
  function renderSurfaceSectionHeader({
    eyebrow,
    title,
    description,
    meta,
  }: {
    eyebrow: string;
    title: string;
    description: string;
    meta?: React.ReactNode;
  }) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">{eyebrow}</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-foreground/66">{description}</p>
        </div>
        {meta ? <div className="text-right text-xs text-foreground/56">{meta}</div> : null}
      </div>
    );
  }
  function renderSurfaceCardSection({
    key,
    id,
    className = "",
    children,
  }: {
    key?: string;
    id?: string;
    className?: string;
    children: React.ReactNode;
  }) {
    return (
      <section
        key={key}
        id={id}
        className={`card-shadow rounded-[2rem] border border-border bg-surface p-5${className ? ` ${className}` : ""}`}
      >
        {children}
      </section>
    );
  }
  function renderSurfaceStateCard(
    message: React.ReactNode,
    tone: "neutral" | "danger" = "neutral",
  ) {
    return (
      <section
        className={`card-shadow rounded-[2rem] border p-6 text-sm ${
          tone === "danger"
            ? "border-danger/30 bg-danger/8 text-danger"
            : "border-border bg-surface text-foreground/66"
        }`}
      >
        {message}
      </section>
    );
  }
  function renderSavedPresetCard({
    presetDefinition,
    statusBadges,
    primaryActionKey,
    secondaryActionKey,
    secondaryActionLabel,
  }: {
    presetDefinition: (typeof DELIVERY_SAVED_PRESETS)[number];
    statusBadges?: React.ReactNode;
    primaryActionKey: string;
    secondaryActionKey: string;
    secondaryActionLabel: string;
  }) {
    return (
      <article key={presetDefinition.id} className="rounded-[1.5rem] border border-border bg-background/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{presetDefinition.label}</p>
            <p className="mt-2 text-sm leading-6 text-foreground/66">{presetDefinition.description}</p>
          </div>
          {statusBadges ? <div className="flex flex-wrap items-center justify-end gap-2">{statusBadges}</div> : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {renderSurfaceActionButton(
            primaryActionKey,
            "Open view",
            () => applySavedPreset(presetDefinition),
          )}
          {renderSurfaceActionButton(
            secondaryActionKey,
            secondaryActionLabel,
            () => togglePinnedPreset(presetDefinition.id),
            "muted",
          )}
        </div>
      </article>
    );
  }
  function renderCurrentSlicePanel(onResetToDefault?: () => void) {
    return (
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
            {!isDefaultSlice && onResetToDefault ? (
              <button
                type="button"
                onClick={onResetToDefault}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
              >
                Reset To Default
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  function renderDeliveryQueueHeader(visibleCount: number) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-foreground/48">Delivery Queue</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            {visibleCount} visible deliver{visibleCount === 1 ? "y" : "ies"}
          </h2>
        </div>
        <p className="max-w-md text-right text-sm text-foreground/64">
          This queue is for communication failures, retries, and channel-specific delivery triage.
        </p>
      </div>
    );
  }
  function renderQueuePresetStrip(
    activePreset: DeliveryPreset,
    onSelect: (preset: DeliveryPreset) => void,
  ) {
    return (
      <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
        {[
          { label: "Needs Attention", value: "needs_attention" as DeliveryPreset },
          { label: "Failed Only", value: "failed_only" as DeliveryPreset },
          { label: "Queued Only", value: "queued_only" as DeliveryPreset },
          { label: "Push Failures", value: "push_failures" as DeliveryPreset },
          { label: "Trust-Driven", value: "trust_driven" as DeliveryPreset },
        ].map((option) =>
          renderSegmentedFilterButton(
            option.value,
            option.label,
            activePreset === option.value,
            () => onSelect(option.value),
          ),
        )}
      </div>
    );
  }
  function renderQueueSearchField(value: string, onChange: (nextValue: string) => void) {
    return (
      <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm text-foreground/72">
        Search
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search by transaction, recipient, payload, or failure"
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
        />
      </label>
    );
  }
  function renderMetricGrid(
    key: string,
    className: string,
    children: React.ReactNode,
  ) {
    return (
      <div key={key} className={className}>
        {children}
      </div>
    );
  }
  function renderSegmentedFilterButton(
    key: string,
    label: string,
    active: boolean,
    onClick: () => void,
  ) {
    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className={`rounded-full border px-4 py-2 text-sm transition ${
          active
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-foreground/72 hover:border-foreground/28"
        }`}
      >
        {label}
      </button>
    );
  }
  function renderFilterGroup({
    key,
    label,
    children,
    className = "flex flex-col gap-2 text-sm text-foreground/72",
  }: {
    key: string;
    label: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <div key={key} className={className}>
        <span>{label}</span>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    );
  }
  function renderQueueActionButton({
    key,
    label,
    onClick,
    disabled = false,
    tone = "neutral",
    surface = "background",
  }: {
    key: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: "primary" | "neutral" | "danger";
    surface?: "background" | "surface";
  }) {
    const className =
      tone === "primary"
        ? "border-foreground bg-foreground text-background hover:opacity-90"
        : tone === "danger"
          ? "border-danger/30 bg-danger/8 text-danger hover:border-danger/45"
          : surface === "surface"
            ? "border-border bg-surface text-foreground/72 hover:border-foreground/28"
            : "border-border bg-background text-foreground/72 hover:border-foreground/28";

    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`rounded-full border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        {label}
      </button>
    );
  }
  function renderQueueLinkAction(
    key: string,
    href: string,
    label: string,
  ) {
    return (
      <Link
        key={key}
        href={href}
        className="rounded-full border border-border bg-surface px-4 py-2 text-center text-sm text-foreground/72 transition hover:border-foreground/28"
      >
        {label}
      </Link>
    );
  }
  function renderDeliveryRowPill(
    key: string,
    label: string,
    tone: "surface" | "danger" | "status_failed" | "status_queued" | "status_sent" = "surface",
    tracking: string = "tracking-[0.18em]",
  ) {
    const toneClassName =
      tone === "danger"
        ? "border-danger/30 bg-danger/8 text-danger"
        : tone === "status_failed"
          ? "border-danger/30 bg-danger/8 text-danger"
          : tone === "status_queued"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
            : tone === "status_sent"
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700"
              : "border-border bg-surface text-foreground/56";

    return (
      <span
        key={key}
        className={`rounded-full border px-3 py-1 text-xs uppercase ${tracking} ${toneClassName}`}
      >
        {label}
      </span>
    );
  }
  function renderDeliveryRowSurface({
    key,
    status,
    children,
  }: {
    key: string;
    status: NotificationDelivery["delivery_status"];
    children: React.ReactNode;
  }) {
    const className =
      status === "failed"
        ? "border-danger/30 bg-danger/8"
        : status === "queued"
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-border bg-background/65";

    return (
      <article key={key} className={`rounded-[1.5rem] border p-4 ${className}`}>
        {children}
      </article>
    );
  }
  function renderDeliveryRowHeader({
    delivery,
    trustSummary,
  }: {
    delivery: NotificationDelivery;
    trustSummary: ReturnType<typeof getSellerTrustSummary>;
  }) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {renderDeliveryRowPill(
            `delivery-channel-${delivery.id}`,
            delivery.channel,
            "surface",
            "tracking-[0.22em]",
          )}
          {renderDeliveryRowPill(`delivery-kind-${delivery.id}`, delivery.transaction_kind)}
          {renderDeliveryRowPill(
            `delivery-status-${delivery.id}`,
            delivery.delivery_status.replaceAll("_", " "),
            delivery.delivery_status === "failed"
              ? "status_failed"
              : delivery.delivery_status === "queued"
                ? "status_queued"
                : "status_sent",
          )}
          <span className="text-xs text-foreground/48">#{truncateId(delivery.id)}</span>
        </div>

        <div className="grid gap-3 text-sm text-foreground/68 sm:grid-cols-2 xl:grid-cols-5">
          {renderLabeledValueBlock({
            key: `delivery-transaction-${delivery.id}`,
            label: "Transaction",
            value: truncateId(delivery.transaction_id),
            valueClassName: "mt-1 font-mono text-xs text-foreground",
          })}
          {renderLabeledValueBlock({
            key: `delivery-recipient-${delivery.id}`,
            label: "Recipient",
            value: truncateId(delivery.recipient_user_id),
            valueClassName: "mt-1 font-mono text-xs text-foreground",
          })}
          {renderLabeledValueBlock({
            key: `delivery-attempts-${delivery.id}`,
            label: "Attempts",
            value: delivery.attempts,
          })}
          {renderLabeledValueBlock({
            key: `delivery-created-${delivery.id}`,
            label: "Created",
            value: formatDateTime(delivery.created_at),
          })}
          {renderLabeledValueBlock({
            key: `delivery-age-${delivery.id}`,
            label: "Age",
            value: formatAgeLabel(delivery.created_at),
          })}
        </div>

        {trustSummary.total > 0 ? (
          <div className="flex flex-wrap gap-2">
            {renderDeliveryRowPill(`trust-flags-${delivery.id}`, "Seller Trust Flags", "danger")}
            {renderDeliveryRowPill(`trust-open-${delivery.id}`, `${trustSummary.open} open`)}
            {renderDeliveryRowPill(`trust-escalated-${delivery.id}`, `${trustSummary.escalated} escalated`)}
            {renderDeliveryRowPill(`trust-hidden-${delivery.id}`, `${trustSummary.hidden} hidden`)}
          </div>
        ) : null}
      </>
    );
  }
  function renderListingOpsContextPanel({
    deliveryId,
    listingOpsContext,
    browseContext,
  }: {
    deliveryId: string;
    listingOpsContext: ListingOpsContext | null;
    browseContext: string | null | undefined;
  }) {
    if (!listingOpsContext) {
      return null;
    }

    const tractionPill = getListingTractionPill(listingOpsContext.listing);
    const comparisonScopeBadge = getListingComparisonScopeBadge(
      listingOpsContext.listing.last_pricing_comparison_scope,
    );
    const browseSignals = [
      isPriceDrivenBrowseContext(browseContext) ? "Price-led" : null,
      isSearchDrivenBrowseContext(browseContext) ? "Search-led" : null,
      isLocalDrivenBrowseContext(browseContext) ? "Local-fit" : null,
    ].filter(Boolean);

    return renderInsetPanel({
      key: `listing-ops-context-${deliveryId}`,
      padding: "md",
      children: (
        <>
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
              <div className="mt-2 flex flex-wrap gap-2">
                {listingOpsContext.listing.available_today
                  ? renderMiniTonePill(
                      `listing-available-today-${deliveryId}`,
                      "Available today",
                      "border-emerald-200 bg-emerald-50 text-emerald-700",
                    )
                  : null}
                {tractionPill
                  ? renderMiniTonePill(
                      `listing-traction-${deliveryId}`,
                      tractionPill.label,
                      tractionPill.className,
                    )
                  : null}
                {comparisonScopeBadge
                  ? renderMiniTonePill(
                      `listing-comparison-scope-${deliveryId}`,
                      comparisonScopeBadge.label,
                      comparisonScopeBadge.className,
                    )
                  : null}
              </div>
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
            {renderLabeledValueBlock({
              key: `listing-last-change-${deliveryId}`,
              label: "Last Change",
              value:
                listingOpsContext.adjustmentSummary?.trim() || "No operating adjustment recorded",
            })}
            {renderLabeledValueBlock({
              key: `listing-since-change-${deliveryId}`,
              label: "Since Change",
              value: `${listingOpsContext.sameSellerPostAdjustmentCount} retained · ${listingOpsContext.crossSellerPostAdjustmentCount} branched`,
            })}
            {renderLabeledValueBlock({
              key: `listing-follow-on-${deliveryId}`,
              label: "Follow-On Mix",
              value: `${listingOpsContext.sameSellerCount} same-seller · ${listingOpsContext.crossSellerCount} cross-seller`,
            })}
            {renderLabeledValueBlock({
              key: `listing-browse-pressure-${deliveryId}`,
              label: "Browse Pressure",
              value: browseSignals.length > 0 ? browseSignals.join(" · ") : "No browse signal",
            })}
          </div>
        </>
      ),
    });
  }
  function renderDeliveryRowDetailStack({
    delivery,
    transactionKey,
  }: {
    delivery: NotificationDelivery;
    transactionKey: string;
  }) {
    return (
      <>
        {delivery.failure_reason
          ? renderDangerMessagePanel(`delivery-failure-reason-${delivery.id}`, delivery.failure_reason)
          : null}

        {renderInsetPanel({
          key: `payload-${delivery.id}`,
          title: "Payload",
          padding: "sm",
          bodyClassName: "text-xs text-foreground/62",
          children: (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-6">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          ),
        })}

        {renderInsetPanel({
          key: `support-note-${delivery.id}`,
          title: "Support Note",
          subtitle: "Travels with assign and escalate actions",
          padding: "sm",
          children: (
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
          ),
        })}
      </>
    );
  }
  function renderMiniTonePill(
    key: string,
    label: string,
    className: string,
  ) {
    return (
      <span
        key={key}
        className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${className}`}
      >
        {label}
      </span>
    );
  }
  function renderDangerCountPill(key: string, label: string) {
    return (
      <span
        key={key}
        className="rounded-full border border-danger/25 bg-danger/8 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-danger"
      >
        {label}
      </span>
    );
  }
  function renderCompactStatusBadge(
    key: string,
    label: string,
    tone: "sky" | "emerald" | "amber" | "neutral" | "muted",
  ) {
    const toneClassName =
      tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : tone === "neutral"
              ? "border-border bg-background text-foreground/62"
              : "border-current/15 text-foreground/64";

    return (
      <span
        key={key}
        className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${toneClassName}`}
      >
        {label}
      </span>
    );
  }
  function renderActivityHighlightedActionButton(
    key: string,
    label: string,
    onClick: () => void,
    tone: "sky" | "amber",
  ) {
    const toneClassName =
      tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100"
        : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100";

    return (
      <button
        key={key}
        type="button"
        onClick={onClick}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${toneClassName}`}
      >
        {label}
      </button>
    );
  }
  function renderActivityStatusBadge(
    key: string,
    label: string,
    tone: "sky" | "amber",
  ) {
    const toneClassName =
      tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-amber-200 bg-amber-50 text-amber-700";

    return (
      <span
        key={key}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClassName}`}
      >
        {label}
      </span>
    );
  }
  function renderWatchlistSummaryButton(
    option: (typeof watchlistSummaryOptions)[number],
    keyPrefix: string,
    beforeClick?: () => void,
  ) {
    if (option.hidden) {
      return null;
    }

    return (
      <button
        key={`${keyPrefix}-${option.key}`}
        type="button"
        onClick={() => {
          beforeClick?.();
          option.onClick();
        }}
        className={`rounded-full border px-3 py-1 transition ${
          option.active ? option.classNameWhenActive : option.classNameWhenInactive
        }`}
      >
        {option.label}
      </button>
    );
  }
  function renderWatchlistFilterButton(option: (typeof watchlistFilterOptions)[number]) {
    const active = watchlistSeverityFilter === option.value;
    return (
      <button
        key={option.key}
        type="button"
        onClick={() => applyWatchlistFilter(option.value, false, "filters")}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
          active
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background/80 text-foreground/62 hover:border-foreground/28 hover:text-foreground"
        }`}
      >
        {option.label}
      </button>
    );
  }
  function renderWatchlistNewOnlyFilterButton() {
    const disabled = !watchlistBaselineAt || watchlistCounts.newSinceReview === 0;
    return (
      <button
        key="watchlist-new-only"
        type="button"
        onClick={() => applyWatchlistFilter(watchlistSeverityFilter, !watchlistNewOnly, "filters")}
        disabled={disabled}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
          watchlistNewOnly
            ? "border-sky-600 bg-sky-600 text-white"
            : disabled
              ? "cursor-not-allowed border-border/60 bg-background/40 text-foreground/38"
              : "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100"
        }`}
      >
        New since review
      </button>
    );
  }
  function renderWatchlistClearFiltersButton() {
    if (!hasActiveWatchlistFilters) {
      return null;
    }

    return (
      <button
        key="watchlist-clear-filters"
        type="button"
        onClick={() => {
          applyWatchlistFilter("all", false, "filters");
        }}
        className="rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/62 transition hover:border-foreground/28 hover:text-foreground"
      >
        Clear filters
      </button>
    );
  }
  const latestWatchlistView = watchlistLastView
    ? watchlistLastView
    : latestWatchlistActivity
      ? {
          severityFilter: latestWatchlistActivity.watchlistSeverityFilter ?? "all",
          newOnly: latestWatchlistActivity.watchlistNewOnly ?? false,
          viewedAt: latestWatchlistActivity.createdAt,
        }
      : null;
  const latestClearedWatchlistView = watchlistLastClearedView
    ? watchlistLastClearedView
    : latestClearedWatchlistActivity
      ? {
          severityFilter: latestClearedWatchlistActivity.watchlistSeverityFilter ?? "all",
          newOnly: latestClearedWatchlistActivity.watchlistNewOnly ?? false,
          viewedAt: latestClearedWatchlistActivity.createdAt,
        }
      : null;
  const collapsibleOlderActivityLabels = useMemo(
    () => groupedActivityLog.map((group) => group.label).filter((label) => label !== "Today"),
    [groupedActivityLog],
  );
  const canCollapseOlderActivityDays = useMemo(
    () => collapsibleOlderActivityLabels.some((label) => !collapsedActivityGroups.includes(label)),
    [collapsedActivityGroups, collapsibleOlderActivityLabels],
  );
  const canExpandAllActivityDays = collapsedActivityGroups.length > 0;

  function toggleActivityGroup(label: string) {
    setCollapsedActivityGroups((current) =>
      current.includes(label) ? current.filter((value) => value !== label) : [...current, label],
    );
  }

  function collapseOlderActivityDays() {
    setCollapsedActivityGroups((current) => Array.from(new Set([...current, ...collapsibleOlderActivityLabels])));
  }

  function expandAllActivityDays() {
    setCollapsedActivityGroups([]);
  }

  function reviewNewAlerts() {
    recordActivity({
      label: "Review new alerts",
      summary:
        reliabilityStatus.newIssueCount === 1
          ? "Opened the delivery watchlist to review 1 alert area that worsened since the last review."
          : `Opened the delivery watchlist to review ${reliabilityStatus.newIssueCount} alert areas that worsened since the last review.`,
      tone: reliabilityStatus.label === "Needs attention" ? "warning" : "neutral",
      watchlistTarget: "delivery-watchlist",
    });
    scrollToDeliverySection("delivery-watchlist");
  }

  function openWatchlistSeverityFilter(filter: DeliveryWatchlistSeverityFilter) {
    setWatchlistSeverityFilter(filter);
    setWatchlistNewOnly(false);
    recordActivity({
      label: filter === "all" ? "Open all watchlist alerts" : `Open ${filter} watchlist alerts`,
      summary:
        filter === "all"
          ? "Opened the full delivery watchlist from the reliability summary."
          : `Opened the ${filter} severity slice in the delivery watchlist from the reliability summary.`,
      tone: filter === "high" ? "warning" : "neutral",
      watchlistTarget: "delivery-watchlist",
      watchlistSeverityFilter: filter,
      watchlistNewOnly: false,
    });
    scrollToDeliverySection("delivery-watchlist");
  }

  function openNewWatchlistAlerts() {
    setWatchlistSeverityFilter("all");
    setWatchlistNewOnly(true);
    recordActivity({
      label: "Open new watchlist alerts",
      summary: "Opened only the delivery alerts that surfaced since the last review.",
      tone: "warning",
      watchlistTarget: "delivery-watchlist",
      watchlistSeverityFilter: "all",
      watchlistNewOnly: true,
    });
    scrollToDeliverySection("delivery-watchlist");
  }

  function applyWatchlistFilter(
    nextSeverity: DeliveryWatchlistSeverityFilter,
    nextNewOnly: boolean,
    source: "summary" | "filters",
  ) {
    setWatchlistSeverityFilter(nextSeverity);
    setWatchlistNewOnly(nextNewOnly);
    setWatchlistLastView({
      severityFilter: nextSeverity,
      newOnly: nextNewOnly,
      viewedAt: new Date().toISOString(),
    });

    if (source === "summary") {
      const summary =
        nextNewOnly
          ? "Opened the new-since-review slice in the delivery watchlist."
          : nextSeverity === "all"
            ? "Opened the full delivery watchlist from the summary strip."
            : `Opened the ${nextSeverity} severity slice in the delivery watchlist from the summary strip.`;

      recordActivity({
        label:
          nextNewOnly
            ? "Open new watchlist alerts"
            : nextSeverity === "all"
              ? "Open all watchlist alerts"
              : `Open ${nextSeverity} watchlist alerts`,
        summary,
        tone: nextSeverity === "high" || nextNewOnly ? "warning" : "neutral",
        watchlistTarget: "delivery-watchlist",
        watchlistSeverityFilter: nextSeverity,
        watchlistNewOnly: nextNewOnly,
      });
    }
  }

  function reopenLatestWatchlistReview(entry: DeliveryOpsActivityEntry) {
    recordActivity({
      label: `Re-open ${formatWatchlistSliceLabel(entry)}`,
      summary: `Returned to ${formatWatchlistSliceLabel(entry)} from the recent activity log after ${entry.label.toLowerCase()}.`,
      tone: "neutral",
      watchlistTarget: entry.watchlistTarget ?? "delivery-watchlist",
      watchlistSeverityFilter: entry.watchlistSeverityFilter ?? "all",
      watchlistNewOnly: entry.watchlistNewOnly ?? false,
    });
    setWatchlistSeverityFilter(entry.watchlistSeverityFilter ?? "all");
    setWatchlistNewOnly(entry.watchlistNewOnly ?? false);
    setWatchlistLastView({
      severityFilter: entry.watchlistSeverityFilter ?? "all",
      newOnly: entry.watchlistNewOnly ?? false,
      viewedAt: new Date().toISOString(),
    });
    scrollToDeliverySection(entry.watchlistTarget ?? "delivery-watchlist");
  }

  function reopenWatchlistActivity(entry: DeliveryOpsActivityEntry) {
    setWatchlistSeverityFilter(entry.watchlistSeverityFilter ?? "all");
    setWatchlistNewOnly(entry.watchlistNewOnly ?? false);
    setWatchlistLastView({
      severityFilter: entry.watchlistSeverityFilter ?? "all",
      newOnly: entry.watchlistNewOnly ?? false,
      viewedAt: new Date().toISOString(),
    });
    scrollToDeliverySection(entry.watchlistTarget ?? "delivery-watchlist");
  }

  function restoreClearedWatchlistView(entry: DeliveryOpsActivityEntry) {
    const restoredSeverity = entry.watchlistSeverityFilter ?? "all";
    const restoredNewOnly = entry.watchlistNewOnly ?? false;
    setWatchlistCollapsed(false);
    setWatchlistSeverityFilter(restoredSeverity);
    setWatchlistNewOnly(restoredNewOnly);
    setWatchlistLastView({
      severityFilter: restoredSeverity,
      newOnly: restoredNewOnly,
      viewedAt: new Date().toISOString(),
    });
    setWatchlistLastClearedView(null);
    recordActivity({
      label: "Restore saved watchlist view",
      summary: `Restored ${formatWatchlistSliceLabel(entry)} after it was cleared from the saved delivery watchlist state.`,
      tone: "neutral",
      watchlistTarget: "delivery-watchlist",
      watchlistSeverityFilter: restoredSeverity,
      watchlistNewOnly: restoredNewOnly,
    });
    scrollToDeliverySection(entry.watchlistTarget ?? "delivery-watchlist");
  }

  function clearLatestWatchlistView() {
    if (!watchlistLastView) {
      return;
    }
    setWatchlistLastClearedView({
      severityFilter: watchlistLastView.severityFilter,
      newOnly: watchlistLastView.newOnly,
      viewedAt: new Date().toISOString(),
    });
    recordActivity({
      label: "Clear saved watchlist view",
      summary: `Cleared ${formatWatchlistSliceLabel(watchlistLastView)} from the saved delivery watchlist resume context.`,
      tone: "neutral",
      watchlistTarget: "delivery-watchlist",
      watchlistSeverityFilter: watchlistLastView.severityFilter,
      watchlistNewOnly: watchlistLastView.newOnly,
    });
    setWatchlistLastView(null);
  }

  function dismissClearedWatchlistView() {
    if (!watchlistLastClearedView) {
      return;
    }
    recordActivity({
      label: "Dismiss cleared watchlist view",
      summary: `Dismissed the restore prompt for ${formatWatchlistSliceLabel(watchlistLastClearedView)}.`,
      tone: "neutral",
    });
    setWatchlistLastClearedView(null);
  }

  function recordWatchlistAlertAction(
    title: string,
    tone: "neutral" | "warning",
    summary: string,
  ) {
    recordActivity({
      label: `Open ${title}`,
      summary,
      tone,
      watchlistTarget: "delivery-watchlist",
      watchlistSeverityFilter: watchlistSeverityFilter,
      watchlistNewOnly: watchlistNewOnly,
    });
  }

  function renderDeliveryRowActions({
    delivery,
    transactionHref,
    listingLaneHref,
    transactionKey,
    trustSummary,
    assignActionKey,
    trustEscalationActionKey,
    escalateActionKey,
    saveNoteActionKey,
  }: {
    delivery: NotificationDelivery;
    transactionHref: string;
    listingLaneHref: string | null;
    transactionKey: string;
    trustSummary: ReturnType<typeof getSellerTrustSummary>;
    assignActionKey: string;
    trustEscalationActionKey: string;
    escalateActionKey: string;
    saveNoteActionKey: string;
  }) {
    return (
      <div className="flex flex-col gap-2 lg:min-w-[220px]">
        {renderQueueLinkAction(`open-transaction-${delivery.id}`, transactionHref, "Open Transaction")}
        {listingLaneHref
          ? renderQueueLinkAction(`open-listing-lane-${delivery.id}`, listingLaneHref, "Open Listing Lane")
          : null}
        {currentAdminUserId
          ? renderQueueActionButton({
              key: `assign-transaction-${delivery.id}`,
              label: "Assign Transaction To Me",
              onClick: () =>
                void updateLinkedTransactionSupport(
                  delivery,
                  getSupportPayload(delivery, { admin_assignee_user_id: currentAdminUserId }),
                  "Assignment",
                ),
              disabled: supportUpdatingKey === assignActionKey,
            })
          : null}
        {trustSummary.total > 0 && trustAdmin
          ? renderQueueActionButton({
              key: `trust-escalation-${delivery.id}`,
              label: "Escalate To Trust",
              onClick: () => void escalateLinkedTransactionToTrust(delivery),
              disabled: supportUpdatingKey === trustEscalationActionKey,
              tone: "danger",
            })
          : null}
        {renderQueueActionButton({
          key: `escalate-transaction-${delivery.id}`,
          label: "Escalate Transaction",
          onClick: () =>
            void updateLinkedTransactionSupport(
              delivery,
              getSupportPayload(delivery, { admin_is_escalated: true }),
              "Escalation",
            ),
          disabled: supportUpdatingKey === escalateActionKey,
          tone: "danger",
        })}
        {delivery.delivery_status === "failed" || delivery.delivery_status === "queued"
          ? renderQueueActionButton({
              key: `retry-delivery-${delivery.id}`,
              label: "Retry Delivery",
              onClick: () => void retryDelivery(delivery),
              disabled: retryingId === delivery.id,
              tone: "danger",
            })
          : null}
        {renderQueueActionButton({
          key: `save-support-note-${delivery.id}`,
          label: "Save Support Note",
          onClick: () =>
            void updateLinkedTransactionSupport(
              delivery,
              { admin_note: noteDrafts[transactionKey].trim() },
              "Support Note",
            ),
          disabled: supportUpdatingKey === saveNoteActionKey || !(noteDrafts[transactionKey]?.trim()),
        })}
        {renderInfoSummaryPanel({
          key: `delivery-summary-${delivery.id}`,
          lines: [
            `Sent: ${delivery.sent_at ? formatDateTime(delivery.sent_at) : "Not yet sent"}`,
            `Recommended owner: ${supportAdmin ? formatAdminLabel(supportAdmin) : "Support lane not labeled"}`,
          ],
        })}
      </div>
    );
  }
  function renderReliabilityOverview() {
    return (
      <section className={`card-shadow rounded-[2rem] border p-5 ${reliabilityStatus.toneClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em]">Reliability status</p>
            <h2 className="mt-2 text-lg font-semibold">{reliabilityStatus.label}</h2>
            <p className="mt-1 text-sm leading-6 text-current/90">{reliabilityStatus.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {reliabilityStatus.newIssueCount > 0
                ? renderReliabilityPill(
                    "reliability-new-issues",
                    `New since review: ${reliabilityStatus.newIssueCount}`,
                    openNewWatchlistAlerts,
                  )
                : renderReliabilityPill("reliability-no-new-issues", "No new regressions since review")}
              {watchlistBaselineAt
                ? renderReliabilityPill(
                    "reliability-baseline",
                    `Baseline: ${formatDateTime(watchlistBaselineAt)}`,
                    undefined,
                    "muted",
                  )
                : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-current/85">{reliabilityStatus.sinceReviewSummary}</p>
            <ul className="mt-3 space-y-2 text-sm text-current/90">
              {reliabilityStatus.drivers.map((driver) => (
                <li key={driver} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current/80" />
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex max-w-md flex-col items-start gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {renderReliabilityPill(
                "reliability-failed-pill",
                `Failed: ${deliverySummary?.failed_deliveries ?? 0}`,
                () => openWatchlistSeverityFilter("high"),
              )}
              {renderReliabilityPill(
                "reliability-queued-pill",
                `Queued >1h: ${deliverySummary?.queued_older_than_1h ?? 0}`,
                () => openWatchlistSeverityFilter("medium"),
              )}
              {renderReliabilityPill(
                "reliability-stuck-pill",
                `Stuck processing: ${workerHealth?.stuck_processing_deliveries ?? 0}`,
                () => openWatchlistSeverityFilter("high"),
              )}
              {renderReliabilityPill(
                "reliability-trust-pill",
                `Trust unassigned: ${counts.trustDrivenUnassigned}`,
                () => openWatchlistSeverityFilter("high"),
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {reliabilityStatus.newIssueCount > 0 && watchlistAlerts.length > 0
                ? renderReliabilityActionButton("review-new-alerts", "Review new alerts", reviewNewAlerts)
                : null}
              {reliabilityStatus.primaryAction
                ? renderReliabilityActionButton(
                    "reliability-primary-action",
                    reliabilityStatus.primaryAction.label,
                    reliabilityStatus.primaryAction.onClick,
                  )
                : null}
            </div>
          </div>
        </div>
      </section>
    );
  }

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
    setDeliverySummary(data.summary);
    setWorkerHealth(data.workerHealth);
    setSummaryFetchedAt(new Date().toLocaleString());
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
      await api.retryAdminNotificationDelivery(delivery.id, session.access_token);
      await reloadDeliveries(session.access_token);
      recordActivity({
        label: "Retry delivery",
        summary: `Retried ${delivery.channel} delivery ${truncateId(delivery.id)} for ${delivery.transaction_kind} ${truncateId(delivery.transaction_id)}.`,
        tone: "success",
        transactionKind: delivery.transaction_kind,
        transactionId: delivery.transaction_id,
      });
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

      recordActivity({
        label: actionLabel,
        summary: `${actionLabel} updated for ${delivery.transaction_kind} ${truncateId(delivery.transaction_id)}.`,
        tone: actionLabel.toLowerCase().includes("trust") ? "warning" : "success",
        transactionKind: delivery.transaction_kind,
        transactionId: delivery.transaction_id,
      });
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
        recordActivity({
          label: "Bulk retry",
          summary: `Retried ${result.succeeded_ids.length} visible deliver${result.succeeded_ids.length === 1 ? "y" : "ies"} with no retry failures.`,
          tone: "success",
        });
        setFeedback({
          tone: "success",
          message: `Retried ${result.succeeded_ids.length} deliver${result.succeeded_ids.length === 1 ? "y" : "ies"} in view. Already matched ${filteredDeliveries.length - retryableDeliveriesInView.length}.`,
        });
      } else if (result.succeeded_ids.length > 0) {
        recordActivity({
          label: "Bulk retry",
          summary: `Retried ${result.succeeded_ids.length} visible deliver${result.succeeded_ids.length === 1 ? "y" : "ies"} with ${result.failed.length} preflight or retry failure${result.failed.length === 1 ? "" : "s"}.`,
          tone: "warning",
        });
        setFeedback({
          tone: "success",
          message: `Retried ${result.succeeded_ids.length} deliver${result.succeeded_ids.length === 1 ? "y" : "ies"} in view. ${result.failed.length} failed preflight or retry.`,
        });
      } else {
        recordActivity({
          label: "Bulk retry",
          summary: `Bulk retry failed for the current queue slice: ${result.failed[0]?.detail ?? "Unable to retry deliveries in view."}`,
          tone: "danger",
        });
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
    return renderSurfaceStateCard("Loading delivery operations queue...");
  }

  if (error) {
    return renderSurfaceStateCard(error, "danger");
  }

  return (
    <section className="flex flex-col gap-5">
      {renderReliabilityOverview()}

      {pinnedPresets.length > 0 ? (
        renderSurfaceCardSection({
          id: "delivery-watchlist",
          children: (
            <>
              {renderSurfaceSectionHeader({
                eyebrow: "Quick access",
                title: "Pinned delivery views",
                description: "Re-open the delivery slices you use most without rebuilding the filter stack.",
                meta: lastAppliedPresetId ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700">
                    Last used:{" "}
                    {DELIVERY_SAVED_PRESETS.find((preset) => preset.id === lastAppliedPresetId)?.label ?? "Saved view"}
                  </span>
                ) : undefined,
              })}

              <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {pinnedPresets.map((presetDefinition) =>
                  renderSavedPresetCard({
                    presetDefinition,
                    statusBadges:
                      lastAppliedPresetId === presetDefinition.id ? (
                        renderCompactStatusBadge(
                          `quick-access-active-${presetDefinition.id}`,
                          "Active favorite",
                          "sky",
                        )
                      ) : undefined,
                    primaryActionKey: `quick-access-open-${presetDefinition.id}`,
                    secondaryActionKey: `quick-access-pin-${presetDefinition.id}`,
                    secondaryActionLabel: "Unpin",
                  }),
                )}
              </div>
            </>
          ),
        })
      ) : null}

      {renderSurfaceCardSection({
        id: "delivery-activity-log",
        children: (
          <>
            {renderSurfaceSectionHeader({
              eyebrow: "Saved views",
              title: "Delivery queue presets",
              description: "Pin the queue slices you revisit most often so they stay one click away.",
              meta: "Pinned presets appear in quick access and persist through your admin profile.",
            })}

            <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {DELIVERY_SAVED_PRESETS.map((presetDefinition) => {
                const isPinned = pinnedPresetIds.includes(presetDefinition.id);
                const isLastUsed = lastAppliedPresetId === presetDefinition.id;
                return renderSavedPresetCard({
                  presetDefinition,
                  statusBadges: (
                    <>
                      {isPinned ? (
                        renderCompactStatusBadge(`saved-view-pinned-${presetDefinition.id}`, "Pinned", "emerald")
                      ) : null}
                      {isLastUsed ? (
                        renderCompactStatusBadge(`saved-view-last-used-${presetDefinition.id}`, "Last used", "sky")
                      ) : null}
                    </>
                  ),
                  primaryActionKey: `saved-view-open-${presetDefinition.id}`,
                  secondaryActionKey: `saved-view-pin-${presetDefinition.id}`,
                  secondaryActionLabel: isPinned ? "Unpin" : "Pin to quick access",
                });
              })}
            </div>
          </>
        ),
      })}

      {renderSurfaceCardSection({
        children: (
          <>
            {renderSurfaceSectionHeader({
              eyebrow: "Recent ops",
              title: "Delivery activity log",
              description:
                "Recent watchlist reviews, saved-view changes, and queue operations for this admin workflow, prioritized in that order in the default feed.",
              meta: (
                <div className="flex flex-wrap items-center justify-end gap-2">
              {renderActivityToolbarButton(
                "export-activity-log",
                "Export CSV",
                exportActivityLogCsv,
                filteredActivityLog.length === 0,
              )}
              {latestWatchlistView ? (
                <>
                  {renderActivityStatusBadge(
                    "latest-watchlist-status",
                    `Latest watchlist: ${formatWatchlistActivityLabel(latestWatchlistView)} · ${getActivityDayLabel(latestWatchlistView.viewedAt)}`,
                    "sky",
                  )}
                  {renderActivityHighlightedActionButton(
                    "resume-latest-watchlist-view",
                    formatWatchlistResumeLabel(latestWatchlistView),
                    () =>
                      reopenLatestWatchlistReview({
                        id: "latest-watchlist-view",
                        label: `Open ${formatWatchlistSliceLabel(latestWatchlistView)}`,
                        summary: `Returned to ${formatWatchlistSliceLabel(latestWatchlistView)} from the saved delivery watchlist state.`,
                        createdAt: latestWatchlistView.viewedAt,
                        tone: "neutral",
                        watchlistTarget: "delivery-watchlist",
                        watchlistSeverityFilter: latestWatchlistView.severityFilter,
                        watchlistNewOnly: latestWatchlistView.newOnly,
                      }),
                    "sky",
                  )}
                  {renderActivitySecondaryActionButton(
                    "clear-saved-watchlist-view",
                    "Clear saved view",
                    clearLatestWatchlistView,
                  )}
                </>
              ) : latestClearedWatchlistView ? (
                <>
                  {renderActivityStatusBadge(
                    "cleared-watchlist-status",
                    `Saved watchlist cleared: ${formatWatchlistActivityLabel(latestClearedWatchlistView)} · ${getActivityDayLabel(latestClearedWatchlistView.viewedAt)}`,
                    "amber",
                  )}
                  {renderActivityHighlightedActionButton(
                    "restore-cleared-watchlist-view",
                    "Restore saved view",
                    () =>
                      restoreClearedWatchlistView({
                        id: "latest-cleared-watchlist-view",
                        label: "Clear saved watchlist view",
                        summary: `Cleared ${formatWatchlistSliceLabel(latestClearedWatchlistView)} from the saved delivery watchlist resume context.`,
                        createdAt: latestClearedWatchlistView.viewedAt,
                        tone: "neutral",
                        watchlistTarget: "delivery-watchlist",
                        watchlistSeverityFilter: latestClearedWatchlistView.severityFilter,
                        watchlistNewOnly: latestClearedWatchlistView.newOnly,
                      }),
                    "amber",
                  )}
                  {renderActivitySecondaryActionButton(
                    "dismiss-cleared-watchlist-view",
                    "Dismiss",
                    dismissClearedWatchlistView,
                  )}
                </>
              ) : null}
              {renderActivityToolbarButton(
                "collapse-older-days",
                "Collapse older days",
                collapseOlderActivityDays,
                !canCollapseOlderActivityDays,
              )}
              {renderActivityToolbarButton(
                "expand-all-days",
                "Expand all days",
                expandAllActivityDays,
                !canExpandAllActivityDays,
              )}
              {activityEntryLimitOptions.map((option) => renderActivityEntryLimitButton(option))}
              {activityFilterOptions.map((option) =>
                renderActivityFilterButton(option, option.label, "full"),
              )}
                </div>
              ),
            })}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {activityFilterOptions.map((option) =>
                renderActivityFilterButton(option, option.legendLabel, "compact"),
              )}
            </div>

            <div className="mt-4 space-y-3">
              {filteredActivityLog.length === 0 ? (
                renderDashedStatePanel({
                  key: "empty-activity-log",
                  message:
                    activityFilter === "views"
                      ? "No saved-view activity yet. Opening delivery presets and managing saved watchlist views will show up here."
                      : activityFilter === "watchlist"
                        ? "No watchlist activity yet. Reviewing new alerts will show up here."
                        : activityFilter === "operations"
                          ? "No delivery operations recorded yet. Retries and support actions will show up here."
                          : "No delivery activity recorded yet. Watchlist reviews, saved-view changes, and queue operations will show up here.",
                })
              ) : (
                groupedActivityLog.map((group) => (
              <section key={group.label} className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                    {group.label}
                  </p>
                  <div className="h-px flex-1 bg-border/60" />
                  <button
                    type="button"
                    onClick={() => toggleActivityGroup(group.label)}
                    className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/62 transition hover:border-foreground/28 hover:text-foreground"
                  >
                    {collapsedActivityGroups.includes(group.label)
                      ? `Expand (${group.entries.length})`
                      : "Collapse"}
                  </button>
                </div>
                {collapsedActivityGroups.includes(group.label) ? (
                  renderDashedStatePanel({
                    key: `collapsed-activity-group-${group.label}`,
                    message: `${group.entries.length} hidden activit${group.entries.length === 1 ? "y" : "ies"} in this day group.`,
                  })
                ) : (
                  group.entries.map((entry) => (
                    <article
                      key={entry.id}
                      className={`rounded-[1.5rem] border p-4 ${
                        entry.tone === "danger"
                          ? "border-danger/30 bg-danger/8"
                          : entry.tone === "warning"
                            ? "border-amber-500/30 bg-amber-500/10"
                            : entry.tone === "success"
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-border bg-background/70"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                            {isSavedViewActivity(entry) ? (
                              renderCompactStatusBadge(`activity-view-${entry.id}`, "View", "emerald")
                            ) : null}
                            {isSavedViewActivity(entry) ? (
                              renderCompactStatusBadge(
                                `activity-view-type-${entry.id}`,
                                getSavedViewActivityLabel(entry),
                                "neutral",
                              )
                            ) : null}
                            {!entry.watchlistTarget && !isSavedViewActivity(entry) ? (
                              renderCompactStatusBadge(`activity-operation-${entry.id}`, "Operation", "amber")
                            ) : null}
                            {!entry.watchlistTarget && !isSavedViewActivity(entry) ? (
                              renderCompactStatusBadge(
                                `activity-operation-type-${entry.id}`,
                                getOperationActivityLabel(entry),
                                "neutral",
                              )
                            ) : null}
                            {entry.label === "Restore saved watchlist view" &&
                            watchlistViewMatchesActivityEntry(latestWatchlistView, entry) ? (
                              renderCompactStatusBadge(`activity-active-${entry.id}`, "Active", "emerald")
                            ) : null}
                            {entry.label === "Clear saved watchlist view" &&
                            watchlistViewMatchesActivityEntry(latestClearedWatchlistView, entry) ? (
                              renderCompactStatusBadge(
                                `activity-pending-restore-${entry.id}`,
                                "Pending restore",
                                "amber",
                              )
                            ) : null}
                            {entry.watchlistTarget ? (
                              renderCompactStatusBadge(`activity-watchlist-${entry.id}`, "Watchlist", "sky")
                            ) : null}
                            {entry.watchlistTarget ? (
                              renderCompactStatusBadge(
                                `activity-watchlist-type-${entry.id}`,
                                formatWatchlistBadgeLabel(entry),
                                "neutral",
                              )
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-foreground/68">{entry.summary}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {entry.presetId ? (
                              renderSurfaceActionButton(
                                `reopen-preset-${entry.id}`,
                                "Re-open view",
                                () => reopenSavedPreset(entry.presetId!),
                              )
                            ) : null}
                            {entry.activityFilterSnapshot ? (
                              renderSurfaceActionButton(
                                `reopen-activity-lane-${entry.id}`,
                                `Re-open ${entry.activityFilterSnapshot} lane`,
                                () => reopenActivityLane(entry),
                              )
                            ) : null}
                            {entry.transactionKind && entry.transactionId ? (
                              renderSurfaceActionButton(
                                `focus-transaction-${entry.id}`,
                                "Focus transaction",
                                () => focusTransaction(entry.transactionKind!, entry.transactionId!),
                              )
                            ) : null}
                            {entry.watchlistTarget ? (
                              entry.label === "Clear saved watchlist view" ? (
                                <>
                                  {renderSurfaceActionButton(
                                    `restore-cleared-${entry.id}`,
                                    "Restore saved view",
                                    () => restoreClearedWatchlistView(entry),
                                  )}
                                  {watchlistViewMatchesActivityEntry(latestClearedWatchlistView, entry) ? (
                                    renderSurfaceActionButton(
                                      `dismiss-cleared-${entry.id}`,
                                      "Dismiss",
                                      dismissClearedWatchlistView,
                                      "muted",
                                    )
                                  ) : null}
                                </>
                              ) : entry.label === "Restore saved watchlist view" ? (
                                <>
                                  {renderSurfaceActionButton(
                                    `reopen-watchlist-${entry.id}`,
                                    formatWatchlistResumeLabel(entry),
                                    () => reopenWatchlistActivity(entry),
                                  )}
                                  {watchlistViewMatchesActivityEntry(latestWatchlistView, entry) ? (
                                    renderSurfaceActionButton(
                                      `clear-saved-${entry.id}`,
                                      "Clear saved view",
                                      clearLatestWatchlistView,
                                      "muted",
                                    )
                                  ) : null}
                                </>
                              ) : (
                                renderSurfaceActionButton(
                                  `reopen-generic-watchlist-${entry.id}`,
                                  formatWatchlistResumeLabel(entry),
                                  () => reopenWatchlistActivity(entry),
                                )
                              )
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {renderCompactStatusBadge(`activity-tone-${entry.id}`, entry.tone, "muted")}
                          <p className="text-xs text-foreground/56">{formatDateTime(entry.createdAt)}</p>
                        </div>
                      </div>
                    </article>
                  ))
                )}
                </section>
              ))
            )}
            </div>
          </>
        ),
      })}

      {watchlistAlerts.length > 0 ? (
        <section
          id="delivery-watchlist"
          className="card-shadow rounded-[2rem] border border-border bg-surface p-5"
        >
          {renderSurfaceSectionHeader({
            eyebrow: "Delivery watchlist",
            title: "Operational alerts",
            description: watchlistBaselineAt
              ? `Queue conditions that currently need admin attention, including what changed since ${formatDateTime(watchlistBaselineAt)}.`
              : "Queue conditions that currently need admin attention.",
            meta: (
              <div className="flex flex-wrap justify-end gap-2 text-xs text-foreground/62">
                {renderActivityToolbarButton(
                  "export-watchlist-csv",
                  "Export CSV",
                  exportWatchlistCsv,
                  filteredWatchlistAlerts.length === 0,
                )}
                {renderActivitySecondaryActionButton(
                  "toggle-watchlist-collapsed",
                  watchlistCollapsed ? "Expand" : "Collapse",
                  () => setWatchlistCollapsed((current) => !current),
                )}
                {watchlistSummaryOptions.map((option) =>
                  renderWatchlistSummaryButton(option, "watchlist-summary"),
                )}
              </div>
            ),
          })}

          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-foreground/48">
            Showing: {watchlistFilterSummary}
          </p>
          {watchlistCollapsed ? (
            <>{renderDashedStatePanel({
              key: "collapsed-watchlist-summary",
              className: "mt-4 bg-background/60 px-4 py-4",
              message: (
                <p className="text-sm text-foreground/62">
                  Watchlist collapsed. {filteredWatchlistAlerts.length} visible alert{filteredWatchlistAlerts.length === 1 ? "" : "s"} match the current delivery watchlist view.
                </p>
              ),
            })}
              {latestWatchlistView ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-foreground/62">
                  {renderActivityStatusBadge(
                    "collapsed-latest-watchlist-status",
                    `Latest watchlist: ${formatWatchlistActivityLabel(latestWatchlistView)} · ${getActivityDayLabel(latestWatchlistView.viewedAt)}`,
                    "sky",
                  )}
                  {renderActivityHighlightedActionButton(
                    "collapsed-resume-latest-watchlist-view",
                    formatWatchlistResumeLabel(latestWatchlistView),
                    () => {
                      setWatchlistCollapsed(false);
                      reopenLatestWatchlistReview({
                        id: "latest-watchlist-view-collapsed",
                        label: `Open ${formatWatchlistSliceLabel(latestWatchlistView)}`,
                        summary: `Returned to ${formatWatchlistSliceLabel(latestWatchlistView)} from the saved delivery watchlist state.`,
                        createdAt: latestWatchlistView.viewedAt,
                        tone: "neutral",
                        watchlistTarget: "delivery-watchlist",
                        watchlistSeverityFilter: latestWatchlistView.severityFilter,
                        watchlistNewOnly: latestWatchlistView.newOnly,
                      });
                    },
                    "sky",
                  )}
                  {renderActivitySecondaryActionButton(
                    "collapsed-clear-saved-watchlist-view",
                    "Clear saved view",
                    clearLatestWatchlistView,
                  )}
                </div>
              ) : latestClearedWatchlistView ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-foreground/62">
                  {renderActivityStatusBadge(
                    "collapsed-cleared-watchlist-status",
                    `Saved watchlist cleared: ${formatWatchlistActivityLabel(latestClearedWatchlistView)} · ${getActivityDayLabel(latestClearedWatchlistView.viewedAt)}`,
                    "amber",
                  )}
                  {renderActivityHighlightedActionButton(
                    "collapsed-restore-cleared-watchlist-view",
                    "Restore saved view",
                    () =>
                      restoreClearedWatchlistView({
                        id: "latest-cleared-watchlist-view-collapsed",
                        label: "Clear saved watchlist view",
                        summary: `Cleared ${formatWatchlistSliceLabel(latestClearedWatchlistView)} from the saved delivery watchlist resume context.`,
                        createdAt: latestClearedWatchlistView.viewedAt,
                        tone: "neutral",
                        watchlistTarget: "delivery-watchlist",
                        watchlistSeverityFilter: latestClearedWatchlistView.severityFilter,
                        watchlistNewOnly: latestClearedWatchlistView.newOnly,
                      }),
                    "amber",
                  )}
                  {renderActivitySecondaryActionButton(
                    "collapsed-dismiss-cleared-watchlist-view",
                    "Dismiss",
                    dismissClearedWatchlistView,
                  )}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-foreground/62">
                {watchlistSummaryOptions.map((option) =>
                  renderWatchlistSummaryButton(option, "watchlist-collapsed-summary", () =>
                    setWatchlistCollapsed(false),
                  ),
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {watchlistFilterOptions.map((option) => renderWatchlistFilterButton(option))}
                {renderWatchlistNewOnlyFilterButton()}
                {renderWatchlistClearFiltersButton()}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {filteredWatchlistAlerts.length === 0 ? (
                  renderDashedStatePanel({
                    key: "empty-watchlist-alerts",
                    className: "bg-background/60 px-4 py-4 text-sm text-foreground/62 xl:col-span-2",
                    message: `No ${watchlistNewOnly ? "new " : ""}${watchlistSeverityFilter === "all" ? "" : `${watchlistSeverityFilter} `}alerts match the current watchlist filter.`,
                  })
                ) : (
                  filteredWatchlistAlerts.map((alert) => (
                    <article
                      key={alert.id}
                      className={`rounded-[1.5rem] border p-4 ${
                        alert.severity === "high"
                          ? "border-danger/30 bg-danger/8"
                          : alert.severity === "medium"
                            ? "border-amber-500/30 bg-amber-500/10"
                            : "border-border bg-background/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {alert.isNewSinceVisit ? (
                            renderCompactStatusBadge(`watchlist-new-${alert.id}`, "New since review", "sky")
                          ) : null}
                          {renderCompactStatusBadge(`watchlist-severity-${alert.id}`, alert.severity, "muted")}
                        </div>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-foreground/68">{alert.detail}</p>
                      <div className="mt-3">
                        {renderSurfaceActionButton(
                          `watchlist-alert-${alert.id}`,
                          alert.actionLabel,
                          alert.onClick,
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      {deliverySummary ? (
        renderSurfaceCardSection({
          children: (
            <>
              {renderSurfaceSectionHeader({
                eyebrow: "Queue health",
                title: "Notification delivery summary",
                description:
                  "Full queue counts across all notification deliveries, separate from the filtered working set below.",
                meta: (
                  <>
                    <p>{summaryFetchedAt ?? "Awaiting queue summary..."}</p>
                    <p className="mt-1">
                      Oldest queued:{" "}
                      {deliverySummary.oldest_queued_created_at
                        ? `${formatAgeLabel(deliverySummary.oldest_queued_created_at)} old`
                        : "None"}
                    </p>
                    <p className="mt-1">
                      Latest failure:{" "}
                      {deliverySummary.latest_failure_created_at
                        ? formatDateTime(deliverySummary.latest_failure_created_at)
                        : "None"}
                    </p>
                  </>
                ),
              })}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Failed now",
                value: deliverySummary.failed_deliveries.toString(),
                detail: `${deliverySummary.failed_last_24h} in the last 24h`,
                tone: deliverySummary.failed_deliveries > 0 ? "danger" : "neutral",
                onClick: () =>
                  applyQueueState({
                    preset: "failed_only",
                    status: "failed",
                    channel: "all",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
              },
              {
                label: "Queued now",
                value: deliverySummary.queued_deliveries.toString(),
                detail: `${deliverySummary.queued_older_than_1h} older than 1h`,
                tone: deliverySummary.queued_deliveries > 0 ? "warning" : "neutral",
                onClick: () =>
                  applyQueueState({
                    preset: "queued_only",
                    status: "queued",
                    channel: "all",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
              },
              {
                label: "Email vs Push",
                value: `${deliverySummary.email_deliveries} / ${deliverySummary.push_deliveries}`,
                detail: "Email first, push second",
                onClick: () =>
                  applyQueueState({
                    preset: "needs_attention",
                    status: "all",
                    channel: "all",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
              },
              {
                label: "Orders vs Bookings",
                value: `${deliverySummary.order_deliveries} / ${deliverySummary.booking_deliveries}`,
                detail: "Order-linked first, booking-linked second",
                onClick: () =>
                  applyQueueState({
                    preset: "needs_attention",
                    status: "all",
                    channel: "all",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
              },
            ].map((card) =>
              renderMetricButtonCard({
                key: card.label,
                label: card.label,
                value: card.value,
                detail: card.detail,
                onClick: card.onClick,
                tone: card.tone,
                surface: "muted",
                detailSize: "xs",
              }),
            )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-foreground/60">
                {renderInfoPill("summary-total-deliveries", `Total deliveries: ${deliverySummary.total_deliveries}`)}
                {renderInfoPill("summary-sent-deliveries", `Sent: ${deliverySummary.sent_deliveries}`)}
                {renderInfoPill("summary-failed-last-24h", `Failed last 24h: ${deliverySummary.failed_last_24h}`)}
                {renderInfoPill("summary-queued-older-than-1h", `Queued older than 1h: ${deliverySummary.queued_older_than_1h}`)}
              </div>
            </>
          ),
        })
      ) : null}

      {workerHealth ? (
        renderSurfaceCardSection({
          id: "delivery-worker-health",
          children: (
            <>
              {renderSurfaceSectionHeader({
                eyebrow: "Worker health",
                title: "Notification worker status",
                description:
                  "Runtime-facing signal for whether queue pressure is likely coming from the worker loop or just queue volume.",
                meta: (
                  <>
                    <p>Email provider: {workerHealth.email_provider}</p>
                    <p className="mt-1">Push provider: {workerHealth.push_provider}</p>
                    <p className="mt-1">
                      Poll / batch: {workerHealth.worker_poll_seconds}s / {workerHealth.batch_size}
                    </p>
                  </>
                ),
              })}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                key: "worker-health-due-queued",
                label: "Due queued now",
                value: workerHealth.due_queued_deliveries.toString(),
                detail: workerHealth.oldest_due_queued_created_at
                  ? `Oldest due queued item is ${formatAgeLabel(workerHealth.oldest_due_queued_created_at)} old.`
                  : "No queued deliveries are currently due.",
              },
              {
                key: "worker-health-processing",
                label: "Processing now",
                value: workerHealth.processing_deliveries.toString(),
                detail: `${workerHealth.stuck_processing_deliveries} appear stuck for more than 10 minutes.`,
                tone: workerHealth.stuck_processing_deliveries > 0 ? "danger" : "neutral",
              },
              {
                key: "worker-health-recent-failures",
                label: "Recent failures",
                value: workerHealth.recent_failure_deliveries.toString(),
                detail: "Failed deliveries created in the last 24 hours.",
                tone: workerHealth.recent_failure_deliveries > 0 ? "warning" : "neutral",
              },
              {
                key: "worker-health-retry-ceiling",
                label: "Retry ceiling",
                value: workerHealth.max_attempts.toString(),
                detail: "Configured maximum attempts before a delivery stays failed.",
              },
            ].map((card) =>
              renderMetricStaticCard({
                key: card.key,
                label: card.label,
                value: card.value,
                detail: card.detail,
                tone: card.tone,
              }),
            )}
              </div>
            </>
          ),
        })
      ) : null}

      {deliverySummary && failureDiagnostics.topReasons.length > 0 ? (
        renderSurfaceCardSection({
          children: (
            <>
              {renderSurfaceSectionHeader({
                eyebrow: "Failure diagnostics",
                title: "What is breaking right now",
                description:
                  "Top failure reasons across the queue, plus channel-specific breakdown for faster triage.",
                meta: (
                  <div className="flex flex-wrap justify-end gap-2 text-xs text-foreground/62">
                {renderInfoPill("failure-diagnostics-email", `Email failures: ${failureDiagnostics.failedEmail}`, () =>
                  applyQueueState({
                    preset: "failed_only",
                    status: "failed",
                    channel: "email",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
                )}
                {renderInfoPill("failure-diagnostics-push", `Push failures: ${failureDiagnostics.failedPush}`, () =>
                  applyQueueState({
                    preset: "push_failures",
                    status: "failed",
                    channel: "push",
                    kind: "all",
                    recency: "all",
                    trust: "all",
                    ownership: "all",
                  }),
                )}
                {renderInfoPill("failure-diagnostics-last-24h", `Last 24h: ${failureDiagnostics.recentFailures}`)}
                  </div>
                ),
              })}

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {failureDiagnostics.topReasons.map((item) => (
              <article
                key={item.reason}
                className="rounded-[1.5rem] border border-border bg-background/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{item.reason}</p>
                  {renderDangerCountPill(`failure-reason-count-${item.reason}`, item.count.toString())}
                </div>
                <p className="mt-3 text-sm leading-6 text-foreground/66">
                  Filter the queue for failures and search this reason to inspect the affected deliveries.
                </p>
                <div className="mt-3">
                  {renderSurfaceActionButton(
                    `inspect-failure-reason-${item.reason}`,
                    "Inspect failures",
                    () => {
                      applyQueueState({
                        preset: "failed_only",
                        status: "failed",
                        channel: "all",
                        kind: "all",
                        recency: "all",
                        trust: "all",
                        ownership: "all",
                      });
                      setSearchQuery(item.reason);
                    },
                  )}
                </div>
              </article>
            ))}
              </div>
            </>
          ),
        })
      ) : null}

      {renderMetricGrid("delivery-count-grid", "grid gap-3 sm:grid-cols-2 xl:grid-cols-6",
        [
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
        ].map((card) =>
          renderMetricButtonCard({
            key: card.label,
            label: card.label,
            value: card.value,
            onClick: card.onClick,
            tone: card.tone,
          }),
        )
      )}

      {renderMetricGrid("trust-metric-grid", "grid gap-3 sm:grid-cols-2 xl:grid-cols-5",
        [
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
        ].map((card) =>
          renderMetricButtonCard({
            key: card.label,
            label: card.label,
            value: card.value,
            detail: card.detail,
            onClick: card.onClick,
          }),
        )
      )}

      {renderMetricGrid("listing-health-grid", "grid gap-3 sm:grid-cols-2 xl:grid-cols-3",
        [
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
        ].map((card) =>
          renderMetricButtonCard({
            key: card.label,
            label: card.label,
            value: card.value,
            detail: card.detail,
            onClick: card.onClick,
            tone: card.tone,
          }),
        )
      )}

      {renderMetricGrid("listing-diagnostic-grid", "grid gap-3 sm:grid-cols-2 xl:grid-cols-3",
        [
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
        ].map((card) =>
          renderMetricButtonCard({
            key: card.label,
            label: card.label,
            value: card.value,
            detail: card.detail,
            onClick: card.onClick,
            tone: card.tone,
          }),
        )
      )}

      {renderMetricGrid("trust-aging-grid", "grid gap-3 sm:grid-cols-2 xl:grid-cols-2",
        [
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
        ].map((card) =>
          renderDetailButtonCard({
            key: card.label,
            label: card.label,
            detail: card.detail,
            onClick: card.onClick,
          }),
        )
      )}

      <div className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
        {renderQueuePresetStrip(preset, applyPreset)}
        {renderCurrentSlicePanel(() =>
          applyQueueState({
            preset: "needs_attention",
            status: "all",
            channel: "all",
            kind: "all",
            recency: "week",
            trust: "all",
            ownership: "all",
            listingHealth: "all",
          }),
        )}

        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          {renderQueueSearchField(searchQuery, setSearchQuery)}

          {renderFilterGroup({
            key: "filter-status",
            label: "Status",
            children: [
              { value: "all", label: `All (${counts.total})` },
              { value: "failed", label: `Failed (${counts.failed})` },
              { value: "queued", label: `Queued (${counts.queued})` },
              { value: "sent", label: `Sent (${counts.sent})` },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                statusFilter === option.value,
                () => setStatusFilter(option.value as DeliveryStatusFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-channel",
            label: "Channel",
            children: [
              { value: "all", label: `All (${counts.total})` },
              { value: "email", label: `Email (${counts.email})` },
              { value: "push", label: `Push (${counts.push})` },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                channelFilter === option.value,
                () => setChannelFilter(option.value as DeliveryChannelFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-kind",
            label: "Transaction",
            children: [
              { value: "all", label: `All (${counts.total})` },
              { value: "order", label: `Orders (${counts.order})` },
              { value: "booking", label: `Bookings (${counts.booking})` },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                kindFilter === option.value,
                () => setKindFilter(option.value as DeliveryKindFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-recency",
            label: "Recency",
            children: [
              { value: "today", label: "Today" },
              { value: "week", label: "7 Days" },
              { value: "all", label: "All Time" },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                recencyFilter === option.value,
                () => setRecencyFilter(option.value as DeliveryRecencyFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-trust",
            label: "Trust Context",
            children: [
              { value: "all", label: `All (${counts.total})` },
              { value: "trust_driven", label: `Trust-Driven (${counts.trustDriven})` },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                trustFilter === option.value,
                () => setTrustFilter(option.value as DeliveryTrustFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-listing-health",
            label: "Listing Health",
            children: [
              { value: "all", label: "All" },
              { value: "softening", label: `Softening (${listingHealthCounts.softening})` },
              { value: "recent_pricing", label: `Recent Pricing (${listingHealthCounts.recentPricing})` },
              { value: "trust_flagged", label: `Trust-Flagged (${listingHealthCounts.trustFlagged})` },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                listingHealthFilter === option.value,
                () => setListingHealthFilter(option.value as DeliveryListingHealthFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-ownership",
            label: "Support Ownership",
            children: [
              { value: "all", label: `All (${counts.total})` },
              { value: "mine", label: `Mine (${counts.trustDrivenAssignedToMe})` },
              { value: "unassigned", label: `Unassigned (${counts.trustDrivenUnassigned})` },
              { value: "assigned", label: `Assigned (${counts.trustDrivenAssigned})` },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                ownershipFilter === option.value,
                () => setOwnershipFilter(option.value as DeliveryOwnershipFilter),
              ),
            ),
          })}

          {renderFilterGroup({
            key: "filter-retry-mode",
            label: "Retry Mode",
            children: [
              { value: "best_effort", label: "Best Effort" },
              { value: "atomic", label: "Validate First" },
            ].map((option) =>
              renderSegmentedFilterButton(
                option.value,
                option.label,
                executionMode === option.value,
                () => setExecutionMode(option.value as ExecutionMode),
              ),
            ),
          })}
        </div>
      </div>

      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
        {renderDeliveryQueueHeader(filteredDeliveries.length)}
        {renderCurrentSlicePanel(() =>
          applyQueueState({
            preset: "needs_attention",
            status: "all",
            channel: "all",
            kind: "all",
            recency: "week",
            trust: "all",
            ownership: "all",
          }),
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-4">
          {renderQueueActionButton({
            key: "retry-deliveries-in-view",
            label: "Retry Deliveries In View",
            onClick: () =>
              setPendingBulkRetry({
                targetCount: retryableDeliveriesInView.length,
                unchangedCount: filteredDeliveries.length - retryableDeliveriesInView.length,
              }),
            disabled: bulkUpdating || retryableDeliveriesInView.length === 0,
            tone: "danger",
          })}
          {renderQueueModePill("queue-execution-mode", executionModeLabel)}
        </div>

        {feedback
          ? renderFeedbackBanner({
              key: "delivery-feedback",
              tone: feedback.tone === "success" ? "success" : "error",
              message: feedback.message,
            })
          : null}

        {pendingBulkRetry
          ? renderQueueConfirmationPanel({
              key: "pending-bulk-retry",
              title: "Retry visible deliveries?",
              description: (
                <>
                  This will change {pendingBulkRetry.targetCount} deliver
                  {pendingBulkRetry.targetCount === 1 ? "y" : "ies"}.
                  {pendingBulkRetry.unchangedCount > 0
                    ? ` ${pendingBulkRetry.unchangedCount} already match the target state.`
                    : null}{" "}
                  Mode: {executionModeLabel}.
                </>
              ),
              actions: (
                <>
                  {renderQueueActionButton({
                    key: "confirm-bulk-retry",
                    label: "Confirm",
                    onClick: () => void runBulkRetry(),
                    disabled: bulkUpdating,
                    tone: "primary",
                  })}
                  {renderQueueActionButton({
                    key: "cancel-bulk-retry",
                    label: "Cancel",
                    onClick: () => setPendingBulkRetry(null),
                    disabled: bulkUpdating,
                    tone: "neutral",
                    surface: "surface",
                  })}
                </>
              ),
            })
          : null}

        <div className="mt-5 flex flex-col gap-4">
          {filteredDeliveries.length === 0 ? (
            renderDashedStatePanel({
              key: "empty-delivery-queue",
              className: "px-4 py-8 text-sm text-foreground/60",
              message: "No deliveries match the current operations filters.",
            })
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
            return renderDeliveryRowSurface({
              key: delivery.id,
              status: delivery.delivery_status,
              children: (
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3 lg:flex-1">
                    {renderDeliveryRowHeader({ delivery, trustSummary })}

                    {renderListingOpsContextPanel({
                      deliveryId: delivery.id,
                      listingOpsContext,
                      browseContext,
                    })}

                    {renderDeliveryRowDetailStack({ delivery, transactionKey })}
                  </div>

                  {renderDeliveryRowActions({
                    delivery,
                    transactionHref,
                    listingLaneHref,
                    transactionKey,
                    trustSummary,
                    assignActionKey,
                    trustEscalationActionKey,
                    escalateActionKey,
                    saveNoteActionKey,
                  })}
                </div>
              ),
            });
          })}
        </div>
      </section>
    </section>
  );
}
