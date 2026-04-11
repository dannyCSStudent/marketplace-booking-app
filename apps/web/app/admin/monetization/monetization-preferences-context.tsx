"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createApiClient, type Profile } from "@/app/lib/api";
import { invalidateMarketplaceCaches } from "@/app/lib/cache-invalidation";
import { restoreAdminSession } from "@/app/lib/admin-auth";
import type {
  PromotionDashboardSegmentFilter,
  PromotionDashboardStatusFilter,
  PromotionDashboardWindowDays,
} from "@/app/admin/monetization/promotion-dashboard-filters";
import type { PromotionListingTypeFilter } from "@/app/admin/monetization/promotion-listing-focus";
import type {
  SubscriptionHistoryDirection,
  SubscriptionHistoryReason,
  SubscriptionHistoryWindowDays,
} from "@/app/admin/monetization/subscription-history-filters";
import type {
  MonetizationActivityEntry,
  MonetizationPreferences,
  MonetizationToolState,
  PromotionDashboardPreferences,
  QuickAccessFilter,
  SubscriptionAssignmentDraft,
  SubscriptionHistoryPreferences,
} from "@/app/admin/monetization/monetization-preferences-types";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const SESSION_STORAGE_KEY = "admin.monetization.preferences-cache";
const MAX_ACTIVITY_ENTRIES = 8;

type MonetizationPreferencesContextValue = {
  preferences: MonetizationPreferences;
  setPinnedPresetIds: (updater: string[] | ((current: string[]) => string[])) => void;
  setQuickAccessFilter: (filter: QuickAccessFilter) => void;
  setSubscriptionHistory: (
    updater:
      | SubscriptionHistoryPreferences
      | ((current: SubscriptionHistoryPreferences) => SubscriptionHistoryPreferences),
  ) => void;
  setPromotionDashboard: (
    updater:
      | PromotionDashboardPreferences
      | ((current: PromotionDashboardPreferences) => PromotionDashboardPreferences),
  ) => void;
  setSubscriptionAssignmentDraft: (
    updater:
      | SubscriptionAssignmentDraft
      | ((current: SubscriptionAssignmentDraft) => SubscriptionAssignmentDraft),
  ) => void;
  setToolState: (
    updater: MonetizationToolState | ((current: MonetizationToolState) => MonetizationToolState),
  ) => void;
  setActivityLog: (
    updater:
      | MonetizationActivityEntry[]
      | ((current: MonetizationActivityEntry[]) => MonetizationActivityEntry[]),
  ) => void;
};

const DEFAULT_PREFERENCES: MonetizationPreferences = {
  pinnedPresetIds: [],
  quickAccessFilter: "all",
  activityLog: [],
  subscriptionHistory: {
    direction: "all",
    reason: "all",
    destructiveOnly: false,
    destructiveType: "all",
    windowDays: 30,
  },
  promotionDashboard: {
    windowDays: 14,
    statusFilter: "all",
    typeFilter: "all",
    segmentFilter: "all",
  },
  subscriptionAssignmentDraft: {
    sellerSlug: "",
    selectedTierId: "",
    reasonCode: "manual_upgrade",
    note: "",
  },
  toolState: {
    exportLastAction: null,
    viewLastPreset: null,
    quickAccessLastUsedPresetId: null,
    dismissedWatchlistAlertSignatures: {},
    lastWatchlistViewedAt: null,
    watchlistSeverityFilter: "all",
    watchlistCollapsed: false,
    watchlistNewOnly: false,
    watchlistLastActionSummary: null,
    watchlistLastActionAt: null,
    watchlistLastActionReplayKey: null,
    activityLogViewFilter: "all",
    activityLogEntryLimit: 6,
    activityLogCollapsedGroups: [],
  },
};

const MonetizationPreferencesContext = createContext<MonetizationPreferencesContextValue | null>(null);

function normalizeQuickAccessFilter(value: unknown): QuickAccessFilter {
  return value === "views" || value === "workflows" || value === "exports" ? value : "all";
}

function normalizeSubscriptionHistoryDirection(value: unknown): SubscriptionHistoryDirection {
  return value === "started" ||
    value === "upgrade" ||
    value === "downgrade" ||
    value === "reactivated" ||
    value === "lateral"
    ? value
    : "all";
}

