"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, createApiClient, formatCurrency, type PlatformFeeHistoryPoint } from "@/app/lib/api";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const WINDOW_OPTIONS = [7, 14, 30] as const;

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }
  return normalized;
}

export default function PlatformFeeHistory() {
  const [history, setHistory] = useState<PlatformFeeHistoryPoint[]>([]);
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(14);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchHistory = async (days: number) => {
    await Promise.resolve();
    setStatus("loading");
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to view fee history.");
        return;
      }

      const api = createApiClient(CLIENT_API_BASE_URL);
      const data = await api.listPlatformFeeHistory(days, { accessToken: session.access_token });
      setHistory(data);
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load fee history.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchHistory(windowDays);
    })();
  }, [windowDays]);

  const totalRevenue = useMemo(
    () => history.reduce((sum, point) => sum + (point.order_fee_cents + point.booking_fee_cents), 0),
    [history],
  );

  const exportCsv = useCallback(() => {
    if (history.length === 0) {
      return;
    }
    const rows = history.map((point) => [
      point.date,
      (point.order_fee_cents / 100).toFixed(2),
      (point.booking_fee_cents / 100).toFixed(2),
      ((point.order_fee_cents + point.booking_fee_cents) / 100).toFixed(2),
    ]);
    const csv = [["date", "order_fees_usd", "booking_fees_usd", "total_fees_usd"], ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `platform-fee-history-${windowDays}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [history, windowDays]);

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "platform_fee_history") {
        return;
      }
      highlightMonetizationSection("platform-fee-history-panel");
      exportCsv();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [exportCsv]);

  const renderBody = () => {
    if (!lastUpdated && !error && history.length === 0) {
      return <p className="text-sm text-foreground/66">Awaiting fee history…</p>;
    }

    if (status === "loading") {
      return <p className="text-sm text-foreground/66">Loading fee history…</p>;
    }

    if (error) {
      return <p className="text-sm text-rose-600">{error}</p>;
    }

    if (history.length === 0) {
      return <p className="text-sm text-foreground/66">No fee activity recorded yet.</p>;
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
                  Orders
                </th>
                <th className="border-b border-border/60 px-3 py-2 text-right font-normal uppercase tracking-[0.15em]">
                  Bookings
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
                    {formatCurrency(point.order_fee_cents, "USD")}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-right text-foreground/70">
                    {formatCurrency(point.booking_fee_cents, "USD")}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-right font-semibold text-foreground">
                    {formatCurrency(point.order_fee_cents + point.booking_fee_cents, "USD")}
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
    <section id="platform-fee-history-panel" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Platform fee history</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Last {windowDays} days</h2>
          <p className="text-xs text-foreground/56">
            {lastUpdated ? `Last updated ${lastUpdated}` : "Awaiting fee data…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-border bg-background p-1">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                  windowDays === option
                    ? "bg-foreground text-background"
                    : "text-foreground/66 hover:text-foreground"
                }`}
                onClick={() => setWindowDays(option)}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={exportCsv}
          >
            Export CSV
          </button>
          <div className="text-right text-sm text-foreground/66">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/50">Revenue total</p>
            <p className="text-lg font-semibold text-foreground">{formatCurrency(totalRevenue, "USD")}</p>
            <button
              type="button"
              disabled={status === "loading"}
              className="mt-2 rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90 disabled:border-border/30 disabled:text-foreground/40"
              onClick={() => {
                if (status !== "loading") {
                  void fetchHistory(windowDays);
                }
              }}
            >
              {status === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-4">{renderBody()}</div>
    </section>
  );
}
