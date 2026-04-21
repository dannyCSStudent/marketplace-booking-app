"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, type ListingPricingScopeCount } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const PRICING_SCOPE_FOCUS_KEY = "pricing_scope_focus";
const PRICING_SCOPE_ACTIVITY_KEY = "pricing_scope_activity";
const PRICING_SCOPE_ACTIVITY_GROUPS_KEY = "pricing_scope_activity_groups";

type PricingScopeActivityEntry = {
  id: string;
  scope: string;
  count: number;
  createdAt: string;
};

function readStoredFocusedScope() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.sessionStorage.getItem(PRICING_SCOPE_FOCUS_KEY);
  return stored && stored.trim() ? stored : null;
}

function readStoredPricingScopeActivity() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.sessionStorage.getItem(PRICING_SCOPE_ACTIVITY_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as PricingScopeActivityEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.scope === "string" &&
        typeof entry.count === "number" &&
        typeof entry.createdAt === "string",
    );
  } catch {
    window.sessionStorage.removeItem(PRICING_SCOPE_ACTIVITY_KEY);
    return [];
  }
}

function readStoredCollapsedActivityGroups() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.sessionStorage.getItem(PRICING_SCOPE_ACTIVITY_GROUPS_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Record<string, boolean>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    window.sessionStorage.removeItem(PRICING_SCOPE_ACTIVITY_GROUPS_KEY);
  }

  return {};
}

