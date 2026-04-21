"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  ApiError,
  formatCurrency,
  type SubscriptionTierCreate,
} from "@/app/lib/api";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useSubscriptionAnalytics } from "@/app/admin/monetization/subscription-analytics-context";
import { escapeCsvValue } from "@/app/admin/monetization/subscription-formatting";

type RecentActivityFilter = "all" | "create" | "refresh" | "export";

type SubscriptionTierRecentActivityInput =
  | {
      kind: "create";
      label: string;
      detail: string;
      tierCode: string;
      tierName: string;
    }
  | {
      kind: "refresh";
      label: string;
      detail: string;
    }
  | {
      kind: "export";
      label: string;
      detail: string;
    };

type SubscriptionTierRecentActivityEntry =
  | {
      id: string;
      kind: "create";
      label: string;
      detail: string;
      createdAt: string;
      tierCode: string;
      tierName: string;
    }
  | {
      id: string;
      kind: "refresh";
      label: string;
      detail: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: "export";
      label: string;
      detail: string;
      createdAt: string;
    };

const EMPTY_FORM: SubscriptionTierCreate = {
  code: "",
  name: "",
  monthly_price_cents: 0,
  perks_summary: "",
  analytics_enabled: false,
  priority_visibility: false,
  premium_storefront: false,
  is_active: true,
};
const SUBSCRIPTION_TIERS_ACTIVITY_KEY = "admin.subscription-tiers.recent-activity";
const SUBSCRIPTION_TIERS_ACTIVITY_FILTER_KEY = "admin.subscription-tiers.recent-activity-filter";
const MAX_RECENT_ACTIVITY_ENTRIES = 4;

type SubscriptionTierRecord = ReturnType<typeof useSubscriptionAnalytics>["tiers"][number];

