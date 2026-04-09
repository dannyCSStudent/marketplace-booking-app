"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type SellerLookupRead,
} from "@/app/lib/api";
import {
  SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT,
  type SubscriptionAssignmentFocusDetail,
} from "@/app/admin/monetization/subscription-assignment-focus";
import { restoreAdminSession } from "@/app/lib/admin-auth";
import { scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { useSubscriptionAnalytics } from "@/app/admin/monetization/subscription-analytics-context";
import { buildSubscriptionPlanDiff } from "@/app/admin/monetization/subscription-analytics-helpers";
import { SUBSCRIPTION_ASSIGNMENT_REASON_OPTIONS } from "@/app/admin/monetization/subscription-formatting";

function formatSellerLocation(location: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}) {
  return [location.city, location.state, location.country].filter(Boolean).join(", ");
}

export default function SellerSubscriptionsPanel() {
  const [sellerResults, setSellerResults] = useState<SellerLookupRead[]>([]);
  const [destructiveChangeConfirmed, setDestructiveChangeConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { preferences, setSubscriptionAssignmentDraft } = useMonetizationPreferences();
  const { tiers, subscriptions, status, error, lastUpdated, refresh, assignSubscription } =
    useSubscriptionAnalytics();
  const { sellerSlug, selectedTierId, reasonCode, note } = preferences.subscriptionAssignmentDraft;
  const api = useMemo(() => createApiClient(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000"), []);
  const fallbackSellerOptions = useMemo(() => {
    const uniqueSellers = new Map<
      string,
      { slug: string; displayName: string; tierLabel: string; monthlyPriceCents: number }
    >();

    subscriptions.forEach((subscription) => {
      const slug = subscription.seller_slug?.trim().toLowerCase();
      if (!slug || uniqueSellers.has(slug)) {
        return;
      }
      uniqueSellers.set(slug, {
        slug,
        displayName: subscription.seller_display_name || slug,
        tierLabel: subscription.tier_name || subscription.tier_code || "No tier",
        monthlyPriceCents: subscription.monthly_price_cents ?? 0,
      });
    });

    return [...uniqueSellers.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  }, [subscriptions]);
  const sellerSuggestions = useMemo(() => {
    if (sellerResults.length > 0) {
      return sellerResults.map((seller) => ({
        slug: seller.slug,
        displayName: seller.display_name,
        tierLabel: seller.is_verified ? "Verified seller" : "Seller",
        monthlyPriceCents: 0,
        location: [seller.city, seller.state].filter(Boolean).join(", "),
      }));
    }

    const normalizedQuery = sellerSlug.trim().toLowerCase();
    if (!normalizedQuery) {
      return fallbackSellerOptions.slice(0, 6).map((seller) => ({ ...seller, location: "" }));
    }

    return fallbackSellerOptions
      .filter(
        (seller) =>
          seller.slug.includes(normalizedQuery) ||
          seller.displayName.toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 6)
      .map((seller) => ({ ...seller, location: "" }));
  }, [fallbackSellerOptions, sellerResults, sellerSlug]);
  const selectedSellerResult = useMemo(
    () =>
      sellerResults.find((seller) => seller.slug.toLowerCase() === sellerSlug.trim().toLowerCase()) ??
      null,
    [sellerResults, sellerSlug],
  );
  const normalizedSellerSlug = sellerSlug.trim().toLowerCase();
  const selectedTier = useMemo(
    () => tiers.find((tier) => (tier.id ?? "") === selectedTierId) ?? null,
    [selectedTierId, tiers],
  );
  const currentSellerSubscription = useMemo(
    () =>
      subscriptions.find(
        (subscription) =>
          subscription.is_active &&
          (subscription.seller_slug?.trim().toLowerCase() ?? "") === normalizedSellerSlug,
      ) ?? null,
    [normalizedSellerSlug, subscriptions],
  );
  const isRedundantAssignment = Boolean(
    currentSellerSubscription &&
      selectedTier &&
      currentSellerSubscription.tier_id === (selectedTier.id ?? ""),
  );
  const planDiff = useMemo(() => {
    return buildSubscriptionPlanDiff(currentSellerSubscription, selectedTier);
  }, [currentSellerSubscription, selectedTier]);
  const requiresDestructiveConfirmation = Boolean(
    currentSellerSubscription &&
      selectedTier &&
      !isRedundantAssignment &&
      planDiff &&
      (planDiff.priceDeltaCents < 0 || planDiff.lostPerks.length > 0),
  );

  useEffect(() => {
    if (!selectedTierId && tiers[0]?.id) {
      setSubscriptionAssignmentDraft((current) => ({
        ...current,
        selectedTierId: tiers[0]?.id ?? "",
      }));
    }
  }, [selectedTierId, setSubscriptionAssignmentDraft, tiers]);

  useEffect(() => {
    let cancelled = false;
    const normalizedQuery = sellerSlug.trim();

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const session = await restoreAdminSession();
          if (!session) {
            if (!cancelled) {
              setSellerResults([]);
            }
            return;
          }
          const rows = await api.listAdminSellers(normalizedQuery || undefined, 8, {
            accessToken: session.access_token,
          });
          if (!cancelled) {
            setSellerResults(rows);
          }
        } catch {
          if (!cancelled) {
            setSellerResults([]);
          }
        }
      })();
    }, normalizedQuery ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [api, sellerSlug]);

  useEffect(() => {
    const handleFocusEvent = (event: Event) => {
      const detail = (event as CustomEvent<SubscriptionAssignmentFocusDetail>).detail;
      if (!detail) {
        return;
      }
      if (detail.sellerSlug) {
        setSubscriptionAssignmentDraft((current) => ({
          ...current,
          sellerSlug: detail.sellerSlug ?? current.sellerSlug,
        }));
      }
      if (detail.tierId) {
        setSubscriptionAssignmentDraft((current) => ({
          ...current,
          selectedTierId: detail.tierId ?? current.selectedTierId,
        }));
      } else if (detail.tierName) {
        const matchedTier = tiers.find(
          (tier) => (tier.name || "").toLowerCase() === detail.tierName?.toLowerCase(),
        );
        if (matchedTier?.id) {
          setSubscriptionAssignmentDraft((current) => ({
            ...current,
            selectedTierId: matchedTier.id ?? current.selectedTierId,
          }));
        }
      }
      if (detail.reasonCode) {
        setSubscriptionAssignmentDraft((current) => ({
          ...current,
          reasonCode: detail.reasonCode ?? current.reasonCode,
        }));
      }
      scrollToMonetizationSection("seller-subscriptions-panel");
    };

    window.addEventListener(SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT, handleFocusEvent);
    return () => {
      window.removeEventListener(SUBSCRIPTION_ASSIGNMENT_FOCUS_EVENT, handleFocusEvent);
    };
  }, [setSubscriptionAssignmentDraft, tiers]);

  useEffect(() => {
    setDestructiveChangeConfirmed(false);
  }, [normalizedSellerSlug, selectedTierId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setMessage(null);
      if (!normalizedSellerSlug || !selectedTierId) {
        setMessage("Enter a seller slug and choose a tier.");
        return;
      }
      if (isRedundantAssignment) {
        setMessage("This seller is already on the selected tier.");
        return;
      }
      if (requiresDestructiveConfirmation && !destructiveChangeConfirmed) {
        setMessage("Confirm the downgrade or perk removal before assigning this tier.");
        return;
      }

      try {
        const session = await restoreAdminSession();
        if (!session) {
          setMessage("Sign in as an admin to assign subscriptions.");
          return;
        }

        await assignSubscription(
          {
            seller_slug: normalizedSellerSlug,
            tier_id: selectedTierId,
            reason_code: reasonCode,
            note: note.trim() || null,
          },
        );
        setSubscriptionAssignmentDraft((current) => ({
          ...current,
          sellerSlug: "",
          reasonCode: "manual_upgrade",
          note: "",
        }));
        setMessage("Seller subscription updated.");
      } catch (caught) {
        setMessage(caught instanceof ApiError ? caught.message : "Unable to assign seller subscription.");
      }
    });
  };

  return (
    <section id="seller-subscriptions-panel" className="rounded-4xl border border-border bg-white p-6">
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
              void refresh();
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
              list="seller-subscription-suggestions"
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={sellerSlug}
              onChange={(event) =>
                setSubscriptionAssignmentDraft((current) => ({
                  ...current,
                  sellerSlug: event.target.value,
                }))
              }
              placeholder="south-dallas-tamales"
            />
            <datalist id="seller-subscription-suggestions">
              {sellerSuggestions.map((seller) => (
                <option key={seller.slug} value={seller.slug}>
                  {seller.displayName}
                </option>
              ))}
            </datalist>
            <p className="mt-2 text-xs text-foreground/56">
              Search by seller slug or use a recent active seller below.
            </p>
            {selectedSellerResult ? (
              <div className="mt-3 rounded-[1.4rem] border border-foreground/12 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedSellerResult.display_name}</p>
                    <p className="text-xs text-foreground/60">@{selectedSellerResult.slug}</p>
                  </div>
                  <span className="rounded-full border border-border/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/72">
                    {selectedSellerResult.is_verified ? "Verified" : "Seller"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-foreground/60">
                  {formatSellerLocation(selectedSellerResult) || "Location not set"}
                </p>
                {currentSellerSubscription ? (
                  <div className="mt-3 rounded-[1rem] border border-border/60 bg-background px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/56">
                      Current subscription
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-foreground">
                        {currentSellerSubscription.tier_name ||
                          currentSellerSubscription.tier_code ||
                          currentSellerSubscription.tier_id}
                      </span>
                      <span className="text-foreground/68">
                        {formatCurrency(currentSellerSubscription.monthly_price_cents, "USD")}/mo
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-foreground/60">
                      Started{" "}
                      {currentSellerSubscription.started_at
                        ? new Date(currentSellerSubscription.started_at).toLocaleString()
                        : "Not available"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-foreground/60">No active subscription on record.</p>
                )}
              </div>
            ) : null}
            {sellerSuggestions.length > 0 ? (
              <div className="mt-3 space-y-2">
                {sellerSuggestions.map((seller) => (
                  <button
                    key={seller.slug}
                    type="button"
                    className={`flex w-full items-start justify-between gap-3 rounded-[1.2rem] border px-4 py-3 text-left transition ${
                      seller.slug === sellerSlug.trim().toLowerCase()
                        ? "border-foreground/40 bg-white"
                        : "border-border/60 bg-white hover:border-foreground/40"
                    }`}
                    onClick={() =>
                      setSubscriptionAssignmentDraft((current) => ({
                        ...current,
                        sellerSlug: seller.slug,
                      }))
                    }
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{seller.displayName}</p>
                      <p className="mt-1 text-xs text-foreground/60">@{seller.slug}</p>
                      <p className="mt-1 text-xs text-foreground/56">
                        {seller.location || "Location not set"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/62">
                        {seller.tierLabel}
                      </p>
                      {seller.monthlyPriceCents > 0 ? (
                        <p className="mt-1 text-xs text-foreground/60">
                          {formatCurrency(seller.monthlyPriceCents, "USD")}/mo
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">Tier</label>
            <select
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-foreground"
              value={selectedTierId}
              onChange={(event) =>
                setSubscriptionAssignmentDraft((current) => ({
                  ...current,
                  selectedTierId: event.target.value,
                }))
              }
            >
              <option value="">Select a tier</option>
              {tiers.map((tier) => (
                <option key={tier.id ?? tier.code} value={tier.id ?? ""}>
                  {tier.name} ({formatCurrency(tier.monthly_price_cents, "USD")}/mo)
                </option>
              ))}
            </select>
          </div>
          {currentSellerSubscription && selectedTier ? (
            <div
              className={`rounded-[1.2rem] border px-4 py-3 text-sm ${
                isRedundantAssignment
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-border/60 bg-white text-foreground/72"
              }`}
            >
              <p className="font-semibold">
                {isRedundantAssignment
                  ? "Selected tier matches the seller's current plan."
                  : "Selected tier will replace the seller's current plan."}
              </p>
              <p className="mt-1 text-xs">
                Current:{" "}
                {currentSellerSubscription.tier_name ||
                  currentSellerSubscription.tier_code ||
                  currentSellerSubscription.tier_id}
                {" -> "}
                {selectedTier.name || selectedTier.code || selectedTier.id}
              </p>
              {planDiff ? (
                <div className="mt-3 space-y-2 text-xs">
                  <p>
                    Price delta:{" "}
                    {planDiff.priceDeltaCents === 0
                      ? "No monthly price change"
                      : `${planDiff.priceDeltaCents > 0 ? "+" : "-"}${formatCurrency(
                          Math.abs(planDiff.priceDeltaCents),
                          "USD",
                        )}/mo`}
                  </p>
                  {planDiff.gainedPerks.length > 0 ? (
                    <p>Gains: {planDiff.gainedPerks.join(", ")}</p>
                  ) : null}
                  {planDiff.lostPerks.length > 0 ? (
                    <p>Loses: {planDiff.lostPerks.join(", ")}</p>
                  ) : null}
                  {planDiff.gainedPerks.length === 0 && planDiff.lostPerks.length === 0 ? (
                    <p>
                      Capability set stays the same
                      {planDiff.unchangedPerks.length > 0
                        ? `: ${planDiff.unchangedPerks.join(", ")}`
                        : "."}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {requiresDestructiveConfirmation ? (
            <label className="flex items-start gap-3 rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-rose-300"
                checked={destructiveChangeConfirmed}
                onChange={(event) => setDestructiveChangeConfirmed(event.target.checked)}
              />
              <span>
                <span className="block font-semibold">Confirm destructive change</span>
                <span className="mt-1 block text-xs text-rose-800/80">
                  This assignment reduces monthly value or removes seller perks. Confirm before applying it.
                </span>
              </span>
            </label>
          ) : null}
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
                setSubscriptionAssignmentDraft((current) => ({
                  ...current,
                  reasonCode:
                    event.target.value as (typeof SUBSCRIPTION_ASSIGNMENT_REASON_OPTIONS)[number]["value"],
                }))
              }
            >
              {SUBSCRIPTION_ASSIGNMENT_REASON_OPTIONS.map((option) => (
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
              onChange={(event) =>
                setSubscriptionAssignmentDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              placeholder="Reason for upgrade, downgrade, or reactivation"
            />
          </div>
          <button
            type="submit"
            disabled={
              isPending ||
              tiers.length === 0 ||
              isRedundantAssignment ||
              (requiresDestructiveConfirmation && !destructiveChangeConfirmed)
            }
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
