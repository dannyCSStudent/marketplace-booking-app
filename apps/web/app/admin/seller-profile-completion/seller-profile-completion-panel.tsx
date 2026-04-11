"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createApiClient,
  type NotificationDelivery,
  type SellerProfileCompletionEventRead,
  type SellerProfileCompletionRead,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type StateFilter = "all" | "incomplete" | "complete";
type AlertStateFilter = "active" | "acknowledged" | "all";
type EventActionFilter = "all" | "acknowledged" | "cleared";

type FilterState = {
  stateFilter?: StateFilter;
  alertStateFilter?: AlertStateFilter;
  eventActionFilter?: EventActionFilter;
};

const STORAGE_KEY = "seller-profile-completion-filters";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

function toneClasses(percent: number) {
  if (percent >= 100) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (percent >= 66) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-danger/30 bg-danger/8 text-danger";
}

function parseStateFilter(value: string | null): StateFilter | null {
  if (value === "all" || value === "incomplete" || value === "complete") {
    return value;
  }

  return null;
}

function matchesSearch(profile: SellerProfileCompletionRead, searchQuery: string) {
  if (!searchQuery.trim()) {
    return true;
  }

  const haystack = [
    profile.seller_display_name,
    profile.seller_slug,
    profile.summary,
    profile.missing_fields.join(" "),
    String(profile.completion_percent),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchQuery.trim().toLowerCase());
}

function isCompletionAlertAcknowledged(delivery: NotificationDelivery) {
  const payload = delivery.payload ?? {};
  const acknowledgedSignature = String(payload.acknowledged_signature ?? "").trim();
  const alertSignature = String(payload.alert_signature ?? "").trim();
  return Boolean(acknowledgedSignature) && acknowledgedSignature === alertSignature;
}

function formatCompletionEventAction(action: string) {
  if (action === "acknowledged") {
    return "Acknowledged";
  }
  if (action === "cleared") {
    return "Cleared";
  }
  return "Updated";
}

