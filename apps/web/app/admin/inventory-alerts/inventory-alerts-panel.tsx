"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createApiClient, type NotificationDelivery } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type InventoryBucketFilter = "all" | "low_stock" | "out_of_stock";
type InventoryStatusFilter = "all" | "queued" | "sent" | "failed";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function toneClasses(bucket: string) {
  if (bucket === "out_of_stock") {
    return "border-danger/30 bg-danger/8 text-danger";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-700";
}

export function InventoryAlertsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [bucketFilter, setBucketFilter] = useState<InventoryBucketFilter>("all");
  const [statusFilter, setStatusFilter] = useState<InventoryStatusFilter>("all");

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

        const response = await api.loadAdminNotificationDeliveries(session.access_token);
        if (!cancelled) {
          setDeliveries(
            response.deliveries.filter(
              (delivery) => delivery.payload?.alert_type === "inventory_alert",
            ),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load inventory alerts.");
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