function normalizeSubscriptionHistoryReason(value: unknown): SubscriptionHistoryReason {
  return value === "trial_conversion" ||
    value === "manual_upgrade" ||
    value === "retention_save" ||
    value === "support_adjustment" ||
    value === "plan_reset"
    ? value
    : "all";
}

function normalizeSubscriptionHistoryWindowDays(value: unknown): SubscriptionHistoryWindowDays {
  return value === 7 || value === 14 ? value : 30;
}

function normalizePromotionWindowDays(value: unknown): PromotionDashboardWindowDays {
  return value === 7 || value === 30 ? value : 14;
}

function normalizePromotionStatusFilter(value: unknown): PromotionDashboardStatusFilter {
  return value === "promoted" || value === "removed" ? value : "all";
}

function normalizePromotionTypeFilter(value: unknown): PromotionListingTypeFilter {
  return value === "product" ||
    value === "service" ||
    value === "hybrid" ||
    value === "unknown"
    ? value
    : "all";
}

function normalizePromotionSegmentFilter(value: unknown): PromotionDashboardSegmentFilter {
  return value === "multi_listing_sellers" || value === "single_listing_sellers" ? value : "all";
}

function normalizeWatchlistSeverityFilter(value: unknown): MonetizationToolState["watchlistSeverityFilter"] {
  return value === "high" || value === "medium" || value === "monitor" ? value : "all";
}

