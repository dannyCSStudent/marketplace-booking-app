"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

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

const REASON_OPTIONS = [
  { value: "trial_conversion", label: "Trial conversion" },
  { value: "manual_upgrade", label: "Manual upgrade" },
  { value: "retention_save", label: "Retention save" },
  { value: "support_adjustment", label: "Support adjustment" },
  { value: "plan_reset", label: "Plan reset" },
] as const;

export default function SellerSubscriptionsPanel() {
  const [tiers, setTiers] = useState<SubscriptionTierRead[]>([]);
  const [subscriptions, setSubscriptions] = useState<SellerSubscriptionRead[]>([]);
  const [sellerSlug, setSellerSlug] = useState("");
  const [selectedTierId, setSelectedTierId] = useState("");
  const [reasonCode, setReasonCode] =
    useState<(typeof REASON_OPTIONS)[number]["value"]>("manual_upgrade");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const api = useMemo(() => createApiClient(CLIENT_API_BASE_URL), []);

  const fetchData = async () => {
    setStatus("loading");
    setMessage(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setMessage("Sign in as an admin to manage seller subscriptions.");
        return;
      }

      const [tierRows, subscriptionRows] = await Promise.all([
        api.listSubscriptionTiers({ accessToken: session.access_token }),
        api.listSellerSubscriptions({ accessToken: session.access_token }),
      ]);
      setTiers(tierRows);
      setSubscriptions(subscriptionRows);
      setSelectedTierId((current) => current || tierRows[0]?.id || "");
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof ApiError ? caught.message : "Unable to load seller subscriptions.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchData();
    })();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setMessage(null);
      const normalizedSlug = sellerSlug.trim().toLowerCase();
      if (!normalizedSlug || !selectedTierId) {
        setMessage("Enter a seller slug and choose a tier.");
        return;
      }

      try {
        const session = await restoreAdminSession();
        if (!session) {
          setMessage("Sign in as an admin to assign subscriptions.");
          return;
        }

        await api.assignSellerSubscription(
          {
            seller_slug: normalizedSlug,
            tier_id: selectedTierId,
            reason_code: reasonCode,
            note: note.trim() || null,
          },
          { accessToken: session.access_token },
        );
        setSellerSlug("");
        setReasonCode("manual_upgrade");
        setNote("");
        setMessage("Seller subscription updated.");
        await fetchData();
      } catch (caught) {
        setMessage(caught instanceof ApiError ? caught.message : "Unable to assign seller subscription.");
      }
    });
  };

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Seller subscriptions</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Active seller plans</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting subscription data…"}
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

      <div className="mt-5 grid gap-6 lg:grid-cols-[0.95fr,1.05fr]">
        <form className="space-y-4 rounded-[1.8rem] border border-border/60 bg-background p-5" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">Seller slug</label>
            <input
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={sellerSlug}
              onChange={(event) => setSellerSlug(event.target.value)}
              placeholder="south-dallas-tamales"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">Tier</label>
            <select
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={selectedTierId}
              onChange={(event) => setSelectedTierId(event.target.value)}
            >
              <option value="">Select a tier</option>
              {tiers.map((tier) => (
                <option key={tier.id ?? tier.code} value={tier.id ?? ""}>
                  {tier.name} ({formatCurrency(tier.monthly_price_cents, "USD")}/mo)
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-foreground/60">
            Assigning a new tier automatically closes the seller’s previous active subscription.
          </p>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
              Reason
            </label>
            <select
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={reasonCode}
              onChange={(event) =>
                setReasonCode(event.target.value as (typeof REASON_OPTIONS)[number]["value"])
              }
            >
              {REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
              Change note
            </label>
            <textarea
              className="mt-2 min-h-24 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reason for upgrade, downgrade, or reactivation"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || tiers.length === 0}
            className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Assign tier
          </button>
          {message ? (
            <p className={`text-sm ${status === "error" ? "text-rose-600" : "text-foreground/60"}`}>{message}</p>
          ) : null}
        </form>

        <div className="space-y-3">
          {subscriptions.length === 0 ? (
            <p className="text-sm text-foreground/66">
              {status === "loading" ? "Loading subscriptions…" : "No seller subscriptions yet."}
            </p>
          ) : (
            subscriptions.map((subscription) => (
              <div
                key={subscription.id ?? `${subscription.seller_id}-${subscription.tier_id}`}
                className="rounded-[1.8rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/52">
                      {subscription.seller_slug || subscription.seller_id}
                    </p>
                    <h3 className="text-lg font-semibold text-foreground">
                      {subscription.seller_display_name || "Unknown seller"}
                    </h3>
                  </div>
                  <span className="rounded-full border border-border/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/72">
                    {subscription.is_active ? "Active" : "Ended"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {subscription.tier_name || subscription.tier_code || subscription.tier_id}
                  </p>
                  <p className="text-foreground/68">
                    {formatCurrency(subscription.monthly_price_cents, "USD")}/mo
                  </p>
                </div>
                <p className="mt-2 text-xs text-foreground/60">
                  Started {subscription.started_at ? new Date(subscription.started_at).toLocaleString() : "Not available"}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
