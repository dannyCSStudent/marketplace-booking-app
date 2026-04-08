"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type DeliveryFeeHistoryPoint,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const HISTORY_DAYS = 14;

export default function DeliveryFeeHistory() {
  const [history, setHistory] = useState<DeliveryFeeHistoryPoint[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchHistory = async () => {
    setStatus("loading");
    setError(null);

    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to view delivery fee history.");
        return;
      }

      const api = createApiClient(CLIENT_API_BASE_URL);
      const data = await api.listDeliveryFeeHistory(HISTORY_DAYS, {
        accessToken: session.access_token,
      });
      setHistory(data);
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load delivery fee history.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchHistory();
    })();
  }, []);

  const totalCollected = useMemo(
    () =>
      history.reduce(
        (sum, point) => sum + point.delivery_fee_cents + point.shipping_fee_cents,
        0,
      ),
    [history],
  );

  const renderBody = () => {
    if (status === "loading") {
      return <p className="text-sm text-foreground/66">Loading delivery fee history…</p>;
    }

    if (error) {
      return <p className="text-sm text-rose-600">{error}</p>;
    }

    if (history.length === 0) {
      return <p className="text-sm text-foreground/66">No delivery fee activity recorded yet.</p>;
    }

    return (
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="no-scrollbar max-h-60 overflow-y-auto">
          <table className="w-full border-collapse text-xs text-foreground">
            <thead className="text-foreground/60">
              <tr>
                <th className="border-b border-border/60 px-3 py-2 text-left font-normal uppercase tracking-[0.15em]">
                  Date
                </th>
                <th className="border-b border-border/60 px-3 py-2 text-right font-normal uppercase tracking-[0.15em]">
                  Delivery
                </th>
                <th className="border-b border-border/60 px-3 py-2 text-right font-normal uppercase tracking-[0.15em]">
                  Shipping
                </th>
                <th className="border-b border-border/60 px-3 py-2 text-right font-normal uppercase tracking-[0.15em]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((point) => (
                <tr key={point.date} className="odd:bg-background/80">
                  <td className="border-b border-border/60 px-3 py-2 text-left font-semibold text-foreground">
                    {point.date}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-right text-foreground/70">
                    {formatCurrency(point.delivery_fee_cents, "USD")}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-right text-foreground/70">
                    {formatCurrency(point.shipping_fee_cents, "USD")}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-right font-semibold text-foreground">
                    {formatCurrency(point.delivery_fee_cents + point.shipping_fee_cents, "USD")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-[2rem] border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Delivery fee history
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Last {HISTORY_DAYS} days</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting fee data…"}
          </p>
        </div>
        <div className="text-right text-sm text-foreground/66">
          <p className="text-xs uppercase tracking-[0.18em] text-foreground/50">Surcharges collected</p>
          <p className="text-lg font-semibold text-foreground">{formatCurrency(totalCollected, "USD")}</p>
          <button
            type="button"
            disabled={status === "loading"}
            className="mt-2 rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
            onClick={() => {
              if (status !== "loading") {
                void fetchHistory();
              }
            }}
          >
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="mt-4">{renderBody()}</div>
    </section>
  );
}
