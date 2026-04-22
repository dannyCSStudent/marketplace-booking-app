"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type Listing,
  type ListingPricingScopeCount,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const PRICING_AUDIT_ACTIVITY_KEY = "admin_pricing_audit_activity";
const PRICING_AUDIT_ACTIVITY_FILTER_KEY = "admin_pricing_audit_activity_filter";
const PRICING_AUDIT_ACTIVE_SCOPE_KEY = "admin_pricing_audit_active_scope";

type PricingAuditActivityEntry = {
  id: string;
  kind: "inspect" | "export" | "clear";
  scope: string;
  summary: string;
  createdAt: string;
};

type PricingAuditActivityFilter = "all" | "inspect" | "export";

function readStoredPricingAuditActivity() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.sessionStorage.getItem(PRICING_AUDIT_ACTIVITY_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as PricingAuditActivityEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.scope === "string" &&
        typeof entry.summary === "string" &&
        typeof entry.createdAt === "string",
    );
  } catch {
    window.sessionStorage.removeItem(PRICING_AUDIT_ACTIVITY_KEY);
    return [];
  }
}

function readStoredPricingAuditActivityFilter() {
  if (typeof window === "undefined") {
    return "all" as const;
  }

  const stored = window.sessionStorage.getItem(PRICING_AUDIT_ACTIVITY_FILTER_KEY);
  if (stored === "all" || stored === "inspect" || stored === "export") {
    return stored;
  }

  return "all" as const;
}

