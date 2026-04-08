"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type SubscriptionTierCreate,
  type SubscriptionTierRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type Status = "idle" | "loading" | "error";

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

export default function SubscriptionTiersPanel() {
  const [tiers, setTiers] = useState<SubscriptionTierRead[]>([]);
  const [form, setForm] = useState<SubscriptionTierCreate>(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const api = useMemo(() => createApiClient(CLIENT_API_BASE_URL), []);

  const fetchTiers = async () => {
    setStatus("loading");
    setMessage(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setMessage("Sign in as an admin to manage subscription tiers.");
        return;
      }

      const data = await api.listSubscriptionTiers({ accessToken: session.access_token });
      setTiers(data);
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof ApiError ? caught.message : "Unable to load subscription tiers.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchTiers();
    })();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setMessage(null);
      const normalizedCode = form.code.trim().toLowerCase().replace(/\s+/g, "-");
      if (!normalizedCode || !form.name.trim()) {
        setMessage("Enter both a code and a display name.");
        return;
      }
      if (!Number.isInteger(form.monthly_price_cents) || form.monthly_price_cents < 0) {
        setMessage("Enter a non-negative monthly price in cents.");
        return;
      }

      try {
        const session = await restoreAdminSession();
        if (!session) {
          setMessage("Sign in as an admin to create subscription tiers.");
          return;
        }

        await api.createSubscriptionTier(
          {
            ...form,
            code: normalizedCode,
            name: form.name.trim(),
            perks_summary: form.perks_summary?.trim() || null,
          },
          { accessToken: session.access_token },
        );
        setForm(EMPTY_FORM);
        setMessage("Subscription tier saved.");
        await fetchTiers();
      } catch (caught) {
        setMessage(caught instanceof ApiError ? caught.message : "Unable to create subscription tier.");
      }
    });
  };

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
              void fetchTiers();
            }
          }}
        >
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

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
            <p className={`text-sm ${status === "error" ? "text-rose-600" : "text-foreground/60"}`}>{message}</p>
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
