"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  createApiClient,
  type ReviewAnomalyRead,
  type Profile,
  type ReviewRead,
  type SellerProfile,
  type SellerTrustIntervention,
} from "@/app/lib/api";
import { invalidateMarketplaceCaches } from "@/app/lib/cache-invalidation";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type ModerationStatus = "open" | "triaged" | "resolved";
type VisibilityFilter = "all" | "public" | "hidden";
type ResolutionReason =
  | "abusive"
  | "spam"
  | "policy_violation"
  | "left_public"
  | "restored_after_review"
  | "insufficient_evidence";
type QueuePreset =
  | "default"
  | "needs_action"
  | "hidden_reviews"
  | "resolved_with_notes"
  | "escalated_only"
  | "assigned_to_me"
  | "unassigned"
  | "seller_risk";
type SortMode = "newest" | "oldest" | "rating_high" | "rating_low";
type AssigneeFilter = "all" | "mine" | "unassigned" | "elsewhere";
type EscalationFilter = "all" | "escalated" | "normal";
type PendingBulkEscalationAction = {
  nextEscalated: boolean;
  targets: number;
  unchanged: number;
};
type PendingBulkAssignmentAction = {
  nextAssigneeUserId: string | null;
  mode: "assign" | "clear";
  targets: number;
  unchanged: number;
};

type ReviewModerationItem = {
  id: string;
  review_id: string;
  reporter_id: string;
  reason: string;
  notes?: string | null;
  status: ModerationStatus;
  moderator_note?: string | null;
  resolution_reason?: ResolutionReason | null;
  assignee_user_id?: string | null;
  assigned_at?: string | null;
  is_escalated?: boolean;
  escalated_at?: string | null;
  created_at: string;
  review: ReviewRead;
  seller_display_name?: string | null;
  seller_slug?: string | null;
  history?: Array<{
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  }>;
};

type ReviewAnomalySeverity = "all" | "high" | "medium" | "monitor";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const RESOLUTION_REASON_OPTIONS: Array<{ value: ResolutionReason; label: string }> = [
  { value: "abusive", label: "Abusive" },
  { value: "spam", label: "Spam" },
  { value: "policy_violation", label: "Policy Violation" },
  { value: "left_public", label: "Left Public" },
  { value: "restored_after_review", label: "Restored After Review" },
  { value: "insufficient_evidence", label: "Insufficient Evidence" },
];
const STALE_UNASSIGNED_HOURS = 24;
const STALE_ASSIGNED_HOURS = 48;