function normalizePreferences(value: unknown): MonetizationPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_PREFERENCES;
  }

  const record = value as {
    pinned_preset_ids?: unknown;
    quick_access_filter?: unknown;
    activity_log?: unknown;
    subscription_history?: unknown;
    promotion_dashboard?: unknown;
    subscription_assignment_draft?: unknown;
    tool_state?: unknown;
  };
  const subscriptionHistoryRecord =
    record.subscription_history && typeof record.subscription_history === "object"
      ? (record.subscription_history as {
          direction?: unknown;
          reason?: unknown;
          destructive_only?: unknown;
          destructive_type?: unknown;
          window_days?: unknown;
        })
      : null;
  const promotionDashboardRecord =
    record.promotion_dashboard && typeof record.promotion_dashboard === "object"
      ? (record.promotion_dashboard as {
          window_days?: unknown;
          status_filter?: unknown;
          type_filter?: unknown;
          segment_filter?: unknown;
        })
      : null;
  const subscriptionAssignmentDraftRecord =
    record.subscription_assignment_draft &&
    typeof record.subscription_assignment_draft === "object"
      ? (record.subscription_assignment_draft as {
          seller_slug?: unknown;
          selected_tier_id?: unknown;
          reason_code?: unknown;
          note?: unknown;
        })
      : null;
  const toolStateRecord =
    record.tool_state && typeof record.tool_state === "object"
      ? (record.tool_state as {
          export_last_action?: unknown;
          view_last_preset?: unknown;
          quick_access_last_used_preset_id?: unknown;
          dismissed_watchlist_alert_signatures?: unknown;
          last_watchlist_viewed_at?: unknown;
          watchlist_severity_filter?: unknown;
          watchlist_collapsed?: unknown;
          watchlist_new_only?: unknown;
          watchlist_last_action_summary?: unknown;
          watchlist_last_action_at?: unknown;
          watchlist_last_action_replay_key?: unknown;
          activity_log_view_filter?: unknown;
          activity_log_entry_limit?: unknown;
          activity_log_collapsed_groups?: unknown;
        })
      : null;

  return {
    pinnedPresetIds: Array.isArray(record.pinned_preset_ids)
      ? record.pinned_preset_ids.filter((entry): entry is string => typeof entry === "string")
      : [],
    quickAccessFilter: normalizeQuickAccessFilter(record.quick_access_filter),
    activityLog: Array.isArray(record.activity_log)
      ? record.activity_log
          .filter((entry): entry is MonetizationActivityEntry => {
            if (!entry || typeof entry !== "object") {
              return false;
            }
            const candidate = entry as Partial<MonetizationActivityEntry>;
            return (
              typeof candidate.id === "string" &&
              typeof candidate.label === "string" &&
              typeof candidate.summary === "string" &&
              typeof candidate.createdAt === "string" &&
              (candidate.kind === "saved_view" ||
                candidate.kind === "export" ||
                candidate.kind === "workflow")
            );
          })
          .slice(0, MAX_ACTIVITY_ENTRIES)
      : [],
    subscriptionHistory: {
      direction: normalizeSubscriptionHistoryDirection(subscriptionHistoryRecord?.direction),
      reason: normalizeSubscriptionHistoryReason(subscriptionHistoryRecord?.reason),
      destructiveOnly: Boolean(subscriptionHistoryRecord?.destructive_only),
      destructiveType:
        subscriptionHistoryRecord?.destructive_type === "value_drop" ||
        subscriptionHistoryRecord?.destructive_type === "perk_removal"
          ? subscriptionHistoryRecord.destructive_type
          : "all",
      windowDays: normalizeSubscriptionHistoryWindowDays(subscriptionHistoryRecord?.window_days),
    },
    promotionDashboard: {
      windowDays: normalizePromotionWindowDays(promotionDashboardRecord?.window_days),
      statusFilter: normalizePromotionStatusFilter(promotionDashboardRecord?.status_filter),
      typeFilter: normalizePromotionTypeFilter(promotionDashboardRecord?.type_filter),
      segmentFilter: normalizePromotionSegmentFilter(promotionDashboardRecord?.segment_filter),
    },
    subscriptionAssignmentDraft: {
      sellerSlug:
        typeof subscriptionAssignmentDraftRecord?.seller_slug === "string"
          ? subscriptionAssignmentDraftRecord.seller_slug
          : "",
      selectedTierId:
        typeof subscriptionAssignmentDraftRecord?.selected_tier_id === "string"
          ? subscriptionAssignmentDraftRecord.selected_tier_id
          : "",
      reasonCode:
        typeof subscriptionAssignmentDraftRecord?.reason_code === "string"
          ? subscriptionAssignmentDraftRecord.reason_code
          : "manual_upgrade",
      note:
        typeof subscriptionAssignmentDraftRecord?.note === "string"
          ? subscriptionAssignmentDraftRecord.note
          : "",
    },
    toolState: {
      exportLastAction:
        typeof toolStateRecord?.export_last_action === "string"
          ? toolStateRecord.export_last_action
          : null,
      viewLastPreset:
        typeof toolStateRecord?.view_last_preset === "string"
          ? toolStateRecord.view_last_preset
          : null,
      quickAccessLastUsedPresetId:
        typeof toolStateRecord?.quick_access_last_used_preset_id === "string"
          ? toolStateRecord.quick_access_last_used_preset_id
          : null,
      dismissedWatchlistAlertSignatures:
        toolStateRecord?.dismissed_watchlist_alert_signatures &&
        typeof toolStateRecord.dismissed_watchlist_alert_signatures === "object"
          ? Object.fromEntries(
              Object.entries(toolStateRecord.dismissed_watchlist_alert_signatures).filter(
                ([key, value]): value is string => typeof key === "string" && typeof value === "string",
              ),
            )
          : {},
      lastWatchlistViewedAt:
        typeof toolStateRecord?.last_watchlist_viewed_at === "string"
          ? toolStateRecord.last_watchlist_viewed_at
          : null,
      watchlistSeverityFilter: normalizeWatchlistSeverityFilter(
        toolStateRecord?.watchlist_severity_filter,
      ),
      watchlistCollapsed: Boolean(toolStateRecord?.watchlist_collapsed),
      watchlistNewOnly: Boolean(toolStateRecord?.watchlist_new_only),
      watchlistLastActionSummary:
        typeof toolStateRecord?.watchlist_last_action_summary === "string"
          ? toolStateRecord.watchlist_last_action_summary
          : null,
      watchlistLastActionAt:
        typeof toolStateRecord?.watchlist_last_action_at === "string"
          ? toolStateRecord.watchlist_last_action_at
          : null,
      watchlistLastActionReplayKey:
        toolStateRecord?.watchlist_last_action_replay_key === "subscription_destructive" ||
        toolStateRecord?.watchlist_last_action_replay_key === "subscription_downgrade" ||
        toolStateRecord?.watchlist_last_action_replay_key === "promotion_removals" ||
        toolStateRecord?.watchlist_last_action_replay_key === "promoted_listings"
          ? toolStateRecord.watchlist_last_action_replay_key
          : null,
      activityLogViewFilter:
        toolStateRecord?.activity_log_view_filter === "watchlist" ? "watchlist" : "all",
      activityLogEntryLimit: toolStateRecord?.activity_log_entry_limit === 10 ? 10 : 6,
      activityLogCollapsedGroups: Array.isArray(toolStateRecord?.activity_log_collapsed_groups)
        ? toolStateRecord.activity_log_collapsed_groups.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    },
  };
}

