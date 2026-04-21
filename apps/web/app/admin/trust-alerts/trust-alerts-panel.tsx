"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createApiClient,
  type NotificationDelivery,
  type TrustAlertEventRead,
  type TrustAlertSellerSummaryRead,
  type SellerTrustIntervention,
} from "@/app/lib/api";
import { restoreAdminSession, type AdminSession } from "@/app/lib/admin-auth";

type TrustRiskFilter = "all" | "critical" | "elevated";
type TrustTrendFilter = "all" | "worsening" | "steady" | "improving" | "new";
type TrustAlertStateFilter = "active" | "acknowledged" | "all";
type TrustAlertEventFilter = "all" | "acknowledged" | "cleared";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const TRUST_ALERTS_FILTERS_STORAGE_KEY = "trust-alerts-filters";

type TrustAlertsFilterState = {
  riskFilter?: TrustRiskFilter;
  trendFilter?: TrustTrendFilter;
  stateFilter?: TrustAlertStateFilter;
  eventFilter?: TrustAlertEventFilter;
};

function toneClasses(level: string) {
  if (level === "critical") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  if (level === "elevated") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  return "border-border bg-surface text-foreground/68";
}

function trendLabel(trend: string) {
  return trend.replaceAll("_", " ");
}

function parseEventFilter(value: string | null): TrustAlertEventFilter | null {
  if (value === "all" || value === "acknowledged" || value === "cleared") {
    return value;
  }

  return null;
}

function buildAlertSignature(alert: SellerTrustIntervention) {
  return [
    alert.seller.id,
    alert.risk_level,
    alert.trend_direction,
    alert.intervention_priority,
    alert.trend_summary,
    alert.intervention_reason,
    ...(alert.seller.trust_score?.risk_reasons ?? []),
  ]
    .map((value) => String(value ?? "").trim())
    .join("|");
}

