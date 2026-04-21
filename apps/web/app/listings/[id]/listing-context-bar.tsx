"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const RECENT_LISTING_HISTORY_KEY = "buyer_recent_listing_history";
const RECENT_LISTING_GROUPS_KEY = "buyer_recent_listing_groups";

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getLocationLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ") || "Location pending";
}

function readRecentListingHistory() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(RECENT_LISTING_HISTORY_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as RecentListingEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is RecentListingEntry =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof entry.id === "string" &&
            typeof entry.title === "string" &&
            typeof entry.summary === "string" &&
            typeof entry.createdAt === "string",
        ),
    );
  } catch {
    window.localStorage.removeItem(RECENT_LISTING_HISTORY_KEY);
    return [];
  }
}

function readCollapsedRecentListingGroups() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(RECENT_LISTING_GROUPS_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Record<string, boolean>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    window.localStorage.removeItem(RECENT_LISTING_GROUPS_KEY);
  }

  return {};
}

type RecentListingEntry = {
  id: string;
  title: string;
  sellerName: string | null;
  summary: string;
  createdAt: string;
};

type RecentListingGroup = {
  label: string;
  entries: RecentListingEntry[];
};

export function ListingContextBar({
  storefrontHref,
  listing,
  sellerDisplayName,
}: {
  storefrontHref?: string | null;
  listing: {
    id: string;
    title: string;
    type: string;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    price_cents: number | null;
    currency: string;
    available_today?: boolean | null;
    requires_booking?: boolean | null;
  };
  sellerDisplayName: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);
  const [storedRecentHistory, setStoredRecentHistory] = useState<RecentListingEntry[]>(
    readRecentListingHistory,
  );
  const [collapsedRecentGroups, setCollapsedRecentGroups] = useState<Record<string, boolean>>(
    readCollapsedRecentListingGroups,
  );
  const fromParam = searchParams.get("from");
  const safeFromHref =
    fromParam && fromParam.startsWith("/") && !fromParam.startsWith("//") ? fromParam : null;
  const currentHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const originSliceSummary = useMemo(() => {
    if (!safeFromHref) {
      return null;
    }

    const parsedUrl = new URL(safeFromHref, "https://marketplace.local");
    const params = parsedUrl.searchParams;
    const parts: string[] = [];
    const query = params.get("q")?.trim();
    const type = params.get("type");
    const sort = params.get("sort");
    const local = params.get("local");

    if (type && type !== "all") {
      parts.push(titleCaseLabel(type));
    }
    if (local === "1") {
      parts.push("Local Only");
    }
    if (sort === "price_low") {
      parts.push("Lowest Price");
    }
    if (sort === "price_high") {
      parts.push("Highest Price");
    }
    if (query) {
      parts.push(`Search: "${query}"`);
    }

    return parts.length > 0 ? parts.join(" · ") : "Default marketplace slice";
  }, [safeFromHref]);
  const listingSummary = useMemo(() => {
    const parts = [
      sellerDisplayName ? sellerDisplayName : null,
      listing.type,
      getLocationLabel([listing.city, listing.state, listing.country]),
      listing.available_today ? "Available today" : null,
      listing.requires_booking ? "Booking ready" : "Order ready",
    ].filter(Boolean);

    return parts.join(" · ");
  }, [
    listing.available_today,
    listing.city,
    listing.country,
    listing.requires_booking,
    listing.state,
    listing.type,
    sellerDisplayName,
  ]);
  const currentListingEntry = useMemo<RecentListingEntry>(
    () => ({
      id: listing.id,
      title: listing.title,
      sellerName: sellerDisplayName,
      summary: listingSummary,
      createdAt: listing.id,
    }),
    [listing.id, listing.title, listingSummary, sellerDisplayName],
  );
  const recentHistory = useMemo(
    () =>
      [currentListingEntry, ...storedRecentHistory.filter((entry) => entry.id !== currentListingEntry.id)].slice(
        0,
        4,
      ),
    [currentListingEntry, storedRecentHistory],
  );
  const groupedRecentHistory = useMemo<RecentListingGroup[]>(() => {
    const groups = new Map<string, RecentListingEntry[]>();

    recentHistory.forEach((entry) => {
      const sameSeller = entry.sellerName && sellerDisplayName && entry.sellerName === sellerDisplayName;
      const groupLabel = sameSeller
        ? "This seller"
        : entry.summary.includes("Available today")
          ? "Available today"
          : entry.summary.includes("Booking ready")
            ? "Booking ready"
            : "Other sellers";
      const current = groups.get(groupLabel) ?? [];
      current.push(entry);
      groups.set(groupLabel, current);
    });

    return [...groups.entries()]
      .map(([label, entries]) => ({ label, entries }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [recentHistory, sellerDisplayName]);
  const hasCollapsedRecentGroups = useMemo(
    () => Object.values(collapsedRecentGroups).some(Boolean),
    [collapsedRecentGroups],
  );
  const latestRecentListing = recentHistory.find((entry) => entry.id !== listing.id) ?? null;

  function clearRecentListingHistory() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(RECENT_LISTING_HISTORY_KEY);
    window.localStorage.removeItem(RECENT_LISTING_GROUPS_KEY);
    setStoredRecentHistory([]);
    setCollapsedRecentGroups({});
  }

  function toggleRecentGroup(groupLabel: string) {
    setCollapsedRecentGroups((current) => ({
      ...current,
      [groupLabel]: !current[groupLabel],
    }));
  }

  function openRecentListing(entry: RecentListingEntry) {
    setHistoryFeedback(`Reopened ${entry.title}`);
    window.setTimeout(() => setHistoryFeedback(null), 2000);
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECENT_LISTING_HISTORY_KEY, JSON.stringify(recentHistory));
  }, [recentHistory]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECENT_LISTING_GROUPS_KEY, JSON.stringify(collapsedRecentGroups));
  }, [collapsedRecentGroups]);

  async function copyCurrentListingLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkFeedback("Link copied");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    } catch {
      setLinkFeedback("Copy failed");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[1.25rem] border border-border bg-white/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
              Discovery Context
            </p>
            <p className="mt-2 text-sm text-foreground/72">
              {safeFromHref
                ? "Return to the catalog slice that led you here or copy this listing link."
                : "Copy this listing link or continue browsing the seller and marketplace surfaces."}
            </p>
            {originSliceSummary ? (
              <div className="mt-3 rounded-[1rem] border border-accent/20 bg-accent/8 px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-deep/72">
                  Seen In Browse
                </p>
                <div className="mt-2 inline-flex rounded-full border border-accent/18 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/72">
                  {originSliceSummary}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {historyFeedback ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                {historyFeedback}
              </span>
            ) : null}
            {linkFeedback ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                {linkFeedback}
              </span>
            ) : null}
            <button
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => void copyCurrentListingLink()}
              type="button"
            >
              Copy Listing Link
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {safeFromHref ? (
          <Link
            href={safeFromHref}
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Back to Previous Slice
          </Link>
        ) : null}
        {storefrontHref ? (
          <Link
            href={storefrontHref}
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Back to Storefront
          </Link>
        ) : null}
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
        >
          Marketplace Home
        </Link>
        {hasCollapsedRecentGroups ? (
          <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/60">
            Recent listings partially collapsed
          </span>
        ) : null}
        {latestRecentListing ? (
          <Link
            href={`/listings/${latestRecentListing.id}?from=${encodeURIComponent(currentHref)}`}
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Open latest listing · {latestRecentListing.title}
          </Link>
        ) : null}
      </div>

      {recentHistory.length > 1 ? (
        <div className="rounded-[1.25rem] border border-border bg-white/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                Recently Viewed Listings
              </p>
              <p className="mt-2 text-sm text-foreground/72">
                Jump back into listings you opened from this browser.
              </p>
            </div>
            <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">
              {recentHistory.length} saved view{recentHistory.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearRecentListingHistory}
              className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
            >
              Clear history
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {groupedRecentHistory.map((group) => (
              <div key={group.label} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
                    {group.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleRecentGroup(group.label)}
                    className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
                  >
                    {collapsedRecentGroups[group.label] ? "Expand" : "Collapse"}
                  </button>
                </div>
                {collapsedRecentGroups[group.label] ? (
                  <p className="rounded-[1.15rem] border border-dashed border-border bg-background/35 px-4 py-3 text-xs uppercase tracking-[0.14em] text-foreground/54">
                    {group.entries.length} listing{group.entries.length === 1 ? "" : "s"} hidden in
                    this group.
                  </p>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    {group.entries
                      .filter((entry) => entry.id !== listing.id)
                      .map((entry) => (
                        <Link
                          key={`${entry.id}:${entry.createdAt}`}
                          href={`/listings/${entry.id}?from=${encodeURIComponent(currentHref)}`}
                          onClick={() => openRecentListing(entry)}
                          className="rounded-[1.15rem] border border-border bg-background/45 px-4 py-4 transition hover:-translate-y-0.5 hover:border-accent"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                              Listing
                            </span>
                            {entry.sellerName ? (
                              <span className="rounded-full border border-border bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                                {entry.sellerName}
                              </span>
                            ) : null}
                            <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-deep">
                              Re-open
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-foreground">{entry.title}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-foreground/50">
                            {entry.summary}
                          </p>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
