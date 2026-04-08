"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  type SellerSubscriptionRead,
  type SellerSubscriptionEventRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type Status = "idle" | "loading" | "error";
type ChangeDirection = SellerSubscriptionEventRead["action"];
type ChangeReason = SellerSubscriptionEventRead["reason_code"];

function getDirectionBadgeClass(direction: ChangeDirection) {
  if (direction === "upgrade") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (direction === "downgrade") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }
  if (direction === "reactivated") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (direction === "lateral") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border border-border bg-white text-foreground/62";
}

function formatDirectionLabel(direction: ChangeDirection) {
  if (direction === "upgrade") {
    return "Upgrade";
  }
  if (direction === "downgrade") {
    return "Downgrade";
  }
  if (direction === "reactivated") {
    return "Reactivated";
  }
  if (direction === "lateral") {
    return "Lateral move";
  }
  return "Started";
}

function formatReasonLabel(reason: ChangeReason) {
  if (reason === "trial_conversion") {
    return "Trial conversion";
  }
  if (reason === "manual_upgrade") {
    return "Manual upgrade";
  }
  if (reason === "retention_save") {
    return "Retention save";
  }
  if (reason === "support_adjustment") {
    return "Support adjustment";
  }
  if (reason === "plan_reset") {
    return "Plan reset";
  }
  return "Unspecified";
}

export default function SubscriptionHistoryPanel() {
  const [subscriptions, setSubscriptions] = useState<SellerSubscriptionRead[]>([]);
  const [events, setEvents] = useState<SellerSubscriptionEventRead[]>([]);
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
        setError("Sign in as an admin to view subscription history.");
        return;
      }

      const [eventRows, subscriptionRows] = await Promise.all([
        api.listSellerSubscriptionEvents({ accessToken: session.access_token }),
        api.listSellerSubscriptions({ accessToken: session.access_token }),
      ]);
      setEvents(eventRows);
      setSubscriptions(subscriptionRows);
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load subscription history.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchData();
    })();
  }, []);

  const summary = useMemo(() => {
    const endedThisWeek = subscriptions.filter((subscription) => {
      if (!subscription.ended_at) {
        return false;
      }
      const endedAt = new Date(subscription.ended_at).getTime();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return endedAt >= weekAgo;
    }).length;

    const startedThisWeek = events.filter((event) => {
      if (event.action !== "started" && event.action !== "reactivated") {
        return false;
      }
      const startedAt = new Date(event.created_at ?? "").getTime();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return startedAt >= weekAgo;
    }).length;

    const upgradesThisWeek = events.filter(
      (event) =>
        event.action === "upgrade" &&
        new Date(event.created_at ?? "").getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).length;
    const downgradesThisWeek = events.filter(
      (event) =>
        event.action === "downgrade" &&
        new Date(event.created_at ?? "").getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).length;

    return {
      endedThisWeek,
      startedThisWeek,
      upgradesThisWeek,
      downgradesThisWeek,
      recentChanges: events,
    };
  }, [events, subscriptions]);

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Seller subscriptions
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Recent subscription changes</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting subscription history…"}
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
        <HistoryStat label="Started in last 7d" value={String(summary.startedThisWeek)} />
        <HistoryStat label="Ended in last 7d" value={String(summary.endedThisWeek)} />
        <HistoryStat label="Upgrades in last 7d" value={String(summary.upgradesThisWeek)} />
        <HistoryStat label="Downgrades in last 7d" value={String(summary.downgradesThisWeek)} />
      </div>

      <div className="mt-5 space-y-3">
        {summary.recentChanges.length === 0 ? (
          <p className="text-sm text-foreground/66">
            {status === "loading" ? "Loading history…" : "No subscription changes yet."}
          </p>
        ) : (
          summary.recentChanges.slice(0, 12).map((event) => (
            <div
              key={event.id ?? `${event.seller_id}-${event.to_tier_id}-${event.created_at ?? "row"}`}
              className="rounded-[1.6rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/52">
                    {event.seller_slug || event.seller_id}
                  </p>
                  <h3 className="text-lg font-semibold text-foreground">
                    {event.seller_display_name || "Unknown seller"}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${getDirectionBadgeClass(event.action)}`}
                  >
                    {formatDirectionLabel(event.action)}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-foreground/72">
                <p className="font-semibold text-foreground">
                  {event.to_tier_name || event.to_tier_code || event.to_tier_id}
                </p>
                <p>{event.from_tier_name ? `${event.from_tier_name} -> ` : ""}{event.to_tier_name || event.to_tier_code || event.to_tier_id}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-foreground/60">
                <span>
                  Recorded {event.created_at ? new Date(event.created_at).toLocaleString() : "Not available"}
                </span>
                <span>Reason {formatReasonLabel(event.reason_code)}</span>
                <span>Actor {event.actor_name || event.actor_user_id}</span>
                {event.note ? <span>{event.note}</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border border-border/60 bg-background px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
    </div>
  );
}