function toProfilePreferences(preferences: MonetizationPreferences) {
  return {
    pinned_preset_ids: preferences.pinnedPresetIds,
    quick_access_filter: preferences.quickAccessFilter,
    activity_log: preferences.activityLog.slice(0, MAX_ACTIVITY_ENTRIES),
    subscription_history: {
      direction: preferences.subscriptionHistory.direction,
      reason: preferences.subscriptionHistory.reason,
      destructive_only: preferences.subscriptionHistory.destructiveOnly,
      destructive_type: preferences.subscriptionHistory.destructiveType,
      window_days: preferences.subscriptionHistory.windowDays,
    },
    promotion_dashboard: {
      window_days: preferences.promotionDashboard.windowDays,
      status_filter: preferences.promotionDashboard.statusFilter,
      type_filter: preferences.promotionDashboard.typeFilter,
      segment_filter: preferences.promotionDashboard.segmentFilter,
    },
    subscription_assignment_draft: {
      seller_slug: preferences.subscriptionAssignmentDraft.sellerSlug,
      selected_tier_id: preferences.subscriptionAssignmentDraft.selectedTierId,
      reason_code: preferences.subscriptionAssignmentDraft.reasonCode,
      note: preferences.subscriptionAssignmentDraft.note,
    },
    tool_state: {
      export_last_action: preferences.toolState.exportLastAction,
      view_last_preset: preferences.toolState.viewLastPreset,
      quick_access_last_used_preset_id: preferences.toolState.quickAccessLastUsedPresetId,
      dismissed_watchlist_alert_signatures: preferences.toolState.dismissedWatchlistAlertSignatures,
      last_watchlist_viewed_at: preferences.toolState.lastWatchlistViewedAt,
      watchlist_severity_filter: preferences.toolState.watchlistSeverityFilter,
      watchlist_collapsed: preferences.toolState.watchlistCollapsed,
      watchlist_new_only: preferences.toolState.watchlistNewOnly,
      watchlist_last_action_summary: preferences.toolState.watchlistLastActionSummary,
      watchlist_last_action_at: preferences.toolState.watchlistLastActionAt,
      watchlist_last_action_replay_key: preferences.toolState.watchlistLastActionReplayKey,
      activity_log_view_filter: preferences.toolState.activityLogViewFilter,
      activity_log_entry_limit: preferences.toolState.activityLogEntryLimit,
      activity_log_collapsed_groups: preferences.toolState.activityLogCollapsedGroups,
    },
  };
}

function mergePreferences(remote: MonetizationPreferences, cached: MonetizationPreferences) {
  return {
    pinnedPresetIds: remote.pinnedPresetIds.length > 0 ? remote.pinnedPresetIds : cached.pinnedPresetIds,
    quickAccessFilter:
      remote.quickAccessFilter !== "all" ? remote.quickAccessFilter : cached.quickAccessFilter,
    activityLog: remote.activityLog.length > 0 ? remote.activityLog : cached.activityLog,
    subscriptionHistory:
      JSON.stringify(remote.subscriptionHistory) !== JSON.stringify(DEFAULT_PREFERENCES.subscriptionHistory)
        ? remote.subscriptionHistory
        : cached.subscriptionHistory,
    promotionDashboard:
      JSON.stringify(remote.promotionDashboard) !== JSON.stringify(DEFAULT_PREFERENCES.promotionDashboard)
        ? remote.promotionDashboard
        : cached.promotionDashboard,
    subscriptionAssignmentDraft:
      JSON.stringify(remote.subscriptionAssignmentDraft) !==
      JSON.stringify(DEFAULT_PREFERENCES.subscriptionAssignmentDraft)
        ? remote.subscriptionAssignmentDraft
        : cached.subscriptionAssignmentDraft,
    toolState:
      JSON.stringify(remote.toolState) !== JSON.stringify(DEFAULT_PREFERENCES.toolState)
        ? remote.toolState
        : cached.toolState,
  };
}

