"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, type ListingPromotionSummary } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type PromotionBucket = { label: string; count: number };

export default function PromotionHeatmap() {
  const [buckets, setBuckets] = useState<PromotionBucket[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

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
            setError("Sign in as an admin to view promotion heatmap.");
          }
          return;
        }

        const api = createApiClient(CLIENT_API_BASE_URL);
        const summary = await api.listPromotionSummary({ accessToken: session.access_token });
        if (cancelled) {
          return;
        }

        const formatted = summary
          .map((entry: ListingPromotionSummary) => ({ label: entry.type.toUpperCase(), count: entry.count }))
          .sort((left, right) => right.count - left.count);

        setBuckets(formatted);
        setStatus("idle");
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(caught instanceof ApiError ? caught.message : "Unable to load promotion heatmap.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const grandTotal = useMemo(() => buckets.reduce((sum, bucket) => sum + bucket.count, 0), [buckets]);

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Promotion heatmap</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Promoted inventory by type</h2>
        </div>
        <p className="text-xs text-foreground/56">{grandTotal} boosted listings</p>
      </div>
      <div className="mt-4 space-y-3">
        {status === "error" ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : buckets.length === 0 ? (
          <p className="text-sm text-foreground/66">No promoted listings yet.</p>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.label} className="flex items-center justify-between text-sm uppercase tracking-[0.18em]">
              <span className="text-foreground/60">{bucket.label}</span>
              <span className="font-semibold text-foreground">{bucket.count}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
