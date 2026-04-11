"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createApiClient, type NotificationDelivery } from "@/app/lib/api";
import { restoreAdminSession, type AdminSession } from "@/app/lib/admin-auth";

type StateFilter = "active" | "acknowledged" | "all";
type StatusFilter = "all" | "queued" | "sent" | "failed";
type RecencyFilter = "today" | "7d" | "all";
type EventFilter = "all" | "acknowledged" | "cleared";

type ReviewResponseReminderSellerSummaryRead = {
  seller_id: string;
  seller_slug: string;
  seller_display_name: string;
  reminder_count: number;
  latest_review_id?: string | null;
  latest_review_rating?: number | null;
  latest_alert_delivery_status: string;
  latest_alert_delivery_created_at: string;
  acknowledged: boolean;
};

type ReviewResponseReminderEventRead = {
  id: string;
  seller_id: string;
  seller_slug: string;
  seller_display_name: string;
  delivery_id?: string | null;
  actor_user_id: string;
  action: string;
  alert_signature: string;
  latest_review_id?: string | null;
  latest_review_rating?: number | null;
  pending_review_count: number;
  created_at: string;
};

type ReminderGroup = {
  sellerId: string;
  sellerSlug: string;
  sellerDisplayName: string;
  reminderCount: number;
  latestCreatedAt: string;
  acknowledged: boolean;
  deliveries: NotificationDelivery[];
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const STORAGE_KEY = "review-response-reminders-filters";

function matchesRecency(createdAt: string, filter: RecencyFilter) {
  if (filter === "all") {
    return true;
  }

  const created = new Date(createdAt).getTime();
  const now = Date.now();
  if (filter === "today") {
    return created >= now - 24 * 60 * 60 * 1000;
  }

  return created >= now - 7 * 24 * 60 * 60 * 1000;
}

function toneClasses(status: string) {
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (status === "queued") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export function ReviewResponseRemindersPanel() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [events, setEvents] = useState<ReviewResponseReminderEventRead[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("active");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [recencyFilter, setRecencyFilter] = useState<RecencyFilter>("7d");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [acknowledgingSellerId, setAcknowledgingSellerId] = useState<string | null>(null);

  useEffect(() => {
    setSession(restoreAdminSession());
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as {
        stateFilter?: StateFilter;
        statusFilter?: StatusFilter;
        recencyFilter?: RecencyFilter;
        eventFilter?: EventFilter;
      };

      if (parsed.stateFilter === "active" || parsed.stateFilter === "acknowledged" || parsed.stateFilter === "all") {
        setStateFilter(parsed.stateFilter);
      }
      if (parsed.statusFilter === "all" || parsed.statusFilter === "queued" || parsed.statusFilter === "sent" || parsed.statusFilter === "failed") {
        setStatusFilter(parsed.statusFilter);
      }
      if (parsed.recencyFilter === "today" || parsed.recencyFilter === "7d" || parsed.recencyFilter === "all") {
        setRecencyFilter(parsed.recencyFilter);
      }
      if (parsed.eventFilter === "all" || parsed.eventFilter === "acknowledged" || parsed.eventFilter === "cleared") {
        setEventFilter(parsed.eventFilter);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ stateFilter, statusFilter, recencyFilter, eventFilter }),
      );
    } catch {
      // Ignore browser persistence failures.
    }
  }, [eventFilter, recencyFilter, stateFilter, statusFilter]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<NotificationDelivery[]>("/notifications/admin", { accessToken: session.accessToken }),
      api.get<ReviewResponseReminderEventRead[]>(
        "/notifications/admin/review-response-reminders/events",
        { accessToken: session.accessToken },
      ),
    ])
      .then(([deliveryRows, eventRows]) => {
        if (!cancelled) {
          setDeliveries(deliveryRows);
          setEvents(eventRows);
          setLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load review response reminders.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const reminderDeliveries = useMemo(
    () =>
      deliveries.filter((delivery) => {
        if (delivery.payload?.alert_type !== "review_response_reminder") {
          return false;
        }

        const isAcknowledged = Boolean(delivery.payload?.acknowledged_signature);
        if (stateFilter === "active" && isAcknowledged) {
          return false;
        }
        if (stateFilter === "acknowledged" && !isAcknowledged) {
          return false;
        }

        if (!matchesRecency(delivery.created_at, recencyFilter)) {
          return false;
        }

        if (statusFilter !== "all" && delivery.delivery_status !== statusFilter) {
          return false;
        }

        return true;
      }),
    [deliveries, recencyFilter, statusFilter],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, ReminderGroup>();

    reminderDeliveries.forEach((delivery) => {
      const payload = delivery.payload ?? {};
      const sellerId = String(payload.seller_id ?? delivery.transaction_id ?? "").trim();
      if (!sellerId) {
        return;
      }

      const sellerSlug = String(payload.seller_slug ?? "").trim();
      const sellerDisplayName = String(payload.seller_display_name ?? sellerSlug ?? sellerId).trim();
      const current = grouped.get(sellerId);
      if (current) {
        current.deliveries.push(delivery);
        if (new Date(delivery.created_at).getTime() > new Date(current.latestCreatedAt).getTime()) {
          current.latestCreatedAt = delivery.created_at;
        }
        return;
      }

      grouped.set(sellerId, {
        sellerId,
        sellerSlug,
        sellerDisplayName,
        reminderCount: Number(payload.pending_review_count ?? 1),
        latestCreatedAt: delivery.created_at,
        acknowledged: Boolean(payload.acknowledged_signature),
        deliveries: [delivery],
      });
    });

    return [...grouped.values()].sort(
      (left, right) =>
        new Date(right.latestCreatedAt).getTime() - new Date(left.latestCreatedAt).getTime(),
    );
  }, [reminderDeliveries]);

  const latestReminder = reminderDeliveries[0] ?? null;
  const groupedEvents = useMemo(() => {
    const grouped = new Map<string, ReviewResponseReminderEventRead[]>();

    events
      .filter((event) => eventFilter === "all" || event.action === eventFilter)
      .forEach((event) => {
        const current = grouped.get(event.seller_id);
        if (current) {
          current.push(event);
          return;
        }

        grouped.set(event.seller_id, [event]);
      });

    return [...grouped.entries()].map(([sellerId, sellerEvents]) => ({
      sellerId,
      sellerDisplayName: sellerEvents[0]?.seller_display_name ?? sellerId,
      sellerSlug: sellerEvents[0]?.seller_slug ?? "",
      events: sellerEvents.sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
    }));
  }, [eventFilter, events]);
  const totalQueued = reminderDeliveries.filter((delivery) => delivery.delivery_status === "queued").length;
  const totalSent = reminderDeliveries.filter((delivery) => delivery.delivery_status === "sent").length;
  const totalFailed = reminderDeliveries.filter((delivery) => delivery.delivery_status === "failed").length;

  async function toggleAcknowledgement(group: ReminderGroup, acknowledged: boolean) {
    if (!session) {
      return;
    }

    setAcknowledgingSellerId(group.sellerId);
    try {
      await (acknowledged
        ? api.post(
            `/notifications/admin/review-response-reminders/${group.sellerId}/acknowledge`,
            undefined,
            { accessToken: session.accessToken },
          )
        : fetch(
            `${apiBaseUrl}/notifications/admin/review-response-reminders/${group.sellerId}/acknowledge`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${session.accessToken}`,
                "Content-Type": "application/json",
              },
            },
          ));
      const [deliveryRows, eventRows] = await Promise.all([
        api.get<NotificationDelivery[]>("/notifications/admin", { accessToken: session.accessToken }),
        api.get<ReviewResponseReminderEventRead[]>(
          "/notifications/admin/review-response-reminders/events",
          { accessToken: session.accessToken },
        ),
      ]);
      setDeliveries(deliveryRows);
      setEvents(eventRows);
    } finally {
      setAcknowledgingSellerId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.5rem] border border-border bg-white px-5 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/46">
          Review response reminders
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Sellers with unanswered review pressure
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground/68">
              This lane reads the backend reminder deliveries generated from visible reviews that
              still need a seller response.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
              {reminderDeliveries.length} reminders
            </span>
            <span className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
              {groups.length} sellers
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
          {[
            ["active", `Active · ${groups.filter((group) => !group.acknowledged).length}`],
            ["acknowledged", `Acknowledged · ${groups.filter((group) => group.acknowledged).length}`],
            ["all", `All · ${groups.length}`],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 transition ${
                stateFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
              onClick={() => setStateFilter(value as StateFilter)}
              type="button"
            >
              {label}
            </button>
          ))}
          {[
            ["all", `All · ${reminderDeliveries.length}`],
            ["queued", `Queued · ${totalQueued}`],
            ["sent", `Sent · ${totalSent}`],
            ["failed", `Failed · ${totalFailed}`],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 transition ${
                statusFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
              onClick={() => setStatusFilter(value as StatusFilter)}
              type="button"
            >
              {label}
            </button>
          ))}
          {["today", "7d", "all"].map((value) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 transition ${
                recencyFilter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
              onClick={() => setRecencyFilter(value as RecencyFilter)}
              type="button"
            >
              {value === "today" ? "Today" : value === "7d" ? "7 Days" : "All Time"}
            </button>
          ))}
        </div>
      </section>

      {latestReminder ? (
        <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50/45 px-5 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/46">
            Latest reminder
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {String(latestReminder.payload?.seller_display_name ?? latestReminder.payload?.seller_slug ?? "Seller")}
              </h2>
              <p className="mt-2 text-sm text-foreground/68">
                {String(latestReminder.payload?.latest_review_comment ?? "A buyer review is waiting on a seller response.")}
              </p>
            </div>
            <Link
              href={
                latestReminder.payload?.seller_slug
                  ? `/sellers/${latestReminder.payload.seller_slug}`
                  : "/admin/reviews"
              }
              className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90"
            >
              Open seller
            </Link>
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="rounded-[1.5rem] border border-border bg-white px-5 py-6 text-sm text-foreground/68">
          Loading review response reminders...
        </div>
      ) : error ? (
        <div className="rounded-[1.5rem] border border-red-200 bg-red-50 px-5 py-6 text-sm text-red-700">
          {error}
        </div>
      ) : groups.length > 0 ? (
        <div className="space-y-3">
          {groups.map((group) => (
            <article
              key={group.sellerId}
              className="rounded-[1.5rem] border border-border bg-white px-5 py-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold tracking-[-0.02em] text-foreground">
                    {group.sellerDisplayName}
                  </p>
                  <p className="mt-1 text-sm text-foreground/64">
                    {group.reminderCount} review{group.reminderCount === 1 ? "" : "s"} need a seller response
                  </p>
                  <p className="mt-1 text-xs text-foreground/48">
                    Latest reminder · {new Date(group.latestCreatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
                    {group.deliveries.length} deliveries
                  </span>
                  <Link
                    href={group.sellerSlug ? `/sellers/${group.sellerSlug}` : "/admin/reviews"}
                    className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90"
                  >
                    Open seller
                  </Link>
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-45"
                    disabled={acknowledgingSellerId === group.sellerId}
                    onClick={() => toggleAcknowledgement(group, !group.acknowledged)}
                    type="button"
                  >
                    {acknowledgingSellerId === group.sellerId
                      ? "Saving..."
                      : group.acknowledged
                        ? "Clear ack"
                        : "Acknowledge"}
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {group.deliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    className={`rounded-[1.1rem] border px-4 py-3 ${toneClasses(delivery.delivery_status)}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {delivery.payload?.subject ?? "Review response reminder"}
                        </p>
                        <p className="mt-1 text-sm text-foreground/70">
                          {delivery.payload?.body ?? "Seller still needs to reply to a review."}
                        </p>
                        <p className="mt-2 text-xs text-foreground/48">
                          {new Date(delivery.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
                        {delivery.channel} · {delivery.delivery_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[1.5rem] border border-border bg-white px-5 py-6 text-sm text-foreground/68">
          No review response reminders match the current filter.
        </div>
      )}

      <section className="rounded-[1.5rem] border border-border bg-white px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/46">
              Reminder history
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              Acknowledged and cleared reminders
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
            {[
              ["all", "All"],
              ["acknowledged", "Acknowledged"],
              ["cleared", "Cleared"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`rounded-full border px-3 py-1.5 transition ${
                  eventFilter === value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
                }`}
                onClick={() => setEventFilter(value as EventFilter)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {groupedEvents.length > 0 ? (
            groupedEvents.map((group) => (
              <article key={group.sellerId} className="rounded-[1.1rem] border border-border bg-background/30 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{group.sellerDisplayName}</p>
                    <p className="mt-1 text-xs text-foreground/48">
                      {group.events.length} event{group.events.length === 1 ? "" : "s"} · latest{" "}
                      {new Date(group.events[0].created_at).toLocaleString()}
                    </p>
                  </div>
                  <Link
                    href={group.sellerSlug ? `/sellers/${group.sellerSlug}` : "/admin/reviews"}
                    className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    Open seller
                  </Link>
                </div>
                <div className="mt-3 space-y-2">
                  {group.events.slice(0, 4).map((event) => (
                    <div key={event.id} className={`rounded-[1rem] border px-3 py-2 ${toneClasses(event.action === "acknowledged" ? "sent" : "queued")}`}>
                      <p className="text-sm font-semibold text-foreground">
                        {event.action === "acknowledged" ? "Acknowledged" : "Cleared"}
                      </p>
                      <p className="mt-1 text-sm text-foreground/70">
                        {event.pending_review_count} pending review{event.pending_review_count === 1 ? "" : "s"}
                      </p>
                      <p className="mt-2 text-xs text-foreground/48">
                        {new Date(event.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-foreground/68">No reminder history matches the current filter.</p>
          )}
        </div>
      </section>
    </div>
  );
}
