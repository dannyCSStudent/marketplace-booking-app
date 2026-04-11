"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createApiClient,
  type InventoryAlertEventRead,
  type InventoryAlertSummaryRead,
  type NotificationDelivery,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type InventoryBucketFilter = "all" | "low_stock" | "out_of_stock";
type InventoryStatusFilter = "all" | "queued" | "sent" | "failed";
type InventoryStateFilter = "active" | "acknowledged" | "all";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function toneClasses(bucket: string) {
  if (bucket === "out_of_stock") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-700";
}

function formatInventoryStatusLabel(summary: InventoryAlertSummaryRead) {
  if (summary.inventory_bucket === "out_of_stock") {
    return "Out of stock";
  }

  if (typeof summary.inventory_count === "number") {
    return `Low stock · ${summary.inventory_count}`;
  }

  return "Low stock";
}

export function InventoryAlertsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [summaries, setSummaries] = useState<InventoryAlertSummaryRead[]>([]);
  const [events, setEvents] = useState<InventoryAlertEventRead[]>([]);
  const [bucketFilter, setBucketFilter] = useState<InventoryBucketFilter>("all");
  const [statusFilter, setStatusFilter] = useState<InventoryStatusFilter>("all");
  const [stateFilter, setStateFilter] = useState<InventoryStateFilter>("active");
  const [inventoryAlertActionLoading, setInventoryAlertActionLoading] = useState<string | null>(
    null,
  );
  const inventoryAlertsStateFilterKey = "inventory-alerts-state-filter";

  const loadInventoryAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available.");
      }

      const [deliveriesResponse, summariesResponse, eventsResponse] = await Promise.all([
        api.loadAdminNotificationDeliveries(session.access_token),
        api.listAdminInventoryAlertSummaries(8, stateFilter, { accessToken: session.access_token }),
        api.listAdminInventoryAlertEvents(20, { accessToken: session.access_token }),
      ]);

      setDeliveries(
        deliveriesResponse.deliveries.filter(
          (delivery) => delivery.payload?.alert_type === "inventory_alert",
        ),
      );
      setSummaries(summariesResponse);
      setEvents(eventsResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load inventory alerts.");
    } finally {
      setLoading(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    void loadInventoryAlerts();
  }, [loadInventoryAlerts]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedState = window.localStorage.getItem(inventoryAlertsStateFilterKey);
    if (
      storedState === "active" ||
      storedState === "acknowledged" ||
      storedState === "all"
    ) {
      setStateFilter(storedState);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(inventoryAlertsStateFilterKey, stateFilter);
  }, [stateFilter]);

  async function acknowledgeInventoryAlert(summary: InventoryAlertSummaryRead) {
    setInventoryAlertActionLoading(`${summary.seller_id}:${summary.listing_id}`);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available.");
      }

      await api.acknowledgeAdminInventoryAlert(summary.seller_id, summary.listing_id, {
        accessToken: session.access_token,
      });
      await loadInventoryAlerts();
    } catch (acknowledgeError) {
      setError(
        acknowledgeError instanceof Error
          ? acknowledgeError.message
          : "Unable to acknowledge inventory alert.",
      );
    } finally {
      setInventoryAlertActionLoading(null);
    }
  }

  async function clearInventoryAlert(summary: InventoryAlertSummaryRead) {
    setInventoryAlertActionLoading(`${summary.seller_id}:${summary.listing_id}`);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        throw new Error("Admin session not available.");
      }

      await api.clearAdminInventoryAlertAcknowledgement(summary.seller_id, summary.listing_id, {
        accessToken: session.access_token,
      });
      await loadInventoryAlerts();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to clear inventory alert.");
    } finally {
      setInventoryAlertActionLoading(null);
    }
  }

  const alertCounts = useMemo(
    () => ({
      total: deliveries.length,
      lowStock: deliveries.filter((delivery) => delivery.payload?.inventory_bucket === "low_stock").length,
      outOfStock: deliveries.filter((delivery) => delivery.payload?.inventory_bucket === "out_of_stock").length,
      queued: deliveries.filter((delivery) => delivery.delivery_status === "queued").length,
      sent: deliveries.filter((delivery) => delivery.delivery_status === "sent").length,
      failed: deliveries.filter((delivery) => delivery.delivery_status === "failed").length,
    }),
    [deliveries],
  );

  const filteredDeliveries = useMemo(
    () =>
      deliveries.filter((delivery) => {
        if (bucketFilter !== "all" && delivery.payload?.inventory_bucket !== bucketFilter) {
          return false;
        }
        if (statusFilter !== "all" && delivery.delivery_status !== statusFilter) {
          return false;
        }
        return true;
      }),
    [bucketFilter, deliveries, statusFilter],
  );

  const groupedDeliveries = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        listingTitle: string;
        listingId: string;
        deliveries: NotificationDelivery[];
      }
    >();

    filteredDeliveries.forEach((delivery) => {
      const payload = delivery.payload ?? {};
      const sellerSlug = String(payload.seller_slug ?? "").trim();
      const listingId = String(payload.listing_id ?? "").trim();
      const listingTitle = String(payload.listing_title ?? "Listing").trim();
      const sellerDisplayName = String(payload.seller_display_name ?? "Seller").trim();
      const key = `${sellerSlug}:${listingId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.deliveries.push(delivery);
        return;
      }

      groups.set(key, {
        sellerDisplayName,
        sellerSlug,
        listingTitle,
        listingId,
        deliveries: [delivery],
      });
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      deliveries: [...group.deliveries].sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
    }));
  }, [filteredDeliveries]);

  const filteredSummaries = useMemo(
    () =>
      summaries.filter((summary) => {
        if (bucketFilter !== "all" && summary.inventory_bucket !== bucketFilter) {
          return false;
        }

        if (statusFilter !== "all" && summary.latest_alert_delivery_status !== statusFilter) {
          return false;
        }

        return true;
      }),
    [bucketFilter, statusFilter, summaries],
  );

  const groupedEvents = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerDisplayName: string;
        sellerSlug: string;
        listingTitle: string;
        listingId: string;
        eventCount: number;
        latestAction: string;
        latestCreatedAt: string;
        events: InventoryAlertEventRead[];
      }
    >();

    events.forEach((event) => {
      const key = `${event.seller_slug}:${event.listing_id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.eventCount += 1;
        existing.events.push(event);
        if (new Date(event.created_at).getTime() > new Date(existing.latestCreatedAt).getTime()) {
          existing.latestAction = event.action;
          existing.latestCreatedAt = event.created_at;
        }
        return;
      }

      groups.set(key, {
        sellerDisplayName: event.seller_display_name,
        sellerSlug: event.seller_slug,
        listingTitle: event.listing_title,
        listingId: event.listing_id,
        eventCount: 1,
        latestAction: event.action,
        latestCreatedAt: event.created_at,
        events: [event],
      });
    });

    return Array.from(groups.values()).sort(
      (left, right) =>
        new Date(right.latestCreatedAt).getTime() - new Date(left.latestCreatedAt).getTime(),
    );
  }, [events]);

  if (loading) {
    return (
      <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
        Loading inventory alerts...
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
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Inventory automation</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Seller inventory alerts
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
            Listing writes emit seller notifications when stock moves into a low-stock or out-of-stock state.
            Use this lane to scan the resulting alert load and jump back to the affected seller or listing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
          {[
            ["all", `All · ${alertCounts.total}`],
            ["low_stock", `Low stock · ${alertCounts.lowStock}`],
            ["out_of_stock", `Out of stock · ${alertCounts.outOfStock}`],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setBucketFilter(value as InventoryBucketFilter)}
              className={`rounded-full border px-3 py-1 transition ${
                bucketFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["active", `Active · ${summaries.filter((summary) => !summary.acknowledged).length}`],
          ["acknowledged", `Acknowledged · ${summaries.filter((summary) => summary.acknowledged).length}`],
          ["all", `Current slice · ${summaries.length}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStateFilter(value as InventoryStateFilter)}
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

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Loaded threads", summaries.length],
          ["Active", summaries.filter((summary) => !summary.acknowledged).length],
          ["Acknowledged", summaries.filter((summary) => summary.acknowledged).length],
          ["Events", groupedEvents.length],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total", alertCounts.total],
          ["Low stock", alertCounts.lowStock],
          ["Out of stock", alertCounts.outOfStock],
          ["Queued", alertCounts.queued],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/52">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {[
          ["all", `All · ${filteredDeliveries.length}`],
          ["queued", `Queued · ${alertCounts.queued}`],
          ["sent", `Sent · ${alertCounts.sent}`],
          ["failed", `Failed · ${alertCounts.failed}`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value as InventoryStatusFilter)}
            className={`rounded-full border px-3 py-1 transition ${
              statusFilter === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-emerald-200 bg-emerald-50/35 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
              Inventory summaries
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Backend inventory alert threads
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/68">
              These rows are grouped by seller and listing from the backend summary feed. Use them to
              acknowledge or clear the current inventory thread before drilling back into the raw
              deliveries below.
            </p>
          </div>
          <span className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
            {filteredSummaries.length} active thread{filteredSummaries.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          {filteredSummaries.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-white px-5 py-8 text-sm text-foreground/60">
              No inventory threads match the current state or stock filters.
            </div>
          ) : (
            filteredSummaries.map((summary) => (
              <article
                key={`${summary.seller_id}:${summary.listing_id}`}
                className="rounded-[1.5rem] border border-border bg-white px-5 py-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3 lg:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sellers/${summary.seller_slug}`}
                        className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                      >
                        {summary.seller_display_name}
                      </Link>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {summary.seller_slug}
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(summary.inventory_bucket)}`}
                      >
                        {formatInventoryStatusLabel(summary)}
                      </span>
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {summary.alert_delivery_count} alerts
                      </span>
                      {summary.acknowledged ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-700">
                          Acknowledged
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs uppercase tracking-[0.18em] text-amber-700">
                          Active
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/listings/${summary.listing_id}`}
                        className="text-sm font-medium text-foreground transition hover:text-accent"
                      >
                        {summary.listing_title}
                      </Link>
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        {summary.listing_id}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        Latest · {summary.latest_alert_delivery_status}
                      </span>
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        Updated · {new Date(summary.latest_alert_delivery_created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:w-72">
                    <Link
                      href={`/sellers/${summary.seller_slug}`}
                      className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                    >
                      Open seller
                    </Link>
                    <Link
                      href={`/listings/${summary.listing_id}`}
                      className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                    >
                      Open listing
                    </Link>
                    <button
                      className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={inventoryAlertActionLoading === `${summary.seller_id}:${summary.listing_id}`}
                      onClick={() => acknowledgeInventoryAlert(summary)}
                      type="button"
                    >
                      {inventoryAlertActionLoading === `${summary.seller_id}:${summary.listing_id}`
                        ? "Saving..."
                        : summary.acknowledged
                          ? "Re-acknowledge"
                          : "Acknowledge"}
                    </button>
                    <button
                      className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={inventoryAlertActionLoading === `${summary.seller_id}:${summary.listing_id}`}
                      onClick={() => clearInventoryAlert(summary)}
                      type="button"
                    >
                      Clear ack
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-sky-200 bg-sky-50/35 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
              Inventory alert history
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Acknowledge and clear events
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/68">
              This trail records the operator actions behind the inventory alert threads. It stays
              readable even when the live delivery feed gets noisy.
            </p>
          </div>
          <span className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/60">
            {groupedEvents.length} thread{groupedEvents.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-5 space-y-4">
          {groupedEvents.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-white px-5 py-8 text-sm text-foreground/60">
              No inventory alert events have been recorded yet.
            </div>
          ) : (
            groupedEvents.slice(0, 6).map((group) => (
              <article
                key={`${group.sellerSlug}:${group.listingId}`}
                className="rounded-[1.5rem] border border-border bg-white px-5 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${group.sellerSlug}`}
                      className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {group.sellerDisplayName}
                    </Link>
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.listingTitle}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.eventCount} event{group.eventCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Link
                    href={`/listings/${group.listingId}`}
                    className="rounded-full border border-foreground bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                  >
                    Open latest
                  </Link>
                </div>
                <div className="mt-3 space-y-2">
                  {group.events.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-[1rem] border border-border bg-background/70 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {event.action === "acknowledged" ? "Acknowledged" : "Cleared"} ·{" "}
                            {event.inventory_bucket === "out_of_stock"
                              ? "Out of stock"
                              : `Low stock · ${event.inventory_count ?? "unknown"}`}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-foreground/52">
                            {new Date(event.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/sellers/${event.seller_slug}`}
                            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-foreground hover:text-foreground"
                          >
                            Open seller
                          </Link>
                          <Link
                            href={`/listings/${event.listing_id}`}
                            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-foreground hover:text-foreground"
                          >
                            Open listing
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {groupedDeliveries.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border px-5 py-8 text-sm text-foreground/60">
            No inventory alerts match the current filters.
          </div>
        ) : (
          groupedDeliveries.map((group) => (
            <article key={`${group.sellerSlug}:${group.listingId}`} className="rounded-[1.5rem] border border-border bg-background/85 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3 lg:flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sellers/${group.sellerSlug}`}
                      className="text-lg font-semibold tracking-[-0.03em] text-foreground transition hover:text-accent"
                    >
                      {group.sellerDisplayName}
                    </Link>
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.sellerSlug}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.deliveries.length} alerts
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/listings/${group.listingId}`}
                      className="text-sm font-medium text-foreground transition hover:text-accent"
                    >
                      {group.listingTitle}
                    </Link>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                      {group.listingId}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {group.deliveries.slice(0, 3).map((delivery) => (
                      <span
                        key={delivery.id}
                        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${toneClasses(String(delivery.payload?.inventory_bucket ?? "low_stock"))}`}
                      >
                        {delivery.payload?.inventory_bucket === "out_of_stock"
                          ? "Out of stock"
                          : `Low stock · ${delivery.payload?.inventory_count ?? "unknown"}`}
                      </span>
                    ))}
                    {group.deliveries.length > 3 ? (
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground/56">
                        +{group.deliveries.length - 3} more
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-2 lg:w-72">
                  <Link
                    href={`/sellers/${group.sellerSlug}`}
                    className="rounded-full border border-foreground bg-foreground px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90"
                  >
                    Open seller
                  </Link>
                  <Link
                    href={`/listings/${group.listingId}`}
                    className="rounded-full border border-border bg-background px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                  >
                    Open listing
                  </Link>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