export function TrustAlertsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const eventFilterInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<SellerTrustIntervention[]>([]);
  const [notifications, setNotifications] = useState<NotificationDelivery[]>([]);
  const [events, setEvents] = useState<TrustAlertEventRead[]>([]);
  const [sellerSummaries, setSellerSummaries] = useState<TrustAlertSellerSummaryRead[]>([]);
  const [riskFilter, setRiskFilter] = useState<TrustRiskFilter>("all");
  const [trendFilter, setTrendFilter] = useState<TrustTrendFilter>("all");
  const [stateFilter, setStateFilter] = useState<TrustAlertStateFilter>("active");
  const [eventFilter, setEventFilter] = useState<TrustAlertEventFilter>("all");
  const [session, setSession] = useState<AdminSession | null>(null);

  useEffect(() => {
    const urlEventFilter = parseEventFilter(searchParams.get("events"));

    try {
      const raw = window.localStorage.getItem(TRUST_ALERTS_FILTERS_STORAGE_KEY);
      if (!raw) {
        if (urlEventFilter) {
          setEventFilter(urlEventFilter);
        }
        eventFilterInitialized.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as TrustAlertsFilterState | null;
      if (!parsed || typeof parsed !== "object") {
        if (urlEventFilter) {
          setEventFilter(urlEventFilter);
        }
        eventFilterInitialized.current = true;
        return;
      }

      if (parsed.riskFilter === "all" || parsed.riskFilter === "critical" || parsed.riskFilter === "elevated") {
        setRiskFilter(parsed.riskFilter);
      }
      if (
        parsed.trendFilter === "all" ||
        parsed.trendFilter === "worsening" ||
        parsed.trendFilter === "steady" ||
        parsed.trendFilter === "improving" ||
        parsed.trendFilter === "new"
      ) {
        setTrendFilter(parsed.trendFilter);
      }
      if (
        parsed.stateFilter === "active" ||
        parsed.stateFilter === "acknowledged" ||
        parsed.stateFilter === "all"
      ) {
        setStateFilter(parsed.stateFilter);
      }
      if (
        parsed.eventFilter === "all" ||
        parsed.eventFilter === "acknowledged" ||
        parsed.eventFilter === "cleared"
      ) {
        setEventFilter(parsed.eventFilter);
      }
      if (urlEventFilter) {
        setEventFilter(urlEventFilter);
      }
    } catch {
      window.localStorage.removeItem(TRUST_ALERTS_FILTERS_STORAGE_KEY);
      if (urlEventFilter) {
        setEventFilter(urlEventFilter);
      }
    }
    eventFilterInitialized.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!eventFilterInitialized.current) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    if (eventFilter === "all") {
      nextParams.delete("events");
    } else {
      nextParams.set("events", eventFilter);
    }

    const nextQuery = nextParams.toString();
    if (nextQuery === searchParams.toString()) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [eventFilter, pathname, router, searchParams]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TRUST_ALERTS_FILTERS_STORAGE_KEY,
        JSON.stringify({
          riskFilter,
          trendFilter,
          stateFilter,
          eventFilter,
        } satisfies TrustAlertsFilterState),
      );
    } catch {
      // Ignore storage write failures in browsers that block persistence.
    }
  }, [eventFilter, riskFilter, stateFilter, trendFilter]);

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
        setSession(session);

        const [response, deliveries, trustEvents] = await Promise.all([
          api.listAdminSellerTrustInterventions(50, {
            accessToken: session.access_token,
          }),
          api.loadAdminNotificationDeliveries(session.access_token),
          api.listAdminTrustAlertEvents(20, {
            accessToken: session.access_token,
          }),
        ]);

        if (!cancelled) {
          setAlerts(response);
          setNotifications(
            deliveries.deliveries.filter(
              (delivery) => delivery.payload?.alert_type === "seller_trust_intervention",
            ),
          );
          setEvents(trustEvents);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load trust alerts.");
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

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const trustSellerSummaries = await api.listAdminTrustAlertSellerSummaries(
          4,
          eventFilter === "all" ? undefined : eventFilter,
          {
            accessToken: session.access_token,
          },
        );
        if (!cancelled) {
          setSellerSummaries(trustSellerSummaries);
        }
      } catch (summaryError) {
        if (!cancelled) {
          setError(
            summaryError instanceof Error
              ? summaryError.message
              : "Unable to refresh trust alert summaries.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, eventFilter]);

  const alertRecords = useMemo(
    () =>
      alerts.map((alert) => ({
        alert,
        signature: buildAlertSignature(alert),
      })),
    [alerts],
  );

  const latestNotificationBySeller = useMemo(() => {
    const map = new Map<string, NotificationDelivery>();

    notifications.forEach((delivery) => {
      if (delivery.payload?.alert_type !== "seller_trust_intervention") {
        return;
      }

      const sellerId = String(delivery.payload?.seller_id ?? "").trim();
      if (!sellerId || map.has(sellerId)) {
        return;
      }

      map.set(sellerId, delivery);
    });

    return map;
  }, [notifications]);

  const acknowledgedAlerts = useMemo(() => {
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

  const activeAlertRecords = useMemo(
    () =>
      alertRecords.filter((record) => {
        const acknowledgedSignature = acknowledgedAlerts[record.alert.seller.id];
        return !acknowledgedSignature || acknowledgedSignature !== record.signature;
      }),
    [acknowledgedAlerts, alertRecords],
  );

  const acknowledgedAlertRecords = useMemo(
    () =>
      alertRecords.filter((record) => {
        const acknowledgedSignature = acknowledgedAlerts[record.alert.seller.id];
        return acknowledgedSignature === record.signature;
      }),
    [acknowledgedAlerts, alertRecords],
  );

  const scopedAlertRecords = useMemo(() => {
    const base = stateFilter === "acknowledged" ? acknowledgedAlertRecords : stateFilter === "all" ? alertRecords : activeAlertRecords;

    return base.filter(({ alert }) => {
      if (riskFilter !== "all" && alert.risk_level !== riskFilter) {
        return false;
      }
      if (trendFilter !== "all" && alert.trend_direction !== trendFilter) {
        return false;
      }
      return true;
    });
  }, [acknowledgedAlertRecords, activeAlertRecords, alertRecords, riskFilter, stateFilter, trendFilter]);

  const counts = useMemo(
    () => ({
      total: alerts.length,
      active: activeAlertRecords.length,
      acknowledged: acknowledgedAlertRecords.length,
      critical: alerts.filter((alert) => alert.risk_level === "critical").length,
      elevated: alerts.filter((alert) => alert.risk_level === "elevated").length,
      worsening: alerts.filter((alert) => alert.trend_direction === "worsening").length,
      steady: alerts.filter((alert) => alert.trend_direction === "steady").length,
      improving: alerts.filter((alert) => alert.trend_direction === "improving").length,
      new: alerts.filter((alert) => alert.trend_direction === "new").length,
    }),
    [acknowledgedAlertRecords.length, activeAlertRecords.length, alerts],
  );

  const notificationCounts = useMemo(
    () => ({
      total: notifications.length,
      queued: notifications.filter((delivery) => delivery.delivery_status === "queued").length,
      sent: notifications.filter((delivery) => delivery.delivery_status === "sent").length,
      failed: notifications.filter((delivery) => delivery.delivery_status === "failed").length,
    }),
    [notifications],
  );

  const eventCounts = useMemo(
    () => ({
      total: events.length,
      acknowledged: events.filter((event) => event.action === "acknowledged").length,
      cleared: events.filter((event) => event.action === "cleared").length,
    }),
    [events],
  );

  const scopedEvents = useMemo(
    () =>
      events.filter((event) => {
        if (eventFilter !== "all" && event.action !== eventFilter) {
          return false;
        }
        return true;
      }),
    [eventFilter, events],
  );

  const groupedEvents = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        events: TrustAlertEventRead[];
      }
    >();

    scopedEvents.forEach((event) => {
      const key = event.seller_id;
      const existing = groups.get(key);
      if (existing) {
        existing.events.push(event);
        return;
      }

      groups.set(key, {
        sellerDisplayName: event.seller_display_name,
        sellerSlug: event.seller_slug,
        events: [event],
      });
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      events: [...group.events].sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
      }));
  }, [scopedEvents]);

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading trust alerts...
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
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Trust automation</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Seller trust alerts
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
            Backend-ranked seller trust interventions pulled from the shared risk queue. Use this lane
            to spot worsening sellers before they spread into support, delivery, or review work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {[
            ["all", `All · ${counts.total}`],
            ["critical", `Critical · ${counts.critical}`],
            ["elevated", `Elevated · ${counts.elevated}`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRiskFilter(value as TrustRiskFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                riskFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
          {[
            ["all", "All trends"],
            ["worsening", `Worsening · ${counts.worsening}`],
            ["steady", `Steady · ${counts.steady}`],
            ["improving", `Improving · ${counts.improving}`],
            ["new", `New · ${counts.new}`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTrendFilter(value as TrustTrendFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                trendFilter === value
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
          ["Critical", counts.critical],
          ["Elevated", counts.elevated],
          ["Worsening", counts.worsening],
          ["New", counts.new],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[1.25rem] border border-border bg-background/80 p-4"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-border bg-background/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Seller focus</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Sellers with active trust history
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Highest-signal seller histories in the current lane, ranked by the number of trust events.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-foreground/56">
            Showing {sellerSummaries.length} of {groupedEvents.length}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {sellerSummaries.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60 lg:col-span-2">
              No seller history matches the current trust filters.
            </div>
          ) : (
            sellerSummaries.map((summary) => (
              <article
                key={summary.seller_slug}
                className="rounded-[1.25rem] border border-border bg-surface/75 p-4"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${summary.seller_slug}`}
                      className="text-sm font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {summary.seller_display_name}
                    </Link>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {summary.seller_slug}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {summary.event_count} events
                    </span>
                  </div>
                  <p className="text-sm leading-7 text-foreground/68">
                    Latest · {summary.latest_event_action} · {summary.latest_event_risk_level} ·{" "}
                    {trendLabel(summary.latest_event_trend_direction)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/reviews?preset=seller_risk&q=${encodeURIComponent(summary.seller_slug)}`}
                      className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                    >
                      Open review lane
                    </Link>
                    <Link
                      href={`/admin/trust-alerts?events=${encodeURIComponent(eventFilter)}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Keep history view
                    </Link>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["active", `Active · ${counts.active}`],
          ["acknowledged", `Acknowledged · ${counts.acknowledged}`],
          ["all", `All · ${counts.total}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStateFilter(value as TrustAlertStateFilter)}
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

      <div className="mt-6 rounded-[1.75rem] border border-border bg-background/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Backend deliveries</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Trust alert notifications
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Queued email and push notifications generated when new trust interventions appear.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-foreground/56">
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Total · {notificationCounts.total}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Queued · {notificationCounts.queued}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Sent · {notificationCounts.sent}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Failed · {notificationCounts.failed}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {notifications.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60">
              No trust alert notifications have been queued yet.
            </div>
          ) : (
            notifications.slice(0, 8).map((delivery) => (
              <article
                key={delivery.id}
                className="rounded-[1.25rem] border border-border bg-surface/75 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {delivery.channel}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(delivery.delivery_status === "failed" ? "critical" : delivery.delivery_status === "queued" ? "elevated" : "all")}`}>
                        {delivery.delivery_status}
                      </span>
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {new Date(delivery.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {String(delivery.payload?.subject ?? "Trust alert notification")}
                    </p>
                    <p className="text-sm leading-7 text-foreground/68">
                      {String(
                        delivery.payload?.body ??
                          delivery.payload?.intervention_reason ??
                          "Seller trust intervention notification.",
                      )}
                    </p>
                  </div>

                  <Link
                    href={`/admin/deliveries?preset=seller_trust_intervention&q=${encodeURIComponent(
                      String(delivery.payload?.seller_id ?? ""),
                    )}`}
                    className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                  >
                    Open delivery queue
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
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">Audit trail</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Trust alert history
            </h3>
            <p className="mt-1 text-sm leading-7 text-foreground/68">
              Backend event log for acknowledge and re-open actions on seller trust alerts, grouped by seller.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-foreground/56">
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Total · {eventCounts.total}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Acknowledged · {eventCounts.acknowledged}
            </span>
            <span className="rounded-full border border-border bg-surface px-3 py-1">
              Cleared · {eventCounts.cleared}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {[
            ["all", `All · ${eventCounts.total}`],
            ["acknowledged", `Acknowledged · ${eventCounts.acknowledged}`],
            ["cleared", `Cleared · ${eventCounts.cleared}`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setEventFilter(value as TrustAlertEventFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                eventFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {groupedEvents.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-4 py-6 text-sm text-foreground/60">
              No trust alert history matches the current filter.
            </div>
          ) : (
            groupedEvents.map((group) => (
              <article
                key={group.sellerSlug}
                className="rounded-[1.25rem] border border-border bg-surface/75 p-4"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/sellers/${group.sellerSlug}`}
                          className="text-sm font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                        >
                          {group.sellerDisplayName}
                        </Link>
                        <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          {group.sellerSlug}
                        </span>
                        <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          {group.events.length} events
                        </span>
                        <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          Latest · {new Date(group.events[0]?.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm leading-7 text-foreground/68">
                        {group.events[0]?.action} · {group.events[0]?.risk_level} · {trendLabel(group.events[0]?.trend_direction ?? "new")}
                      </p>
                    </div>
                    <Link
                      href={`/admin/reviews?preset=seller_risk&q=${encodeURIComponent(group.sellerSlug)}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open seller risk
                    </Link>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border pt-4">
                    {group.events.slice(0, 3).map((event) => (
                      <div key={event.id} className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        <span className="rounded-full border border-border bg-background px-3 py-1">
                          {event.action}
                        </span>
                        <span className="rounded-full border border-border bg-background px-3 py-1">
                          {event.risk_level}
                        </span>
                        <span className="rounded-full border border-border bg-background px-3 py-1">
                          {trendLabel(event.trend_direction)}
                        </span>
                        <span className="rounded-full border border-border bg-background px-3 py-1">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    {group.events.length > 3 ? (
                      <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">
                        +{group.events.length - 3} more events
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {scopedAlertRecords.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No trust alerts match the current filters.
          </div>
        ) : (
            scopedAlertRecords.map(({ alert, signature }) => {
            const acknowledged = acknowledgedAlerts[alert.seller.id] === signature;

            return (
              <article
                key={alert.seller.id}
                className="rounded-[1.5rem] border border-border bg-background/85 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3 lg:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sellers/${alert.seller.slug}`}
                        className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                      >
                        {alert.seller.display_name}
                      </Link>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {alert.seller.slug}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(alert.risk_level)}`}>
                        {alert.risk_level}
                      </span>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {trendLabel(alert.trend_direction)}
                      </span>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {alert.intervention_priority}
                      </span>
                      {acknowledged ? (
                        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                          Acknowledged
                        </span>
                      ) : null}
                    </div>

                    <p className="text-sm leading-7 text-foreground/72">{alert.intervention_reason}</p>
                    <p className="text-sm leading-7 text-foreground/62">{alert.trend_summary}</p>

                    <div className="flex flex-wrap gap-2">
                      {alert.seller.trust_score?.risk_reasons?.map((reason) => (
                        <span
                          key={`${alert.seller.id}-${reason}`}
                          className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:w-72">
                    <Link
                      href={`/admin/reviews?preset=seller_risk&q=${encodeURIComponent(alert.seller.slug)}`}
                      className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                    >
                      Open review lane
                    </Link>
                    <Link
                      href={`/admin/transactions?preset=seller_trust_intervention&q=${encodeURIComponent(alert.seller.id)}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open transaction lane
                    </Link>
                    <Link
                      href={`/admin/deliveries?preset=seller_trust_intervention&q=${encodeURIComponent(alert.seller.id)}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open delivery lane
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!session) {
                          return;
                        }

                        try {
                          const updated = await api.acknowledgeAdminTrustAlert(alert.seller.id, {
                            accessToken: session.access_token,
                          });
                          setNotifications((current) => {
                            const updatedById = new Map(updated.map((delivery) => [delivery.id, delivery]));
                            const next = current.map((delivery) => updatedById.get(delivery.id) ?? delivery);
                            updated.forEach((delivery) => {
                              if (!next.some((currentDelivery) => currentDelivery.id === delivery.id)) {
                                next.push(delivery);
                              }
                            });
                            return next;
                          });
                        } catch (ackError) {
                          setError(ackError instanceof Error ? ackError.message : "Unable to acknowledge trust alert.");
                        }
                      }}
                      className="rounded-full border border-border bg-surface px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      {acknowledged ? "Refresh acknowledged" : "Acknowledge alert"}
                    </button>
                    {acknowledged ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!session) {
                            return;
                          }

                          try {
                            const updated = await api.clearAdminTrustAlertAcknowledgement(alert.seller.id, {
                              accessToken: session.access_token,
                            });
                            setNotifications((current) => {
                              const updatedById = new Map(updated.map((delivery) => [delivery.id, delivery]));
                              const next = current.map((delivery) => updatedById.get(delivery.id) ?? delivery);
                              updated.forEach((delivery) => {
                                if (!next.some((currentDelivery) => currentDelivery.id === delivery.id)) {
                                  next.push(delivery);
                                }
                              });
                              return next;
                            });
                          } catch (reopenError) {
                            setError(reopenError instanceof Error ? reopenError.message : "Unable to reopen trust alert.");
                          }
                        }}
                        className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                      >
                        Re-open alert
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