export function MonetizationPreferencesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [preferences, setPreferences] = useState<MonetizationPreferences>(DEFAULT_PREFERENCES);
  const [readyToPersist, setReadyToPersist] = useState(false);
  const accessTokenRef = useRef<string | null>(null);
  const lastRemoteSnapshotRef = useRef<string>(JSON.stringify(DEFAULT_PREFERENCES));

  useEffect(() => {
    let cancelled = false;

    const loadPreferences = async () => {
      let cached = DEFAULT_PREFERENCES;
      try {
        const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
          cached = normalizePreferences(JSON.parse(raw));
          if (!cancelled) {
            setPreferences(cached);
          }
        }
      } catch {
        // Ignore malformed cached preferences.
      }

      try {
        const session = await restoreAdminSession();
        if (!session || cancelled) {
          lastRemoteSnapshotRef.current = JSON.stringify(cached);
          setReadyToPersist(true);
          return;
        }

        accessTokenRef.current = session.access_token;
        const api = createApiClient(CLIENT_API_BASE_URL);
        const profile = await api.get<Profile>("/profiles/me", { accessToken: session.access_token });
        const remote = normalizePreferences(profile.admin_monetization_preferences);
        const merged = mergePreferences(remote, cached);

        if (!cancelled) {
          setPreferences(merged);
          lastRemoteSnapshotRef.current = JSON.stringify(remote);
          setReadyToPersist(true);
        }
      } catch {
        lastRemoteSnapshotRef.current = JSON.stringify(cached);
        if (!cancelled) {
          setReadyToPersist(true);
        }
      }
    };

    void loadPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toProfilePreferences(preferences)));
    } catch {
      // Ignore storage failures.
    }
  }, [preferences]);

  useEffect(() => {
    if (!readyToPersist || !accessTokenRef.current) {
      return;
    }

    const payload = toProfilePreferences(preferences);
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastRemoteSnapshotRef.current) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const api = createApiClient(CLIENT_API_BASE_URL);
        await api.updateProfile(
          { admin_monetization_preferences: payload },
          { accessToken: accessTokenRef.current ?? undefined },
        );
        lastRemoteSnapshotRef.current = snapshot;
        await invalidateMarketplaceCaches();
        router.refresh();
      } catch {
        // Keep local preferences even if the remote save fails.
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [preferences, readyToPersist]);

  const value = useMemo<MonetizationPreferencesContextValue>(
    () => ({
      preferences,
      setPinnedPresetIds: (updater) => {
        setPreferences((current) => ({
          ...current,
          pinnedPresetIds:
            typeof updater === "function" ? updater(current.pinnedPresetIds) : updater,
        }));
      },
      setQuickAccessFilter: (filter) => {
        setPreferences((current) => ({ ...current, quickAccessFilter: filter }));
      },
      setSubscriptionHistory: (updater) => {
        setPreferences((current) => ({
          ...current,
          subscriptionHistory:
            typeof updater === "function" ? updater(current.subscriptionHistory) : updater,
        }));
      },
      setPromotionDashboard: (updater) => {
        setPreferences((current) => ({
          ...current,
          promotionDashboard:
            typeof updater === "function" ? updater(current.promotionDashboard) : updater,
        }));
      },
      setSubscriptionAssignmentDraft: (updater) => {
        setPreferences((current) => ({
          ...current,
          subscriptionAssignmentDraft:
            typeof updater === "function"
              ? updater(current.subscriptionAssignmentDraft)
              : updater,
        }));
      },
      setToolState: (updater) => {
        setPreferences((current) => ({
          ...current,
          toolState: typeof updater === "function" ? updater(current.toolState) : updater,
        }));
      },
      setActivityLog: (updater) => {
        setPreferences((current) => ({
          ...current,
          activityLog:
            typeof updater === "function"
              ? updater(current.activityLog).slice(0, MAX_ACTIVITY_ENTRIES)
              : updater.slice(0, MAX_ACTIVITY_ENTRIES),
        }));
      },
    }),
    [preferences],
  );

  return <MonetizationPreferencesContext.Provider value={value}>{children}</MonetizationPreferencesContext.Provider>;
}

export function useMonetizationPreferences() {
  const context = useContext(MonetizationPreferencesContext);
  if (!context) {
    throw new Error("useMonetizationPreferences must be used within MonetizationPreferencesProvider");
  }
  return context;
}
