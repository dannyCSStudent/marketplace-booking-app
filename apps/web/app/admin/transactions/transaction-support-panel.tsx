"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type AdminUser,
  type BookingAdmin,
  type NotificationDelivery,
  type OrderAdmin,
  type ReviewModerationItem,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type TransactionKind = "order" | "booking";
type TransactionFilter = "all" | TransactionKind;
type StatusFilter = "all" | "open" | "completed";
type AssigneeFilter = "all" | "mine" | "unassigned" | "elsewhere";
type EscalationFilter = "all" | "escalated" | "normal";
type AdminRoleFilter = "all" | "support" | "trust" | "owner";
type DeliveryFilter = "all" | "failed" | "queued";
type TrustContextFilter = "all" | "trust_driven";
type QueuePreset =
  | "default"
  | "needs_follow_up"
  | "assigned_to_me"
  | "escalated_unassigned"
  | "escalated_to_me"
  | "stale_unassigned"
  | "escalated_assigned"
  | "escalated_assigned_elsewhere"
  | "needs_reassignment"
  | "support_queue"
  | "trust_queue"
  | "failed_delivery_follow_up"
  | "trust_driven";
type FeedbackTone = "success" | "error";
type PendingBulkAction =
  | {
      kind: "assign";
      targetCount: number;
      unchangedCount: number;
    }
  | {
      kind: "clear_assignment";
      targetCount: number;
      unchangedCount: number;
    }
  | {
      kind: "escalate";
      targetCount: number;
      unchangedCount: number;
    }
  | {
      kind: "clear_escalation";
      targetCount: number;
      unchangedCount: number;
    }
  | {
      kind: "retry_failed_deliveries";
      targetCount: number;
      unchangedCount: number;
    };
type PendingRouteAction = {
  item: SupportItem;
  nextEscalated: boolean;
  target: AdminUser | null;
};
type OrderHistoryEvent = NonNullable<OrderAdmin["status_history"]>[number];
type BookingHistoryEvent = NonNullable<BookingAdmin["status_history"]>[number];
type OrderAdminEvent = NonNullable<OrderAdmin["admin_history"]>[number];
type BookingAdminEvent = NonNullable<BookingAdmin["admin_history"]>[number];

type SupportItem =
  | {
      id: string;
      kind: "order";
      status: string;
      seller_id: string;
      buyer_id: string;
      title: string;
      subtitle: string;
      amountLabel: string;
      createdAt: string | null;
      adminNote: string | null;
      adminHandoffNote: string | null;
      adminAssigneeUserId: string | null;
      adminAssignedAt: string | null;
      adminIsEscalated: boolean;
      adminEscalatedAt: string | null;
      history: Array<{
        id: string;
        status: string;
        actorRole: string;
        note: string | null;
        createdAt: string;
      }>;
      adminHistory: Array<{
        id: string;
        actorUserId: string;
        action: string;
        note: string | null;
        createdAt: string;
      }>;
      raw: OrderAdmin;
    }
  | {
      id: string;
      kind: "booking";
      status: string;
      seller_id: string;
      buyer_id: string;
      title: string;
      subtitle: string;
      amountLabel: string;
      createdAt: string | null;
      adminNote: string | null;
      adminHandoffNote: string | null;
      adminAssigneeUserId: string | null;
      adminAssignedAt: string | null;
      adminIsEscalated: boolean;
      adminEscalatedAt: string | null;
      history: Array<{
        id: string;
        status: string;
        actorRole: string;
        note: string | null;
        createdAt: string;
      }>;
      adminHistory: Array<{
        id: string;
        actorUserId: string;
        action: string;
        note: string | null;
        createdAt: string;
      }>;
      raw: BookingAdmin;
    };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

const OPEN_ORDER_STATUSES = new Set(["pending", "accepted", "preparing", "ready"]);
const OPEN_BOOKING_STATUSES = new Set(["requested", "confirmed", "in_progress"]);
const STALE_UNASSIGNED_HOURS = 24;
const STALE_ASSIGNED_HOURS = 48;
const TRUST_ESCALATION_MARKER = "Trust escalation trigger:";

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

function hoursSince(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }

  return Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60));
}

function formatAgeLabel(value: string | null | undefined) {
  const hours = hoursSince(value);
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

function formatAdminOptionLabel(admin: AdminUser) {
  const primary = admin.full_name?.trim() || admin.username?.trim() || admin.email?.trim() || truncateId(admin.id);
  const secondary = admin.full_name?.trim()
    ? admin.email?.trim() || admin.username?.trim() || truncateId(admin.id)
    : admin.email?.trim()
      ? truncateId(admin.id)
      : null;
  const identity = secondary ? `${primary} · ${secondary}` : primary;
  return admin.role?.trim() ? `${identity} · ${admin.role.trim()}` : identity;
}

function normalizeAdminRole(role: string | null | undefined): AdminRoleFilter | null {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "support" || normalized === "trust" || normalized === "owner") {
    return normalized;
  }
  return null;
}

function formatAdminActionLabel(action: string) {
  if (action === "admin_note_updated") {
    return "Note Updated";
  }

  if (action === "handoff_note_updated") {
    return "Handoff Note Updated";
  }

  if (action === "assignment_set") {
    return "Assigned";
  }

  if (action === "assignment_cleared") {
    return "Assignment Cleared";
  }

  if (action === "escalation_enabled") {
    return "Escalated";
  }

  if (action === "escalation_cleared") {
    return "Escalation Cleared";
  }

  return action.replaceAll("_", " ");
}

function titleCaseFilterLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toSupportOrder(order: OrderAdmin): SupportItem {
  const statusHistory = order.status_history ?? [];
  const items = order.items ?? [];
  const firstStatusAt = statusHistory.at(-1)?.created_at ?? null;
  const itemSummary =
    items.length > 0
      ? `${items.length} item${items.length === 1 ? "" : "s"}`
      : "No items";

  return {
    id: order.id,
    kind: "order",
    status: order.status,
    seller_id: order.seller_id,
    buyer_id: order.buyer_id,
    title: items[0]?.listing_title ?? "Order",
    subtitle: `${itemSummary} · ${order.fulfillment.replaceAll("_", " ")}`,
    amountLabel: formatCurrency(order.total_cents, order.currency),
    createdAt: firstStatusAt,
    adminNote: order.admin_note ?? null,
    adminHandoffNote: order.admin_handoff_note ?? null,
    adminAssigneeUserId: order.admin_assignee_user_id ?? null,
    adminAssignedAt: order.admin_assigned_at ?? null,
    adminIsEscalated: Boolean(order.admin_is_escalated),
    adminEscalatedAt: order.admin_escalated_at ?? null,
    history: statusHistory.map((event: OrderHistoryEvent) => ({
      id: event.id,
      status: event.status,
      actorRole: event.actor_role,
      note: event.note ?? null,
      createdAt: event.created_at,
    })),
    adminHistory: (order.admin_history ?? []).map((event: OrderAdminEvent) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      action: event.action,
      note: event.note ?? null,
      createdAt: event.created_at,
    })),
    raw: order,
  };
}

function toSupportBooking(booking: BookingAdmin): SupportItem {
  const statusHistory = booking.status_history ?? [];
  const firstStatusAt = statusHistory.at(-1)?.created_at ?? null;
  const scheduleLabel = booking.scheduled_start
    ? `${formatDateTime(booking.scheduled_start)}${booking.scheduled_end ? ` to ${formatDateTime(booking.scheduled_end)}` : ""}`
    : "Schedule pending";

  return {
    id: booking.id,
    kind: "booking",
    status: booking.status,
    seller_id: booking.seller_id,
    buyer_id: booking.buyer_id,
    title: booking.listing_title ?? "Booking",
    subtitle: scheduleLabel,
    amountLabel: formatCurrency(booking.total_cents, booking.currency),
    createdAt: firstStatusAt,
    adminNote: booking.admin_note ?? null,
    adminHandoffNote: booking.admin_handoff_note ?? null,
    adminAssigneeUserId: booking.admin_assignee_user_id ?? null,
    adminAssignedAt: booking.admin_assigned_at ?? null,
    adminIsEscalated: Boolean(booking.admin_is_escalated),
    adminEscalatedAt: booking.admin_escalated_at ?? null,
    history: statusHistory.map((event: BookingHistoryEvent) => ({
      id: event.id,
      status: event.status,
      actorRole: event.actor_role,
      note: event.note ?? null,
      createdAt: event.created_at,
    })),
    adminHistory: (booking.admin_history ?? []).map((event: BookingAdminEvent) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      action: event.action,
      note: event.note ?? null,
      createdAt: event.created_at,
    })),
    raw: booking,
  };
}

function isOpenItem(item: SupportItem) {
  if (item.kind === "order") {
    return OPEN_ORDER_STATUSES.has(item.status);
  }

  return OPEN_BOOKING_STATUSES.has(item.status);
}

function isStaleUnassigned(item: SupportItem) {
  return !item.adminAssigneeUserId && isOpenItem(item) && hoursSince(item.createdAt) >= STALE_UNASSIGNED_HOURS;
}

function isStaleAssigned(item: SupportItem) {
  return Boolean(item.adminAssigneeUserId) &&
    isOpenItem(item) &&
    hoursSince(item.adminAssignedAt ?? item.createdAt) >= STALE_ASSIGNED_HOURS;
}

