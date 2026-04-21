"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createApiClient,
  formatCurrency,
  type DeliveryFeeHistoryPoint,
} from "@/app/lib/api";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const WINDOW_OPTIONS = [7, 14, 30] as const;
const DELIVERY_FEE_HISTORY_ACTIVITY_KEY = "admin.delivery-fee-history.recent-activity";
const DELIVERY_FEE_HISTORY_ACTIVITY_FILTER_KEY = "admin.delivery-fee-history.recent-activity-filter";
const MAX_RECENT_ACTIVITY_ENTRIES = 4;

type RecentActivityFilter = "all" | "window" | "export";

type DeliveryFeeHistoryRecentActivityEntry =
  | {
      id: string;
      kind: "window";
      label: string;
      detail: string;
      createdAt: string;
      windowDays: (typeof WINDOW_OPTIONS)[number];
    }
  | {
      id: string;
      kind: "export";
      label: string;
      detail: string;
      createdAt: string;
      windowDays: (typeof WINDOW_OPTIONS)[number];
    };

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }
  return normalized;
}

export default function DeliveryFeeHistory() {
  const [recentActivity, setRecentActivity] = useState<DeliveryFeeHistoryRecentActivityEntry[]>(
    () => {
      if (typeof window === "undefined") {
        return [];
      }

      try {
        const stored = window.sessionStorage.getItem(DELIVERY_FEE_HISTORY_ACTIVITY_KEY);
        if (!stored) {
          return [];
        }

        const parsed = JSON.parse(stored) as DeliveryFeeHistoryRecentActivityEntry[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        window.sessionStorage.removeItem(DELIVERY_FEE_HISTORY_ACTIVITY_KEY);
        return [];
      }
    },
  );
  const [recentActivityFilter, setRecentActivityFilter] = useState<RecentActivityFilter>(() => {
    if (typeof window === "undefined") {
      return "all";
    }

    const stored = window.sessionStorage.getItem(DELIVERY_FEE_HISTORY_ACTIVITY_FILTER_KEY);
    if (stored === "all" || stored === "window" || stored === "export") {
      return stored;
    }

    return "all";
  });
  const [history, setHistory] = useState<DeliveryFeeHistoryPoint[]>([]);
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(14);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      DELIVERY_FEE_HISTORY_ACTIVITY_KEY,
      JSON.stringify(recentActivity),
    );
  }, [recentActivity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      DELIVERY_FEE_HISTORY_ACTIVITY_FILTER_KEY,
      recentActivityFilter,
    );
  }, [recentActivityFilter]);

  const fetchHistory = async (days: number) => {
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
      const data = await api.listDeliveryFeeHistory(days, {
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
      await fetchHistory(windowDays);
    })();
  }, [windowDays]);

  const totalCollected = useMemo(
    () =>
      history.reduce(
        (sum, point) => sum + point.delivery_fee_cents + point.shipping_fee_cents,
        0,
      ),
    [history],
  );

  const recordRecentActivity = useCallback((entry: Omit<DeliveryFeeHistoryRecentActivityEntry, "id" | "createdAt">) => {
    setRecentActivity((current) =>
      [
        {
          ...entry,
          id: `${entry.kind}:${Date.now()}`,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, MAX_RECENT_ACTIVITY_ENTRIES),
    );
  }, []);

  const setWindowDaysWithActivity = (nextWindowDays: (typeof WINDOW_OPTIONS)[number]) => {
    recordRecentActivity({
      kind: "window",
      label: `${nextWindowDays}d delivery fees`,
      detail: `${history.length} history points`,
      windowDays: nextWindowDays,
    });
    setWindowDays(nextWindowDays);
  };

  const exportCsv = useCallback(() => {
    if (history.length === 0) {
      return;
    }
    const rows = history.map((point) => [
      point.date,
      (point.delivery_fee_cents / 100).toFixed(2),
      (point.shipping_fee_cents / 100).toFixed(2),
      ((point.delivery_fee_cents + point.shipping_fee_cents) / 100).toFixed(2),
    ]);
    const csv = [["date", "delivery_fees_usd", "shipping_fees_usd", "total_fees_usd"], ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `delivery-fee-history-${windowDays}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [history, windowDays]);

  const runExport = useCallback(() => {
    recordRecentActivity({
      kind: "export",
      label: `Exported ${history.length} fee points`,
      detail: `${windowDays}d · ${formatCurrency(totalCollected, "USD")}`,
      windowDays,
    });
    exportCsv();
  }, [exportCsv, history.length, recordRecentActivity, totalCollected, windowDays]);

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "delivery_fee_history") {
        return;
      }
      highlightMonetizationSection("delivery-fee-history-panel");
      runExport();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [runExport]);

  const renderBody = () => {
    if (!lastUpdated && !error && history.length === 0) {
      return <p className="text-sm text-foreground/66">Awaiting delivery fee history…</p>;
    }

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
    <section id="delivery-fee-history-panel" className="rounded-[2rem] border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Delivery fee history
          </p>
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
                onClick={() => setWindowDaysWithActivity(option)}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={runExport}
          >
            Export CSV
          </button>
          <div className="text-right text-sm text-foreground/66">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/50">Surcharges collected</p>
            <p className="text-lg font-semibold text-foreground">{formatCurrency(totalCollected, "USD")}</p>
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
      {recentActivity.length > 0 ? (
        <div className="mt-5 rounded-[1.8rem] border border-border/60 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                Recent Activity
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Re-open the last window you inspected or rerun the latest export.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
              onClick={() => {
                setRecentActivity([]);
                window.sessionStorage.removeItem(DELIVERY_FEE_HISTORY_ACTIVITY_KEY);
              }}
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["window", "Window"],
              ["export", "Export"],
            ] as const).map(([value, label]) => {
              const filteredCount = recentActivity.filter(
                (entry) => value === "all" || entry.kind === value,
              ).length;
              return (
                <button
                  key={value}
                  type="button"
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                    recentActivityFilter === value
                      ? "border-accent bg-accent text-white"
                      : "border-border text-foreground hover:border-accent hover:text-accent"
                  }`}
                  onClick={() => setRecentActivityFilter(value)}
                >
                  {label} ({filteredCount})
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-2">
            {recentActivity
              .filter((entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter)
              .map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border border-border bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-foreground/58">
                      {entry.kind === "window" ? "Window" : "Export"} · {entry.detail}
                    </p>
                  </div>
                  {entry.kind === "window" ? (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() => setWindowDaysWithActivity(entry.windowDays)}
                      type="button"
                    >
                      Re-open window
                    </button>
                  ) : (
                    <button
                      className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                      onClick={runExport}
                      type="button"
                    >
                      Re-export slice
                    </button>
                  )}
                </div>
              ))}
          </div>
          {recentActivity.filter((entry) => recentActivityFilter === "all" || entry.kind === recentActivityFilter).length === 0 ? (
            <div className="mt-4 rounded-[1.1rem] border border-dashed border-border bg-white/55 px-4 py-4 text-sm leading-6 text-foreground/66">
              {recentActivityFilter === "all"
                ? "No recent delivery fee activity yet."
                : `No ${recentActivityFilter} activity has been recorded in this session yet.`}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4">{renderBody()}</div>
    </section>
  );
}
