"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, formatCurrency } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export default function PlatformFeeSummary() {
  const [totalOrderFees, setTotalOrderFees] = useState(0);
  const [totalBookingFees, setTotalBookingFees] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
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
            setStatus("error");
            setError("Sign in as an admin to view revenue stats.");
          }
          return;
        }

        const api = createApiClient(CLIENT_API_BASE_URL);
        const data = await api.loadAdminTransactions(session.access_token);
        if (cancelled) {
          return;
        }

        setTotalOrderFees(data.orders.reduce((sum, order) => sum + (order.platform_fee_cents ?? 0), 0));
        setTotalBookingFees(data.bookings.reduce((sum, booking) => sum + (booking.platform_fee_cents ?? 0), 0));
        setLastFetchedAt(new Date().toLocaleString());
        setStatus("idle");
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(caught instanceof ApiError ? caught.message : "Unable to load platform fee totals.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalRevenue = useMemo(() => totalOrderFees + totalBookingFees, [totalOrderFees, totalBookingFees]);

  return (
    <section className="rounded-4xl border border-border bg-surface-strong p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Platform fee revenue</p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">{formatCurrency(totalRevenue, "USD")}</h2>
          <p className="text-xs text-foreground/56">{lastFetchedAt ?? "Awaiting latest totals…"}</p>
        </div>
        <div className="space-y-2 text-sm text-foreground/72">
          <p>Orders collected: {formatCurrency(totalOrderFees, "USD")}</p>
          <p>Bookings collected: {formatCurrency(totalBookingFees, "USD")}</p>
        </div>
      </div>
      {status === "loading" ? (
        <p className="mt-4 text-sm text-foreground/66">Loading latest totals…</p>
      ) : status === "error" ? (
        <p className="mt-4 text-sm text-rose-600">{error}</p>
      ) : null}
    </section>
  );
}