export default function PricingScopeSummarySection() {
  const [summary, setSummary] = useState<ListingPricingScopeCount[]>([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [focusedScope, setFocusedScope] = useState<string | null>(readStoredFocusedScope);
  const [recentActivity, setRecentActivity] = useState<PricingScopeActivityEntry[]>(
    readStoredPricingScopeActivity,
  );
  const [collapsedActivityGroups, setCollapsedActivityGroups] = useState<Record<string, boolean>>(
    readStoredCollapsedActivityGroups,
  );

  function focusPricingScope(scope: string, count: number) {
    setFocusedScope(scope);
    setRecentActivity((current) => [
      {
        id: `${scope}-${Date.now()}`,
        scope,
        count,
        createdAt: new Date().toISOString(),
      },
        ...current.filter((entry) => entry.scope !== scope),
      ].slice(0, 5));
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setStatus("loading");
      setError(null);
      try {
        const session = await restoreAdminSession();
        if (!session) {
          if (!cancelled) {
            setError("Sign in as an admin to view pricing scope stats.");
            setStatus("error");
          }
          return;
        }

        const api = createApiClient(CLIENT_API_BASE_URL);
        const rows = await api.listPricingScopeSummary({ cache: "no-store", accessToken: session.access_token });
        if (cancelled) {
          return;
        }

        setSummary(rows);
        setLastFetchedAt(new Date().toLocaleString());
        setStatus("idle");
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setError(caught instanceof ApiError ? caught.message : "Unable to load pricing scope counts.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (focusedScope) {
      window.sessionStorage.setItem(PRICING_SCOPE_FOCUS_KEY, focusedScope);
    } else {
      window.sessionStorage.removeItem(PRICING_SCOPE_FOCUS_KEY);
    }
  }, [focusedScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PRICING_SCOPE_ACTIVITY_KEY, JSON.stringify(recentActivity));
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      PRICING_SCOPE_ACTIVITY_GROUPS_KEY,
      JSON.stringify(collapsedActivityGroups),
    );
  }, [collapsedActivityGroups]);

  const total = useMemo(() => summary.reduce((sum, row) => sum + row.count, 0), [summary]);
  const focusedRow = useMemo(
    () => summary.find((row) => row.scope === focusedScope) ?? null,
    [focusedScope, summary],
  );
  const recentActivityRows = useMemo(
    () =>
      recentActivity
        .map((entry) => ({
          ...entry,
          row: summary.find((item) => item.scope === entry.scope) ?? null,
        }))
        .filter((entry) => entry.row),
    [recentActivity, summary],
  );
  const groupedRecentActivityRows = useMemo(() => {
    const today: typeof recentActivityRows = [];
    const earlier: typeof recentActivityRows = [];

    recentActivityRows.forEach((entry) => {
      const label = new Date(entry.createdAt).toDateString() === new Date().toDateString() ? today : earlier;
      label.push(entry);
    });

    return [
      { label: "Today", entries: today },
      { label: "Earlier", entries: earlier },
    ].filter((group) => group.entries.length > 0);
  }, [recentActivityRows]);
  const latestActivity = recentActivityRows[0] ?? null;
  const earlierActivityCount = recentActivityRows.filter(
    (entry) => new Date(entry.createdAt).toDateString() !== new Date().toDateString(),
  ).length;
  const hasCollapsedActivityGroups = Object.values(collapsedActivityGroups).some(Boolean);
  const sortedSummary = useMemo(
    () =>
      [...summary].sort((left, right) => {
        if (left.scope === focusedScope) {
          return -1;
        }
        if (right.scope === focusedScope) {
          return 1;
        }

        return right.count - left.count;
      }),
    [focusedScope, summary],
  );

  const renderedRows = () => {
    if (status === "loading") {
      return (
        <div className="rounded-2xl border border-border/50 bg-background px-4 py-3 text-sm text-foreground/66">
          Loading pricing scope distribution...
        </div>
      );
    }

    if (error) {
      return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      );
    }

    if (summary.length === 0) {
      return (
        <div className="rounded-2xl border border-border/50 bg-background px-4 py-3 text-sm text-foreground/66">
          No pricing history yet.
        </div>
      );
    }

    return sortedSummary.map((row) => {
      const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
      return (
        <div
          key={row.scope}
          className={`rounded-2xl border px-4 py-3 ${
            focusedScope === row.scope
              ? "border-accent bg-accent/5"
              : "border-border/50 bg-background"
          }`}
        >
          <div className="flex items-center justify-between gap-3 text-sm font-semibold">
            <span className="uppercase tracking-[0.18em] text-foreground/68">{row.scope}</span>
            <div className="flex items-center gap-2">
              {focusedScope === row.scope ? (
                <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                  Focused
                </span>
              ) : null}
              <span className="text-foreground">{row.count}</span>
            </div>
          </div>
          <div className="mt-2 h-1 rounded-full bg-border/30">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => focusPricingScope(row.scope, row.count)}
              type="button"
            >
              Focus scope
            </button>
          </div>
        </div>
      );
    });
  };

  return (
    <section className="rounded-[1.5rem] border border-border bg-white/90 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/56">
          Comparison scope distribution
        </p>
        <div className="flex items-center gap-2 text-xs text-foreground/56">
          {latestActivity ? (
            <button
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => focusPricingScope(latestActivity.scope, latestActivity.count)}
              type="button"
            >
              Resume latest · {latestActivity.scope}
            </button>
          ) : null}
          {focusedRow ? (
            <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              Focused: {focusedRow.scope}
            </span>
          ) : null}
          <span>{lastFetchedAt ?? new Date().toLocaleString()}</span>
        </div>
      </div>
      {focusedScope ? (
        <div className="mt-3 flex justify-end">
          <button
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
            onClick={() => setFocusedScope(null)}
            type="button"
          >
            Clear focus
          </button>
        </div>
      ) : null}
      {recentActivityRows.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-border/60 bg-background px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
              Recent Scope Activity
            </p>
            <div className="flex items-center gap-2">
              {hasCollapsedActivityGroups ? (
                <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
                  Earlier collapsed · {earlierActivityCount} hidden
                </span>
              ) : null}
              <button
                className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                onClick={() => {
                  setRecentActivity([]);
                  setCollapsedActivityGroups({});
                  if (typeof window !== "undefined") {
                    window.sessionStorage.removeItem(PRICING_SCOPE_ACTIVITY_KEY);
                    window.sessionStorage.removeItem(PRICING_SCOPE_ACTIVITY_GROUPS_KEY);
                  }
                }}
                type="button"
              >
                Clear history
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {groupedRecentActivityRows.map((group) => (
              <div key={group.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                    {group.label}
                  </p>
                  {group.label === "Earlier" ? (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() =>
                        setCollapsedActivityGroups((current) => ({
                          ...current,
                          Earlier: !current.Earlier,
                        }))
                      }
                      type="button"
                    >
                      {collapsedActivityGroups.Earlier ? "Expand" : "Collapse"}
                    </button>
                  ) : null}
                </div>
                {group.label === "Earlier" && collapsedActivityGroups.Earlier ? (
                  <div className="rounded-2xl border border-dashed border-border bg-white/55 px-4 py-3 text-sm text-foreground/66">
                    {group.entries.length} hidden scope action{group.entries.length === 1 ? "" : "s"}.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.entries.map((entry) => (
              <button
                key={entry.id}
                className="rounded-2xl border border-border/50 bg-white/80 px-4 py-3 text-left transition hover:border-accent hover:text-accent"
                onClick={() => focusPricingScope(entry.scope, entry.count)}
                type="button"
              >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold uppercase tracking-[0.14em] text-foreground/68">
                            {entry.scope}
                          </span>
                          <span className="text-sm font-semibold text-foreground">{entry.count}</span>
                        </div>
                        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-foreground/52">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {renderedRows()}
      </div>
    </section>
  );
}