export function SellerProfileCompletionPanel() {
  const filtersInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<SellerProfileCompletionRead[]>([]);
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([]);
  const [profileCompletionEvents, setProfileCompletionEvents] = useState<SellerProfileCompletionEventRead[]>(
    [],
  );
  const [stateFilter, setStateFilter] = useState<StateFilter>("incomplete");
  const [alertStateFilter, setAlertStateFilter] = useState<AlertStateFilter>("active");
  const [eventActionFilter, setEventActionFilter] = useState<EventActionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || filtersInitialized.current) {
      return;
    }

    filtersInitialized.current = true;

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as FilterState;
        if (parsed.stateFilter === "all" || parsed.stateFilter === "incomplete" || parsed.stateFilter === "complete") {
          setStateFilter(parsed.stateFilter);
        }
        if (
          parsed.alertStateFilter === "active" ||
          parsed.alertStateFilter === "acknowledged" ||
          parsed.alertStateFilter === "all"
        ) {
          setAlertStateFilter(parsed.alertStateFilter);
        }
        if (
          parsed.eventActionFilter === "all" ||
          parsed.eventActionFilter === "acknowledged" ||
          parsed.eventActionFilter === "cleared"
        ) {
          setEventActionFilter(parsed.eventActionFilter);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          stateFilter,
          alertStateFilter,
          eventActionFilter,
        } satisfies FilterState),
      );
    } catch {
      // ignore
    }
  }, [alertStateFilter, eventActionFilter, stateFilter]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const currentSession = await restoreAdminSession();
        if (!currentSession) {
          throw new Error("Admin session not available.");
        }

        const response = await api.listAdminSellerProfileCompletions(currentSession.access_token, {
          limit: 24,
          state: stateFilter,
        });
        const [deliveries, events] = await Promise.all([
          api.listAdminNotificationDeliveries({
            accessToken: currentSession.access_token,
          }),
          api.listAdminSellerProfileCompletionEvents(currentSession.access_token, {
            limit: 20,
          }),
        ]);

        if (!cancelled) {
          setProfiles(response);
          setNotificationDeliveries(deliveries);
          setProfileCompletionEvents(events);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load seller profile completion.",
          );
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
  }, [refreshTick, stateFilter]);

  const counts = useMemo(
    () => ({
      total: profiles.length,
      complete: profiles.filter((profile) => profile.is_complete).length,
      incomplete: profiles.filter((profile) => !profile.is_complete).length,
      verified: profiles.filter((profile) => profile.missing_fields.length === 0).length,
    }),
    [profiles],
  );

  const filteredProfiles = useMemo(
    () => profiles.filter((profile) => matchesSearch(profile, searchQuery)),
    [profiles, searchQuery],
  );

  const latestIncompleteProfile = useMemo(
    () => filteredProfiles.find((profile) => !profile.is_complete) ?? filteredProfiles[0] ?? null,
    [filteredProfiles],
  );
  const profileCompletionAlerts = useMemo(
    () =>
      notificationDeliveries.filter(
        (delivery) => delivery.payload?.alert_type === "seller_profile_completion",
      ),
    [notificationDeliveries],
  );
  const filteredProfileCompletionAlerts = useMemo(
    () =>
      profileCompletionAlerts.filter((delivery) => {
        const acknowledged = isCompletionAlertAcknowledged(delivery);
        if (alertStateFilter === "active") {
          return !acknowledged;
        }
        if (alertStateFilter === "acknowledged") {
          return acknowledged;
        }
        return true;
      }),
    [alertStateFilter, profileCompletionAlerts],
  );
  const profileCompletionAlertCounts = useMemo(
    () => ({
      total: profileCompletionAlerts.length,
      active: profileCompletionAlerts.filter((delivery) => !isCompletionAlertAcknowledged(delivery)).length,
      acknowledged: profileCompletionAlerts.filter((delivery) => isCompletionAlertAcknowledged(delivery)).length,
    }),
    [profileCompletionAlerts],
  );
  const latestProfileCompletionAlert = useMemo(
    () => filteredProfileCompletionAlerts[0] ?? null,
    [filteredProfileCompletionAlerts],
  );
  const filteredProfileCompletionEvents = useMemo(
    () =>
      profileCompletionEvents.filter((event) => {
        if (eventActionFilter === "all") {
          return true;
        }
        return event.action === eventActionFilter;
      }),
    [eventActionFilter, profileCompletionEvents],
  );
  const profileCompletionEventCounts = useMemo(
    () => ({
      total: profileCompletionEvents.length,
      acknowledged: profileCompletionEvents.filter((event) => event.action === "acknowledged").length,
      cleared: profileCompletionEvents.filter((event) => event.action === "cleared").length,
    }),
    [profileCompletionEvents],
  );
  const latestProfileCompletionEvent = useMemo(
    () => filteredProfileCompletionEvents[0] ?? null,
    [filteredProfileCompletionEvents],
  );

  function clearFilters() {
    setStateFilter("incomplete");
    setAlertStateFilter("active");
    setEventActionFilter("all");
    setSearchQuery("");
  }

  function reloadProfiles() {
    setRefreshTick((current) => current + 1);
  }

  async function updateProfileCompletionAlertAck(sellerId: string, acknowledged: boolean) {
    const currentSession = await restoreAdminSession();
    if (!currentSession) {
      throw new Error("Admin session not available.");
    }

    if (acknowledged) {
      await api.acknowledgeAdminSellerProfileCompletion(sellerId, {
        accessToken: currentSession.access_token,
      });
    } else {
      await api.clearAdminSellerProfileCompletionAcknowledgement(sellerId, {
        accessToken: currentSession.access_token,
      });
    }

    reloadProfiles();
  }

  return (
    <section className="space-y-6">
      <header className="rounded-[1.5rem] border border-border bg-white px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
              Seller profile completion
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
              Seller profile gaps the team should close
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={reloadProfiles}
              type="button"
            >
              Refresh
            </button>
            <button
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
          <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-foreground/72">
            Total · {counts.total}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
            Complete · {counts.complete}
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700">
            Incomplete · {counts.incomplete}
          </span>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700">
            Complete fields · {counts.verified}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["all", "incomplete", "complete"] as const).map((state) => (
            <button
              key={state}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                stateFilter === state
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/68"
              }`}
              onClick={() => setStateFilter(state)}
              type="button"
            >
              {state === "all" ? "All" : state === "incomplete" ? "Incomplete" : "Complete"}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["active", "acknowledged", "all"] as const).map((state) => (
            <button
              key={state}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                alertStateFilter === state
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/68"
              }`}
              onClick={() => setAlertStateFilter(state)}
              type="button"
            >
              {state === "active" ? "Active" : state === "acknowledged" ? "Acknowledged" : "All Alerts"}
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-foreground/52">
            Search sellers
          </span>
          <input
            className="w-full rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm outline-none transition focus:border-accent"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Seller name, slug, missing field"
          />
        </label>
        {latestIncompleteProfile ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold uppercase tracking-[0.16em]">
                  Next profile to finish
                </p>
                <p className="mt-1 text-base font-semibold">
                  {latestIncompleteProfile.seller_display_name}
                </p>
              </div>
              <Link
                className="rounded-full border border-amber-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-900 transition hover:border-amber-500 hover:text-amber-950"
                href={`/sellers/${latestIncompleteProfile.seller_slug}`}
              >
                Open seller
              </Link>
            </div>
            <p className="mt-2 text-sm leading-6">{latestIncompleteProfile.summary}</p>
          </div>
        ) : null}
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4 text-sm text-emerald-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold uppercase tracking-[0.16em]">Profile completion alerts</p>
              <p className="mt-1 text-base font-semibold">
                {profileCompletionAlertCounts.active} active · {profileCompletionAlertCounts.acknowledged} acknowledged
              </p>
            </div>
            {latestProfileCompletionAlert ? (
              <button
                className="rounded-full border border-emerald-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900 transition hover:border-emerald-500 hover:text-emerald-950"
                onClick={() =>
                  document
                    .getElementById(`profile-completion-alert-${latestProfileCompletionAlert.payload?.seller_id ?? ""}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                type="button"
              >
                Open latest alert
              </button>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {filteredProfileCompletionAlerts.length > 0 ? (
              filteredProfileCompletionAlerts.slice(0, 5).map((delivery) => {
                const payload = delivery.payload ?? {};
                const acknowledged = isCompletionAlertAcknowledged(delivery);
                const missingFields = Array.isArray(payload.missing_fields) ? payload.missing_fields : [];
                return (
                  <div
                    key={delivery.id}
                    id={`profile-completion-alert-${String(payload.seller_id ?? "")}`}
                    className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {String(payload.seller_display_name ?? "Seller")}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/52">
                          {String(payload.completion_percent ?? 0)}% complete
                          {missingFields.length > 0 ? ` · ${missingFields.join(" · ")}` : ""}
                        </p>
                        <p className="mt-1 text-sm text-foreground/68">
                          {String(payload.summary ?? "Finish the remaining profile fields.")}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            acknowledged
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {acknowledged ? "Acknowledged" : delivery.delivery_status}
                        </span>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            className="rounded-full border border-emerald-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-900 transition hover:border-emerald-500 hover:text-emerald-950"
                            href={`/sellers/${String(payload.seller_slug ?? "")}`}
                          >
                            Open seller
                          </Link>
                          {!acknowledged ? (
                            <button
                              className="rounded-full border border-emerald-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-900 transition hover:border-emerald-500 hover:text-emerald-950"
                              onClick={() =>
                                void updateProfileCompletionAlertAck(
                                  String(payload.seller_id ?? ""),
                                  true,
                                )
                              }
                              type="button"
                            >
                              Acknowledge
                            </button>
                          ) : (
                            <button
                              className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                              onClick={() =>
                                void updateProfileCompletionAlertAck(
                                  String(payload.seller_id ?? ""),
                                  false,
                                )
                              }
                              type="button"
                            >
                              Clear ack
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
          ) : (
              <p className="text-sm text-foreground/68">No profile completion alerts match the current filter.</p>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/60 px-4 py-4 text-sm text-sky-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold uppercase tracking-[0.16em]">Profile completion history</p>
              <p className="mt-1 text-base font-semibold">
                {profileCompletionEventCounts.acknowledged} acknowledged · {profileCompletionEventCounts.cleared} cleared
              </p>
            </div>
            {latestProfileCompletionEvent ? (
              <button
                className="rounded-full border border-sky-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-900 transition hover:border-sky-500 hover:text-sky-950"
                onClick={() =>
                  document
                    .getElementById(`profile-completion-event-${latestProfileCompletionEvent.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                type="button"
              >
                Open latest event
              </button>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["all", "acknowledged", "cleared"] as const).map((action) => (
              <button
                key={action}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  eventActionFilter === action
                    ? "border-sky-700 bg-sky-700 text-white"
                    : "border-sky-200 bg-white text-sky-900"
                }`}
                onClick={() => setEventActionFilter(action)}
                type="button"
              >
                {action === "all" ? "All" : action === "acknowledged" ? "Acknowledged" : "Cleared"}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {filteredProfileCompletionEvents.length > 0 ? (
              filteredProfileCompletionEvents.slice(0, 5).map((event) => {
                const missingFields = Array.isArray(event.missing_fields) ? event.missing_fields : [];
                return (
                  <div
                    key={event.id}
                    id={`profile-completion-event-${event.id}`}
                    className="rounded-2xl border border-sky-200 bg-white px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {event.seller_display_name}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/52">
                          {formatCompletionEventAction(event.action)} · {event.completion_percent}% complete
                          {missingFields.length > 0 ? ` · ${missingFields.join(" · ")}` : ""}
                        </p>
                        <p className="mt-1 text-sm text-foreground/68">{event.summary}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/48">
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                          {formatCompletionEventAction(event.action)}
                        </span>
                        <Link
                          className="rounded-full border border-sky-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-900 transition hover:border-sky-500 hover:text-sky-950"
                          href={`/sellers/${event.seller_slug}`}
                        >
                          Open seller
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-foreground/68">No profile completion events match the current filter.</p>
            )}
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[1.25rem] border border-border bg-white px-4 py-8 text-sm text-foreground/60">
          Loading seller profile completion...
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredProfiles.map((profile) => (
            <article key={profile.seller_id} className="rounded-[1.5rem] border border-border bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/48">
                    {profile.completion_percent}% complete
                  </p>
                  <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {profile.seller_display_name}
                  </h2>
                  <p className="text-sm text-foreground/58">@{profile.seller_slug}</p>
                </div>
                <span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClasses(profile.completion_percent)}`}>
                  {profile.is_complete ? "Complete" : "Needs work"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {profile.missing_fields.length > 0 ? (
                  profile.missing_fields.map((field) => (
                    <span
                      key={field}
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700"
                    >
                      {field} missing
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    All basics present
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground/66">{profile.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
                  href={`/sellers/${profile.seller_slug}`}
                >
                  Open seller
                </Link>
              </div>
            </article>
          ))}
          {!filteredProfiles.length ? (
            <div className="rounded-[1.25rem] border border-dashed border-border bg-white px-4 py-8 text-sm text-foreground/60">
              No seller profiles match the current filters.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