function downloadSubscriptionTiersCsv(tiers: SubscriptionTierRecord[]) {
  const rows = tiers.map((tier) => [
    tier.code,
    tier.name,
    tier.monthly_price_cents,
    tier.perks_summary || "",
    tier.analytics_enabled ? "yes" : "no",
    tier.priority_visibility ? "yes" : "no",
    tier.premium_storefront ? "yes" : "no",
    tier.is_active ? "yes" : "no",
  ]);
  const csv = [
    [
      "code",
      "name",
      "monthly_price_cents",
      "perks_summary",
      "analytics_enabled",
      "priority_visibility",
      "premium_storefront",
      "is_active",
    ],
    ...rows,
  ]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "subscription-tiers.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function SubscriptionTiersPanel() {
  const [form, setForm] = useState<SubscriptionTierCreate>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { tiers, status, error, lastUpdated, refresh, createTier } = useSubscriptionAnalytics();
  const [recentActivity, setRecentActivity] = useState<SubscriptionTierRecentActivityEntry[]>(
    () => {
      if (typeof window === "undefined") {
        return [];
      }

      try {
        const stored = window.sessionStorage.getItem(SUBSCRIPTION_TIERS_ACTIVITY_KEY);
        if (!stored) {
          return [];
        }

        const parsed = JSON.parse(stored) as SubscriptionTierRecentActivityEntry[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        window.sessionStorage.removeItem(SUBSCRIPTION_TIERS_ACTIVITY_KEY);
        return [];
      }
    },
  );
  const [recentActivityFilter, setRecentActivityFilter] = useState<RecentActivityFilter>(() => {
    if (typeof window === "undefined") {
      return "all";
    }

    const stored = window.sessionStorage.getItem(SUBSCRIPTION_TIERS_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "create" || stored === "refresh" || stored === "export") {
      return stored;
    }

    return "all";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      SUBSCRIPTION_TIERS_ACTIVITY_KEY,
      JSON.stringify(recentActivity),
    );
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(SUBSCRIPTION_TIERS_ACTIVITY_FILTER_KEY, recentActivityFilter);
  }, [recentActivityFilter]);

  const recordRecentActivity = useCallback((entry: SubscriptionTierRecentActivityInput) => {
    setRecentActivity((current) =>
      [
        {
          ...entry,
          id: `${entry.kind}:${Date.now()}`,
          createdAt: new Date().toISOString(),
        } as SubscriptionTierRecentActivityEntry,
        ...current,
      ].slice(0, MAX_RECENT_ACTIVITY_ENTRIES),
    );
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setMessage(null);
      const normalizedCode = form.code.trim().toLowerCase().replace(/\s+/g, "-");
      const monthlyPriceCents = form.monthly_price_cents ?? 0;
      if (!normalizedCode || !form.name.trim()) {
        setMessage("Enter both a code and a display name.");
        return;
      }
      if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
        setMessage("Enter a non-negative monthly price in cents.");
        return;
      }

      try {
        const monthlyPriceCents = form.monthly_price_cents ?? 0;
        await createTier(
          {
            ...form,
            code: normalizedCode,
            name: form.name.trim(),
            perks_summary: form.perks_summary?.trim() || null,
          },
        );
        recordRecentActivity({
          kind: "create",
          label: form.name.trim(),
          detail: `${normalizedCode} · ${formatCurrency(monthlyPriceCents, "USD")}/mo`,
          tierCode: normalizedCode,
          tierName: form.name.trim(),
        });
        setForm(EMPTY_FORM);
        setMessage("Subscription tier saved.");
      } catch (caught) {
        setMessage(caught instanceof ApiError ? caught.message : "Unable to create subscription tier.");
      }
    });
  };

  const handleExportTiers = () => {
    if (tiers.length === 0) {
      return;
    }
    recordRecentActivity({
      kind: "export",
      label: `Exported ${tiers.length} tiers`,
      detail: `${tiers.filter((tier) => tier.is_active).length} active`,
    });
    downloadSubscriptionTiersCsv(tiers);
  };

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "subscription_tiers") {
        return;
      }
      highlightMonetizationSection("subscription-tiers-panel");
      recordRecentActivity({
        kind: "export",
        label: `Exported ${tiers.length} tiers`,
        detail: `${tiers.filter((tier) => tier.is_active).length} active`,
      });
      downloadSubscriptionTiersCsv(tiers);
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [recordRecentActivity, tiers]);

  const recentActivityCounts = useMemo(
    () => ({
      all: recentActivity.length,
      create: recentActivity.filter((entry) => entry.kind === "create").length,
      refresh: recentActivity.filter((entry) => entry.kind === "refresh").length,
      export: recentActivity.filter((entry) => entry.kind === "export").length,
    }),
    [recentActivity],
  );
  const filteredRecentActivity = useMemo(
    () =>
      recentActivity.filter(
        (entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter,
      ),
    [recentActivity, recentActivityFilter],
  );

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Seller subscriptions</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Subscription tiers</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting tier data…"}
          </p>
        </div>
        <button
          type="button"
          disabled={status === "loading"}
          className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
          onClick={() => {
            if (status !== "loading") {
              recordRecentActivity({
                kind: "refresh",
                label: "Refreshed tiers",
                detail: `${tiers.length} tiers`,
              });
              void refresh();
            }
          }}
        >
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {recentActivity.length > 0 ? (
        <div className="mt-5 rounded-[1.8rem] border border-border/60 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Recent Activity
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Re-open the last create or refresh path, or rerun the latest export.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => {
                setRecentActivity([]);
                window.sessionStorage.removeItem(SUBSCRIPTION_TIERS_ACTIVITY_KEY);
              }}
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["create", "Create"],
              ["refresh", "Refresh"],
              ["export", "Export"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  recentActivityFilter === value
                    ? "border-accent bg-accent text-white"
                    : "border-border text-foreground hover:border-accent hover:text-accent"
                }`}
                onClick={() => setRecentActivityFilter(value)}
              >
                {label} ({recentActivityCounts[value]})
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {filteredRecentActivity.length > 0 ? (
              filteredRecentActivity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border border-border bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-foreground/58">
                      {entry.kind} · {entry.detail}
                    </p>
                  </div>
                  {entry.kind === "create" ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      Created
                    </span>
                  ) : entry.kind === "refresh" ? (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => {
                        recordRecentActivity({
                          kind: "refresh",
                          label: "Refreshed tiers",
                          detail: `${tiers.length} tiers`,
                        });
                        void refresh();
                      }}
                      type="button"
                    >
                      Re-open refresh
                    </button>
                  ) : (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                    onClick={handleExportTiers}
                      type="button"
                    >
                      Re-export slice
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded-[1.1rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
                {recentActivityFilter === "all"
                  ? "No recent tier activity yet."
                  : `No ${recentActivityFilter} activity has been recorded in this session yet.`}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr,1.1fr]">
        <form className="space-y-4 rounded-[1.8rem] border border-border/60 bg-background p-5" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">Code</label>
            <input
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
              placeholder="starter"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">Name</label>
            <input
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Starter"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
              Monthly price (cents)
            </label>
            <input
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              type="number"
              min={0}
              step={1}
              value={form.monthly_price_cents}
              onChange={(event) =>
                setForm((current) => ({ ...current, monthly_price_cents: Number(event.target.value || 0) }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
              Perks summary
            </label>
            <textarea
              className="mt-2 min-h-24 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={form.perks_summary ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, perks_summary: event.target.value }))}
              placeholder="Priority visibility, analytics, premium storefront"
            />
          </div>
          <div className="grid gap-2 text-sm text-foreground/72 sm:grid-cols-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.analytics_enabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, analytics_enabled: event.target.checked }))
                }
              />
              Analytics
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.priority_visibility}
                onChange={(event) =>
                  setForm((current) => ({ ...current, priority_visibility: event.target.checked }))
                }
              />
              Priority
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.premium_storefront}
                onChange={(event) =>
                  setForm((current) => ({ ...current, premium_storefront: event.target.checked }))
                }
              />
              Storefront
            </label>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save tier
          </button>
          {message ? (
            <p className={`text-sm ${error ? "text-rose-600" : "text-foreground/60"}`}>{message}</p>
          ) : null}
        </form>

        <div className="space-y-3">
          {tiers.length === 0 ? (
            <p className="text-sm text-foreground/66">{status === "loading" ? "Loading tiers…" : "No tiers yet."}</p>
          ) : (
            tiers.map((tier) => (
              <div key={tier.id ?? tier.code} className="rounded-[1.8rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/52">{tier.code}</p>
                    <h3 className="text-lg font-semibold text-foreground">{tier.name}</h3>
                  </div>
                  <p className="text-lg font-semibold text-foreground">
                    {formatCurrency(tier.monthly_price_cents, "USD")}/mo
                  </p>
                </div>
                <p className="mt-3 text-sm text-foreground/68">{tier.perks_summary || "No perk summary yet."}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                  {tier.analytics_enabled ? (
                    <span className="rounded-full border border-border/60 px-3 py-1 text-foreground/72">Analytics</span>
                  ) : null}
                  {tier.priority_visibility ? (
                    <span className="rounded-full border border-border/60 px-3 py-1 text-foreground/72">Priority visibility</span>
                  ) : null}
                  {tier.premium_storefront ? (
                    <span className="rounded-full border border-border/60 px-3 py-1 text-foreground/72">Premium storefront</span>
                  ) : null}
                  {!tier.is_active ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700">Inactive</span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
