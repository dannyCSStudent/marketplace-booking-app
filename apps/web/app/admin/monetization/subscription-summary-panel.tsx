"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type SellerSubscriptionRead,
  type SubscriptionTierRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type Status = "idle" | "loading" | "error";

export default function SubscriptionSummaryPanel() {
  const [tiers, setTiers] = useState<SubscriptionTierRead[]>([]);
  const [subscriptions, setSubscriptions] = useState<SellerSubscriptionRead[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const api = useMemo(() => createApiClient(CLIENT_API_BASE_URL), []);

  const fetchData = async () => {
    setStatus("loading");
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to view subscription reporting.");
        return;
      }

      const [tierRows, subscriptionRows] = await Promise.all([
        api.listSubscriptionTiers({ accessToken: session.access_token }),
        api.listSellerSubscriptions({ accessToken: session.access_token }),
      ]);
      setTiers(tierRows);
      setSubscriptions(subscriptionRows.filter((subscription) => subscription.is_active));
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load subscription reporting.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchData();
    })();
  }, []);

  const summary = useMemo(() => {
    const assignedMrrCents = subscriptions.reduce(
      (sum, subscription) => sum + (subscription.monthly_price_cents ?? 0),
      0,
    );

    const tierCounts = subscriptions.reduce<Record<string, number>>((acc, subscription) => {
      const label = subscription.tier_name || subscription.tier_code || "Unknown tier";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});

    const analyticsEnabledCount = subscriptions.filter((subscription) => subscription.analytics_enabled).length;
    const priorityVisibilityCount = subscriptions.filter(
      (subscription) => subscription.priority_visibility,
    ).length;
    const premiumStorefrontCount = subscriptions.filter(
      (subscription) => subscription.premium_storefront,
    ).length;

    return {
      assignedMrrCents,
      activeSubscriptions: subscriptions.length,
      tierCounts: Object.entries(tierCounts).sort((left, right) => right[1] - left[1]),
      analyticsEnabledCount,
      priorityVisibilityCount,
      premiumStorefrontCount,
      totalTiers: tiers.length,
    };
  }, [subscriptions, tiers]);

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Seller subscriptions
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Subscription reporting</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting subscription reporting…"}
          </p>
        </div>
        <button
          type="button"
          disabled={status === "loading"}
          className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
          onClick={() => {
            if (status !== "loading") {
              void fetchData();
            }
          }}
        >
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Assigned MRR" value={formatCurrency(summary.assignedMrrCents, "USD")} />
        <SummaryStat label="Active subscriptions" value={String(summary.activeSubscriptions)} />
        <SummaryStat label="Live tiers" value={String(summary.totalTiers)} />
        <SummaryStat
          label="Analytics-enabled sellers"
          value={String(summary.analyticsEnabledCount)}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-[1.8rem] border border-border/60 bg-background p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Tier mix
          </p>
          <div className="mt-4 space-y-3">
            {summary.tierCounts.length > 0 ? (
              summary.tierCounts.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-sm text-foreground/72">
                  <span>{label}</span>
                  <span className="font-semibold text-foreground">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-foreground/66">No active seller subscriptions yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
            Perk adoption
          </p>
          <div className="mt-4 space-y-3 text-sm text-foreground/72">
            <div className="flex items-center justify-between gap-3">
              <span>Priority visibility</span>
              <span className="font-semibold text-foreground">{summary.priorityVisibilityCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Premium storefront</span>
              <span className="font-semibold text-foreground">{summary.premiumStorefrontCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Analytics</span>
              <span className="font-semibold text-foreground">{summary.analyticsEnabledCount}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border border-border/60 bg-background px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
    </div>
  );
}
