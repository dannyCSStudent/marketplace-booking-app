"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, type ListingPricingScopeCount } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export default function PricingScopeSummarySection() {
  const [summary, setSummary] = useState<ListingPricingScopeCount[]>([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

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

  const total = useMemo(() => summary.reduce((sum, row) => sum + row.count, 0), [summary]);

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

    return summary.map((row) => {
      const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
      return (
        <div key={row.scope} className="rounded-2xl border border-border/50 bg-background px-4 py-3">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span className="uppercase tracking-[0.18em] text-foreground/68">{row.scope}</span>
            <span className="text-foreground">{row.count}</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-border/30">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
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
        <p className="text-xs text-foreground/56">
          {lastFetchedAt ?? new Date().toLocaleString()}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {renderedRows()}
      </div>
    </section>
  );
}
