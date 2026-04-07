"use client";

import { useEffect, useState } from "react";

import { ApiError, createApiClient, type ListingPromotionEvent } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const MAX_EVENTS = 12;

type Signal = {
  cancelled: boolean;
};

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatPlatformFee(rate: string) {
  const numeric = Number(rate);
  if (Number.isNaN(numeric)) {
    return rate;
  }

  return `${(numeric * 100).toFixed(2)}%`;
}

function truncateId(value: string) {
  if (!value) {
    return "";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function PromotionEventsPanel() {
  const [events, setEvents] = useState<ListingPromotionEvent[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  const fetchEvents = async (signal: Signal) => {
    if (signal.cancelled) {
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const session = await restoreAdminSession();
      if (!session) {
        if (signal.cancelled) {
          return;
        }
        setStatus("error");
        setError("Sign in as an admin to review promotion events.");
        return;
      }

      const api = createApiClient(CLIENT_API_BASE_URL);
      const data = await api.listPromotionEvents({ accessToken: session.access_token });

      if (signal.cancelled) {
        return;
      }

      setEvents(data.slice(0, MAX_EVENTS));
      setLastFetchedAt(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      if (signal.cancelled) {
        return;
      }
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load promotion events.");
    }
  };

  useEffect(() => {
    const signal: Signal = { cancelled: false };
    void (async () => {
      await Promise.resolve();
      await fetchEvents(signal);
    })();
    return () => {
      signal.cancelled = true;
    };
  }, []);

  const handleRefresh = () => {
    if (status === "loading") {
      return;
    }
    const signal: Signal = { cancelled: false };
    void fetchEvents(signal);
  };

  const renderBody = () => {
    if (status === "loading") {
      return <p className="text-sm text-foreground/66">Loading promotion events…</p>;
    }

    if (error) {
      return <p className="text-sm text-rose-600">{error}</p>;
    }

    if (events.length === 0) {
      return <p className="text-sm text-foreground/66">No promotion activity has been recorded yet.</p>;
    }

    return (
      <ul className="space-y-3">
        {events.map((event) => {
          const actionLabel = event.promoted ? "Promotion added" : "Promotion removed";
          const badgeColor = event.promoted ? "bg-[#d9f2ff] text-[#00577f]" : "bg-[#ffe5e5] text-[#a12d2d]";
          return (
            <li
              key={event.id}
              className="flex flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-background px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{actionLabel}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-foreground/60">
                  <span className="rounded-full border border-border/60 bg-[#f9f9f9] px-2 py-1">
                    Listing {truncateId(event.listing_id)}
                  </span>
                  <span className="rounded-full border border-border/60 bg-[#f9f9f9] px-2 py-1">
                    Seller {truncateId(event.seller_id)}
                  </span>rounded-[2rem]
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 text-xs text-foreground/70 sm:items-end">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${badgeColor}`}>
                  <span>{event.promoted ? "Promoted" : "Removed"}</span>
                </span>
                <p className="text-[11px] text-foreground/60">{formatPlatformFee(event.platform_fee_rate)} platform fee</p>
                <p className="text-[11px] text-foreground/50">{formatTimestamp(event.created_at)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Promotion events</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Recent promotion history</h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground/56">
          <p>{lastFetchedAt ? `Last updated ${lastFetchedAt}` : "No data yet"}</p>
          <button
            type="button"
            disabled={status === "loading"}
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
            onClick={handleRefresh}
          >
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="mt-4 space-y-3">{renderBody()}</div>
    </section>
  );
}