export default function PricingAuditSummary() {
  const [summary, setSummary] = useState<ListingPricingScopeCount[]>([]);
  const [scopeListings, setScopeListings] = useState<Listing[]>([]);
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [restoredClearedScope, setRestoredClearedScope] = useState<string | null>(null);
  const [activity, setActivity] = useState<PricingAuditActivityEntry[]>(readStoredPricingAuditActivity);
  const [activityFilter, setActivityFilter] = useState<PricingAuditActivityFilter>(
    readStoredPricingAuditActivityFilter,
  );
  const [status, setStatus] = useState("loading");
  const [detailStatus, setDetailStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const recordActivity = useCallback((entry: Omit<PricingAuditActivityEntry, "id" | "createdAt">) => {
    setActivity((current) => [
      {
        ...entry,
        id: `${entry.kind}:${entry.scope}:${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 8));
  }, []);

  const openScope = useCallback(
    async (scope: string, options?: { record?: boolean; restoredFromClear?: boolean }) => {
    setActiveScope(scope);
    setRestoredClearedScope(options?.restoredFromClear ? scope : null);
    setDetailStatus("loading");
    setDetailError(null);

    try {
      const session = await restoreAdminSession();
      if (!session) {
        setDetailStatus("error");
        setDetailError("Sign in as an admin to inspect pricing scope listings.");
        return;
      }

      const api = createApiClient(CLIENT_API_BASE_URL);
      const rows = await api.listPricingScopeItems(scope, {
        cache: "no-store",
        accessToken: session.access_token,
      });
      setScopeListings(rows);
      setDetailStatus("idle");
      if (options?.record !== false) {
        recordActivity({
          kind: "inspect",
          scope,
          summary: options?.restoredFromClear
            ? `Restored ${scope} pricing scope from cleared state`
            : `Inspected ${scope} pricing scope`,
        });
      }
    } catch (caught) {
      setDetailStatus("error");
      setDetailError(caught instanceof ApiError ? caught.message : "Unable to load pricing scope listings.");
    }
    },
    [recordActivity],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setStatus("loading");
      setError(null);
      try {
        const session = await restoreAdminSession();
        if (!session) {
          if (!cancelled) {
            setStatus("error");
            setError("Sign in as an admin to view the pricing audit.");
          }
          return;
        }

        const api = createApiClient(CLIENT_API_BASE_URL);
        const rows = await api.listPricingScopeSummary({
          cache: "no-store",
          accessToken: session.access_token,
        });
        if (cancelled) {
          return;
        }

        setSummary(rows);
        setFetchedAt(new Date().toLocaleString());
        setStatus("idle");

        if (typeof window !== "undefined") {
          const storedScope = window.sessionStorage.getItem(PRICING_AUDIT_ACTIVE_SCOPE_KEY);
          if (storedScope && rows.some((row) => row.scope === storedScope)) {
            void openScope(storedScope, { record: false });
          }
        }
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setError(caught instanceof ApiError ? caught.message : "Unable to load pricing audit.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PRICING_AUDIT_ACTIVITY_KEY, JSON.stringify(activity));
  }, [activity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(PRICING_AUDIT_ACTIVITY_FILTER_KEY, activityFilter);
  }, [activityFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (activeScope) {
      window.sessionStorage.setItem(PRICING_AUDIT_ACTIVE_SCOPE_KEY, activeScope);
    } else {
      window.sessionStorage.removeItem(PRICING_AUDIT_ACTIVE_SCOPE_KEY);
    }
  }, [activeScope]);

  const total = useMemo(() => summary.reduce((sum, row) => sum + row.count, 0), [summary]);
  const activeScopeSummary = useMemo(
    () => summary.find((row) => row.scope === activeScope) ?? null,
    [activeScope, summary],
  );
  const lastClearedScopeActivity = useMemo(
    () => activity.find((entry) => entry.kind === "clear") ?? null,
    [activity],
  );
  const watchlistAlerts = useMemo(() => {
    const alerts: Array<{
      id: string;
      title: string;
      description: string;
      scope: string | null;
      tone: "high" | "medium" | "monitor";
    }> = [];

    if (summary.length === 0 || total === 0) {
      return alerts;
    }

    const uncategorizedRow = summary.find((row) => row.scope === "Uncategorized") ?? null;
    if (uncategorizedRow && uncategorizedRow.count > 0) {
      const uncategorizedPct = Math.round((uncategorizedRow.count / total) * 100);
      alerts.push({
        id: "uncategorized",
        title: "Uncategorized pricing scope",
        description: `${uncategorizedRow.count} active listings (${uncategorizedPct}%) have no saved pricing comparison scope.`,
        scope: uncategorizedRow.scope,
        tone: uncategorizedPct >= 20 || uncategorizedRow.count >= 5 ? "high" : "medium",
      });
    }

    const topScope = summary[0] ?? null;
    if (topScope) {
      const topPct = Math.round((topScope.count / total) * 100);
      if (topPct >= 60 && total >= 10) {
        alerts.push({
          id: "concentration",
          title: "Scope concentration",
          description: `${topScope.scope} is driving ${topPct}% of active listing prices, which may signal over-reliance on one comparison mode.`,
          scope: topScope.scope,
          tone: topPct >= 75 ? "high" : "medium",
        });
      }
    }

    if (summary.length <= 2 && total >= 10) {
      alerts.push({
        id: "coverage",
        title: "Thin scope coverage",
        description: `Only ${summary.length} pricing scope bucket${summary.length === 1 ? "" : "s"} are represented across ${total} active listings.`,
        scope: null,
        tone: "monitor",
      });
    }

    return alerts;
  }, [summary, total]);
  const filteredActivity = useMemo(
    () => activity.filter((entry) => activityFilter === "all" || entry.kind === activityFilter),
    [activity, activityFilter],
  );
  const activityCounts = useMemo(
    () => ({
      all: activity.length,
      inspect: activity.filter((entry) => entry.kind === "inspect").length,
      export: activity.filter((entry) => entry.kind === "export").length,
    }),
    [activity],
  );

  function exportScopeCsv() {
    if (!activeScope || scopeListings.length === 0) {
      return;
    }

    const rows = [
      ["scope", "listing_id", "title", "type", "seller_id", "price", "location", "available_today", "promoted"],
      ...scopeListings.map((listing) => [
        activeScope,
        listing.id,
        listing.title,
        listing.type,
        listing.seller_id,
        formatCurrency(listing.price_cents, listing.currency),
        [listing.city, listing.state].filter(Boolean).join(", "),
        listing.available_today ? "yes" : "no",
        listing.is_promoted ? "yes" : "no",
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `pricing-scope-${activeScope.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    recordActivity({
      kind: "export",
      scope: activeScope,
      summary: `Exported ${activeScope} pricing scope CSV`,
    });
  }

  function clearActiveScope() {
    if (!activeScope) {
      return;
    }

    recordActivity({
      kind: "clear",
      scope: activeScope,
      summary: `Cleared ${activeScope} pricing scope`,
    });
    setActiveScope(null);
    setRestoredClearedScope(null);
    setScopeListings([]);
    setDetailStatus("idle");
    setDetailError(null);
  }

  function reopenLastClearedScope() {
    if (!lastClearedScopeActivity) {
      return;
    }

    void openScope(lastClearedScopeActivity.scope, { restoredFromClear: true });
  }

  const renderContent = () => {
    if (status === "loading") {
      return (
        <div className="rounded-2xl border border-border/50 bg-background px-4 py-3 text-sm text-foreground/66">
          Loading pricing audit data...
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
          No pricing history captured yet.
        </div>
      );
    }

    return (
      <ul className="flex flex-col gap-3">
        {summary.map((row) => {
          const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
          return (
            <li
              key={row.scope}
              className={`rounded-2xl border px-4 py-3 transition ${
                activeScope === row.scope
                  ? "border-foreground/30 bg-foreground/4"
                  : "border-border/50 bg-background"
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                <span className="uppercase tracking-[0.18em] text-foreground/68">{row.scope}</span>
                <div className="flex items-center gap-2">
                  <span className="text-foreground">{row.count}</span>
                  <button
                    className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={() => openScope(row.scope)}
                    type="button"
                  >
                    Inspect
                  </button>
                </div>
              </div>
              <div className="mt-2 h-1 rounded-full bg-border/30">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-foreground/60">{pct}% of active listings</p>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderDetail = () => {
    if (!activeScope) {
      return (
        <div className="rounded-2xl border border-dashed border-border/60 bg-background px-4 py-3 text-sm text-foreground/66">
          Choose a pricing scope above to inspect the listings behind that bucket.
        </div>
      );
    }

    if (detailStatus === "loading") {
      return (
        <div className="rounded-2xl border border-border/50 bg-background px-4 py-3 text-sm text-foreground/66">
          Loading {activeScope} listings...
        </div>
      );
    }

    if (detailError) {
      return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {detailError}
        </div>
      );
    }

    if (scopeListings.length === 0) {
      return (
        <div className="rounded-2xl border border-border/50 bg-background px-4 py-3 text-sm text-foreground/66">
          No active listings currently match the {activeScope} pricing scope.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {scopeListings.map((listing) => (
          <div key={listing.id} className="rounded-2xl border border-border/50 bg-background px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{listing.title}</p>
                <p className="mt-1 text-xs text-foreground/60">
                  {[listing.city, listing.state].filter(Boolean).join(", ") || "Location pending"}
                  {" · "}
                  {listing.type}
                </p>
              </div>
              <p className="text-sm font-semibold text-foreground">
                {formatCurrency(listing.price_cents, listing.currency)}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
              {listing.available_today ? (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-800">
                  Available today
                </span>
              ) : null}
              {listing.is_promoted ? (
                <span className="rounded-full border border-[#d48b7d]/25 bg-[#fbe8e1] px-3 py-1 text-[#9a4d3c]">
                  Promoted
                </span>
              ) : null}
              <span className="rounded-full border border-border px-3 py-1">
                {listing.last_pricing_comparison_scope ?? "Uncategorized"}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderActivity = () => {
    if (filteredActivity.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-border/60 bg-background px-4 py-3 text-sm text-foreground/66">
          {activity.length === 0
            ? "Inspect or export a pricing scope to build a recent audit trail here."
            : activityFilter === "inspect"
              ? "No inspection activity in this session yet."
              : "No export activity in this session yet."}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {filteredActivity.map((entry) => (
          <div key={entry.id} className="rounded-2xl border border-border/50 bg-background px-4 py-3">
            {(() => {
              const isRestoredInspect =
                entry.kind === "inspect" && entry.summary.includes("from cleared state");

              return (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.summary}</p>
                    <p className="mt-1 text-xs text-foreground/56">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                        entry.kind === "export"
                          ? "border border-[#d48b7d]/25 bg-[#fbe8e1] text-[#9a4d3c]"
                          : entry.kind === "clear"
                            ? "border border-amber-300 bg-amber-50 text-amber-800"
                            : "border border-sky-300 bg-sky-50 text-sky-800"
                      }`}
                    >
                      {entry.kind === "export" ? "Export" : entry.kind === "clear" ? "Clear" : "Inspect"}
                    </span>
                    {isRestoredInspect ? (
                      <span className="rounded-full border border-sky-300 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-800">
                        Restored
                      </span>
                    ) : null}
                    {entry.kind !== "clear" ? (
                      <button
                        className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                        onClick={() => openScope(entry.scope, { record: false })}
                        type="button"
                      >
                        {isRestoredInspect ? "Re-open restored scope" : "Re-open"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    );
  };

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      {watchlistAlerts.length > 0 ? (
        <div className="mb-6 rounded-3xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Audit watchlist</p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">Pricing scope risks to review first</h2>
            </div>
            <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/58">
              {watchlistAlerts.length} active
            </span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {watchlistAlerts.map((alert) => (
              <div key={alert.id} className="rounded-2xl border border-border/50 bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                    <p className="mt-2 text-sm leading-6 text-foreground/68">{alert.description}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      alert.tone === "high"
                        ? "border border-rose-200 bg-rose-50 text-rose-700"
                        : alert.tone === "medium"
                          ? "border border-amber-300 bg-amber-50 text-amber-800"
                          : "border border-sky-300 bg-sky-50 text-sky-800"
                    }`}
                  >
                    {alert.tone}
                  </span>
                </div>
                <div className="mt-4">
                  {alert.scope ? (
                    <button
                      className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => openScope(alert.scope!)}
                      type="button"
                    >
                      Inspect scope
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Pricing insights</p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">Pricing comparison audit</h2>
              <p className="text-xs text-foreground/56">Counts grouped by the comparison scope that triggered the current price.</p>
            </div>
            <p className="text-xs text-foreground/56">{fetchedAt ?? "Awaiting..."}</p>
          </div>
          <div className="mt-4 space-y-3 text-sm text-foreground/72">{renderContent()}</div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Scope details</p>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {activeScopeSummary ? `${activeScopeSummary.scope} listings` : "Listing drill-down"}
              </h3>
              <p className="text-xs text-foreground/56">
                {activeScopeSummary
                  ? `${activeScopeSummary.count} active listing${activeScopeSummary.count === 1 ? "" : "s"} in this scope`
                  : "Inspect a scope to review the listings behind the summary."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeScope ? (
                <button
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  onClick={clearActiveScope}
                  type="button"
                >
                  Clear scope
                </button>
              ) : null}
              <button
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                disabled={scopeListings.length === 0}
                onClick={exportScopeCsv}
                type="button"
              >
                Export CSV
              </button>
            </div>
          </div>
          {activeScope && restoredClearedScope === activeScope ? (
            <div className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <p className="font-semibold">Restored from cleared scope</p>
              <p className="mt-1 text-sky-800/90">
                {activeScope} was reopened from the last cleared pricing drill-down.
              </p>
            </div>
          ) : null}
          {!activeScope && lastClearedScopeActivity ? (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">No saved scope selected</p>
              <p className="mt-1 text-amber-800/90">
                {lastClearedScopeActivity.scope} was cleared from the active pricing drill-down{" "}
                {new Date(lastClearedScopeActivity.createdAt).toLocaleString()}.
              </p>
              <div className="mt-3">
                <button
                  className="rounded-full border border-amber-400 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-900 transition hover:border-amber-500 hover:text-amber-950"
                  onClick={reopenLastClearedScope}
                  type="button"
                >
                  Re-open cleared scope
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 space-y-3 text-sm text-foreground/72">{renderDetail()}</div>
        </div>
      </div>
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Recent audit activity</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Replay pricing scope actions</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["all", "All"],
              ["inspect", "Inspections"],
              ["export", "Exports"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                  activityFilter === value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-foreground/58 hover:border-accent hover:text-accent"
                }`}
                onClick={() => setActivityFilter(value)}
                type="button"
              >
                {label} ({activityCounts[value]})
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-3 text-sm text-foreground/72">{renderActivity()}</div>
      </div>
    </section>
  );
}
