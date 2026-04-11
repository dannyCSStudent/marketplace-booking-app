"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  createApiClient,
  type NotificationDelivery,
  type ReviewAnomalyRead,
  type ReviewAnomalySellerSummaryRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type SeverityFilter = "all" | "high" | "medium" | "monitor";
type DeliveryFilter = "all" | "queued" | "sent" | "failed";
type AnomalyStateFilter = "active" | "acknowledged" | "all";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function toneClasses(level: string) {
  if (level === "high") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  if (level === "medium") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  return "border-border bg-surface text-foreground/68";
}

export function ReviewAnomaliesPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<ReviewAnomalyRead[]>([]);
  const [sellerSummaries, setSellerSummaries] = useState<ReviewAnomalySellerSummaryRead[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [stateFilter, setStateFilter] = useState<AnomalyStateFilter>("active");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const session = await restoreAdminSession();
        if (!session) {
          throw new Error("Admin session not available.");
        }

        const [anomalyRows, sellerSummaryRows, deliveryResponse] = await Promise.all([
          api.listReviewAnomalies(10, { accessToken: session.access_token }),
          api.listReviewAnomalySellerSummaries(4, { accessToken: session.access_token }),
          api.loadAdminNotificationDeliveries(session.access_token),
        ]);

        if (!cancelled) {
          setAnomalies(anomalyRows);
          setSellerSummaries(sellerSummaryRows);
          setDeliveries(
            deliveryResponse.deliveries.filter(
              (delivery) => delivery.payload?.alert_type === "review_anomaly",
            ),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load review anomalies.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const anomalyCounts = useMemo(
    () => ({
      total: anomalies.length,
      high: anomalies.filter((anomaly) => anomaly.severity === "high").length,
      medium: anomalies.filter((anomaly) => anomaly.severity === "medium").length,
      monitor: anomalies.filter((anomaly) => anomaly.severity === "monitor").length,
      hidden: anomalies.filter((anomaly) => anomaly.hidden_open_count > 0).length,
      escalated: anomalies.filter((anomaly) => anomaly.escalated_report_count > 0).length,
    }),
    [anomalies],
  );

  const deliveryCounts = useMemo(
    () => ({
      total: deliveries.length,
      queued: deliveries.filter((delivery) => delivery.delivery_status === "queued").length,
      sent: deliveries.filter((delivery) => delivery.delivery_status === "sent").length,
      failed: deliveries.filter((delivery) => delivery.delivery_status === "failed").length,
    }),
    [deliveries],
  );

  const groupedDeliveries = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        sellerId: string;
        deliveries: NotificationDelivery[];
      }
    >();

    deliveries.forEach((delivery) => {
      const payload = delivery.payload ?? {};
      const sellerId = String(payload.seller_id ?? "").trim();
      if (!sellerId) {
        return;
      }

      const sellerSlug = String(payload.seller_slug ?? "").trim();
      const sellerDisplayName = String(payload.seller_display_name ?? "Seller").trim();
      const key = sellerId;
      const existing = groups.get(key);
      if (existing) {
        existing.deliveries.push(delivery);
        return;
      }

      groups.set(key, {
        sellerDisplayName,
        sellerSlug,
        sellerId,
        deliveries: [delivery],
      });
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        deliveries: [...group.deliveries].sort(
          (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
        ),
      }))
      .sort(
        (left, right) =>
          right.deliveries.length - left.deliveries.length ||
          left.sellerDisplayName.localeCompare(right.sellerDisplayName),
      );
  }, [deliveries]);

  const latestNotificationBySeller = useMemo(() => {
    const map = new Map<string, NotificationDelivery>();

    deliveries.forEach((delivery) => {
      if (delivery.payload?.alert_type !== "review_anomaly") {
        return;
      }

      const sellerId = String(delivery.payload?.seller_id ?? "").trim();
      if (!sellerId || map.has(sellerId)) {
        return;
      }

      map.set(sellerId, delivery);
    });

    return map;
  }, [deliveries]);

  const acknowledgedAnomalies = useMemo(() => {
    const result: Record<string, string> = {};

    latestNotificationBySeller.forEach((delivery, sellerId) => {
      const payload = delivery.payload ?? {};
      const acknowledgedSignature = String(payload.acknowledged_signature ?? "").trim();
      if (acknowledgedSignature && acknowledgedSignature === String(payload.alert_signature ?? "").trim()) {
        result[sellerId] = acknowledgedSignature;
      }
    });

    return result;
  }, [latestNotificationBySeller]);

  const activeSellerSummaries = useMemo(
    () =>
      sellerSummaries.filter((summary) => {
        const delivery = latestNotificationBySeller.get(summary.seller_id);
        const acknowledgedSignature = acknowledgedAnomalies[summary.seller_id];
        const isAcknowledged =
          Boolean(delivery) && Boolean(acknowledgedSignature) && acknowledgedSignature === String(delivery?.payload?.alert_signature ?? "").trim();
        if (stateFilter === "active") {
          return !isAcknowledged;
        }
        if (stateFilter === "acknowledged") {
          return isAcknowledged;
        }
        return true;
      }),
    [acknowledgedAnomalies, latestNotificationBySeller, sellerSummaries, stateFilter],
  );

  const anomalyStateCounts = useMemo(
    () => ({
      total: sellerSummaries.length,
      active: sellerSummaries.filter((summary) => {
        const delivery = latestNotificationBySeller.get(summary.seller_id);
        const acknowledgedSignature = acknowledgedAnomalies[summary.seller_id];
        return !(delivery && acknowledgedSignature && acknowledgedSignature === String(delivery.payload?.alert_signature ?? "").trim());
      }).length,
      acknowledged: sellerSummaries.filter((summary) => {
        const delivery = latestNotificationBySeller.get(summary.seller_id);
        const acknowledgedSignature = acknowledgedAnomalies[summary.seller_id];
        return Boolean(delivery) && Boolean(acknowledgedSignature) && acknowledgedSignature === String(delivery.payload?.alert_signature ?? "").trim();
      }).length,
    }),
    [acknowledgedAnomalies, latestNotificationBySeller, sellerSummaries],
  );

  async function acknowledgeAnomaly(sellerId: string) {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available.");
    }

    const updatedDeliveries = await api.acknowledgeReviewAnomaly(sellerId, {
      accessToken: session.access_token,
    });

    setDeliveries((current) =>
      current.map((delivery) => {
        const next = updatedDeliveries.find((row) => row.id === delivery.id);
        return next ?? delivery;
      }),
    );
  }

  async function clearAnomalyAcknowledgement(sellerId: string) {
    const session = await restoreAdminSession();
    if (!session) {
      throw new Error("Admin session not available.");
    }

    const updatedDeliveries = await api.clearReviewAnomalyAcknowledgement(sellerId, {
      accessToken: session.access_token,
    });

    setDeliveries((current) =>
      current.map((delivery) => {
        const next = updatedDeliveries.find((row) => row.id === delivery.id);
        return next ?? delivery;
      }),
    );
  }

  const filteredAnomalies = useMemo(
    () =>
      anomalies.filter((anomaly) => {
        if (severityFilter !== "all" && anomaly.severity !== severityFilter) {
          return false;
        }
        return true;
      }),
    [anomalies, severityFilter],
  );

  const filteredDeliveries = useMemo(
    () =>
      deliveries.filter((delivery) => {
        if (deliveryFilter !== "all" && delivery.delivery_status !== deliveryFilter) {
          return false;
        }
        return true;
      }),
    [deliveryFilter, deliveries],
  );

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading review anomalies...
      </section>
    );
  }

  if (error) {
    return (
      <section className="card-shadow rounded-[2rem] border border-danger/30 bg-danger/8 p-6 text-sm text-danger">
        {error}
      </section>
    );
  }

  return (
    <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Review automation</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Review anomaly lane
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
            Sellers with clustered or bursty report pressure, plus the notification deliveries emitted when the anomaly state changes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {(
            [
              ["all", `All · ${anomalyStateCounts.total}`],
              ["active", `Active · ${anomalyStateCounts.active}`],
              ["acknowledged", `Acknowledged · ${anomalyStateCounts.acknowledged}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStateFilter(value as AnomalyStateFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                stateFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {(
            [
              ["all", `All severity · ${anomalyCounts.total}`],
              ["high", `High · ${anomalyCounts.high}`],
              ["medium", `Medium · ${anomalyCounts.medium}`],
              ["monitor", `Monitor · ${anomalyCounts.monitor}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeverityFilter(value as SeverityFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                severityFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total", anomalyCounts.total],
          ["High", anomalyCounts.high],
          ["Hidden open", anomalyCounts.hidden],
          ["Escalated", anomalyCounts.escalated],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-border bg-background/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Seller focus</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Highest-pressure sellers
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Backend summary of the sellers carrying the most anomaly pressure right now.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-foreground/56">
            Showing {activeSellerSummaries.length} of {sellerSummaries.length}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {activeSellerSummaries.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60 lg:col-span-2">
              No seller summaries match the current anomaly state.
            </div>
          ) : (
            activeSellerSummaries.map((summary) => (
              <article key={summary.seller_id} className="rounded-[1.25rem] border border-border bg-surface/75 p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${summary.seller_slug ?? summary.seller_id}`}
                      className="text-sm font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {summary.seller_display_name ?? summary.seller_slug ?? summary.seller_id}
                    </Link>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {summary.seller_slug ?? summary.seller_id}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(summary.severity)}`}>
                      {summary.severity}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${
                      acknowledgedAnomalies[summary.seller_id]
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                        : "border-border bg-background text-foreground/56"
                    }`}>
                      {acknowledgedAnomalies[summary.seller_id] ? "Acknowledged" : "Active"}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {summary.active_report_count} reports
                    </span>
                  </div>
                  <p className="text-sm leading-7 text-foreground/68">{summary.reasons.join(" · ")}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-foreground/56">
                    Latest report · {new Date(summary.latest_report_at).toLocaleString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/reviews?preset=needs_action&q=${encodeURIComponent(
                        summary.seller_slug ?? summary.seller_display_name ?? summary.seller_id,
                      )}`}
                      className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                    >
                      Open moderation lane
                    </Link>
                    <Link
                      href={`/admin/deliveries?q=${encodeURIComponent(summary.seller_slug ?? summary.seller_id)}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open delivery lane
                    </Link>
                    {acknowledgedAnomalies[summary.seller_id] ? (
                      <button
                        type="button"
                        onClick={() => void clearAnomalyAcknowledgement(summary.seller_id)}
                        className="rounded-full border border-border bg-white px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                      >
                        Clear acknowledgement
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void acknowledgeAnomaly(summary.seller_id)}
                        className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-border bg-background/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Anomaly queue</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Seller review anomalies
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Backend clusters ordered by severity and report pressure.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-foreground/56">
            Showing {filteredAnomalies.length} of {anomalies.length}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {filteredAnomalies.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60 lg:col-span-2">
              No review anomalies match the current severity filter.
            </div>
          ) : (
            filteredAnomalies.map((anomaly) => (
              <article
                key={anomaly.seller_id}
                className={`rounded-[1.25rem] border p-4 ${
                  anomaly.severity === "high"
                    ? "border-danger/30 bg-danger/8"
                    : anomaly.severity === "medium"
                      ? "border-amber-500/30 bg-amber-500/10"
                      : "border-border bg-surface/75"
                }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${anomaly.seller_slug ?? anomaly.seller_id}`}
                      className="text-sm font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {anomaly.seller_display_name ?? anomaly.seller_slug ?? anomaly.seller_id}
                    </Link>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {anomaly.seller_slug ?? anomaly.seller_id}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(anomaly.severity)}`}>
                      {anomaly.severity}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {anomaly.active_report_count} reports
                    </span>
                  </div>

                  <p className="text-sm leading-7 text-foreground/68">{anomaly.reasons.join(" · ")}</p>

                  <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-foreground/56">
                    <span className="rounded-full border border-border bg-background px-3 py-1">
                      Open · {anomaly.open_report_count}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1">
                      Escalated · {anomaly.escalated_report_count}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1">
                      Hidden open · {anomaly.hidden_open_count}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1">
                      Recent · {anomaly.recent_report_count}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/reviews?preset=needs_action&q=${encodeURIComponent(
                        anomaly.seller_slug ?? anomaly.seller_display_name ?? anomaly.seller_id,
                      )}`}
                      className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                    >
                      Open moderation lane
                    </Link>
                    <Link
                      href={`/admin/deliveries?preset=review_anomaly&q=${encodeURIComponent(
                        anomaly.seller_slug ?? anomaly.seller_id,
                      )}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open delivery lane
                    </Link>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-border bg-background/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Backend deliveries</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Review anomaly notifications
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Queued email and push notifications generated from anomaly detection.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-foreground/56">
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Total · {deliveryCounts.total}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Queued · {deliveryCounts.queued}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Sent · {deliveryCounts.sent}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Failed · {deliveryCounts.failed}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {(
            [
              ["all", `All · ${deliveryCounts.total}`],
              ["queued", `Queued · ${deliveryCounts.queued}`],
              ["sent", `Sent · ${deliveryCounts.sent}`],
              ["failed", `Failed · ${deliveryCounts.failed}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDeliveryFilter(value as DeliveryFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                deliveryFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {filteredDeliveries.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60">
              No anomaly deliveries match the current filter.
            </div>
          ) : (
            filteredDeliveries.slice(0, 8).map((delivery) => (
              <article key={delivery.id} className="rounded-[1.25rem] border border-border bg-surface/75 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {delivery.channel}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(delivery.delivery_status === "failed" ? "high" : delivery.delivery_status === "queued" ? "medium" : "monitor")}`}>
                        {delivery.delivery_status}
                      </span>
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {new Date(delivery.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {delivery.payload?.subject ?? "Review anomaly notification"}
                    </p>
                    <p className="text-sm leading-7 text-foreground/68">
                      {delivery.payload?.body ?? delivery.payload?.alert_type ?? "Backend review anomaly alert."}
                    </p>
                  </div>

                  <Link
                    href={`/admin/reviews?preset=needs_action&q=${encodeURIComponent(
                      String(delivery.payload?.seller_slug ?? delivery.payload?.seller_id ?? ""),
                    )}`}
                    className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                  >
                    Open review lane
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-border bg-background/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Grouped sellers</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Sellers carrying anomaly pressure
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Latest anomaly state by seller, ordered by alert volume.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-foreground/56">
            Showing {groupedDeliveries.length} of {filteredDeliveries.length}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {groupedDeliveries.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60 lg:col-span-2">
              No grouped anomaly deliveries match the current filter.
            </div>
          ) : (
            groupedDeliveries.map((group) => (
              <article key={group.sellerId} className="rounded-[1.25rem] border border-border bg-surface/75 p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${group.sellerSlug || group.sellerId}`}
                      className="text-sm font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {group.sellerDisplayName}
                    </Link>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.sellerSlug || group.sellerId}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.deliveries.length} deliveries
                    </span>
                  </div>

                  <p className="text-sm leading-7 text-foreground/68">
                    Latest · {group.deliveries[0]?.payload?.severity ?? "unknown"} ·{" "}
                    {group.deliveries[0]?.payload?.reasons?.join(" · ") ?? "Review anomaly"}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/reviews?preset=needs_action&q=${encodeURIComponent(group.sellerSlug || group.sellerId)}`}
                      className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                    >
                      Open moderation lane
                    </Link>
                    <Link
                      href={`/admin/deliveries?q=${encodeURIComponent(group.sellerSlug || group.sellerId)}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open deliveries
                    </Link>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