export function TransactionSupportPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SupportItem[]>([]);
  const [adminRoster, setAdminRoster] = useState<AdminUser[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [reviewReports, setReviewReports] = useState<ReviewModerationItem[]>([]);
  const [preset, setPreset] = useState<QueuePreset>("needs_follow_up");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TransactionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [escalationFilter, setEscalationFilter] = useState<EscalationFilter>("all");
  const [roleFilter, setRoleFilter] = useState<AdminRoleFilter>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [trustFilter, setTrustFilter] = useState<TrustContextFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentAdminUserId, setCurrentAdminUserId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});
  const [handoffDrafts, setHandoffDrafts] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null);
  const [focusFeedback, setFocusFeedback] = useState<string | null>(null);
  const [sliceLinkFeedback, setSliceLinkFeedback] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState<string | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction | null>(null);
  const [pendingRouteAction, setPendingRouteAction] = useState<PendingRouteAction | null>(null);

  useEffect(() => {
    const nextPreset = searchParams.get("preset");
    const nextType = searchParams.get("type");
    const nextStatus = searchParams.get("status");
    const nextAssignee = searchParams.get("assignee");
    const nextPriority = searchParams.get("priority");
    const nextRole = searchParams.get("role");
    const nextDelivery = searchParams.get("delivery");
    const nextTrust = searchParams.get("trust");
    const nextSearch = searchParams.get("q");
    const nextFocus = searchParams.get("focus");

    setPreset(
      nextPreset === "default" ||
        nextPreset === "needs_follow_up" ||
        nextPreset === "assigned_to_me" ||
        nextPreset === "escalated_unassigned" ||
        nextPreset === "escalated_to_me" ||
        nextPreset === "stale_unassigned" ||
        nextPreset === "escalated_assigned" ||
        nextPreset === "escalated_assigned_elsewhere" ||
        nextPreset === "needs_reassignment" ||
        nextPreset === "support_queue" ||
        nextPreset === "trust_queue" ||
        nextPreset === "failed_delivery_follow_up" ||
        nextPreset === "trust_driven"
        ? nextPreset
        : "needs_follow_up",
    );
    setTypeFilter(
      nextType === "all" || nextType === "order" || nextType === "booking" ? nextType : "all",
    );
    setStatusFilter(
      nextStatus === "all" || nextStatus === "open" || nextStatus === "completed"
        ? nextStatus
        : "open",
    );
    setAssigneeFilter(
      nextAssignee === "all" ||
        nextAssignee === "mine" ||
        nextAssignee === "unassigned" ||
        nextAssignee === "elsewhere"
        ? nextAssignee
        : "all",
    );
    setEscalationFilter(
      nextPriority === "all" || nextPriority === "escalated" || nextPriority === "normal"
        ? nextPriority
        : "all",
    );
    setRoleFilter(
      nextRole === "all" || nextRole === "support" || nextRole === "trust" || nextRole === "owner"
        ? nextRole
        : "all",
    );
    setDeliveryFilter(
      nextDelivery === "all" || nextDelivery === "failed" || nextDelivery === "queued"
        ? nextDelivery
        : "all",
    );
    setTrustFilter(nextTrust === "trust_driven" ? "trust_driven" : "all");
    setSearchQuery(nextSearch ?? "");
    setFocusKey(nextFocus ?? null);
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "needs_follow_up") {
      params.set("preset", preset);
    }
    if (typeFilter !== "all") {
      params.set("type", typeFilter);
    }
    if (statusFilter !== "open") {
      params.set("status", statusFilter);
    }
    if (assigneeFilter !== "all") {
      params.set("assignee", assigneeFilter);
    }
    if (escalationFilter !== "all") {
      params.set("priority", escalationFilter);
    }
    if (roleFilter !== "all") {
      params.set("role", roleFilter);
    }
    if (deliveryFilter !== "all") {
      params.set("delivery", deliveryFilter);
    }
    if (trustFilter !== "all") {
      params.set("trust", trustFilter);
    }
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }
    if (focusKey) {
      params.set("focus", focusKey);
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `?${nextQuery}` : "/admin/transactions", { scroll: false });
    }
  }, [assigneeFilter, deliveryFilter, escalationFilter, focusKey, preset, roleFilter, router, searchParams, searchQuery, statusFilter, trustFilter, typeFilter]);

  function applyQueueState(next: {
    preset: QueuePreset;
    type: TransactionFilter;
    status: StatusFilter;
    assignee: AssigneeFilter;
    priority: EscalationFilter;
    role: AdminRoleFilter;
    delivery: DeliveryFilter;
    trust?: TrustContextFilter;
  }) {
    setPreset(next.preset);
    setTypeFilter(next.type);
    setStatusFilter(next.status);
    setAssigneeFilter(next.assignee);
    setEscalationFilter(next.priority);
    setRoleFilter(next.role);
    setDeliveryFilter(next.delivery);
    setTrustFilter(next.trust ?? "all");
    setFocusKey("__AUTO__");
  }

  function syncSupportItem(nextItem: SupportItem) {
    setItems((current) =>
      current
        .map((item) => (item.kind === nextItem.kind && item.id === nextItem.id ? nextItem : item))
        .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")),
    );
  }

  async function updateSupport(item: SupportItem, payload: Record<string, unknown>, actionLabel: string) {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available. Sign in through the seller workspace first.");
    }

    const itemKey = `${item.kind}:${item.id}`;
    const focusedFallbackKey =
      focusKey === itemKey
        ? (filteredItems[focusedIndex + 1] ?? filteredItems[focusedIndex - 1])
          ? `${(filteredItems[focusedIndex + 1] ?? filteredItems[focusedIndex - 1])!.kind}:${(filteredItems[focusedIndex + 1] ?? filteredItems[focusedIndex - 1])!.id}`
          : null
        : null;
    const shouldAdvanceFocus =
      focusKey === itemKey &&
      ("admin_assignee_user_id" in payload || "admin_is_escalated" in payload) &&
      (assigneeFilter !== "all" ||
        escalationFilter !== "all" ||
        preset === "assigned_to_me" ||
        preset === "escalated_unassigned" ||
        preset === "escalated_to_me" ||
        preset === "stale_unassigned" ||
        preset === "escalated_assigned");

    setUpdatingId(`${item.kind}:${item.id}`);
    setFeedback(null);
    try {
      const updated =
        item.kind === "order"
          ? toSupportOrder(
              await api.updateAdminOrderSupport(item.id, payload, {
                accessToken: session.access_token,
              }),
            )
          : toSupportBooking(
              await api.updateAdminBookingSupport(item.id, payload, {
                accessToken: session.access_token,
              }),
            );
      syncSupportItem(updated);
      setNoteDrafts((current) => ({ ...current, [item.id]: updated.adminNote ?? "" }));
      setAssigneeDrafts((current) => ({
        ...current,
        [item.id]: updated.adminAssigneeUserId ?? "",
      }));
      setHandoffDrafts((current) => ({ ...current, [item.id]: updated.adminHandoffNote ?? "" }));
      if (shouldAdvanceFocus) {
        setFocusFeedback(
          `${item.kind} ${truncateId(item.id)} left the current slice. Focus moved to the next matching transaction.`,
        );
        setFocusKey(focusedFallbackKey ?? "__AUTO__");
      }
      setFeedback({
        tone: "success",
        message: `${actionLabel} updated for ${item.kind} ${truncateId(item.id)}.`,
      });
    } catch (updateError) {
      setFeedback({
        tone: "error",
        message:
          updateError instanceof ApiError
            ? updateError.message
            : updateError instanceof Error
              ? updateError.message
              : `Unable to update ${item.kind} support state.`,
      });
    } finally {
      setUpdatingId(null);
    }
  }

  async function runBulkAction(action: PendingBulkAction) {
    const session = await restoreAdminSession();
    if (!session || !currentAdminUserId) {
      setFeedback({ tone: "error", message: "Admin session not available. Sign in again." });
      return;
    }

    if (action.kind === "retry_failed_deliveries") {
      setBulkUpdating(action.kind);
      setFeedback(null);
      try {
        const retryResults = await Promise.allSettled(
          bulkCandidates.retryFailedDeliveries.map((delivery) =>
            api.retryAdminNotificationDelivery(delivery.id, session.access_token),
          ),
        );

        const updatedDeliveries = retryResults
          .filter((result): result is PromiseFulfilledResult<NotificationDelivery> => result.status === "fulfilled")
          .map((result) => result.value);
        const failedResults = retryResults.filter((result) => result.status === "rejected");

        if (updatedDeliveries.length > 0) {
          setDeliveries((current) => {
            const updates = new Map(updatedDeliveries.map((delivery) => [delivery.id, delivery]));
            return current.map((delivery) => updates.get(delivery.id) ?? delivery);
          });
        }

        setFocusFeedback("Delivery retry batch completed. Focus moved to the first remaining matching transaction.");
        setFocusKey("__AUTO__");

        if (failedResults.length === 0) {
          setFeedback({
            tone: "success",
            message: `Retried ${updatedDeliveries.length} failed deliver${updatedDeliveries.length === 1 ? "y" : "ies"} in view. Already matched ${action.unchangedCount}.`,
          });
        } else if (updatedDeliveries.length > 0) {
          setFeedback({
            tone: "success",
            message: `Retried ${updatedDeliveries.length} failed deliver${updatedDeliveries.length === 1 ? "y" : "ies"} in view. ${failedResults.length} failed again. Already matched ${action.unchangedCount}.`,
          });
        } else {
          const firstFailure = failedResults[0]?.reason;
          setFeedback({
            tone: "error",
            message:
              firstFailure instanceof ApiError
                ? firstFailure.message
                : firstFailure instanceof Error
                  ? firstFailure.message
                  : "Unable to retry failed deliveries in view.",
          });
        }
        setPendingBulkAction(null);
      } catch (updateError) {
        setFeedback({
          tone: "error",
          message:
            updateError instanceof ApiError
              ? updateError.message
              : updateError instanceof Error
                ? updateError.message
                : "Unable to run bulk delivery retry.",
        });
      } finally {
        setBulkUpdating(null);
      }
      return;
    }

    const visibleTargets = filteredItems.filter((item) => {
      if (action.kind === "assign") {
        return item.adminAssigneeUserId !== currentAdminUserId;
      }
      if (action.kind === "clear_assignment") {
        return Boolean(item.adminAssigneeUserId);
      }
      if (action.kind === "escalate") {
        return !item.adminIsEscalated;
      }
      return item.adminIsEscalated;
    });

    setBulkUpdating(action.kind);
    setFeedback(null);
    try {
      const updatedItems = await Promise.all(
        visibleTargets.map(async (item) => {
          const payload =
            action.kind === "assign"
              ? { admin_assignee_user_id: currentAdminUserId }
              : action.kind === "clear_assignment"
                ? { admin_assignee_user_id: null }
                : action.kind === "escalate"
                  ? { admin_is_escalated: true }
                  : { admin_is_escalated: false };

          return item.kind === "order"
            ? toSupportOrder(
                await api.updateAdminOrderSupport(item.id, payload, {
                  accessToken: session.access_token,
                }),
              )
            : toSupportBooking(
                await api.updateAdminBookingSupport(item.id, payload, {
                  accessToken: session.access_token,
                }),
              );
        }),
      );

      setItems((current) => {
        const updates = new Map(updatedItems.map((item) => [`${item.kind}:${item.id}`, item]));
        return current
          .map((item) => updates.get(`${item.kind}:${item.id}`) ?? item)
          .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
      });
      setNoteDrafts((current) => {
        const next = { ...current };
        for (const item of updatedItems) {
          next[item.id] = item.adminNote ?? "";
        }
        return next;
      });
      setAssigneeDrafts((current) => {
        const next = { ...current };
        for (const item of updatedItems) {
          next[item.id] = item.adminAssigneeUserId ?? "";
        }
        return next;
      });
      setHandoffDrafts((current) => {
        const next = { ...current };
        for (const item of updatedItems) {
          next[item.id] = item.adminHandoffNote ?? "";
        }
        return next;
      });
      setFocusFeedback("Bulk action completed. Focus moved to the first remaining matching transaction.");
      setFocusKey("__AUTO__");

      const labels: Record<PendingBulkAction["kind"], string> = {
        assign: "Assigned view to you",
        clear_assignment: "Cleared assignments in view",
        escalate: "Escalated view",
        clear_escalation: "Cleared escalation in view",
        retry_failed_deliveries: "Retried failed deliveries in view",
      };

      setFeedback({
        tone: "success",
        message: `${labels[action.kind]}. Changed ${updatedItems.length}. Already matched ${action.unchangedCount}.`,
      });
      setPendingBulkAction(null);
    } catch (updateError) {
      setFeedback({
        tone: "error",
        message:
          updateError instanceof ApiError
            ? updateError.message
            : updateError instanceof Error
              ? updateError.message
              : "Unable to run bulk support action.",
      });
    } finally {
      setBulkUpdating(null);
    }
  }

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

        const [data, reports] = await Promise.all([
          api.loadAdminTransactions(session.access_token),
          api.listAdminReviewReports(session.access_token, "all"),
        ]);
        if (!cancelled) {
          const nextItems = [
            ...data.orders.map(toSupportOrder),
            ...data.bookings.map(toSupportBooking),
          ].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
          setAdminRoster(data.admins);
          setDeliveries(data.deliveries);
          setReviewReports(reports);
          setItems(nextItems);
          setNoteDrafts(
            Object.fromEntries(nextItems.map((item) => [item.id, item.adminNote ?? ""])),
          );
          setAssigneeDrafts(
            Object.fromEntries(nextItems.map((item) => [item.id, item.adminAssigneeUserId ?? ""])),
          );
          setHandoffDrafts(
            Object.fromEntries(nextItems.map((item) => [item.id, item.adminHandoffNote ?? ""])),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof ApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
                : "Unable to load transactions queue.",
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

  const getAssignedRole = useCallback(
    (userId: string | null | undefined): AdminRoleFilter | null => {
      if (!userId) {
        return null;
      }
      return normalizeAdminRole(adminRoster.find((entry) => entry.id === userId)?.role);
    },
    [adminRoster],
  );

  const getSellerTrustSummary = useCallback(
    (sellerId: string) => {
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

  const isTrustDrivenItem = useCallback(
    (item: SupportItem) => item.adminHandoffNote?.includes(TRUST_ESCALATION_MARKER) ?? false,
    [],
  );

  const getDeliveriesForTransaction = useCallback(
    (item: SupportItem) =>
      deliveries.filter(
        (delivery) =>
          delivery.transaction_kind === item.kind &&
          delivery.transaction_id === item.id,
      ),
    [deliveries],
  );

  const hasFailedDelivery = useCallback(
    (item: SupportItem) =>
      getDeliveriesForTransaction(item).some((delivery) => delivery.delivery_status === "failed"),
    [getDeliveriesForTransaction],
  );

  const hasQueuedDelivery = useCallback(
    (item: SupportItem) =>
      getDeliveriesForTransaction(item).some((delivery) => delivery.delivery_status === "queued"),
    [getDeliveriesForTransaction],
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      orders: items.filter((item) => item.kind === "order").length,
      bookings: items.filter((item) => item.kind === "booking").length,
      open: items.filter(isOpenItem).length,
      completed: items.filter((item) => !isOpenItem(item)).length,
      assignedToMe: currentAdminUserId
        ? items.filter((item) => item.adminAssigneeUserId === currentAdminUserId).length
        : 0,
      assignedElsewhere: currentAdminUserId
        ? items.filter(
            (item) => item.adminAssigneeUserId && item.adminAssigneeUserId !== currentAdminUserId,
          ).length
        : items.filter((item) => item.adminAssigneeUserId).length,
      unassigned: items.filter((item) => !item.adminAssigneeUserId).length,
      escalated: items.filter((item) => item.adminIsEscalated).length,
      failedDeliveries: deliveries.filter((delivery) => delivery.delivery_status === "failed").length,
      queuedDeliveries: deliveries.filter((delivery) => delivery.delivery_status === "queued").length,
      escalatedAssigned: items.filter(
        (item) => item.adminIsEscalated && Boolean(item.adminAssigneeUserId),
      ).length,
      escalatedAssignedElsewhere: currentAdminUserId
        ? items.filter(
            (item) =>
              item.adminIsEscalated &&
              Boolean(item.adminAssigneeUserId) &&
              item.adminAssigneeUserId !== currentAdminUserId,
          ).length
        : items.filter((item) => item.adminIsEscalated && Boolean(item.adminAssigneeUserId)).length,
      needsFollowUp: items.filter((item) => isOpenItem(item) || item.adminIsEscalated).length,
      staleUnassigned: items.filter(isStaleUnassigned).length,
      staleAssigned: items.filter(isStaleAssigned).length,
      supportQueue: items.filter((item) => getAssignedRole(item.adminAssigneeUserId) === "support" && isOpenItem(item)).length,
      trustQueue: items.filter((item) => getAssignedRole(item.adminAssigneeUserId) === "trust" && isOpenItem(item)).length,
      ownerQueue: items.filter((item) => getAssignedRole(item.adminAssigneeUserId) === "owner" && isOpenItem(item)).length,
      failedDeliveryTransactions: items.filter((item) => hasFailedDelivery(item)).length,
      queuedDeliveryTransactions: items.filter((item) => hasQueuedDelivery(item)).length,
      trustDriven: items.filter((item) => isTrustDrivenItem(item)).length,
      trustDrivenOpen: items.filter((item) => isTrustDrivenItem(item) && isOpenItem(item)).length,
      trustDrivenAssigned: items.filter((item) => isTrustDrivenItem(item) && Boolean(item.adminAssigneeUserId)).length,
      trustDrivenAssignedToMe: currentAdminUserId
        ? items.filter(
            (item) => isTrustDrivenItem(item) && item.adminAssigneeUserId === currentAdminUserId,
          ).length
        : 0,
      trustDrivenUnassigned: items.filter(
        (item) => isTrustDrivenItem(item) && !item.adminAssigneeUserId,
      ).length,
      trustDrivenEscalated: items.filter((item) => isTrustDrivenItem(item) && item.adminIsEscalated).length,
      trustDrivenResolved7d: items.filter(
        (item) =>
          isTrustDrivenItem(item) &&
          !isOpenItem(item) &&
          isRecentWithinDays(item.history[0]?.createdAt ?? item.createdAt, 7),
      ).length,
      needsReassignment: currentAdminUserId
        ? items.filter(
            (item) =>
              item.adminAssigneeUserId &&
              item.adminAssigneeUserId !== currentAdminUserId &&
              (isStaleAssigned(item) || item.adminIsEscalated),
          ).length
        : items.filter((item) => item.adminAssigneeUserId && (isStaleAssigned(item) || item.adminIsEscalated)).length,
    }),
    [currentAdminUserId, deliveries, getAssignedRole, hasFailedDelivery, hasQueuedDelivery, isTrustDrivenItem, items],
  );

  const agingSummary = useMemo(() => {
    const oldestUnassigned = items
      .filter((item) => !item.adminAssigneeUserId && isOpenItem(item))
      .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""))[0];
    const oldestAssigned = items
      .filter((item) => item.adminAssigneeUserId && isOpenItem(item))
      .sort((left, right) => (left.adminAssignedAt ?? left.createdAt ?? "").localeCompare(right.adminAssignedAt ?? right.createdAt ?? ""))[0];
    const oldestEscalatedAssigned = items
      .filter((item) => item.adminIsEscalated && item.adminAssigneeUserId)
      .sort((left, right) =>
        (left.adminAssignedAt ?? left.adminEscalatedAt ?? left.createdAt ?? "").localeCompare(
          right.adminAssignedAt ?? right.adminEscalatedAt ?? right.createdAt ?? "",
        ),
      )[0];
    const oldestTrustDrivenUnassigned = items
      .filter((item) => isTrustDrivenItem(item) && !item.adminAssigneeUserId && isOpenItem(item))
      .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""))[0];
    const oldestTrustDrivenAssigned = items
      .filter((item) => isTrustDrivenItem(item) && item.adminAssigneeUserId && isOpenItem(item))
      .sort((left, right) =>
        (left.adminAssignedAt ?? left.createdAt ?? "").localeCompare(
          right.adminAssignedAt ?? right.createdAt ?? "",
        ),
      )[0];

    return {
      oldestUnassigned,
      oldestAssigned,
      oldestEscalatedAssigned,
      oldestTrustDrivenUnassigned,
      oldestTrustDrivenAssigned,
    };
  }, [isTrustDrivenItem, items]);

  const presetCounts = useMemo(
    () => ({
      default: items.length,
      needs_follow_up: items.filter((item) => isOpenItem(item) || item.adminIsEscalated).length,
      assigned_to_me: currentAdminUserId
        ? items.filter((item) => item.adminAssigneeUserId === currentAdminUserId).length
        : 0,
      escalated_unassigned: items.filter((item) => item.adminIsEscalated && !item.adminAssigneeUserId).length,
      escalated_to_me: currentAdminUserId
        ? items.filter(
            (item) => item.adminIsEscalated && item.adminAssigneeUserId === currentAdminUserId,
          ).length
        : 0,
      stale_unassigned: items.filter(isStaleUnassigned).length,
      escalated_assigned: items.filter(
        (item) => item.adminIsEscalated && Boolean(item.adminAssigneeUserId),
      ).length,
      escalated_assigned_elsewhere: currentAdminUserId
        ? items.filter(
            (item) =>
              item.adminIsEscalated &&
              Boolean(item.adminAssigneeUserId) &&
              item.adminAssigneeUserId !== currentAdminUserId,
          ).length
        : items.filter((item) => item.adminIsEscalated && Boolean(item.adminAssigneeUserId)).length,
      support_queue: items.filter(
        (item) => getAssignedRole(item.adminAssigneeUserId) === "support" && isOpenItem(item),
      ).length,
      trust_queue: items.filter(
        (item) => getAssignedRole(item.adminAssigneeUserId) === "trust" && isOpenItem(item),
      ).length,
      failed_delivery_follow_up: items.filter((item) => hasFailedDelivery(item)).length,
      trust_driven: items.filter((item) => isTrustDrivenItem(item)).length,
      needs_reassignment: currentAdminUserId
        ? items.filter(
            (item) =>
              item.adminAssigneeUserId &&
              item.adminAssigneeUserId !== currentAdminUserId &&
              (isStaleAssigned(item) || item.adminIsEscalated),
          ).length
        : items.filter((item) => item.adminAssigneeUserId && (isStaleAssigned(item) || item.adminIsEscalated)).length,
    }),
    [currentAdminUserId, getAssignedRole, hasFailedDelivery, isTrustDrivenItem, items],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      if (typeFilter !== "all" && item.kind !== typeFilter) {
        return false;
      }

      if (statusFilter === "open" && !isOpenItem(item)) {
        return false;
      }

      if (statusFilter === "completed" && isOpenItem(item)) {
        return false;
      }

      if (deliveryFilter === "failed" && !hasFailedDelivery(item)) {
        return false;
      }

      if (deliveryFilter === "queued" && !hasQueuedDelivery(item)) {
        return false;
      }

      if (trustFilter === "trust_driven" && !isTrustDrivenItem(item)) {
        return false;
      }

      if (roleFilter !== "all" && getAssignedRole(item.adminAssigneeUserId) !== roleFilter) {
        return false;
      }

      if (assigneeFilter === "mine" && item.adminAssigneeUserId !== currentAdminUserId) {
        return false;
      }

      if (assigneeFilter === "unassigned" && item.adminAssigneeUserId) {
        return false;
      }

      if (
        assigneeFilter === "elsewhere" &&
        (!item.adminAssigneeUserId || item.adminAssigneeUserId === currentAdminUserId)
      ) {
        return false;
      }

      if (escalationFilter === "escalated" && !item.adminIsEscalated) {
        return false;
      }

      if (escalationFilter === "normal" && item.adminIsEscalated) {
        return false;
      }

      if (preset === "stale_unassigned" && !isStaleUnassigned(item)) {
        return false;
      }

      if (preset === "escalated_assigned" && (!item.adminIsEscalated || !item.adminAssigneeUserId)) {
        return false;
      }

      if (
        preset === "escalated_assigned_elsewhere" &&
        (!item.adminIsEscalated ||
          !item.adminAssigneeUserId ||
          item.adminAssigneeUserId === currentAdminUserId)
      ) {
        return false;
      }

      if (
        preset === "needs_reassignment" &&
        (!item.adminAssigneeUserId ||
          item.adminAssigneeUserId === currentAdminUserId ||
          (!isStaleAssigned(item) && !item.adminIsEscalated))
      ) {
        return false;
      }

      if (preset === "support_queue" && getAssignedRole(item.adminAssigneeUserId) !== "support") {
        return false;
      }

      if (preset === "trust_queue" && getAssignedRole(item.adminAssigneeUserId) !== "trust") {
        return false;
      }

      if (preset === "failed_delivery_follow_up" && !hasFailedDelivery(item)) {
        return false;
      }

      if (preset === "trust_driven" && !isTrustDrivenItem(item)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        item.id,
        item.status,
        item.title,
        item.subtitle,
        item.buyer_id,
        item.seller_id,
        item.adminNote,
        item.adminHandoffNote,
        item.adminAssigneeUserId,
        item.kind,
        ...item.history.flatMap((event) => [event.status, event.actorRole, event.note]),
        ...item.adminHistory.flatMap((event) => [event.action, event.actorUserId, event.note]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [assigneeFilter, currentAdminUserId, deliveryFilter, escalationFilter, getAssignedRole, hasFailedDelivery, hasQueuedDelivery, isTrustDrivenItem, items, preset, roleFilter, searchQuery, statusFilter, trustFilter, typeFilter]);

  useEffect(() => {
    if (focusKey === "__AUTO__") {
      setFocusKey(filteredItems[0] ? `${filteredItems[0].kind}:${filteredItems[0].id}` : null);
      return;
    }

    if (focusKey && !filteredItems.some((item) => `${item.kind}:${item.id}` === focusKey)) {
      setFocusKey(filteredItems[0] ? `${filteredItems[0].kind}:${filteredItems[0].id}` : null);
    }
  }, [filteredItems, focusKey]);

  const bulkCandidates = useMemo(
    () => ({
      assign: filteredItems.filter((item) => item.adminAssigneeUserId !== currentAdminUserId),
      clearAssignment: filteredItems.filter((item) => Boolean(item.adminAssigneeUserId)),
      escalate: filteredItems.filter((item) => !item.adminIsEscalated),
      clearEscalation: filteredItems.filter((item) => item.adminIsEscalated),
      retryFailedDeliveries: deliveries.filter(
        (delivery) =>
          delivery.delivery_status === "failed" &&
          filteredItems.some(
            (item) =>
              item.kind === delivery.transaction_kind &&
              item.id === delivery.transaction_id,
          ),
      ),
    }),
    [currentAdminUserId, deliveries, filteredItems],
  );

  const focusedIndex = useMemo(
    () => filteredItems.findIndex((item) => `${item.kind}:${item.id}` === focusKey),
    [filteredItems, focusKey],
  );
  const focusedItem = focusedIndex >= 0 ? filteredItems[focusedIndex] : null;
  const focusedTrustSummary = useMemo(
    () => (focusedItem ? getSellerTrustSummary(focusedItem.seller_id) : null),
    [focusedItem, getSellerTrustSummary],
  );
  const focusedDeliveries = useMemo(
    () =>
      focusedItem
        ? deliveries.filter(
            (delivery) =>
              delivery.transaction_kind === focusedItem.kind &&
              delivery.transaction_id === focusedItem.id,
          )
        : [],
    [deliveries, focusedItem],
  );
  const previousItem = focusedIndex > 0 ? filteredItems[focusedIndex - 1] : null;
  const nextItem = focusedIndex >= 0 && focusedIndex < filteredItems.length - 1 ? filteredItems[focusedIndex + 1] : null;
  const activeSliceSummary = useMemo(() => {
    const parts: string[] = [];

    if (preset !== "default") {
      parts.push(titleCaseFilterLabel(preset));
    }
    if (statusFilter !== "open") {
      parts.push(`Status: ${titleCaseFilterLabel(statusFilter)}`);
    }
    if (assigneeFilter !== "all") {
      parts.push(`Owner: ${titleCaseFilterLabel(assigneeFilter)}`);
    }
    if (escalationFilter !== "all") {
      parts.push(`Priority: ${titleCaseFilterLabel(escalationFilter)}`);
    }
    if (roleFilter !== "all") {
      parts.push(`Role: ${titleCaseFilterLabel(roleFilter)}`);
    }
    if (deliveryFilter !== "all") {
      parts.push(`Delivery: ${titleCaseFilterLabel(deliveryFilter)}`);
    }
    if (trustFilter !== "all") {
      parts.push("Trust-Driven");
    }
    if (typeFilter !== "all") {
      parts.push(`Type: ${titleCaseFilterLabel(typeFilter)}`);
    }
    if (searchQuery.trim()) {
      parts.push(`Search: "${searchQuery.trim()}"`);
    }

    return parts.length > 0 ? parts.join(" · ") : "Default open support queue";
  }, [assigneeFilter, deliveryFilter, escalationFilter, preset, roleFilter, searchQuery, statusFilter, trustFilter, typeFilter]);
  const isDefaultSlice =
    preset === "default" &&
    typeFilter === "all" &&
    statusFilter === "open" &&
    assigneeFilter === "all" &&
    escalationFilter === "all" &&
    roleFilter === "all" &&
    deliveryFilter === "all" &&
    trustFilter === "all" &&
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

  function formatAdminIdentity(userId: string | null | undefined) {
    if (!userId) {
      return "None";
    }

    const admin = adminRoster.find((entry) => entry.id === userId);
    if (userId === currentAdminUserId) {
      return admin ? `${formatAdminOptionLabel(admin)} (You)` : `${truncateId(userId)} (You)`;
    }

    return admin ? formatAdminOptionLabel(admin) : truncateId(userId);
  }

  function getRecommendedRoleForItem(item: SupportItem): AdminRoleFilter | null {
    if (roleFilter !== "all") {
      return roleFilter;
    }

    if (preset === "support_queue") {
      return "support";
    }

    if (preset === "trust_queue") {
      return "trust";
    }

    if (item.adminIsEscalated) {
      return "trust";
    }

    if (isOpenItem(item)) {
      return "support";
    }

    return null;
  }

  function getRecommendedAdminsForItem(item: SupportItem): AdminUser[] {
    const recommendedRole = getRecommendedRoleForItem(item);
    return getRecommendedAdminsForRole(recommendedRole, item.adminAssigneeUserId);
  }

  function getTrustRouteTarget(item: SupportItem): AdminUser | null {
    if (getAssignedRole(item.adminAssigneeUserId) === "trust") {
      return null;
    }
    return getRecommendedAdminsForRole("trust", item.adminAssigneeUserId)[0] ?? null;
  }

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading transactions queue...
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

  const shortcuts: Array<{
    label: string;
    preset: QueuePreset;
    type: TransactionFilter;
    status: StatusFilter;
    assignee: AssigneeFilter;
    priority: EscalationFilter;
    role: AdminRoleFilter;
    delivery: DeliveryFilter;
    trust?: TrustContextFilter;
  }> = [
    {
      label: "Needs Follow-Up",
      preset: "needs_follow_up",
      type: "all",
      status: "open",
      assignee: "all",
      priority: "all",
      role: "all",
      delivery: "all",
    },
    {
      label: "Assigned To Me",
      preset: "assigned_to_me",
      type: "all",
      status: "all",
      assignee: "mine",
      priority: "all",
      role: "all",
      delivery: "all",
    },
    {
      label: "Escalated Unassigned",
      preset: "escalated_unassigned",
      type: "all",
      status: "all",
      assignee: "unassigned",
      priority: "escalated",
      role: "all",
      delivery: "all",
    },
    {
      label: "Escalated To Me",
      preset: "escalated_to_me",
      type: "all",
      status: "all",
      assignee: "mine",
      priority: "escalated",
      role: "all",
      delivery: "all",
    },
    {
      label: "Stale Unassigned",
      preset: "stale_unassigned",
      type: "all",
      status: "open",
      assignee: "unassigned",
      priority: "all",
      role: "all",
      delivery: "all",
    },
    {
      label: "Escalated Assigned",
      preset: "escalated_assigned",
      type: "all",
      status: "all",
      assignee: "all",
      priority: "escalated",
      role: "all",
      delivery: "all",
    },
    {
      label: "Escalated Assigned Elsewhere",
      preset: "escalated_assigned_elsewhere",
      type: "all",
      status: "all",
      assignee: "elsewhere",
      priority: "escalated",
      role: "all",
      delivery: "all",
    },
    {
      label: "Needs Reassignment",
      preset: "needs_reassignment",
      type: "all",
      status: "open",
      assignee: "elsewhere",
      priority: "all",
      role: "all",
      delivery: "all",
    },
    {
      label: "Support Queue",
      preset: "support_queue",
      type: "all",
      status: "open",
      assignee: "all",
      priority: "all",
      role: "support",
      delivery: "all",
    },
    {
      label: "Trust Queue",
      preset: "trust_queue",
      type: "all",
      status: "open",
      assignee: "all",
      priority: "all",
      role: "trust",
      delivery: "all",
    },
    {
      label: "Failed Delivery Follow-Up",
      preset: "failed_delivery_follow_up",
      type: "all",
      status: "all",
      assignee: "all",
      priority: "all",
      role: "all",
      delivery: "failed",
      trust: "all",
    },
    {
      label: "Trust-Driven",
      preset: "trust_driven",
      type: "all",
      status: "all",
      assignee: "all",
      priority: "all",
      role: "all",
      delivery: "all",
      trust: "trust_driven",
    },
  ];

  async function transferAssignment(item: SupportItem) {
    const nextAssignee = assigneeDrafts[item.id]?.trim() ?? "";
    if (!nextAssignee) {
      setFeedback({ tone: "error", message: "Enter an admin user id before transferring work." });
      return;
    }

    if (nextAssignee === item.adminAssigneeUserId) {
      setFeedback({
        tone: "error",
        message: `${item.kind} ${truncateId(item.id)} is already assigned to that admin.`,
      });
      return;
    }

    const handoffNote = handoffDrafts[item.id]?.trim() ?? "";
    if (nextAssignee !== currentAdminUserId && !handoffNote) {
      setFeedback({
        tone: "error",
        message: "Add a handoff note before transferring work to another admin.",
      });
      return;
    }

    await updateSupport(
      item,
      {
        admin_assignee_user_id: nextAssignee,
        admin_handoff_note: handoffNote || null,
      },
      "Assignment",
    );
  }

  function getRecommendedAdminsForRole(
    role: AdminRoleFilter | null,
    currentAssigneeUserId: string | null | undefined,
  ): AdminUser[] {
    const candidates = adminRoster.filter((admin) => {
      if (admin.id === currentAssigneeUserId) {
        return false;
      }
      if (!role) {
        return true;
      }
      return normalizeAdminRole(admin.role) === role;
    });

    if (candidates.length > 0) {
      return candidates;
    }

    return adminRoster.filter((admin) => admin.id !== currentAssigneeUserId);
  }

  function getRecommendedRouteTarget(item: SupportItem, nextEscalated: boolean): AdminUser | null {
    const targetRole: AdminRoleFilter | null = nextEscalated
      ? "trust"
      : isOpenItem(item)
        ? "support"
        : null;
    return getRecommendedAdminsForRole(targetRole, item.adminAssigneeUserId)[0] ?? null;
  }

  function getRoutePreviewLabel(item: SupportItem, nextEscalated: boolean) {
    const target = getRecommendedRouteTarget(item, nextEscalated);
    if (!target) {
      return nextEscalated ? "No trust-lane target available." : "No support-lane target available.";
    }

    return nextEscalated
      ? `Escalate + Route will send this to ${formatAdminOptionLabel(target)}.`
      : `Clear + Return will send this to ${formatAdminOptionLabel(target)}.`;
  }

  async function routePriorityAction(item: SupportItem, nextEscalated: boolean) {
    const target = getRecommendedRouteTarget(item, nextEscalated);
    const handoffNote = handoffDrafts[item.id]?.trim() ?? "";

    if (target && target.id !== currentAdminUserId && !handoffNote) {
      setFeedback({
        tone: "error",
        message: "Add a handoff note before routing this transaction to another admin lane.",
      });
      return;
    }

    const routeAuditNote = target
      ? `${handoffNote ? `${handoffNote}\n\n` : ""}Route target: ${formatAdminOptionLabel(target)}`
      : handoffNote || null;

    await updateSupport(
      item,
      {
        admin_is_escalated: nextEscalated,
        ...(target ? { admin_assignee_user_id: target.id } : {}),
        admin_handoff_note: routeAuditNote,
      },
      nextEscalated
        ? target
          ? "Escalation and route"
          : "Escalation"
        : target
          ? "Escalation clear and route"
          : "Escalation cleared",
    );
  }

  async function escalateToTrust(item: SupportItem) {
    const target = getTrustRouteTarget(item);
    if (!target) {
      setFeedback({
        tone: "error",
        message: "No trust-lane target available for this transaction.",
      });
      return;
    }

    const handoffNote = handoffDrafts[item.id]?.trim() ?? "";
    const routeAuditNote = `${handoffNote ? `${handoffNote}\n\n` : ""}Trust escalation trigger: seller has active moderation flags.\nRoute target: ${formatAdminOptionLabel(target)}`;

    await updateSupport(
      item,
      {
        admin_is_escalated: true,
        admin_assignee_user_id: target.id,
        admin_handoff_note: routeAuditNote,
      },
      "Trust escalation",
    );
  }

  async function retryAdminDelivery(delivery: NotificationDelivery) {
    const session = await restoreAdminSession();
    if (!session) {
      setFeedback({ tone: "error", message: "Admin session not available. Sign in again." });
      return;
    }

    setRetryingDeliveryId(delivery.id);
    setFeedback(null);
    try {
      const updated = await api.retryAdminNotificationDelivery(delivery.id, session.access_token);
      setDeliveries((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setFeedback({
        tone: "success",
        message: `Retried delivery ${truncateId(delivery.id)} for ${delivery.channel}.`,
      });
    } catch (retryError) {
      setFeedback({
        tone: "error",
        message:
          retryError instanceof ApiError
            ? retryError.message
            : retryError instanceof Error
              ? retryError.message
              : "Unable to retry admin delivery.",
      });
    } finally {
      setRetryingDeliveryId(null);
    }
  }

  function requestRoutePriorityAction(item: SupportItem, nextEscalated: boolean) {
    setPendingRouteAction({
      item,
      nextEscalated,
      target: getRecommendedRouteTarget(item, nextEscalated),
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "All Transactions",
            value: counts.all.toString(),
            onClick: () =>
              applyQueueState({
                preset: "default",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Escalated",
            value: counts.escalated.toString(),
            onClick: () =>
              applyQueueState({
                preset: "escalated_assigned",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "escalated",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Open Support Work",
            value: counts.open.toString(),
            onClick: () =>
              applyQueueState({
                preset: "needs_follow_up",
                type: "all",
                status: "open",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Assigned To Me",
            value: counts.assignedToMe.toString(),
            onClick: () =>
              applyQueueState({
                preset: "assigned_to_me",
                type: "all",
                status: "all",
                assignee: "mine",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Unassigned",
            value: counts.unassigned.toString(),
            onClick: () =>
              applyQueueState({
                preset: "stale_unassigned",
                type: "all",
                status: "open",
                assignee: "unassigned",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Failed Deliveries",
            value: counts.failedDeliveries.toString(),
            onClick: () =>
              applyQueueState({
                preset: "failed_delivery_follow_up",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "failed",
                trust: "all",
              }),
          },
          {
            label: "Queued Deliveries",
            value: counts.queuedDeliveries.toString(),
            onClick: () =>
              applyQueueState({
                preset: "default",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "queued",
                trust: "all",
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
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {card.value}
            </p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Needs Follow-Up",
            value: counts.needsFollowUp.toString(),
            tone: "neutral",
            detail: "Open or escalated support work",
            onClick: () =>
              applyQueueState({
                preset: "needs_follow_up",
                type: "all",
                status: "open",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Stale Unassigned",
            value: counts.staleUnassigned.toString(),
            tone: counts.staleUnassigned > 0 ? "danger" : "neutral",
            detail: agingSummary.oldestUnassigned
              ? `Oldest open unassigned: ${formatAgeLabel(agingSummary.oldestUnassigned.createdAt)}`
              : "No stale unassigned work",
            onClick: () =>
              applyQueueState({
                preset: "stale_unassigned",
                type: "all",
                status: "open",
                assignee: "unassigned",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Stale Assigned",
            value: counts.staleAssigned.toString(),
            tone: counts.staleAssigned > 0 ? "warning" : "neutral",
            detail: agingSummary.oldestAssigned
              ? `Oldest assigned: ${formatAgeLabel(agingSummary.oldestAssigned.adminAssignedAt ?? agingSummary.oldestAssigned.createdAt)}`
              : "No stale assigned work",
            onClick: () =>
              applyQueueState({
                preset: "default",
                type: "all",
                status: "open",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Completed",
            value: counts.completed.toString(),
            tone: "neutral",
            detail: "Closed transaction support work",
            onClick: () =>
              applyQueueState({
                preset: "default",
                type: "all",
                status: "completed",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Failed Delivery Follow-Up",
            value: counts.failedDeliveryTransactions.toString(),
            tone: counts.failedDeliveryTransactions > 0 ? "danger" : "neutral",
            detail: "Transactions with failed email or push delivery",
            onClick: () =>
              applyQueueState({
                preset: "failed_delivery_follow_up",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "failed",
                trust: "all",
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
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {card.value}
            </p>
            <p className="mt-2 text-sm text-foreground/64">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Trust-Driven Open",
            value: counts.trustDrivenOpen.toString(),
            detail: "Trust-routed work still active",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "open",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
          },
          {
            label: "Trust-Driven Assigned To Me",
            value: counts.trustDrivenAssignedToMe.toString(),
            detail: "Trust-routed work owned by me",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "open",
                assignee: "mine",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
          },
          {
            label: "Trust-Driven Unassigned",
            value: counts.trustDrivenUnassigned.toString(),
            detail: "Trust-routed work without an owner",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "open",
                assignee: "unassigned",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
          },
          {
            label: "Trust-Driven Escalated",
            value: counts.trustDrivenEscalated.toString(),
            detail: "Trust-routed work still marked escalated",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "escalated",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
          },
          {
            label: "Trust-Driven Resolved 7d",
            value: counts.trustDrivenResolved7d.toString(),
            detail: "Trust-routed work closed in the last 7 days",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "completed",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className="card-shadow rounded-[1.5rem] border border-border bg-surface p-4 text-left transition hover:border-foreground/28"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {card.value}
            </p>
            <p className="mt-2 text-sm text-foreground/64">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
        {[
          {
            label: "Oldest Trust-Driven Unassigned",
            detail: agingSummary.oldestTrustDrivenUnassigned
              ? `${formatAgeLabel(agingSummary.oldestTrustDrivenUnassigned.createdAt)} · ${agingSummary.oldestTrustDrivenUnassigned.kind} #${truncateId(agingSummary.oldestTrustDrivenUnassigned.id)}`
              : "No open unassigned trust-driven work",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "open",
                assignee: "unassigned",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
          },
          {
            label: "Oldest Trust-Driven Assigned",
            detail: agingSummary.oldestTrustDrivenAssigned
              ? `${formatAgeLabel(agingSummary.oldestTrustDrivenAssigned.adminAssignedAt ?? agingSummary.oldestTrustDrivenAssigned.createdAt)} · ${agingSummary.oldestTrustDrivenAssigned.kind} #${truncateId(agingSummary.oldestTrustDrivenAssigned.id)}`
              : "No open assigned trust-driven work",
            onClick: () => {
              applyQueueState({
                preset: "trust_driven",
                type: "all",
                status: "open",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "trust_driven",
              });
            },
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            label: "Oldest Unassigned",
            detail: agingSummary.oldestUnassigned
              ? `${formatAgeLabel(agingSummary.oldestUnassigned.createdAt)} · ${agingSummary.oldestUnassigned.kind} #${truncateId(agingSummary.oldestUnassigned.id)}`
              : "No open unassigned work",
            tone: counts.unassigned > 0 ? "danger" : "neutral",
            onClick: () => {
              applyQueueState({
                preset: "stale_unassigned",
                type: "all",
                status: "open",
                assignee: "unassigned",
                priority: "all",
                role: "all",
                delivery: "all",
              });
            },
          },
          {
            label: "Oldest Assigned",
            detail: agingSummary.oldestAssigned
              ? `${formatAgeLabel(agingSummary.oldestAssigned.adminAssignedAt ?? agingSummary.oldestAssigned.createdAt)} · ${agingSummary.oldestAssigned.kind} #${truncateId(agingSummary.oldestAssigned.id)}`
              : "No open assigned work",
            tone: counts.assignedToMe + counts.assignedElsewhere > 0 ? "warning" : "neutral",
            onClick: () => {
              applyQueueState({
                preset: "default",
                type: "all",
                status: "open",
                assignee: "all",
                priority: "all",
                role: "all",
                delivery: "all",
              });
            },
          },
          {
            label: "Oldest Escalated Assigned",
            detail: agingSummary.oldestEscalatedAssigned
              ? `${formatAgeLabel(agingSummary.oldestEscalatedAssigned.adminAssignedAt ?? agingSummary.oldestEscalatedAssigned.adminEscalatedAt ?? agingSummary.oldestEscalatedAssigned.createdAt)} · ${agingSummary.oldestEscalatedAssigned.kind} #${truncateId(agingSummary.oldestEscalatedAssigned.id)}`
              : "No escalated assigned work",
            tone: counts.escalatedAssigned > 0 ? "danger" : "neutral",
            onClick: () => {
              applyQueueState({
                preset: "escalated_assigned",
                type: "all",
                status: "all",
                assignee: "all",
                priority: "escalated",
                role: "all",
                delivery: "all",
              });
            },
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className={`card-shadow rounded-[1.5rem] border p-4 text-left transition hover:border-foreground/28 ${
              card.tone === "danger"
                ? "border-danger/30 bg-danger/8"
                : card.tone === "warning"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-border bg-surface"
            }`}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">{card.label}</p>
            <p className="mt-3 text-sm leading-6 text-foreground/72">{card.detail}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-foreground/46">
              Click To Open Slice
            </p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Assigned To Me",
            value: counts.assignedToMe.toString(),
            detail: "My active and completed support ownership",
            onClick: () =>
              applyQueueState({
                preset: "assigned_to_me",
                type: "all",
                status: "all",
                assignee: "mine",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Unassigned",
            value: counts.unassigned.toString(),
            detail: "Support work without an owner",
            onClick: () =>
              applyQueueState({
                preset: "stale_unassigned",
                type: "all",
                status: "open",
                assignee: "unassigned",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Assigned Elsewhere",
            value: counts.assignedElsewhere.toString(),
            detail: "Currently owned by another admin",
            onClick: () =>
              applyQueueState({
                preset: "default",
                type: "all",
                status: "all",
                assignee: "elsewhere",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
              }),
          },
          {
            label: "Needs Reassignment",
            value: counts.needsReassignment.toString(),
            detail: "Elsewhere-owned work that is stale or escalated",
            onClick: () =>
              applyQueueState({
                preset: "needs_reassignment",
                type: "all",
                status: "open",
                assignee: "elsewhere",
                priority: "all",
                role: "all",
                delivery: "all",
                trust: "all",
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
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {card.value}
            </p>
            <p className="mt-2 text-sm text-foreground/64">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
          {shortcuts.map((shortcut) => {
            const active = preset === shortcut.preset;
            const count = presetCounts[shortcut.preset];
            return (
              <button
                key={shortcut.preset}
                type="button"
                onClick={() =>
                  applyQueueState({
                    preset: shortcut.preset,
                    type: shortcut.type,
                    status: shortcut.status,
                    assignee: shortcut.assignee,
                    priority: shortcut.priority,
                    role: shortcut.role,
                    delivery: shortcut.delivery,
                  })
                }
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                }`}
              >
                {shortcut.label} ({count})
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
                      preset: "default",
                      type: "all",
                      status: "open",
                      assignee: "all",
                      priority: "all",
                      role: "all",
                      delivery: "all",
                      trust: "all",
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
              placeholder="Search by id, title, buyer, seller, note, or status"
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
            />
          </label>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Type</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.all})` },
                { value: "order", label: `Orders (${counts.orders})` },
                { value: "booking", label: `Bookings (${counts.bookings})` },
              ].map((option) => {
                const active = typeFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTypeFilter(option.value as TransactionFilter)}
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
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Status Scope</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "open", label: `Open (${counts.open})` },
                { value: "completed", label: `Completed (${counts.completed})` },
                { value: "all", label: `All (${counts.all})` },
              ].map((option) => {
                const active = statusFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value as StatusFilter)}
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
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Assignee</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.all})` },
                { value: "mine", label: `Mine (${counts.assignedToMe})` },
                { value: "unassigned", label: `Unassigned (${counts.unassigned})` },
                { value: "elsewhere", label: `Elsewhere (${counts.assignedElsewhere})` },
              ].map((option) => {
                const active = assigneeFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAssigneeFilter(option.value as AssigneeFilter)}
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
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Priority</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.all})` },
                { value: "escalated", label: `Escalated (${counts.escalated})` },
                { value: "normal", label: "Normal" },
              ].map((option) => {
                const active = escalationFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEscalationFilter(option.value as EscalationFilter)}
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
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Admin Role</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.all})` },
                { value: "support", label: `Support (${counts.supportQueue})` },
                { value: "trust", label: `Trust (${counts.trustQueue})` },
                { value: "owner", label: `Owner (${counts.ownerQueue})` },
              ].map((option) => {
                const active = roleFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRoleFilter(option.value as AdminRoleFilter)}
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
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Delivery Health</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.all})` },
                { value: "failed", label: `Failed (${counts.failedDeliveryTransactions})` },
                { value: "queued", label: `Queued (${counts.queuedDeliveryTransactions})` },
              ].map((option) => {
                const active = deliveryFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDeliveryFilter(option.value as DeliveryFilter)}
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
          </div>

          <div className="flex flex-col gap-2 text-sm text-foreground/72">
            <span>Trust Context</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "all", label: `All (${counts.all})` },
                { value: "trust_driven", label: `Trust-Driven (${counts.trustDriven})` },
              ].map((option) => {
                const active = trustFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTrustFilter(option.value as TrustContextFilter)}
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
          </div>
        </div>
      </div>

      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-foreground/48">
              Live Support Queue
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {filteredItems.length} visible transaction{filteredItems.length === 1 ? "" : "s"}
            </h2>
          </div>
          <p className="max-w-md text-right text-sm text-foreground/64">
            Admins can now keep internal notes, assign ownership, and escalate transaction support
            work without exposing that state to buyers or sellers.
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
                      preset: "default",
                      type: "all",
                      status: "open",
                      assignee: "all",
                      priority: "all",
                      role: "all",
                      delivery: "all",
                      trust: "all",
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
            disabled={bulkUpdating !== null || bulkCandidates.assign.length === 0}
            onClick={() =>
              setPendingBulkAction({
                kind: "assign",
                targetCount: bulkCandidates.assign.length,
                unchangedCount: filteredItems.length - bulkCandidates.assign.length,
              })
            }
            className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign View To Me
          </button>
          <button
            type="button"
            disabled={bulkUpdating !== null || bulkCandidates.clearAssignment.length === 0}
            onClick={() =>
              setPendingBulkAction({
                kind: "clear_assignment",
                targetCount: bulkCandidates.clearAssignment.length,
                unchangedCount: filteredItems.length - bulkCandidates.clearAssignment.length,
              })
            }
            className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Assignments In View
          </button>
          <button
            type="button"
            disabled={bulkUpdating !== null || bulkCandidates.escalate.length === 0}
            onClick={() =>
              setPendingBulkAction({
                kind: "escalate",
                targetCount: bulkCandidates.escalate.length,
                unchangedCount: filteredItems.length - bulkCandidates.escalate.length,
              })
            }
            className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Escalate In View
          </button>
          <button
            type="button"
            disabled={bulkUpdating !== null || bulkCandidates.clearEscalation.length === 0}
            onClick={() =>
              setPendingBulkAction({
                kind: "clear_escalation",
                targetCount: bulkCandidates.clearEscalation.length,
                unchangedCount: filteredItems.length - bulkCandidates.clearEscalation.length,
              })
            }
            className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Escalation In View
          </button>
          <button
            type="button"
            disabled={bulkUpdating !== null || bulkCandidates.retryFailedDeliveries.length === 0}
            onClick={() =>
              setPendingBulkAction({
                kind: "retry_failed_deliveries",
                targetCount: bulkCandidates.retryFailedDeliveries.length,
                unchangedCount:
                  filteredItems.length - filteredItems.filter((item) => hasFailedDelivery(item)).length,
              })
            }
            className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry Failed Deliveries In View
          </button>
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

        {focusFeedback ? (
          <div className="mt-4 rounded-[1.25rem] border border-border bg-background px-4 py-3 text-sm text-foreground/72">
            <div className="flex items-center justify-between gap-3">
              <span>{focusFeedback}</span>
              <button
                type="button"
                onClick={() => setFocusFeedback(null)}
                className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56 transition hover:border-foreground/28"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {pendingBulkAction ? (
          <div className="mt-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
            <p className="text-sm font-medium text-foreground">
              {pendingBulkAction.kind === "assign" && "Assign the current view to you?"}
              {pendingBulkAction.kind === "clear_assignment" && "Clear assignments in the current view?"}
              {pendingBulkAction.kind === "escalate" && "Escalate the current view?"}
              {pendingBulkAction.kind === "clear_escalation" && "Clear escalation in the current view?"}
              {pendingBulkAction.kind === "retry_failed_deliveries" && "Retry failed deliveries in the current view?"}
            </p>
            <p className="mt-2 text-sm text-foreground/66">
              This will change {pendingBulkAction.targetCount}{" "}
              {pendingBulkAction.kind === "retry_failed_deliveries"
                ? pendingBulkAction.targetCount === 1
                  ? "delivery"
                  : "deliveries"
                : pendingBulkAction.targetCount === 1
                  ? "transaction"
                  : "transactions"}
              .
              {pendingBulkAction.unchangedCount > 0
                ? ` ${pendingBulkAction.unchangedCount} already match the target state.`
                : null}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={bulkUpdating !== null}
                onClick={() => void runBulkAction(pendingBulkAction)}
                className="rounded-full border border-foreground bg-foreground px-4 py-2 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={bulkUpdating !== null}
                onClick={() => setPendingBulkAction(null)}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {pendingRouteAction ? (
          <div className="mt-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
            <p className="text-sm font-medium text-foreground">
              {pendingRouteAction.nextEscalated ? "Escalate and reroute this transaction?" : "Clear escalation and reroute this transaction?"}
            </p>
            <p className="mt-2 text-sm text-foreground/66">
              {pendingRouteAction.target
                ? `This will send ${pendingRouteAction.item.kind} ${truncateId(pendingRouteAction.item.id)} to ${formatAdminOptionLabel(pendingRouteAction.target)}.`
                : `This will update ${pendingRouteAction.item.kind} ${truncateId(pendingRouteAction.item.id)} without changing the assignee.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={updatingId === `${pendingRouteAction.item.kind}:${pendingRouteAction.item.id}`}
                onClick={() => void routePriorityAction(pendingRouteAction.item, pendingRouteAction.nextEscalated).finally(() => setPendingRouteAction(null))}
                className="rounded-full border border-foreground bg-foreground px-4 py-2 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={updatingId === `${pendingRouteAction.item.kind}:${pendingRouteAction.item.id}`}
                onClick={() => setPendingRouteAction(null)}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {focusedItem ? (
          <div className="mt-4 rounded-[1.5rem] border border-foreground/18 bg-foreground/[0.03] p-5">
            <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                  Focused Transaction
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  {focusedItem.title}
                </h3>
                <p className="mt-2 text-sm text-foreground/66">
                  {focusedItem.kind} #{truncateId(focusedItem.id)} · {focusedItem.subtitle}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!previousItem}
                  onClick={() => setFocusKey(previousItem ? `${previousItem.kind}:${previousItem.id}` : null)}
                  className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!nextItem}
                  onClick={() => setFocusKey(nextItem ? `${nextItem.kind}:${nextItem.id}` : null)}
                  className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={() => setFocusKey(null)}
                  className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
                >
                  Clear Focus
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm text-foreground/68 sm:grid-cols-2 xl:grid-cols-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Amount</p>
                <p className="mt-1 font-medium text-foreground">{focusedItem.amountLabel}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Buyer</p>
                <p className="mt-1 font-mono text-xs text-foreground">{truncateId(focusedItem.buyer_id)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Seller</p>
                <p className="mt-1 font-mono text-xs text-foreground">{truncateId(focusedItem.seller_id)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Report Age</p>
                <p className="mt-1 text-foreground">{formatAgeLabel(focusedItem.createdAt)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Assignment Age</p>
                <p className="mt-1 text-foreground">
                  {focusedItem.adminAssigneeUserId
                    ? formatAgeLabel(focusedItem.adminAssignedAt ?? focusedItem.createdAt)
                    : "Not assigned"}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="rounded-[1.25rem] border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                  Support Snapshot
                </p>
                <div className="mt-3 flex flex-col gap-3 text-sm text-foreground/68">
                  <p>
                    <span className="text-foreground/46">Assignee:</span>{" "}
                    {formatAdminIdentity(focusedItem.adminAssigneeUserId)}
                  </p>
                  <p>
                    <span className="text-foreground/46">Role:</span>{" "}
                    {focusedItem.adminAssigneeUserId
                      ? adminRoster.find((entry) => entry.id === focusedItem.adminAssigneeUserId)?.role ?? "Unlabeled"
                      : "Unassigned"}
                  </p>
                  <p>
                    <span className="text-foreground/46">Escalated:</span>{" "}
                    {focusedItem.adminIsEscalated ? "Yes" : "No"}
                  </p>
                  <p>
                    <span className="text-foreground/46">Latest note:</span>{" "}
                    {focusedItem.adminNote?.trim() ? focusedItem.adminNote : "No internal note"}
                  </p>
                  <p>
                    <span className="text-foreground/46">Handoff note:</span>{" "}
                    {focusedItem.adminHandoffNote?.trim()
                      ? focusedItem.adminHandoffNote
                      : "No handoff context"}
                  </p>
                  <p>
                    <span className="text-foreground/46">Trust flags:</span>{" "}
                    {focusedTrustSummary && focusedTrustSummary.total > 0
                      ? `${focusedTrustSummary.open} open · ${focusedTrustSummary.escalated} escalated · ${focusedTrustSummary.hidden} hidden`
                      : "No seller review reports"}
                  </p>
                </div>
              </div>
              <div className="rounded-[1.25rem] border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                  Support History
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {focusedItem.adminHistory.length === 0 ? (
                    <p className="text-sm text-foreground/56">No support events recorded yet.</p>
                  ) : (
                    focusedItem.adminHistory.slice(0, 4).map((event) => (
                      <div
                        key={event.id}
                        className="rounded-2xl border border-border bg-surface px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {formatAdminActionLabel(event.action)}
                          </p>
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/44">
                            {formatAdminIdentity(event.actorUserId)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-foreground/50">
                          {formatDateTime(event.createdAt)}
                        </p>
                        {event.note ? (
                          <p className="mt-2 text-sm leading-6 text-foreground/68">{event.note}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-[1.25rem] border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                Delivery Health
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {focusedDeliveries.length === 0 ? (
                  <p className="text-sm text-foreground/56">No notification deliveries recorded for this transaction yet.</p>
                ) : (
                  focusedDeliveries.slice(0, 5).map((delivery) => (
                    <div
                      key={delivery.id}
                      className="rounded-2xl border border-border bg-surface px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          {delivery.channel} · {delivery.delivery_status.replaceAll("_", " ")}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-foreground/44">
                            {formatDateTime(delivery.created_at)}
                          </p>
                          {delivery.delivery_status === "failed" || delivery.delivery_status === "queued" ? (
                            <button
                              type="button"
                              disabled={retryingDeliveryId === delivery.id}
                              onClick={() => void retryAdminDelivery(delivery)}
                              className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.16em] text-foreground/64 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Retry
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-foreground/50">
                        Attempts {delivery.attempts}
                        {delivery.sent_at ? ` · Sent ${formatDateTime(delivery.sent_at)}` : ""}
                      </p>
                      {delivery.failure_reason ? (
                        <p className="mt-2 text-sm leading-6 text-danger">{delivery.failure_reason}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-4">
          {filteredItems.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-border px-4 py-8 text-sm text-foreground/60">
              No transactions match the current support filters.
            </div>
          ) : null}

          {filteredItems.map((item) => (
            <article
              key={`${item.kind}-${item.id}`}
              className={`rounded-[1.5rem] border bg-background/65 p-4 ${
                focusKey === `${item.kind}:${item.id}`
                  ? "border-foreground/35 ring-1 ring-foreground/18"
                  : "border-border"
              }`}
            >
              {(() => {
                const trustSummary = getSellerTrustSummary(item.seller_id);
                return (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3 lg:flex-1">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.22em] text-foreground/56">
                      {item.kind}
                    </span>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${
                        isOpenItem(item)
                          ? "border-amber-500/35 bg-amber-500/10 text-amber-700"
                          : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700"
                      }`}
                    >
                      {item.status.replaceAll("_", " ")}
                    </span>
                    {item.adminIsEscalated ? (
                      <span className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1 text-xs uppercase tracking-[0.18em] text-danger">
                        Escalated
                      </span>
                    ) : null}
                    {isStaleUnassigned(item) ? (
                      <span className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1 text-xs uppercase tracking-[0.18em] text-danger">
                        Stale Unassigned
                      </span>
                    ) : null}
                    {isStaleAssigned(item) ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-amber-700">
                        Stale Assigned
                      </span>
                    ) : null}
                    {item.adminAssigneeUserId === currentAdminUserId ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-700">
                        Assigned To Me
                      </span>
                    ) : null}
                    {!item.adminAssigneeUserId ? (
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/48">
                        Unassigned
                      </span>
                    ) : null}
                    <span className="text-xs text-foreground/48">#{truncateId(item.id)}</span>
                  </div>

                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm text-foreground/66">{item.subtitle}</p>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setFocusKey(`${item.kind}:${item.id}`)}
                        className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28"
                      >
                        {focusKey === `${item.kind}:${item.id}` ? "Focused" : "Open Focus"}
                      </button>
                    </div>
                  </div>

                    <div className="grid gap-3 text-sm text-foreground/68 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Amount</p>
                      <p className="mt-1 font-medium text-foreground">{item.amountLabel}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Buyer</p>
                      <p className="mt-1 font-mono text-xs text-foreground">{truncateId(item.buyer_id)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Seller</p>
                      <p className="mt-1 font-mono text-xs text-foreground">{truncateId(item.seller_id)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Started</p>
                      <p className="mt-1 text-foreground">{formatDateTime(item.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Report Age</p>
                      <p className="mt-1 text-foreground">{formatAgeLabel(item.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Assignment Age</p>
                      <p className="mt-1 text-foreground">
                        {item.adminAssigneeUserId ? formatAgeLabel(item.adminAssignedAt ?? item.createdAt) : "Not assigned"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[1.25rem] border border-border bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                          Support Controls
                        </p>
                        <p className="mt-1 text-sm text-foreground/64">
                          Internal-only assignment, escalation, and note state.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {trustSummary.total > 0 && getTrustRouteTarget(item) ? (
                          <button
                            type="button"
                            disabled={updatingId === `${item.kind}:${item.id}`}
                            onClick={() => void escalateToTrust(item)}
                            className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Escalate To Trust
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={updatingId === `${item.kind}:${item.id}`}
                          onClick={() =>
                            updateSupport(
                              item,
                              {
                                admin_assignee_user_id:
                                  item.adminAssigneeUserId === currentAdminUserId ? null : currentAdminUserId,
                              },
                              item.adminAssigneeUserId === currentAdminUserId ? "Assignment cleared" : "Assigned",
                            )
                          }
                          className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {item.adminAssigneeUserId === currentAdminUserId ? "Unassign Me" : "Assign To Me"}
                        </button>
                        {!item.adminIsEscalated && getRecommendedRouteTarget(item, true) ? (
                          <button
                            type="button"
                            disabled={updatingId === `${item.kind}:${item.id}`}
                            onClick={() => requestRoutePriorityAction(item, true)}
                            className="rounded-full border border-danger/30 bg-danger/8 px-4 py-2 text-sm text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Escalate + Route
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={updatingId === `${item.kind}:${item.id}`}
                          onClick={() =>
                            updateSupport(
                              item,
                              { admin_is_escalated: !item.adminIsEscalated },
                              item.adminIsEscalated ? "Escalation cleared" : "Escalated",
                            )
                          }
                          className={`rounded-full border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            item.adminIsEscalated
                              ? "border-danger/30 bg-danger/8 text-danger hover:border-danger/45"
                              : "border-border bg-background text-foreground/72 hover:border-foreground/28"
                          }`}
                        >
                          {item.adminIsEscalated ? "Clear Escalation" : "Escalate"}
                        </button>
                        {item.adminIsEscalated && getRecommendedRouteTarget(item, false) ? (
                          <button
                            type="button"
                            disabled={updatingId === `${item.kind}:${item.id}`}
                            onClick={() => requestRoutePriorityAction(item, false)}
                            className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Clear + Return
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-foreground/66 sm:grid-cols-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Assignee</p>
                        <p className="mt-1 font-mono text-xs text-foreground">
                          {formatAdminIdentity(item.adminAssigneeUserId)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Role</p>
                        <p className="mt-1 text-foreground">
                          {item.adminAssigneeUserId
                            ? adminRoster.find((entry) => entry.id === item.adminAssigneeUserId)?.role ?? "Unlabeled"
                            : "Unassigned"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Assigned At</p>
                        <p className="mt-1 text-foreground">{formatDateTime(item.adminAssignedAt)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/42">Escalated At</p>
                        <p className="mt-1 text-foreground">{formatDateTime(item.adminEscalatedAt)}</p>
                      </div>
                    </div>

                    {!item.adminIsEscalated && getRecommendedRouteTarget(item, true) ? (
                      <p className="mt-4 text-sm text-foreground/60">
                        {getRoutePreviewLabel(item, true)}
                      </p>
                    ) : null}
                    {item.adminIsEscalated && getRecommendedRouteTarget(item, false) ? (
                      <p className="mt-4 text-sm text-foreground/60">
                        {getRoutePreviewLabel(item, false)}
                      </p>
                    ) : null}

                    <label className="mt-4 flex flex-col gap-2 text-sm text-foreground/72">
                      Transfer to admin
                      <div className="flex flex-wrap gap-2">
                        {getRecommendedAdminsForItem(item).slice(0, 3).map((admin) => (
                          <button
                            key={admin.id}
                            type="button"
                            onClick={() =>
                              setAssigneeDrafts((current) => ({
                                ...current,
                                [item.id]: admin.id,
                              }))
                            }
                            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] transition ${
                              assigneeDrafts[item.id] === admin.id
                                ? "border-foreground bg-foreground text-background"
                                : "border-border bg-background text-foreground/64 hover:border-foreground/28"
                            }`}
                          >
                            {formatAdminOptionLabel(admin)}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-foreground/50">
                        Recommended target:{" "}
                        {getRecommendedRoleForItem(item)
                          ? getRecommendedRoleForItem(item)?.replace("_", " ")
                          : "best available admin"}
                      </p>
                      <select
                        value={assigneeDrafts[item.id] ?? ""}
                        onChange={(event) =>
                          setAssigneeDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="rounded-full border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
                      >
                        <option value="">Choose allowlisted admin</option>
                        {adminRoster.map((admin) => (
                          <option key={admin.id} value={admin.id}>
                            {formatAdminOptionLabel(admin)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        disabled={updatingId === `${item.kind}:${item.id}`}
                        onClick={() => void transferAssignment(item)}
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Transfer Assignment
                      </button>
                    </div>

                    <label className="mt-4 flex flex-col gap-2 text-sm text-foreground/72">
                      Internal note
                      <textarea
                        rows={3}
                        value={noteDrafts[item.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                        className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
                        placeholder="Capture support context, follow-up plans, or internal findings."
                      />
                    </label>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        disabled={updatingId === `${item.kind}:${item.id}`}
                        onClick={() =>
                          updateSupport(
                            item,
                            { admin_note: noteDrafts[item.id]?.trim() ? noteDrafts[item.id].trim() : null },
                            "Internal note",
                          )
                        }
                        className="rounded-full border border-foreground bg-foreground px-4 py-2 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save Note
                      </button>
                    </div>

                    <label className="mt-4 flex flex-col gap-2 text-sm text-foreground/72">
                      Handoff note
                      <textarea
                        rows={3}
                        value={handoffDrafts[item.id] ?? ""}
                        onChange={(event) =>
                          setHandoffDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground/30"
                        placeholder="Capture what the next admin needs to know if this work changes hands."
                      />
                    </label>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        disabled={updatingId === `${item.kind}:${item.id}`}
                        onClick={() =>
                          updateSupport(
                            item,
                            {
                              admin_handoff_note: handoffDrafts[item.id]?.trim()
                                ? handoffDrafts[item.id].trim()
                                : null,
                            },
                            "Handoff note",
                          )
                        }
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground/72 transition hover:border-foreground/28 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save Handoff
                      </button>
                    </div>

                    <div className="mt-4 border-t border-border pt-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                        Support History
                      </p>
                      <div className="mt-3 flex flex-col gap-3">
                        {item.adminHistory.length === 0 ? (
                          <p className="text-sm text-foreground/56">No support events recorded yet.</p>
                        ) : (
                          item.adminHistory.map((event) => (
                            <div
                              key={event.id}
                              className="rounded-2xl border border-border bg-background px-3 py-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-foreground">
                                  {formatAdminActionLabel(event.action)}
                                </p>
                                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/44">
                                  {truncateId(event.actorUserId)}
                                </p>
                              </div>
                              <p className="mt-1 text-xs text-foreground/50">
                                {formatDateTime(event.createdAt)}
                              </p>
                              {event.note ? (
                                <p className="mt-2 text-sm leading-6 text-foreground/68">{event.note}</p>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-w-[280px] rounded-[1.25rem] border border-border bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-foreground/48">
                    Status History
                  </p>
                  <div className="mt-3 flex flex-col gap-3">
                    {item.history.length === 0 ? (
                      <p className="text-sm text-foreground/56">No status history recorded.</p>
                    ) : (
                      item.history.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-2xl border border-border bg-background px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium capitalize text-foreground">
                              {event.status.replaceAll("_", " ")}
                            </p>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-foreground/44">
                              {event.actorRole}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-foreground/50">
                            {formatDateTime(event.createdAt)}
                          </p>
                          {event.note ? (
                            <p className="mt-2 text-sm leading-6 text-foreground/68">{event.note}</p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
                );
              })()}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
