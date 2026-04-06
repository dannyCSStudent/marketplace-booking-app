"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, type ReviewRead } from "@/app/lib/api";
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
  | "unassigned";
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

type ModerationShortcut = {
  label: string;
  preset: QueuePreset;
  status: ModerationStatus | "all";
  visibility: VisibilityFilter;
  assignee: AssigneeFilter;
  priority: EscalationFilter;
  sort: SortMode;
};

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
    }),
    [currentAdminUserId, reports],
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

  function applyPreset(nextPreset: QueuePreset) {
    setPreset(nextPreset);

    if (nextPreset === "default") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      return;
    }

    if (nextPreset === "needs_action") {
      setStatusFilter("open");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      return;
    }

    if (nextPreset === "hidden_reviews") {
      setStatusFilter("all");
      setVisibilityFilter("hidden");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("all");
      setSortMode("newest");
      return;
    }

    if (nextPreset === "assigned_to_me") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("mine");
      setEscalationFilter("all");
      setSortMode("newest");
      return;
    }

    if (nextPreset === "escalated_only") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("all");
      setEscalationFilter("escalated");
      setSortMode("newest");
      return;
    }

    if (nextPreset === "unassigned") {
      setStatusFilter("all");
      setVisibilityFilter("all");
      setReasonFilter("all");
      setAssigneeFilter("unassigned");
      setEscalationFilter("all");
      setSortMode("newest");
      return;
    }

    setStatusFilter("resolved");
    setVisibilityFilter("all");
    setReasonFilter("all");
    setAssigneeFilter("all");
    setEscalationFilter("all");
    setSortMode("oldest");
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
    setPreset(shortcut.preset);
    setStatusFilter(shortcut.status);
    setVisibilityFilter(shortcut.visibility);
    setReasonFilter("all");
    setAssigneeFilter(shortcut.assignee);
    setEscalationFilter(shortcut.priority);
    setSortMode(shortcut.sort);
    setSearchQuery("");
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
            onClick={() => applyPreset(value)}
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