function toSearchText(report: ReviewModerationItem): string {
  return [
    report.reason,
    report.notes,
    report.moderator_note,
    report.resolution_reason,
    report.assignee_user_id,
    report.assigned_at,
    report.seller_display_name,
    report.seller_slug,
    report.review.comment,
    report.review.seller_response,
    report.reporter_id,
    ...(report.history?.flatMap((event) => [event.action, event.note, event.actor_user_id]) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatActionLabel(action: string): string {
  if (action === "reported") {
    return "Report Submitted";
  }

  if (action === "visibility:hidden") {
    return "Review Hidden";
  }

  if (action === "visibility:restored") {
    return "Review Restored";
  }

  if (action === "assignment:assigned") {
    return "Assigned";
  }

  if (action === "assignment:cleared") {
    return "Unassigned";
  }

  if (action === "escalation:enabled") {
    return "Escalated";
  }

  if (action === "escalation:cleared") {
    return "Escalation Cleared";
  }

  if (action.startsWith("status:")) {
    const nextStatus = action.replace("status:", "");
    return `Marked ${nextStatus}`;
  }

  return action.replaceAll("_", " ");
}

function formatActorLabel(report: ReviewModerationItem, actorUserId: string, action: string): string {
  if (action === "reported" || actorUserId === report.reporter_id) {
    return "Reporter";
  }

  if (action.startsWith("status:")) {
    return "Moderator";
  }

  if (action.startsWith("visibility:")) {
    return "Moderator";
  }

  if (action.startsWith("assignment:")) {
    return "Moderator";
  }

  if (action.startsWith("escalation:")) {
    return "Moderator";
  }

  return `User ${actorUserId.slice(0, 8)}`;
}

function hoursSince(timestamp: string): number {
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, (Date.now() - value) / (1000 * 60 * 60));
}

function formatAgeLabel(timestamp: string): string {
  const hours = hoursSince(timestamp);
  if (hours < 1) {
    return "<1h";
  }

  if (hours < 24) {
    return `${Math.floor(hours)}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function isAfterBaseline(value: string | null | undefined, baseline: number | null) {
  if (baseline === null) {
    return false;
  }

  const timestamp = toTimestamp(value);
  return timestamp !== null && timestamp > baseline;
}

function formatLastReviewedLabel(value: string | null) {
  if (!value) {
    return "First review";
  }

  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    return "First review";
  }

  const diff = Date.now() - timestamp;
  if (diff < 24 * 60 * 60 * 1000) {
    return "Today";
  }

  if (diff < 2 * 24 * 60 * 60 * 1000) {
    return "Yesterday";
  }

  return new Date(timestamp).toLocaleDateString();
}

function formatActivityDayLabel(value: string) {
  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    return "Unknown";
  }

  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (timestamp >= startOfToday) {
    return "Today";
  }

  if (timestamp >= startOfYesterday) {
    return "Yesterday";
  }

  return date.toLocaleDateString();
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;
}

function TrustRiskStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/66">
      {label} · {value}
    </div>
  );
}

type ModerationShortcut = {
  label: string;
  preset: QueuePreset;
  status: ModerationStatus | "all";
  visibility: VisibilityFilter;
  assignee: AssigneeFilter;
  priority: EscalationFilter;
  sort: SortMode;
};

type ModerationWatchlistAlert = {
  id:
    | "stale_unassigned"
    | "stale_assigned"
    | "escalated_unassigned"
    | "hidden_open"
    | "repeat_seller_reports";
  label: string;
  detail: string;
  count: number;
  newCount: number;
  isNew: boolean;
  tone: "high" | "medium" | "monitor";
  apply: () => void;
};

type ReviewModerationActivityEntry = {
  id: string;
  kind: "view" | "watchlist" | "operation" | "export";
  label: string;
  created_at: string;
  snapshot?: {
    preset: QueuePreset;
    status: ModerationStatus | "all";
    visibility: VisibilityFilter;
    reason: string;
    sort: SortMode;
    assignee: AssigneeFilter;
    priority: EscalationFilter;
    query: string;
  } | null;
};

type SellerTrustRiskEntry = {
  seller: SellerProfile;
  reportCount: number;
};
type SellerTrustRiskLevel = "all" | "critical" | "elevated" | "watch" | "low";
type SellerTrustTrendFilter = "all" | "worsening" | "steady" | "improving" | "new";
type SellerTrustQueueMode = "all" | "intervention";

type ReviewModerationPreferences = {
  preset: QueuePreset;
  status: ModerationStatus | "all";
  visibility: VisibilityFilter;
  reason: string;
  sort: SortMode;
  assignee: AssigneeFilter;
  priority: EscalationFilter;
  query: string;
  watchlist_last_viewed_at: string | null;
  watchlist_severity_filter: WatchlistSeverityFilter;
  watchlist_new_only: boolean;
  activity_filter: ModerationActivityFilter;
  activity_entry_limit: 6 | 10;
  activity_collapsed_groups: string[];
  activity_log: ReviewModerationActivityEntry[];
};

type WatchlistSeverityFilter = "all" | "high" | "medium" | "monitor";
type ModerationActivityFilter = "all" | "watchlist" | "view" | "operation" | "export";

const DEFAULT_REVIEW_MODERATION_PREFERENCES: ReviewModerationPreferences = {
  preset: "needs_action",
  status: "open",
  visibility: "all",
  reason: "all",
  sort: "newest",
  assignee: "all",
  priority: "all",
  query: "",
  watchlist_last_viewed_at: null,
  watchlist_severity_filter: "all",
  watchlist_new_only: false,
  activity_filter: "all",
  activity_entry_limit: 6,
  activity_collapsed_groups: [],
  activity_log: [],
};

function escapeCsvValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value).replaceAll('"', '""');
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | boolean | null | undefined>>) {
  if (typeof window === "undefined") {
    return;
  }

  const csv = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function normalizeActivityEntry(value: unknown): ReviewModerationActivityEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const kind =
    entry.kind === "view" || entry.kind === "watchlist" || entry.kind === "operation" || entry.kind === "export"
      ? entry.kind
      : null;
  if (!kind || typeof entry.id !== "string" || typeof entry.label !== "string" || typeof entry.created_at !== "string") {
    return null;
  }

  const snapshotValue = entry.snapshot;
  let snapshot: ReviewModerationActivityEntry["snapshot"] = null;
  if (snapshotValue && typeof snapshotValue === "object") {
    const value = snapshotValue as Record<string, unknown>;
    const preset =
      value.preset === "default" ||
      value.preset === "needs_action" ||
      value.preset === "hidden_reviews" ||
      value.preset === "resolved_with_notes" ||
      value.preset === "escalated_only" ||
      value.preset === "assigned_to_me" ||
      value.preset === "unassigned" ||
      value.preset === "seller_risk"
        ? value.preset
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.preset;
    const status =
      value.status === "open" || value.status === "triaged" || value.status === "resolved" || value.status === "all"
        ? value.status
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.status;
    const visibility =
      value.visibility === "all" || value.visibility === "public" || value.visibility === "hidden"
        ? value.visibility
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.visibility;
    const sort =
      value.sort === "newest" || value.sort === "oldest" || value.sort === "rating_high" || value.sort === "rating_low"
        ? value.sort
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.sort;
    const assignee =
      value.assignee === "all" ||
      value.assignee === "mine" ||
      value.assignee === "unassigned" ||
      value.assignee === "elsewhere"
        ? value.assignee
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.assignee;
    const priority =
      value.priority === "all" || value.priority === "escalated" || value.priority === "normal"
        ? value.priority
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.priority;

    snapshot = {
      preset,
      status,
      visibility,
      reason: typeof value.reason === "string" && value.reason.trim() ? value.reason : "all",
      sort,
      assignee,
      priority,
      query: typeof value.query === "string" ? value.query : "",
    };
  }

  return {
    id: entry.id,
    kind,
    label: entry.label,
    created_at: entry.created_at,
    snapshot,
  };
}

function normalizeReviewModerationPreferences(value: unknown): ReviewModerationPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_REVIEW_MODERATION_PREFERENCES;
  }

  const input = value as Record<string, unknown>;
  return {
    preset:
      input.preset === "default" ||
      input.preset === "needs_action" ||
      input.preset === "hidden_reviews" ||
      input.preset === "resolved_with_notes" ||
      input.preset === "escalated_only" ||
      input.preset === "assigned_to_me" ||
      input.preset === "unassigned" ||
      input.preset === "seller_risk"
        ? input.preset
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.preset,
    status:
      input.status === "open" || input.status === "triaged" || input.status === "resolved" || input.status === "all"
        ? input.status
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.status,
    visibility:
      input.visibility === "all" || input.visibility === "public" || input.visibility === "hidden"
        ? input.visibility
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.visibility,
    reason: typeof input.reason === "string" && input.reason.trim() ? input.reason : "all",
    sort:
      input.sort === "newest" || input.sort === "oldest" || input.sort === "rating_high" || input.sort === "rating_low"
        ? input.sort
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.sort,
    assignee:
      input.assignee === "all" ||
      input.assignee === "mine" ||
      input.assignee === "unassigned" ||
      input.assignee === "elsewhere"
        ? input.assignee
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.assignee,
    priority:
      input.priority === "all" || input.priority === "escalated" || input.priority === "normal"
        ? input.priority
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.priority,
    query: typeof input.query === "string" ? input.query : "",
    watchlist_last_viewed_at:
      typeof input.watchlist_last_viewed_at === "string" ? input.watchlist_last_viewed_at : null,
    watchlist_severity_filter:
      input.watchlist_severity_filter === "all" ||
      input.watchlist_severity_filter === "high" ||
      input.watchlist_severity_filter === "medium" ||
      input.watchlist_severity_filter === "monitor"
        ? input.watchlist_severity_filter
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.watchlist_severity_filter,
    watchlist_new_only:
      typeof input.watchlist_new_only === "boolean"
        ? input.watchlist_new_only
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.watchlist_new_only,
    activity_filter:
      input.activity_filter === "all" ||
      input.activity_filter === "watchlist" ||
      input.activity_filter === "view" ||
      input.activity_filter === "operation" ||
      input.activity_filter === "export"
        ? input.activity_filter
        : DEFAULT_REVIEW_MODERATION_PREFERENCES.activity_filter,
    activity_entry_limit:
      input.activity_entry_limit === 10 ? 10 : DEFAULT_REVIEW_MODERATION_PREFERENCES.activity_entry_limit,
    activity_collapsed_groups: Array.isArray(input.activity_collapsed_groups)
      ? input.activity_collapsed_groups.filter((value): value is string => typeof value === "string")
      : DEFAULT_REVIEW_MODERATION_PREFERENCES.activity_collapsed_groups,
    activity_log: Array.isArray(input.activity_log)
      ? input.activity_log.map((entry) => normalizeActivityEntry(entry)).filter(Boolean) as ReviewModerationActivityEntry[]
      : [],
  };
}

export function ReviewModerationPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preset, setPreset] = useState<QueuePreset>("needs_action");
  const [statusFilter, setStatusFilter] = useState<ModerationStatus | "all">("open");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [escalationFilter, setEscalationFilter] = useState<EscalationFilter>("all");
  const [reports, setReports] = useState<ReviewModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState<string | null>(null);
  const [currentAdminUserId, setCurrentAdminUserId] = useState<string | null>(null);
  const [moderatorNotes, setModeratorNotes] = useState<Record<string, string>>({});
  const [resolutionReasons, setResolutionReasons] = useState<Record<string, string>>({});
  const [pendingBulkAssignment, setPendingBulkAssignment] = useState<PendingBulkAssignmentAction | null>(null);
  const [pendingBulkEscalation, setPendingBulkEscalation] = useState<PendingBulkEscalationAction | null>(null);
  const [bulkFeedback, setBulkFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ReviewModerationActivityEntry[]>([]);
  const [sellerTrustWatchlist, setSellerTrustWatchlist] = useState<SellerTrustRiskEntry[]>([]);
  const [sellerTrustInterventions, setSellerTrustInterventions] = useState<SellerTrustIntervention[]>([]);
  const [reviewAnomalies, setReviewAnomalies] = useState<ReviewAnomalyRead[]>([]);
  const [reviewAnomalySeverityFilter, setReviewAnomalySeverityFilter] =
    useState<ReviewAnomalySeverity>("all");
  const [sellerTrustRiskLevel, setSellerTrustRiskLevel] = useState<SellerTrustRiskLevel>("all");
  const [sellerTrustTrendFilter, setSellerTrustTrendFilter] = useState<SellerTrustTrendFilter>("all");
  const [sellerTrustQueueMode, setSellerTrustQueueMode] = useState<SellerTrustQueueMode>("all");
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [watchlistLastViewedAt, setWatchlistLastViewedAt] = useState<string | null>(null);
  const [watchlistBaselineAt, setWatchlistBaselineAt] = useState<string | null>(null);
  const [watchlistSeverityFilter, setWatchlistSeverityFilter] = useState<WatchlistSeverityFilter>("all");
  const [watchlistNewOnly, setWatchlistNewOnly] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ModerationActivityFilter>("all");
  const [activityEntryLimit, setActivityEntryLimit] = useState<6 | 10>(6);
  const [collapsedActivityGroups, setCollapsedActivityGroups] = useState<string[]>([]);
  const watchlistViewMarkedRef = useRef(false);

  const shortcuts: ModerationShortcut[] = [
    {
      label: "Escalated Unassigned",
      preset: "escalated_only",
      status: "all",
      visibility: "all",
      assignee: "unassigned",
      priority: "escalated",
      sort: "oldest",
    },
    {
      label: "Assigned To Me",
      preset: "assigned_to_me",
      status: "all",
      visibility: "all",
      assignee: "mine",
      priority: "all",
      sort: "newest",
    },
    {
      label: "Resolved With Notes",
      preset: "resolved_with_notes",
      status: "resolved",
      visibility: "all",
      assignee: "all",
      priority: "all",
      sort: "oldest",
    },
  ];

  function buildCurrentSnapshot() {
    return {
      preset,
      status: statusFilter,
      visibility: visibilityFilter,
      reason: reasonFilter,
      sort: sortMode,
      assignee: assigneeFilter,
      priority: escalationFilter,
      query: searchQuery,
    } satisfies ReviewModerationActivityEntry["snapshot"];
  }

  function applySnapshot(
    snapshot: NonNullable<ReviewModerationActivityEntry["snapshot"]>,
    options?: { recordLabel?: string; kind?: ReviewModerationActivityEntry["kind"] },
  ) {
    setPreset(snapshot.preset);
    setStatusFilter(snapshot.status);
    setVisibilityFilter(snapshot.visibility);
    setReasonFilter(snapshot.reason);
    setSortMode(snapshot.sort);
    setAssigneeFilter(snapshot.assignee);
    setEscalationFilter(snapshot.priority);
    setSearchQuery(snapshot.query);

    if (options?.recordLabel) {
      setActivityLog((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: options.kind ?? "view",
          label: String(options.recordLabel),
          created_at: new Date().toISOString(),
          snapshot,
        },
        ...current,
      ].slice(0, 12));
    }
  }

  function recordActivity(
    kind: ReviewModerationActivityEntry["kind"],
    label: string,
    snapshot?: ReviewModerationActivityEntry["snapshot"],
  ) {
    setActivityLog((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        label,
        created_at: new Date().toISOString(),
        snapshot: snapshot ?? null,
      },
      ...current,
    ].slice(0, 12));
  }

  useEffect(() => {
    const nextPreset = searchParams.get("preset");
    const nextStatus = searchParams.get("status");
    const nextVisibility = searchParams.get("visibility");
    const nextReason = searchParams.get("reason");
    const nextSort = searchParams.get("sort");
    const nextAssignee = searchParams.get("assignee");
    const nextPriority = searchParams.get("priority");
    const nextSearch = searchParams.get("q");

    setPreset(
      nextPreset === "default" ||
        nextPreset === "needs_action" ||
        nextPreset === "hidden_reviews" ||
        nextPreset === "resolved_with_notes" ||
        nextPreset === "escalated_only" ||
        nextPreset === "assigned_to_me" ||
        nextPreset === "unassigned"
        ? nextPreset
        : "needs_action",
    );
    setStatusFilter(
      nextStatus === "open" || nextStatus === "triaged" || nextStatus === "resolved" || nextStatus === "all"
        ? nextStatus
        : "open",
    );
    setVisibilityFilter(
      nextVisibility === "all" || nextVisibility === "public" || nextVisibility === "hidden"
        ? nextVisibility
        : "all",
    );
    setReasonFilter(nextReason ?? "all");
    setSortMode(
      nextSort === "newest" || nextSort === "oldest" || nextSort === "rating_high" || nextSort === "rating_low"
        ? nextSort
        : "newest",
    );
    setAssigneeFilter(
      nextAssignee === "all" || nextAssignee === "mine" || nextAssignee === "unassigned" || nextAssignee === "elsewhere"
        ? nextAssignee
        : "all",
    );
    setEscalationFilter(
      nextPriority === "all" || nextPriority === "escalated" || nextPriority === "normal"
        ? nextPriority
        : "all",
    );
    setSearchQuery(nextSearch ?? "");
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await restoreAdminSession();
        if (!session) {
          if (!cancelled) {
            setPreferencesHydrated(true);
          }
          return;
        }

        const profile = await api.get<Profile>("/profiles/me", {
          accessToken: session.access_token,
        }).catch(() => null);
        const interventions = await api
          .listAdminSellerTrustInterventions(50, { accessToken: session.access_token })
          .catch(() => [] as SellerTrustIntervention[]);
        const anomalies = await api
          .listReviewAnomalies(8, { accessToken: session.access_token })
          .catch(() => [] as ReviewAnomalyRead[]);

        if (cancelled) {
          return;
        }

        const savedPreferences = normalizeReviewModerationPreferences(
          profile?.admin_review_moderation_preferences ?? DEFAULT_REVIEW_MODERATION_PREFERENCES,
        );
        setActivityLog(savedPreferences.activity_log);
        setWatchlistLastViewedAt(savedPreferences.watchlist_last_viewed_at);
        setWatchlistBaselineAt(savedPreferences.watchlist_last_viewed_at);
        setSellerTrustInterventions(interventions);
        setReviewAnomalies(anomalies);
        setWatchlistSeverityFilter(savedPreferences.watchlist_severity_filter);
        setWatchlistNewOnly(savedPreferences.watchlist_new_only);
        setActivityFilter(savedPreferences.activity_filter);
        setActivityEntryLimit(savedPreferences.activity_entry_limit);
        setCollapsedActivityGroups(savedPreferences.activity_collapsed_groups);

        if (!searchParams.toString()) {
          applySnapshot(
            {
              preset: savedPreferences.preset,
              status: savedPreferences.status,
              visibility: savedPreferences.visibility,
              reason: savedPreferences.reason,
              sort: savedPreferences.sort,
              assignee: savedPreferences.assignee,
              priority: savedPreferences.priority,
              query: savedPreferences.query,
            },
          );
        }
      } finally {
        if (!cancelled) {
          setPreferencesHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    if (!preferencesHydrated || loading || watchlistViewMarkedRef.current) {
      return;
    }

    watchlistViewMarkedRef.current = true;
    setWatchlistLastViewedAt(new Date().toISOString());
  }, [loading, preferencesHydrated]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "needs_action") {
      params.set("preset", preset);
    }
    if (statusFilter !== "open") {
      params.set("status", statusFilter);
    }
    if (visibilityFilter !== "all") {
      params.set("visibility", visibilityFilter);
    }
    if (reasonFilter !== "all") {
      params.set("reason", reasonFilter);
    }
    if (sortMode !== "newest") {
      params.set("sort", sortMode);
    }
    if (assigneeFilter !== "all") {
      params.set("assignee", assigneeFilter);
    }
    if (escalationFilter !== "all") {
      params.set("priority", escalationFilter);
    }
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `?${nextQuery}` : "/admin/reviews", { scroll: false });
    }
  }, [
    assigneeFilter,
    escalationFilter,
    preset,
    reasonFilter,
    router,
    searchParams,
    searchQuery,
    sortMode,
    statusFilter,
    visibilityFilter,
  ]);

  useEffect(() => {
    if (!preferencesHydrated) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const session = await restoreAdminSession();
          if (!session) {
            return;
          }

          await api.patch<Profile>(
            "/profiles/me",
            {
              admin_review_moderation_preferences: {
                preset,
                status: statusFilter,
                visibility: visibilityFilter,
                reason: reasonFilter,
                sort: sortMode,
                assignee: assigneeFilter,
                priority: escalationFilter,
                query: searchQuery,
                watchlist_last_viewed_at: watchlistLastViewedAt,
                watchlist_severity_filter: watchlistSeverityFilter,
                watchlist_new_only: watchlistNewOnly,
                activity_filter: activityFilter,
                activity_entry_limit: activityEntryLimit,
                activity_collapsed_groups: collapsedActivityGroups,
                activity_log: activityLog,
              },
            },
            { accessToken: session.access_token },
          );
        } catch {
          // Keep local moderation state even if remote persistence fails.
        }
      })();
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    activityLog,
    assigneeFilter,
    escalationFilter,
    preferencesHydrated,
    preset,
    reasonFilter,
    searchQuery,
    sortMode,
    statusFilter,
    visibilityFilter,
    watchlistLastViewedAt,
    watchlistNewOnly,
    watchlistSeverityFilter,
    activityFilter,
    activityEntryLimit,
    collapsedActivityGroups,
  ]);

  async function loadReports() {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available. Sign in through the seller workspace first.");
    }

    return api.get<ReviewModerationItem[]>("/reviews/reports?status=all", {
      accessToken: session.access_token,
      cache: "no-store",
    });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextReports = await loadReports();
        const session = await restoreAdminSession();
        if (!cancelled) {
          setReports(nextReports);
          setCurrentAdminUserId(session?.user_id ?? null);
          setModeratorNotes(
            Object.fromEntries(
              nextReports.map((report) => [report.id, report.moderator_note ?? ""]),
            ),
          );
          setResolutionReasons(
            Object.fromEntries(
              nextReports.map((report) => [report.id, report.resolution_reason ?? ""]),
            ),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof ApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
                : "Unable to load review reports.",
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

  const counts = useMemo(
    () => ({
      all: reports.length,
      open: reports.filter((report) => report.status === "open").length,
      triaged: reports.filter((report) => report.status === "triaged").length,
      resolved: reports.filter((report) => report.status === "resolved").length,
      hidden: reports.filter((report) => report.review.is_hidden).length,
      public: reports.filter((report) => !report.review.is_hidden).length,
      escalated: reports.filter((report) => report.is_escalated).length,
    }),
    [reports],
  );

  const reasonCounts = useMemo(() => {
    const values = new Map<string, number>();
    for (const report of reports) {
      values.set(report.reason, (values.get(report.reason) ?? 0) + 1);
    }

    return values;
  }, [reports]);

  const resolutionReasonCounts = useMemo(() => {
    const values = new Map<string, number>();
    for (const report of reports) {
      if (!report.resolution_reason) {
        continue;
      }

      values.set(report.resolution_reason, (values.get(report.resolution_reason) ?? 0) + 1);
    }

    return Array.from(values.entries()).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
  }, [reports]);

  const sellerCounts = useMemo(() => {
    const values = new Map<string, { label: string; count: number; slug?: string | null }>();
    for (const report of reports) {
      const key = report.seller_slug ?? report.seller_display_name ?? report.review_id;
      const label = report.seller_display_name ?? report.seller_slug ?? "Unknown seller";
      const current = values.get(key);
      if (current) {
        current.count += 1;
      } else {
        values.set(key, { label, count: 1, slug: report.seller_slug });
      }
    }

    return Array.from(values.values()).sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label),
    );
  }, [reports]);

  useEffect(() => {
    let cancelled = false;
    const nextSellerRows = sellerCounts.filter((seller) => seller.slug).slice(0, 6);

    if (!nextSellerRows.length) {
      setSellerTrustWatchlist([]);
      return;
    }

    void (async () => {
      const loaded = await Promise.allSettled(
        nextSellerRows.map(async (seller) => ({
          seller: await api.getSellerBySlug(seller.slug ?? "", { cache: "no-store" }),
          reportCount: seller.count,
        })),
      );

      if (cancelled) {
        return;
      }

      setSellerTrustWatchlist(
        loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])).sort(
          (left, right) =>
            (left.seller.trust_score?.score ?? 100) - (right.seller.trust_score?.score ?? 100) ||
            right.reportCount - left.reportCount ||
            left.seller.display_name.localeCompare(right.seller.display_name),
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [sellerCounts]);

  const sellerTrustInterventionSellerIds = useMemo(
    () => new Set(sellerTrustInterventions.map((entry) => entry.seller.id)),
    [sellerTrustInterventions],
  );

  const sellerTrustRiskCounts = useMemo(
    () => ({
      tracked: sellerTrustWatchlist.length,
      critical: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.risk_level === "critical").length,
      elevated: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.risk_level === "elevated").length,
      watch: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.risk_level === "watch").length,
      low: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.risk_level === "low").length,
      at_risk: sellerTrustWatchlist.filter((entry) => {
        const level = entry.seller.trust_score?.risk_level;
        return level === "critical" || level === "elevated";
      }).length,
      verified: sellerTrustWatchlist.filter((entry) => entry.seller.is_verified).length,
      needs_attention: sellerTrustWatchlist.filter(
        (entry) => entry.seller.trust_score?.label === "Needs attention",
      ).length,
      worsening: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.trend_direction === "worsening").length,
      steady: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.trend_direction === "steady").length,
      improving: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.trend_direction === "improving").length,
      new: sellerTrustWatchlist.filter((entry) => entry.seller.trust_score?.trend_direction === "new").length,
      intervention: sellerTrustWatchlist.filter((entry) => sellerTrustInterventionSellerIds.has(entry.seller.id)).length,
    }),
    [sellerTrustInterventionSellerIds, sellerTrustWatchlist],
  );

  function focusSellerTrustRisk(seller: SellerProfile) {
    setPreset("seller_risk");
    setSellerTrustRiskLevel("all");
    setSellerTrustTrendFilter("all");
    setSellerTrustQueueMode("all");
    setStatusFilter("all");
    setVisibilityFilter("all");
    setReasonFilter("all");
    setSortMode("newest");
    setAssigneeFilter("all");
    setEscalationFilter("all");
    setSearchQuery(seller.slug || seller.display_name);
    recordActivity(
      "watchlist",
      `Focused seller trust risk: ${seller.display_name}`,
      {
        preset: "seller_risk",
        status: "all",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "all",
        query: seller.slug || seller.display_name,
      },
    );
  }

  function focusSellerTrustIntervention() {
    setPreset("seller_risk");
    setSellerTrustRiskLevel("all");
    setSellerTrustTrendFilter("worsening");
    setSellerTrustQueueMode("intervention");
    setStatusFilter("all");
    setVisibilityFilter("all");
    setReasonFilter("all");
    setSortMode("newest");
    setAssigneeFilter("all");
    setEscalationFilter("all");
    setSearchQuery("");
    recordActivity("watchlist", "Opened seller trust intervention queue", {
      preset: "seller_risk",
      status: "all",
      visibility: "all",
      reason: "all",
      sort: "newest",
      assignee: "all",
      priority: "all",
      query: "",
    });
  }

  function focusReviewAnomaly(anomaly: ReviewAnomalyRead) {
    setPreset("needs_action");
    setStatusFilter("open");
    setVisibilityFilter("all");
    setReasonFilter("all");
    setSortMode("newest");
    setAssigneeFilter("all");
    setEscalationFilter("all");
    setSellerTrustRiskLevel("all");
    setSellerTrustTrendFilter("all");
    setSellerTrustQueueMode("all");
    setReviewAnomalySeverityFilter("all");
    setSearchQuery(anomaly.seller_slug ?? anomaly.seller_display_name ?? anomaly.seller_id);
    recordActivity(
      "watchlist",
      `Focused review anomaly: ${anomaly.seller_display_name ?? anomaly.seller_slug ?? anomaly.seller_id}`,
      {
        preset: "needs_action",
        status: "open",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "all",
        query: anomaly.seller_slug ?? anomaly.seller_display_name ?? anomaly.seller_id,
      },
    );
  }

  const presetCounts = useMemo(
    () => ({
      default: reports.length,
      needs_action: reports.filter((report) => report.status !== "resolved").length,
      hidden_reviews: reports.filter((report) => report.review.is_hidden).length,
      resolved_with_notes: reports.filter(
        (report) => report.status === "resolved" && Boolean(report.moderator_note?.trim()),
      ).length,
      escalated_only: reports.filter((report) => report.is_escalated).length,
      assigned_to_me: currentAdminUserId
        ? reports.filter((report) => report.assignee_user_id === currentAdminUserId).length
        : 0,
      unassigned: reports.filter((report) => !report.assignee_user_id).length,
      seller_risk: sellerTrustWatchlist.length,
    }),
    [currentAdminUserId, reports, sellerTrustWatchlist.length],
  );

  const assignmentCounts = useMemo(
    () => ({
      assigned_to_me: currentAdminUserId
        ? reports.filter((report) => report.assignee_user_id === currentAdminUserId).length
        : 0,
      unassigned: reports.filter((report) => !report.assignee_user_id).length,
      assigned_elsewhere: currentAdminUserId
        ? reports.filter(
            (report) => report.assignee_user_id && report.assignee_user_id !== currentAdminUserId,
          ).length
        : reports.filter((report) => report.assignee_user_id).length,
      total_assigned: reports.filter((report) => report.assignee_user_id).length,
    }),
    [currentAdminUserId, reports],
  );

  const escalationCounts = useMemo(
    () => ({
      escalated: reports.filter((report) => report.is_escalated).length,
      normal: reports.filter((report) => !report.is_escalated).length,
      assigned_to_me: currentAdminUserId
        ? reports.filter(
            (report) => report.is_escalated && report.assignee_user_id === currentAdminUserId,
          ).length
        : 0,
      unassigned: reports.filter((report) => report.is_escalated && !report.assignee_user_id).length,
      oldest:
        reports
          .filter((report) => report.is_escalated)
          .sort((left, right) =>
            (left.escalated_at ?? left.created_at).localeCompare(right.escalated_at ?? right.created_at),
          )[0]?.escalated_at ??
        reports
          .filter((report) => report.is_escalated)
          .sort((left, right) => left.created_at.localeCompare(right.created_at))[0]?.created_at ??
        null,
    }),
    [currentAdminUserId, reports],
  );

  const agingCounts = useMemo(
    () => ({
      stale_unassigned: reports.filter(
        (report) =>
          !report.assignee_user_id &&
          report.status !== "resolved" &&
          hoursSince(report.created_at) >= STALE_UNASSIGNED_HOURS,
      ).length,
      stale_assigned: reports.filter((report) => {
        if (!report.assignee_user_id || report.status === "resolved") {
          return false;
        }

        return hoursSince(report.assigned_at ?? report.created_at) >= STALE_ASSIGNED_HOURS;
      }).length,
      oldest_unassigned:
        reports
          .filter((report) => !report.assignee_user_id && report.status !== "resolved")
          .sort((left, right) => left.created_at.localeCompare(right.created_at))[0]?.created_at ??
        null,
      oldest_assigned:
        reports
          .filter((report) => report.assignee_user_id && report.status !== "resolved")
          .sort((left, right) =>
            (left.assigned_at ?? left.created_at).localeCompare(right.assigned_at ?? right.created_at),
          )[0]?.assigned_at ??
        reports
          .filter((report) => report.assignee_user_id && report.status !== "resolved")
          .sort((left, right) => left.created_at.localeCompare(right.created_at))[0]?.created_at ??
        null,
    }),
    [reports],
  );

  const repeatSellerAlert = useMemo(() => sellerCounts.find((seller) => seller.count >= 3) ?? null, [sellerCounts]);
  const watchlistBaselineTimestamp = useMemo(() => toTimestamp(watchlistBaselineAt), [watchlistBaselineAt]);

  const filteredReports = useMemo(
    () => {
      const normalizedSearch = searchQuery.trim().toLowerCase();
      const filtered = reports.filter((report) => {
        if (preset === "needs_action" && report.status === "resolved") {
          return false;
        }

        if (preset === "hidden_reviews" && !report.review.is_hidden) {
          return false;
        }

        if (preset === "resolved_with_notes") {
          if (report.status !== "resolved") {
            return false;
          }

          if (!report.moderator_note?.trim()) {
            return false;
          }
        }

        if (preset === "escalated_only" && !report.is_escalated) {
          return false;
        }

        if (preset === "assigned_to_me" && report.assignee_user_id !== currentAdminUserId) {
          return false;
        }

        if (preset === "unassigned" && report.assignee_user_id) {
          return false;
        }

        if (statusFilter !== "all" && report.status !== statusFilter) {
          return false;
        }

        if (visibilityFilter === "hidden" && !report.review.is_hidden) {
          return false;
        }

        if (visibilityFilter === "public" && report.review.is_hidden) {
          return false;
        }

        if (reasonFilter !== "all" && report.reason !== reasonFilter) {
          return false;
        }

        if (escalationFilter === "escalated" && !report.is_escalated) {
          return false;
        }

        if (escalationFilter === "normal" && report.is_escalated) {
          return false;
        }

        if (assigneeFilter === "mine" && report.assignee_user_id !== currentAdminUserId) {
          return false;
        }

        if (assigneeFilter === "unassigned" && report.assignee_user_id) {
          return false;
        }

        if (
          assigneeFilter === "elsewhere" &&
          (!report.assignee_user_id || report.assignee_user_id === currentAdminUserId)
        ) {
          return false;
        }

        if (normalizedSearch && !toSearchText(report).includes(normalizedSearch)) {
          return false;
        }

        return true;
      });

      return filtered.sort((left, right) => {
        if (sortMode === "oldest") {
          return left.created_at.localeCompare(right.created_at);
        }

        if (sortMode === "rating_high") {
          return right.review.rating - left.review.rating || right.created_at.localeCompare(left.created_at);
        }

        if (sortMode === "rating_low") {
          return left.review.rating - right.review.rating || right.created_at.localeCompare(left.created_at);
        }

        return right.created_at.localeCompare(left.created_at);
      });
    },
    [
      assigneeFilter,
      currentAdminUserId,
      preset,
      reasonFilter,
      reports,
      searchQuery,
      sortMode,
      statusFilter,
      escalationFilter,
      visibilityFilter,
    ],
  );

  const watchlistAlerts = useMemo<ModerationWatchlistAlert[]>(() => {
    const alerts: ModerationWatchlistAlert[] = [];

    if (agingCounts.stale_unassigned > 0) {
      const matchingReports = reports.filter(
        (report) =>
          !report.assignee_user_id &&
          report.status !== "resolved" &&
          hoursSince(report.created_at) >= STALE_UNASSIGNED_HOURS,
      );
      const newCount = matchingReports.filter((report) =>
        isAfterBaseline(report.created_at, watchlistBaselineTimestamp),
      ).length;
      alerts.push({
        id: "stale_unassigned",
        label: "Stale unassigned reports",
        detail: `Open reports older than ${STALE_UNASSIGNED_HOURS}h without an owner.`,
        count: agingCounts.stale_unassigned,
        newCount,
        isNew: newCount > 0,
        tone: "high",
        apply: () => {
          applySnapshot(
            {
              preset: "unassigned",
              status: "open",
              visibility: "all",
              reason: "all",
              sort: "oldest",
              assignee: "unassigned",
              priority: "all",
              query: "",
            },
            { recordLabel: "Opened stale unassigned watchlist", kind: "watchlist" },
          );
        },
      });
    }

    if (agingCounts.stale_assigned > 0) {
      const matchingReports = reports.filter((report) => {
        if (!report.assignee_user_id || report.status === "resolved") {
          return false;
        }

        return hoursSince(report.assigned_at ?? report.created_at) >= STALE_ASSIGNED_HOURS;
      });
      const newCount = matchingReports.filter((report) =>
        isAfterBaseline(report.assigned_at ?? report.created_at, watchlistBaselineTimestamp),
      ).length;
      alerts.push({
        id: "stale_assigned",
        label: "Stale assigned reports",
        detail: `Assigned reports older than ${STALE_ASSIGNED_HOURS}h still waiting on moderation.`,
        count: agingCounts.stale_assigned,
        newCount,
        isNew: newCount > 0,
        tone: "medium",
        apply: () => {
          applySnapshot(
            {
              preset: "default",
              status: "all",
              visibility: "all",
              reason: "all",
              sort: "oldest",
              assignee: "all",
              priority: "all",
              query: "",
            },
            { recordLabel: "Opened stale assigned watchlist", kind: "watchlist" },
          );
        },
      });
    }

    if (escalationCounts.unassigned > 0) {
      const matchingReports = reports.filter((report) => report.is_escalated && !report.assignee_user_id);
      const newCount = matchingReports.filter((report) =>
        isAfterBaseline(report.escalated_at ?? report.created_at, watchlistBaselineTimestamp),
      ).length;
      alerts.push({
        id: "escalated_unassigned",
        label: "Escalated without owner",
        detail: "Escalated trust cases are sitting unassigned.",
        count: escalationCounts.unassigned,
        newCount,
        isNew: newCount > 0,
        tone: "high",
        apply: () => {
          applySnapshot(
            {
              preset: "escalated_only",
              status: "all",
              visibility: "all",
              reason: "all",
              sort: "oldest",
              assignee: "unassigned",
              priority: "escalated",
              query: "",
            },
            { recordLabel: "Opened escalated unassigned watchlist", kind: "watchlist" },
          );
        },
      });
    }

    const hiddenOpenCount = reports.filter(
      (report) => report.review.is_hidden && report.status !== "resolved",
    ).length;
    if (hiddenOpenCount > 0) {
      const matchingReports = reports.filter(
        (report) => report.review.is_hidden && report.status !== "resolved",
      );
      const newCount = matchingReports.filter((report) => {
        const hiddenEventTimestamp =
          report.history
            ?.filter((event) => event.action === "visibility:hidden")
            .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]?.created_at ?? null;
        return isAfterBaseline(hiddenEventTimestamp ?? report.created_at, watchlistBaselineTimestamp);
      }).length;
      alerts.push({
        id: "hidden_open",
        label: "Hidden reviews still open",
        detail: "Moderators hid these reviews but have not closed the report workflow.",
        count: hiddenOpenCount,
        newCount,
        isNew: newCount > 0,
        tone: "monitor",
        apply: () => {
          applySnapshot(
            {
              preset: "hidden_reviews",
              status: "open",
              visibility: "hidden",
              reason: "all",
              sort: "newest",
              assignee: "all",
              priority: "all",
              query: "",
            },
            { recordLabel: "Opened hidden open review watchlist", kind: "watchlist" },
          );
        },
      });
    }

    if (repeatSellerAlert) {
      const matchingReports = reports.filter(
        (report) =>
          report.seller_slug === repeatSellerAlert.slug ||
          report.seller_display_name === repeatSellerAlert.label,
      );
      const newCount = matchingReports.filter((report) =>
        isAfterBaseline(report.created_at, watchlistBaselineTimestamp),
      ).length;
      alerts.push({
        id: "repeat_seller_reports",
        label: "Repeat seller reporting",
        detail: `${repeatSellerAlert.label} has ${repeatSellerAlert.count} active reports in queue.`,
        count: repeatSellerAlert.count,
        newCount,
        isNew: newCount > 0,
        tone: "medium",
        apply: () => {
          applySnapshot(
            {
              preset: "default",
              status: "all",
              visibility: "all",
              reason: "all",
              sort: "newest",
              assignee: "all",
              priority: "all",
              query: repeatSellerAlert.slug ?? repeatSellerAlert.label,
            },
            { recordLabel: "Opened repeat seller moderation watchlist", kind: "watchlist" },
          );
        },
      });
    }

    return alerts.sort((left, right) => {
      const toneOrder = { high: 0, medium: 1, monitor: 2 };
      return toneOrder[left.tone] - toneOrder[right.tone] || Number(right.isNew) - Number(left.isNew) || right.count - left.count;
    });
  }, [
    agingCounts.stale_assigned,
    agingCounts.stale_unassigned,
    escalationCounts.unassigned,
    repeatSellerAlert,
    reports,
    watchlistBaselineTimestamp,
  ]);

  const visibleWatchlistAlerts = useMemo(
    () =>
      watchlistAlerts.filter((alert) => {
        if (watchlistSeverityFilter !== "all" && alert.tone !== watchlistSeverityFilter) {
          return false;
        }

        if (watchlistNewOnly && !alert.isNew) {
          return false;
        }

        return true;
      }),
    [watchlistAlerts, watchlistNewOnly, watchlistSeverityFilter],
  );

  const visibleReviewAnomalies = useMemo(
    () =>
      reviewAnomalies.filter((anomaly) => {
        if (reviewAnomalySeverityFilter !== "all" && anomaly.severity !== reviewAnomalySeverityFilter) {
          return false;
        }

        return true;
      }),
    [reviewAnomalySeverityFilter, reviewAnomalies],
  );

  const reviewAnomalyCounts = useMemo(
    () => ({
      all: reviewAnomalies.length,
      high: reviewAnomalies.filter((anomaly) => anomaly.severity === "high").length,
      medium: reviewAnomalies.filter((anomaly) => anomaly.severity === "medium").length,
      monitor: reviewAnomalies.filter((anomaly) => anomaly.severity === "monitor").length,
    }),
    [reviewAnomalies],
  );

  const visibleSellerTrustWatchlist = useMemo(
    () =>
      sellerTrustWatchlist.filter((entry) => {
        const trustScore = entry.seller.trust_score;

        if (sellerTrustQueueMode === "intervention") {
          if (!sellerTrustInterventionSellerIds.has(entry.seller.id)) {
            return false;
          }
        }

        if (sellerTrustRiskLevel === "all") {
          // fall through to trend filtering
        } else if (trustScore?.risk_level !== sellerTrustRiskLevel) {
          return false;
        }

        if (sellerTrustTrendFilter === "all") {
          return true;
        }

        return trustScore?.trend_direction === sellerTrustTrendFilter;
      }),
    [
      sellerTrustInterventionSellerIds,
      sellerTrustQueueMode,
      sellerTrustRiskLevel,
      sellerTrustTrendFilter,
      sellerTrustWatchlist,
    ],
  );

  const activityCounts = useMemo(
    () => ({
      all: activityLog.length,
      watchlist: activityLog.filter((entry) => entry.kind === "watchlist").length,
      view: activityLog.filter((entry) => entry.kind === "view").length,
      operation: activityLog.filter((entry) => entry.kind === "operation").length,
      export: activityLog.filter((entry) => entry.kind === "export").length,
    }),
    [activityLog],
  );

  const visibleActivityLog = useMemo(
    () =>
      activityLog.filter((entry) => {
        if (activityFilter === "all") {
          return true;
        }

        return entry.kind === activityFilter;
      }),
    [activityFilter, activityLog],
  );

  const visibleActivityGroups = useMemo(() => {
    const groups: Array<{ label: string; entries: ReviewModerationActivityEntry[] }> = [];
    for (const entry of visibleActivityLog.slice(0, activityEntryLimit)) {
      const label = formatActivityDayLabel(entry.created_at);
      const current = groups[groups.length - 1];
      if (current?.label === label) {
        current.entries.push(entry);
      } else {
        groups.push({ label, entries: [entry] });
      }
    }

    return groups;
  }, [activityEntryLimit, visibleActivityLog]);

  const collapsedActivityGroupSet = useMemo(
    () => new Set(collapsedActivityGroups),
    [collapsedActivityGroups],
  );

  const hasOlderActivityGroups = useMemo(
    () => visibleActivityGroups.some((group) => group.label !== "Today"),
    [visibleActivityGroups],
  );
  const allOlderActivityGroupsCollapsed = useMemo(
    () =>
      visibleActivityGroups
        .filter((group) => group.label !== "Today")
        .every((group) => collapsedActivityGroupSet.has(group.label)),
    [collapsedActivityGroupSet, visibleActivityGroups],
  );
  const hasCollapsedVisibleActivityGroups = useMemo(
    () => visibleActivityGroups.some((group) => collapsedActivityGroupSet.has(group.label)),
    [collapsedActivityGroupSet, visibleActivityGroups],
  );

  function toggleActivityGroup(label: string) {
    setCollapsedActivityGroups((current) =>
      current.includes(label) ? current.filter((value) => value !== label) : [...current, label],
    );
  }

  function collapseOlderActivityGroups() {
    setCollapsedActivityGroups((current) => {
      const next = new Set(current);
      for (const group of visibleActivityGroups) {
        if (group.label !== "Today") {
          next.add(group.label);
        }
      }

      return Array.from(next);
    });
  }

  function expandAllActivityGroups() {
    setCollapsedActivityGroups((current) =>
      current.filter((label) => !visibleActivityGroups.some((group) => group.label === label)),
    );
  }

  function exportFilteredReportsCsv() {
    if (!filteredReports.length) {
      return;
    }

    downloadCsv("review-moderation-queue.csv", [
      [
        "report_id",
        "review_id",
        "seller",
        "seller_slug",
        "status",
        "visibility",
        "rating",
        "reason",
        "resolution_reason",
        "assignee",
        "escalated",
        "reported_at",
        "report_age",
        "notes",
        "moderator_note",
        "comment",
        "seller_response",
      ],
      ...filteredReports.map((report) => [
        report.id,
        report.review_id,
        report.seller_display_name ?? "Unknown seller",
        report.seller_slug ?? "",
        report.status,
        report.review.is_hidden ? "hidden" : "public",
        report.review.rating,
        report.reason,
        report.resolution_reason ?? "",
        report.assignee_user_id ?? "",
        Boolean(report.is_escalated),
        report.created_at,
        formatAgeLabel(report.created_at),
        report.notes ?? "",
        moderatorNotes[report.id] ?? report.moderator_note ?? "",
        report.review.comment ?? "",
        report.review.seller_response ?? "",
      ]),
    ]);
    recordActivity("export", "Exported moderation queue CSV", buildCurrentSnapshot());
  }

  function applyPreset(nextPreset: QueuePreset) {
    setPreset(nextPreset);

    if (nextPreset === "default") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      recordActivity("view", "Opened default moderation view", {
        preset: "default",
        status: "all",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "all",
        query: "",
      });
      return;
    }

    if (nextPreset === "needs_action") {
      setStatusFilter("open");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      recordActivity("view", "Opened needs action moderation view", {
        preset: "needs_action",
        status: "open",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "all",
        query: "",
      });
      return;
    }

    if (nextPreset === "hidden_reviews") {
      setStatusFilter("all");
      setVisibilityFilter("hidden");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      recordActivity("view", "Opened hidden reviews moderation view", {
        preset: "hidden_reviews",
        status: "all",
        visibility: "hidden",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "all",
        query: "",
      });
      return;
    }

    if (nextPreset === "assigned_to_me") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("mine");
      setEscalationFilter("all");
      setSortMode("newest");
      recordActivity("view", "Opened assigned to me moderation view", {
        preset: "assigned_to_me",
        status: "all",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "mine",
        priority: "all",
        query: "",
      });
      return;
    }

    if (nextPreset === "escalated_only") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("escalated");
      setSortMode("newest");
      recordActivity("view", "Opened escalated moderation view", {
        preset: "escalated_only",
        status: "all",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "escalated",
        query: "",
      });
      return;
    }

    if (nextPreset === "unassigned") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("unassigned");
      setEscalationFilter("all");
      setSortMode("newest");
      recordActivity("view", "Opened unassigned moderation view", {
        preset: "unassigned",
        status: "all",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "unassigned",
        priority: "all",
        query: "",
      });
      return;
    }

    if (nextPreset === "seller_risk") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      recordActivity("view", "Opened seller trust risk moderation view", {
        preset: "seller_risk",
        status: "all",
        visibility: "all",
        reason: "all",
        sort: "newest",
        assignee: "all",
        priority: "all",
        query: "",
      });
      return;
    }

    setStatusFilter("resolved");
    setVisibilityFilter("all");
    setReasonFilter("all");
    setAssigneeFilter("all");
    setEscalationFilter("all");
    setSortMode("oldest");
    recordActivity("view", "Opened resolved with notes moderation view", {
      preset: "resolved_with_notes",
      status: "resolved",
      visibility: "all",
      reason: "all",
      sort: "oldest",
      assignee: "all",
      priority: "all",
      query: "",
    });
  }

  async function updateStatus(reportId: string, status: ModerationStatus) {
    setUpdating(reportId);
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available. Sign in through the seller workspace first.");
      }

      const updated = await api.patch<ReviewModerationItem>(
        `/reviews/reports/${reportId}`,
        {
          status,
          moderator_note: moderatorNotes[reportId] ?? null,
          resolution_reason: status === "resolved" ? resolutionReasons[reportId] || null : null,
        },
        { accessToken: session.access_token },
      );

      setReports((current) => current.map((report) => (report.id === reportId ? updated : report)));
      setResolutionReasons((current) => ({
        ...current,
        [reportId]: updated.resolution_reason ?? "",
      }));
      recordActivity("operation", `Updated report status to ${status}`, buildCurrentSnapshot());
      await invalidateMarketplaceCaches();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof ApiError
          ? updateError.message
          : updateError instanceof Error
            ? updateError.message
            : "Unable to update report status.",
      );
    } finally {
      setUpdating(null);
    }
  }

  async function updateVisibility(reportId: string, reviewId: string, isHidden: boolean) {
    setUpdating(reportId);
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available. Sign in through the seller workspace first.");
      }

      const updatedReview = await api.updateReviewVisibility(
        reviewId,
        { is_hidden: isHidden, report_id: reportId },
        { accessToken: session.access_token },
      );

      setReports((current) =>
        current.map((report) =>
          report.id === reportId
            ? {
                ...report,
                review: updatedReview,
              }
            : report,
        ),
      );
      recordActivity(
        "operation",
        `${isHidden ? "Hidden" : "Restored"} reported review`,
        buildCurrentSnapshot(),
      );
      await invalidateMarketplaceCaches();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof ApiError
          ? updateError.message
          : updateError instanceof Error
            ? updateError.message
            : "Unable to update review visibility.",
      );
    } finally {
      setUpdating(null);
    }
  }

  async function updateAssignment(reportId: string, assigneeUserId: string | null) {
    setUpdating(reportId);
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available. Sign in through the seller workspace first.");
      }

      const currentReport = reports.find((report) => report.id === reportId);
      if (!currentReport) {
        throw new Error("Report not found in the moderation queue.");
      }

      const updated = await api.patch<ReviewModerationItem>(
        `/reviews/reports/${reportId}`,
        {
          status: currentReport.status,
          moderator_note: moderatorNotes[reportId] ?? null,
          resolution_reason:
            currentReport.status === "resolved" ? resolutionReasons[reportId] || null : null,
          assignee_user_id: assigneeUserId,
        },
        { accessToken: session.access_token },
      );

      setReports((current) => current.map((report) => (report.id === reportId ? updated : report)));
      recordActivity(
        "operation",
        assigneeUserId ? "Assigned review report" : "Cleared review assignment",
        buildCurrentSnapshot(),
      );
      await invalidateMarketplaceCaches();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof ApiError
          ? updateError.message
          : updateError instanceof Error
            ? updateError.message
            : "Unable to update report assignment.",
      );
    } finally {
      setUpdating(null);
    }
  }

  async function updateEscalation(reportId: string, isEscalated: boolean) {
    setUpdating(reportId);
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available. Sign in through the seller workspace first.");
      }

      const currentReport = reports.find((report) => report.id === reportId);
      if (!currentReport) {
        throw new Error("Report not found in the moderation queue.");
      }

      const updated = await api.patch<ReviewModerationItem>(
        `/reviews/reports/${reportId}`,
        {
          status: currentReport.status,
          moderator_note: moderatorNotes[reportId] ?? null,
          resolution_reason:
            currentReport.status === "resolved" ? resolutionReasons[reportId] || null : null,
          assignee_user_id: currentReport.assignee_user_id ?? null,
          is_escalated: isEscalated,
        },
        { accessToken: session.access_token },
      );

      setReports((current) => current.map((report) => (report.id === reportId ? updated : report)));
      recordActivity(
        "operation",
        isEscalated ? "Escalated review report" : "Cleared review escalation",
        buildCurrentSnapshot(),
      );
      await invalidateMarketplaceCaches();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof ApiError
          ? updateError.message
          : updateError instanceof Error
            ? updateError.message
            : "Unable to update escalation state.",
      );
    } finally {
      setUpdating(null);
    }
  }

  async function bulkUpdateAssignment(nextAssigneeUserId: string | null, mode: "assign" | "clear") {
    if (!filteredReports.length) {
      return;
    }

    setBulkUpdating(mode);
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available. Sign in through the seller workspace first.");
      }

      const targets = filteredReports.filter((report) =>
        nextAssigneeUserId
          ? report.assignee_user_id !== nextAssigneeUserId
          : Boolean(report.assignee_user_id),
      );
      const unchanged = filteredReports.length - targets.length;

      await Promise.all(
        targets.map((report) =>
          api.patch<ReviewModerationItem>(
            `/reviews/reports/${report.id}`,
            {
              status: report.status,
              moderator_note: moderatorNotes[report.id] ?? null,
              resolution_reason:
                report.status === "resolved" ? resolutionReasons[report.id] || null : null,
              assignee_user_id: nextAssigneeUserId,
            },
            { accessToken: session.access_token },
          ),
        ),
      );

      const refreshedReports = await loadReports();
      setReports(refreshedReports);
      setModeratorNotes(
        Object.fromEntries(refreshedReports.map((report) => [report.id, report.moderator_note ?? ""])),
      );
      setResolutionReasons(
        Object.fromEntries(
          refreshedReports.map((report) => [report.id, report.resolution_reason ?? ""]),
        ),
      );
      setBulkFeedback({
        tone: "success",
        message:
          `${mode === "assign" ? "Assigned" : "Cleared assignments on"} ${targets.length} report${targets.length === 1 ? "" : "s"}`
          + (unchanged > 0
            ? `. ${unchanged} already ${mode === "assign" ? "matched" : "were unassigned"}.`
            : "."),
      });
      await invalidateMarketplaceCaches();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof ApiError
          ? updateError.message
          : updateError instanceof Error
            ? updateError.message
            : "Unable to update assignments for the current view.",
      );
      setBulkFeedback({
        tone: "error",
        message:
          mode === "assign"
            ? "Unable to assign the current view."
            : "Unable to clear assignments for the current view.",
      });
    } finally {
      setBulkUpdating(null);
      setPendingBulkAssignment(null);
    }
  }

  async function bulkUpdateEscalation(nextEscalated: boolean) {
    if (!filteredReports.length) {
      return;
    }

    setBulkUpdating(nextEscalated ? "escalate" : "deescalate");
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available. Sign in through the seller workspace first.");
      }

      const targets = filteredReports.filter((report) => Boolean(report.is_escalated) !== nextEscalated);
      const unchanged = filteredReports.length - targets.length;

      await Promise.all(
        targets.map((report) =>
          api.patch<ReviewModerationItem>(
            `/reviews/reports/${report.id}`,
            {
              status: report.status,
              moderator_note: moderatorNotes[report.id] ?? null,
              resolution_reason:
                report.status === "resolved" ? resolutionReasons[report.id] || null : null,
              assignee_user_id: report.assignee_user_id ?? null,
              is_escalated: nextEscalated,
            },
            { accessToken: session.access_token },
          ),
        ),
      );

      const refreshedReports = await loadReports();
      setReports(refreshedReports);
      setModeratorNotes(
        Object.fromEntries(refreshedReports.map((report) => [report.id, report.moderator_note ?? ""])),
      );
      setResolutionReasons(
        Object.fromEntries(
          refreshedReports.map((report) => [report.id, report.resolution_reason ?? ""]),
        ),
      );
      setBulkFeedback({
        tone: "success",
        message:
          `${nextEscalated ? "Escalated" : "Cleared escalation on"} ${targets.length} report${targets.length === 1 ? "" : "s"}`
          + (unchanged > 0
            ? `. ${unchanged} already ${nextEscalated ? "matched" : "were clear"}.`
            : "."),
      });
      await invalidateMarketplaceCaches();
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof ApiError
          ? updateError.message
          : updateError instanceof Error
            ? updateError.message
            : "Unable to update escalation state for the current view.",
      );
      setBulkFeedback({
        tone: "error",
        message: nextEscalated
          ? "Unable to escalate the current view."
          : "Unable to clear escalation for the current view.",
      });
    } finally {
      setBulkUpdating(null);
      setPendingBulkEscalation(null);
    }
  }

  function stageBulkEscalation(nextEscalated: boolean) {
    if (!filteredReports.length) {
      return;
    }

    const targets = filteredReports.filter((report) => Boolean(report.is_escalated) !== nextEscalated);
    setBulkFeedback(null);
    setError(null);
    setPendingBulkAssignment(null);
    setPendingBulkEscalation({
      nextEscalated,
      targets: targets.length,
      unchanged: filteredReports.length - targets.length,
    });
  }

  function stageBulkAssignment(nextAssigneeUserId: string | null, mode: "assign" | "clear") {
    if (!filteredReports.length) {
      return;
    }

    const targets = filteredReports.filter((report) =>
      nextAssigneeUserId
        ? report.assignee_user_id !== nextAssigneeUserId
        : Boolean(report.assignee_user_id),
    );

    setBulkFeedback(null);
    setError(null);
    setPendingBulkEscalation(null);
    setPendingBulkAssignment({
      nextAssigneeUserId,
      mode,
      targets: targets.length,
      unchanged: filteredReports.length - targets.length,
    });
  }

  function updateModeratorNote(reportId: string, value: string) {
    setModeratorNotes((current) => ({
      ...current,
      [reportId]: value,
    }));
  }

  function updateResolutionReason(reportId: string, value: string) {
    setResolutionReasons((current) => ({
      ...current,
      [reportId]: value,
    }));
  }

  function applyShortcut(shortcut: ModerationShortcut) {
    applySnapshot(
      {
        preset: shortcut.preset,
        status: shortcut.status,
        visibility: shortcut.visibility,
        reason: "all",
        sort: shortcut.sort,
        assignee: shortcut.assignee,
        priority: shortcut.priority,
        query: "",
      },
      { recordLabel: `Opened ${shortcut.label} shortcut`, kind: "view" },
    );
  }

  return (
    <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Review Reports
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            Moderation queue
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!filteredReports.length}
            onClick={exportFilteredReportsCsv}
            type="button"
          >
            Export CSV
          </button>
          {(["open", "triaged", "resolved", "all"] as const).map((status) => (
            <button
              key={status}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                statusFilter === status
                  ? "border-accent bg-accent text-white"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setStatusFilter(status)}
              type="button"
            >
              {status} · {counts[status]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-[1.2rem] border border-border bg-[#f7f4ec] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Trust Watchlist
            </p>
            <p className="mt-2 text-sm text-foreground/72">
              Highest-friction moderation risks that need routing or closure first.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              Active alerts · {watchlistAlerts.length}
            </div>
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              New since review · {watchlistAlerts.reduce((sum, alert) => sum + alert.newCount, 0)}
            </div>
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              Last reviewed · {formatLastReviewedLabel(watchlistBaselineAt)}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All alerts", watchlistAlerts.length],
              [
                "high",
                "High",
                watchlistAlerts.filter((alert) => alert.tone === "high").length,
              ],
              [
                "medium",
                "Medium",
                watchlistAlerts.filter((alert) => alert.tone === "medium").length,
              ],
              [
                "monitor",
                "Monitor",
                watchlistAlerts.filter((alert) => alert.tone === "monitor").length,
              ],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                watchlistSeverityFilter === value
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setWatchlistSeverityFilter(value)}
              type="button"
            >
              {label} · {count}
            </button>
          ))}
          <button
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
              watchlistNewOnly
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
            }`}
            disabled={!watchlistAlerts.some((alert) => alert.isNew)}
            onClick={() => setWatchlistNewOnly((current) => !current)}
            type="button"
          >
            New since review · {watchlistAlerts.filter((alert) => alert.isNew).length}
          </button>
          {(watchlistSeverityFilter !== "all" || watchlistNewOnly) ? (
            <button
              className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => {
                setWatchlistSeverityFilter("all");
                setWatchlistNewOnly(false);
              }}
              type="button"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {visibleWatchlistAlerts.length ? (
            visibleWatchlistAlerts.map((alert) => (
              <button
                key={alert.id}
                className={`rounded-[1.1rem] border px-4 py-4 text-left transition ${
                  alert.tone === "high"
                    ? "border-red-200 bg-red-50 hover:border-red-300"
                    : alert.tone === "medium"
                      ? "border-amber-200 bg-amber-50 hover:border-amber-300"
                      : "border-border bg-white hover:border-accent"
                }`}
                onClick={alert.apply}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      alert.tone === "high"
                        ? "bg-white text-red-700"
                        : alert.tone === "medium"
                          ? "bg-white text-amber-700"
                          : "bg-[#eef4ff] text-[#214d9b]"
                    }`}
                  >
                    {alert.tone}
                  </span>
                  <span className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {alert.count}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">{alert.label}</p>
                <p className="mt-2 text-sm leading-6 text-foreground/68">{alert.detail}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {alert.isNew ? (
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-700">
                      New since review · {alert.newCount}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                      Ongoing
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                  Open slice
                </p>
              </button>
            ))
          ) : (
            <div className="rounded-[1.1rem] border border-dashed border-border bg-white/65 px-4 py-4 text-sm text-foreground/62">
              {watchlistAlerts.length
                ? "No trust watchlist alerts match the current filter."
                : "No active trust watchlist alerts right now."}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-[1.2rem] border border-border bg-[#f5f2ff] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Review Anomalies
            </p>
            <p className="mt-2 text-sm text-foreground/72">
              Backend-derived seller clusters with repeated, hidden, or bursty report pressure.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              Sellers · {reviewAnomalies.length}
            </div>
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              High · {reviewAnomalyCounts.high}
            </div>
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              Medium · {reviewAnomalyCounts.medium}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All", reviewAnomalyCounts.all],
              ["high", "High", reviewAnomalyCounts.high],
              ["medium", "Medium", reviewAnomalyCounts.medium],
              ["monitor", "Monitor", reviewAnomalyCounts.monitor],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                reviewAnomalySeverityFilter === value
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setReviewAnomalySeverityFilter(value)}
              type="button"
            >
              {label} · {count}
            </button>
          ))}
          {reviewAnomalySeverityFilter !== "all" ? (
            <button
              className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => setReviewAnomalySeverityFilter("all")}
              type="button"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {visibleReviewAnomalies.length ? (
            visibleReviewAnomalies.map((anomaly) => (
              <button
                key={anomaly.seller_id}
                className={`rounded-[1.1rem] border px-4 py-4 text-left transition ${
                  anomaly.severity === "high"
                    ? "border-red-200 bg-red-50 hover:border-red-300"
                    : anomaly.severity === "medium"
                      ? "border-amber-200 bg-amber-50 hover:border-amber-300"
                      : "border-border bg-white hover:border-accent"
                }`}
                onClick={() => focusReviewAnomaly(anomaly)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      anomaly.severity === "high"
                        ? "bg-white text-red-700"
                        : anomaly.severity === "medium"
                          ? "bg-white text-amber-700"
                          : "bg-[#eef4ff] text-[#214d9b]"
                    }`}
                  >
                    {anomaly.severity}
                  </span>
                  <span className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {anomaly.active_report_count}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {anomaly.seller_display_name ?? anomaly.seller_slug ?? anomaly.seller_id}
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground/68">
                  {anomaly.reasons.join(" · ")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                    Open · {anomaly.open_report_count}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                    Escalated · {anomaly.escalated_report_count}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                    Hidden open · {anomaly.hidden_open_count}
                  </span>
                </div>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                  Latest report · {formatAgeLabel(anomaly.latest_report_at)}
                </p>
              </button>
            ))
          ) : (
            <div className="rounded-[1.1rem] border border-dashed border-border bg-white/65 px-4 py-4 text-sm text-foreground/62">
              {reviewAnomalies.length
                ? "No review anomalies match the current filter."
                : "No review anomalies detected right now."}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-[1.2rem] border border-border bg-[#f8f2ea] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Seller Trust Risk
            </p>
            <p className="mt-2 text-sm text-foreground/72">
              Sellers with the heaviest report pressure and their computed trust score.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              Tracked sellers · {sellerTrustRiskCounts.tracked}
            </div>
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              At risk · {sellerTrustRiskCounts.at_risk}
            </div>
            <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
              Verified · {sellerTrustRiskCounts.verified}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All Levels"],
              ["critical", "Critical"],
              ["elevated", "Elevated"],
              ["watch", "Watch"],
              ["low", "Low Risk"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                sellerTrustRiskLevel === value
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setSellerTrustRiskLevel(value)}
              type="button"
            >
              {label} · {sellerTrustRiskCounts[value === "all" ? "tracked" : value]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All Trends"],
              ["worsening", "Worsening"],
              ["steady", "Steady"],
              ["improving", "Improving"],
              ["new", "New"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                sellerTrustTrendFilter === value
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setSellerTrustTrendFilter(value)}
              type="button"
            >
              {label} · {sellerTrustRiskCounts[value === "all" ? "tracked" : value]}
            </button>
          ))}
          <button
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
              sellerTrustQueueMode === "intervention"
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
            }`}
            onClick={() => {
              if (sellerTrustQueueMode === "intervention") {
                setSellerTrustQueueMode("all");
                return;
              }

              focusSellerTrustIntervention();
            }}
            type="button"
          >
            Intervention · {sellerTrustRiskCounts.intervention}
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {visibleSellerTrustWatchlist.length ? (
            visibleSellerTrustWatchlist.map(({ seller, reportCount }) => {
              const trustScore = seller.trust_score;
              const score = trustScore?.score ?? 0;
              const riskTone =
                trustScore?.risk_level === "critical"
                  ? "border-red-200 bg-red-50"
                  : trustScore?.risk_level === "elevated"
                    ? "border-amber-200 bg-amber-50"
                    : "border-border bg-white";

              return (
                <article key={seller.id} className={`rounded-[1.1rem] border px-4 py-4 ${riskTone}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{seller.display_name}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/56">
                        {seller.slug}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/72">
                        Reports · {reportCount}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          trustScore?.risk_level === "low"
                            ? "bg-[#eef4ff] text-[#214d9b]"
                            : trustScore?.risk_level === "watch"
                              ? "bg-white text-amber-700"
                              : "bg-white text-red-700"
                        }`}
                      >
                        Trust score · {score} · {trustScore?.label ?? "Unknown"}
                      </span>
                      {trustScore?.trend_direction ? (
                        <span
                          className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            trustScore.trend_direction === "improving"
                              ? "bg-[#eef4ff] text-[#214d9b]"
                              : trustScore.trend_direction === "worsening"
                                ? "bg-white text-red-700"
                                : trustScore.trend_direction === "new"
                                  ? "bg-white text-foreground/72"
                                  : "bg-white text-amber-700"
                          }`}
                        >
                          Trend · {trustScore.trend_direction}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-foreground/70">
                    {trustScore?.summary ?? "No trust summary available yet."}
                  </p>
                  {trustScore?.trend_summary ? (
                    <p className="mt-2 text-sm leading-6 text-foreground/64">
                      {trustScore.trend_summary}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <TrustRiskStat label="Reviews" value={trustScore?.review_count ?? 0} />
                    <TrustRiskStat
                      label="Response"
                      value={formatPercent(trustScore?.response_rate ?? 0)}
                    />
                    <TrustRiskStat
                      label="Completion"
                      value={formatPercent(trustScore?.completion_rate ?? 0)}
                    />
                    <TrustRiskStat
                      label="Delivery"
                      value={formatPercent(trustScore?.delivery_success_rate ?? 0)}
                    />
                  </div>
                  {trustScore?.risk_reasons?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {trustScore.risk_reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                      {trustScore?.hidden_review_count
                        ? `Hidden reviews · ${trustScore.hidden_review_count}`
                        : "No hidden reviews"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {trustScore?.trend_direction === "worsening" &&
                      (trustScore?.risk_level === "critical" || trustScore?.risk_level === "elevated") ? (
                        <button
                          className="rounded-full border border-red-300 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-700 transition hover:border-red-400 hover:text-red-800"
                          onClick={focusSellerTrustIntervention}
                          type="button"
                        >
                          Route intervention
                        </button>
                      ) : null}
                      <button
                        className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={() => focusSellerTrustRisk(seller)}
                        type="button"
                      >
                        Focus reports
                      </button>
                      <Link
                        className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        href={`/sellers/${seller.slug}`}
                      >
                        Open seller
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-[1.1rem] border border-dashed border-border bg-white/70 px-4 py-4 text-sm text-foreground/62">
              {sellerTrustQueueMode === "intervention"
                ? "No sellers are currently in the trust intervention queue."
                : sellerTrustWatchlist.length
                ? "No seller trust risk entries match the current level filter."
                : "No seller trust risk watchlist data loaded yet."}
            </div>
          )}
        </div>
        {sellerTrustRiskCounts.needs_attention ? (
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
            {sellerTrustRiskCounts.needs_attention} sellers are marked needs attention right now.
          </p>
        ) : null}
        {sellerTrustRiskCounts.worsening ? (
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-700">
            {sellerTrustRiskCounts.worsening} sellers are worsening across the last trust windows.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {shortcuts.map((shortcut) => {
          const count =
            shortcut.label === "Escalated Unassigned"
              ? escalationCounts.unassigned
              : shortcut.label === "Assigned To Me"
                ? assignmentCounts.assigned_to_me
                : presetCounts.resolved_with_notes;

          return (
            <button
              key={shortcut.label}
              className="rounded-full border border-border bg-white/75 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => applyShortcut(shortcut)}
              type="button"
            >
              {shortcut.label} · {count}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(
          [
            ["default", "Default"],
            ["needs_action", "Needs Action"],
            ["hidden_reviews", "Hidden Reviews"],
            ["resolved_with_notes", "Resolved With Notes"],
            ["escalated_only", "Escalated Only"],
            ["assigned_to_me", "Assigned To Me"],
            ["unassigned", "Unassigned"],
            ["seller_risk", "Seller Risk"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
              preset === value
                ? "border-accent bg-accent text-white"
                : value === "hidden_reviews" && presetCounts.hidden_reviews > 0
                  ? "border-red-300 bg-red-50 text-red-700 hover:border-accent hover:text-accent"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
            }`}
            onClick={() => {
              if (value === "seller_risk" && sellerTrustWatchlist.length) {
                focusSellerTrustRisk(sellerTrustWatchlist[0].seller);
                return;
              }

              applyPreset(value);
            }}
            type="button"
          >
            {label} · {presetCounts[value]}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["all", "public", "hidden"] as const).map((visibility) => (
          <button
            key={visibility}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
              visibilityFilter === visibility
                ? "border-accent bg-accent text-white"
                : visibility === "hidden" && counts.hidden > 0
                  ? "border-red-300 bg-red-50 text-red-700 hover:border-accent hover:text-accent"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
            }`}
            onClick={() => setVisibilityFilter(visibility)}
            type="button"
          >
            {visibility} · {counts[visibility]}
          </button>
        ))}
        <div className="ml-auto rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
          Visible queue · {filteredReports.length}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All Priority"],
            ["escalated", "Escalated"],
            ["normal", "Normal"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
              escalationFilter === value
                ? "border-accent bg-accent text-white"
                : value === "escalated" && escalationCounts.escalated > 0
                  ? "border-red-300 bg-red-50 text-red-700 hover:border-accent hover:text-accent"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
            }`}
            onClick={() => setEscalationFilter(value)}
            type="button"
          >
            {label} ·{" "}
            {value === "escalated"
              ? escalationCounts.escalated
              : value === "normal"
                ? escalationCounts.normal
                : reports.length}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!filteredReports.length || bulkUpdating !== null}
            onClick={() => stageBulkEscalation(true)}
            type="button"
          >
            {bulkUpdating === "escalate" ? "Escalating..." : "Escalate In View"}
          </button>
          <button
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!filteredReports.length || bulkUpdating !== null}
            onClick={() => stageBulkEscalation(false)}
            type="button"
          >
            {bulkUpdating === "deescalate" ? "Clearing..." : "Clear Escalation In View"}
          </button>
        </div>
      </div>

      {pendingBulkEscalation ? (
        <div className="mt-4 rounded-[1.2rem] border border-border bg-[#fff7ed] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9a4a00]/72">
                Confirm Bulk Escalation
              </p>
              <p className="mt-2 text-sm text-foreground/74">
                {pendingBulkEscalation.nextEscalated
                  ? `Escalate ${pendingBulkEscalation.targets} visible report${pendingBulkEscalation.targets === 1 ? "" : "s"}.`
                  : `Clear escalation on ${pendingBulkEscalation.targets} visible report${pendingBulkEscalation.targets === 1 ? "" : "s"}.`}
                {pendingBulkEscalation.unchanged > 0
                  ? ` ${pendingBulkEscalation.unchanged} already match the target state.`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={() => setPendingBulkEscalation(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-full border border-accent bg-accent px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white transition hover:opacity-90"
                disabled={bulkUpdating !== null}
                onClick={() => void bulkUpdateEscalation(pendingBulkEscalation.nextEscalated)}
                type="button"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All Assignees"],
            ["mine", "Mine"],
            ["unassigned", "Unassigned"],
            ["elsewhere", "Elsewhere"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
              assigneeFilter === value
                ? "border-accent bg-accent text-white"
                : "border-border text-foreground hover:border-accent hover:text-accent"
            }`}
            onClick={() => setAssigneeFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!currentAdminUserId || !filteredReports.length || bulkUpdating !== null}
            onClick={() => stageBulkAssignment(currentAdminUserId, "assign")}
            type="button"
          >
            {bulkUpdating === "assign" ? "Assigning..." : "Assign View To Me"}
          </button>
          <button
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!filteredReports.length || bulkUpdating !== null}
            onClick={() => stageBulkAssignment(null, "clear")}
            type="button"
          >
            {bulkUpdating === "clear" ? "Clearing..." : "Clear Assignments In View"}
          </button>
        </div>
      </div>

      {pendingBulkAssignment ? (
        <div className="mt-4 rounded-[1.2rem] border border-border bg-[#eff6ff] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#214d9b]/72">
                Confirm Bulk Assignment
              </p>
              <p className="mt-2 text-sm text-foreground/74">
                {pendingBulkAssignment.mode === "assign"
                  ? `Assign ${pendingBulkAssignment.targets} visible report${pendingBulkAssignment.targets === 1 ? "" : "s"} to you.`
                  : `Clear assignments on ${pendingBulkAssignment.targets} visible report${pendingBulkAssignment.targets === 1 ? "" : "s"}.`}
                {pendingBulkAssignment.unchanged > 0
                  ? ` ${pendingBulkAssignment.unchanged} already match the target state.`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={() => setPendingBulkAssignment(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-full border border-accent bg-accent px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white transition hover:opacity-90"
                disabled={bulkUpdating !== null}
                onClick={() =>
                  void bulkUpdateAssignment(
                    pendingBulkAssignment.nextAssigneeUserId,
                    pendingBulkAssignment.mode,
                  )
                }
                type="button"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.1fr_0.7fr_0.7fr]">
        <label className="rounded-[1.2rem] border border-border bg-white/65 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
            Search Queue
          </p>
          <input
            className="mt-2 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search seller, review text, notes, moderator note, or reporter id"
            type="search"
            value={searchQuery}
          />
        </label>

        <div className="rounded-[1.2rem] border border-border bg-white/65 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
            Reason
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                reasonFilter === "all"
                  ? "border-accent bg-accent text-white"
                  : "border-border text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setReasonFilter("all")}
              type="button"
            >
              all · {reports.length}
            </button>
            {Array.from(reasonCounts.entries())
              .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
              .map(([reason, count]) => (
                <button
                  key={reason}
                  className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    reasonFilter === reason
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setReasonFilter(reason)}
                  type="button"
                >
                  {reason} · {count}
                </button>
              ))}
          </div>
        </div>

        <div className="rounded-[1.2rem] border border-border bg-white/65 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
            Sort
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["newest", "Newest"],
                ["oldest", "Oldest"],
                ["rating_high", "Highest Rating"],
                ["rating_low", "Lowest Rating"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                  sortMode === value
                    ? "border-accent bg-accent text-white"
                    : "border-border text-foreground hover:border-accent hover:text-accent"
                }`}
                onClick={() => setSortMode(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-5">
        {[
          ["Open", String(counts.open)],
          ["Triaged", String(counts.triaged)],
          ["Resolved", String(counts.resolved)],
          ["Hidden", String(counts.hidden)],
          ["Escalated", String(counts.escalated)],
          ["All Reports", String(counts.all)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[1.2rem] border border-border bg-white/65 px-4 py-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              {label}
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          ["Assigned To Me", String(assignmentCounts.assigned_to_me)],
          ["Unassigned", String(assignmentCounts.unassigned)],
          ["Assigned Elsewhere", String(assignmentCounts.assigned_elsewhere)],
          ["Total Assigned", String(assignmentCounts.total_assigned)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[1.2rem] border border-border bg-[#eef4ff] px-4 py-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#214d9b]/70">
              {label}
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[#214d9b]">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          ["Stale Unassigned", String(agingCounts.stale_unassigned)],
          ["Stale Assigned", String(agingCounts.stale_assigned)],
          [
            "Oldest Unassigned",
            agingCounts.oldest_unassigned ? formatAgeLabel(agingCounts.oldest_unassigned) : "None",
          ],
          [
            "Oldest Assigned",
            agingCounts.oldest_assigned ? formatAgeLabel(agingCounts.oldest_assigned) : "None",
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[1.2rem] border border-border bg-[#fff3e8] px-4 py-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9a4a00]/70">
              {label}
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[#9a4a00]">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          ["Escalated Total", String(escalationCounts.escalated)],
          ["Escalated To Me", String(escalationCounts.assigned_to_me)],
          ["Escalated Unassigned", String(escalationCounts.unassigned)],
          [
            "Oldest Escalated",
            escalationCounts.oldest ? formatAgeLabel(escalationCounts.oldest) : "None",
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[1.2rem] border border-border bg-[#fff1f0] px-4 py-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#b42318]/72">
              {label}
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[#b42318]">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="rounded-[1.2rem] border border-border bg-white/65 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Resolution Breakdown
            </p>
            <p className="text-xs text-foreground/46">
              {resolutionReasonCounts.reduce((sum, [, count]) => sum + count, 0)} resolved outcomes
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {resolutionReasonCounts.length > 0 ? (
              resolutionReasonCounts.map(([reason, count]) => (
                <div
                  key={reason}
                  className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/76"
                >
                  {reason.replaceAll("_", " ")} · {count}
                </div>
              ))
            ) : (
              <p className="text-sm text-foreground/58">No resolved reasons recorded yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-[1.2rem] border border-border bg-white/65 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Seller Breakdown
            </p>
            <p className="text-xs text-foreground/46">{sellerCounts.length} sellers in queue</p>
          </div>
          <div className="mt-3 space-y-2">
            {sellerCounts.slice(0, 5).map((seller) => (
              <div
                key={`${seller.label}-${seller.slug ?? "none"}`}
                className="flex items-center justify-between gap-3 rounded-[0.9rem] border border-border bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{seller.label}</p>
                  {seller.slug ? (
                    <p className="text-xs text-foreground/46">/{seller.slug}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#f7f0e2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c3a10]">
                    {seller.count} reports
                  </span>
                  {seller.slug ? (
                    <Link
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      href={`/sellers/${seller.slug}`}
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
            {sellerCounts.length === 0 ? (
              <p className="text-sm text-foreground/58">No seller-linked reports in the queue yet.</p>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {bulkFeedback ? (
        <div
          className={`mt-5 rounded-[1.2rem] px-4 py-3 text-sm ${
            bulkFeedback.tone === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {bulkFeedback.message}
        </div>
      ) : null}

      <div className="mt-5 rounded-[1.2rem] border border-border bg-white/65 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Recent Moderation Activity
            </p>
            <p className="mt-2 text-sm text-foreground/66">
              Saved review queue actions from this admin workspace.
            </p>
          </div>
          <div className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/62">
            Entries · {activityLog.length}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All", activityCounts.all],
              ["watchlist", "Watchlist", activityCounts.watchlist],
              ["view", "Views", activityCounts.view],
              ["operation", "Operations", activityCounts.operation],
              ["export", "Exports", activityCounts.export],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                activityFilter === value
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setActivityFilter(value)}
              type="button"
            >
              {label} · {count}
            </button>
          ))}
          {([6, 10] as const).map((value) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                activityEntryLimit === value
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-foreground hover:border-accent hover:text-accent"
              }`}
              onClick={() => setActivityEntryLimit(value)}
              type="button"
            >
              Show {value}
            </button>
          ))}
          <button
            className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasOlderActivityGroups || allOlderActivityGroupsCollapsed}
            onClick={collapseOlderActivityGroups}
            type="button"
          >
            Collapse older days
          </button>
          <button
            className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasCollapsedVisibleActivityGroups}
            onClick={expandAllActivityGroups}
            type="button"
          >
            Expand all days
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {visibleActivityLog.length ? (
            visibleActivityGroups.map((group) => (
              <div key={group.label} className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
                    {group.label}
                  </p>
                  <div className="h-px flex-1 bg-border" />
                  <button
                    className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={() => toggleActivityGroup(group.label)}
                    type="button"
                  >
                    {collapsedActivityGroupSet.has(group.label) ? "Expand" : "Collapse"}
                  </button>
                </div>
                {collapsedActivityGroupSet.has(group.label) ? (
                  <div className="rounded-[1rem] border border-dashed border-border bg-white/60 px-4 py-3 text-sm text-foreground/62">
                    {group.entries.length} hidden entr{group.entries.length === 1 ? "y" : "ies"}
                  </div>
                ) : (
                  group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-border bg-white px-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                              entry.kind === "watchlist"
                                ? "bg-red-50 text-red-700"
                                : entry.kind === "view"
                                  ? "bg-[#eef4ff] text-[#214d9b]"
                                  : entry.kind === "export"
                                    ? "bg-[#f7f0e2] text-[#7c3a10]"
                                    : "bg-[#e8f7ef] text-[#166534]"
                            }`}
                          >
                            {entry.kind}
                          </span>
                          <p className="text-xs text-foreground/52">
                            {new Date(entry.created_at).toLocaleString()}
                          </p>
                        </div>
                        <p className="mt-2 text-sm font-medium text-foreground">{entry.label}</p>
                      </div>
                      {entry.snapshot ? (
                        <button
                          className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                          onClick={() =>
                            applySnapshot(entry.snapshot!, {
                              recordLabel: `Re-opened ${entry.label.toLowerCase()}`,
                              kind: entry.kind === "watchlist" ? "watchlist" : "view",
                            })
                          }
                          type="button"
                        >
                          Re-open
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ))
          ) : (
            <div className="rounded-[1rem] border border-dashed border-border bg-white/60 px-4 py-4 text-sm text-foreground/62">
              {activityLog.length
                ? "No moderation activity matches the current filter."
                : "No saved moderation activity yet."}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="rounded-[1.4rem] border border-border bg-white/70 px-4 py-4 text-sm text-foreground/66">
            Loading moderation queue...
          </div>
        ) : filteredReports.length > 0 ? (
          filteredReports.map((report) => (
            <article
              key={report.id}
              className="rounded-[1.5rem] border border-border bg-white/75 px-5 py-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#f3e1bd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c3a10]">
                      {report.review.rating}/5
                    </span>
                    <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                      {report.status}
                    </span>
                    {report.resolution_reason ? (
                      <span className="rounded-full bg-[#ede7f6] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5c2f91]">
                        {report.resolution_reason.replaceAll("_", " ")}
                      </span>
                    ) : null}
                    {report.assignee_user_id ? (
                      <span className="rounded-full bg-[#e2ecff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#214d9b]">
                        {report.assignee_user_id === currentAdminUserId ? "Assigned to Me" : `Assigned · ${report.assignee_user_id.slice(0, 8)}`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#f5efe5] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8b5e24]">
                        Unassigned
                      </span>
                    )}
                    {report.is_escalated ? (
                      <span className="rounded-full bg-[#fff1f0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b42318]">
                        Escalated
                      </span>
                    ) : null}
                    {!report.assignee_user_id &&
                    report.status !== "resolved" &&
                    hoursSince(report.created_at) >= STALE_UNASSIGNED_HOURS ? (
                      <span className="rounded-full bg-[#fff1f0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b42318]">
                        Stale Unassigned
                      </span>
                    ) : null}
                    {report.assignee_user_id &&
                    report.status !== "resolved" &&
                    hoursSince(report.assigned_at ?? report.created_at) >= STALE_ASSIGNED_HOURS ? (
                      <span className="rounded-full bg-[#fff1f0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b42318]">
                        Stale Assigned
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                        report.review.is_hidden
                          ? "bg-red-50 text-red-700"
                          : "bg-[#e4f1ed] text-[#0f5f62]"
                      }`}
                    >
                      {report.review.is_hidden ? "Hidden" : "Public"}
                    </span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-foreground">
                    {report.seller_display_name ?? "Unknown seller"}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-foreground/72">
                    {report.review.comment ?? "Buyer left a rating without a written comment."}
                  </p>
                  {report.review.seller_response ? (
                    <div className="mt-3 rounded-[1rem] border border-border bg-[#f7f0e2] px-3 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/48">
                        Seller Response
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/72">
                        {report.review.seller_response}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="min-w-[220px] rounded-[1.2rem] border border-border bg-background px-4 py-4 text-sm text-foreground/70">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
                    Report Context
                  </p>
                  <div className="mt-3 space-y-2">
                    <p>Reason: {report.reason}</p>
                    <p>Notes: {report.notes ?? "No extra notes provided."}</p>
                    <p>Reported: {new Date(report.created_at).toLocaleString()}</p>
                    <p>Report age: {formatAgeLabel(report.created_at)}</p>
                    <p>Reporter: user {report.reporter_id.slice(0, 8)}</p>
                    <p>
                      Assignee:{" "}
                      {report.assignee_user_id
                        ? report.assignee_user_id === currentAdminUserId
                          ? "Me"
                          : `user ${report.assignee_user_id.slice(0, 8)}`
                        : "Unassigned"}
                    </p>
                    <p>
                      Assignment age:{" "}
                      {report.assignee_user_id
                        ? formatAgeLabel(report.assigned_at ?? report.created_at)
                        : "Not assigned"}
                    </p>
                    <p>
                      Escalation:{" "}
                      {report.is_escalated
                        ? `Escalated${report.escalated_at ? ` · ${formatAgeLabel(report.escalated_at)}` : ""}`
                        : "Normal"}
                    </p>
                  </div>
                  {report.seller_slug ? (
                    <Link
                      className="mt-4 inline-flex rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      href={`/sellers/${report.seller_slug}`}
                    >
                      Open Storefront
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 rounded-[1.2rem] border border-border bg-background px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
                  Resolution Reason
                </p>
                <select
                  className="mt-3 w-full rounded-[0.9rem] border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
                  onChange={(event) => updateResolutionReason(report.id, event.target.value)}
                  value={resolutionReasons[report.id] ?? ""}
                >
                  <option value="">No resolution reason</option>
                  {RESOLUTION_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {report.status === "resolved" && !(resolutionReasons[report.id] ?? "").trim() ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Resolved reports require a structured resolution reason.
                  </p>
                ) : null}
              </div>

              <div className="mt-4 rounded-[1.2rem] border border-border bg-background px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
                  Moderator Note
                </p>
                <textarea
                  className="mt-3 min-h-[88px] w-full rounded-[0.9rem] border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
                  onChange={(event) => updateModeratorNote(report.id, event.target.value)}
                  placeholder="Capture why this report was triaged, resolved, or left public."
                  value={moderatorNotes[report.id] ?? ""}
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  disabled={updating === report.id || !currentAdminUserId}
                  onClick={() =>
                    void updateAssignment(
                      report.id,
                      report.assignee_user_id === currentAdminUserId ? null : currentAdminUserId,
                    )
                  }
                  type="button"
                >
                  {updating === report.id
                    ? "Updating..."
                    : report.assignee_user_id === currentAdminUserId
                      ? "Unassign Me"
                      : "Assign To Me"}
                </button>
                <button
                  className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  disabled={updating === report.id}
                  onClick={() => void updateEscalation(report.id, !report.is_escalated)}
                  type="button"
                >
                  {updating === report.id
                    ? "Updating..."
                    : report.is_escalated
                      ? "Clear Escalation"
                      : "Escalate"}
                </button>
                {(["open", "triaged", "resolved"] as const).map((status) => (
                  <button
                    key={status}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                      report.status === status
                        ? "border-accent bg-accent text-white"
                        : "border-border text-foreground hover:border-accent hover:text-accent"
                    }`}
                    disabled={updating === report.id}
                    onClick={() => void updateStatus(report.id, status)}
                    type="button"
                  >
                    {updating === report.id && report.status !== status ? "Updating..." : status}
                  </button>
                ))}
                <button
                  className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  disabled={updating === report.id}
                  onClick={() =>
                    void updateVisibility(report.id, report.review.id, !report.review.is_hidden)
                  }
                  type="button"
                >
                  {updating === report.id
                    ? "Updating..."
                    : report.review.is_hidden
                      ? "Restore Review"
                      : "Hide Review"}
                </button>
              </div>

              {report.history?.length ? (
                <div className="mt-5 rounded-[1.2rem] border border-border bg-white/65 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
                    Action History
                  </p>
                  <div className="mt-3 space-y-3">
                    {report.history.map((event) => (
                      <div
                        key={event.id}
                        className="border-t border-border pt-3 first:border-t-0 first:pt-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/66">
                            {formatActionLabel(event.action)}
                          </p>
                          <p className="text-xs text-foreground/52">
                            {new Date(event.created_at).toLocaleString()}
                          </p>
                        </div>
                        <p className="mt-2 text-xs text-foreground/52">
                          {formatActorLabel(report, event.actor_user_id, event.action)}
                          {" · "}
                          {event.actor_user_id.slice(0, 8)}
                        </p>
                        {event.note ? (
                          <p className="mt-2 text-sm leading-6 text-foreground/72">{event.note}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-[1.4rem] border border-dashed border-border bg-white/60 px-4 py-4 text-sm leading-6 text-foreground/66">
            No review reports match this moderation state right now.
          </div>
        )}
      </div>
    </section>
  );
}
