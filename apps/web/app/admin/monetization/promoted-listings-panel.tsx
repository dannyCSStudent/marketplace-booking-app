"use client";

import { useEffect, useMemo } from "react";

import {
  PROMOTION_LISTING_FOCUS_EVENT,
  type PromotionListingFocusDetail,
  type PromotionListingTypeFilter,
} from "@/app/admin/monetization/promotion-listing-focus";
import {
  PROMOTION_DASHBOARD_FILTER_EVENT,
  type PromotionDashboardFilterDetail,
} from "@/app/admin/monetization/promotion-dashboard-filters";
import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
} from "@/app/admin/monetization/monetization-export-events";
import { highlightMonetizationSection, scrollToMonetizationSection } from "@/app/admin/monetization/monetization-navigation";
import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { usePromotionAnalytics } from "@/app/admin/monetization/promotion-analytics-context";
import { escapeCsvValue } from "@/app/admin/monetization/promotion-formatting";

type SellerSegmentFilter = "all" | "multi_listing_sellers" | "single_listing_sellers";

export default function PromotedListingsPanel() {
  const { preferences, setPromotionDashboard } = useMonetizationPreferences();
  const {
    promotedListings: listings,
    status,
    error,
    lastUpdated,
    removePromotion,
    removingId,
  } = usePromotionAnalytics();
  const { segmentFilter, typeFilter } = preferences.promotionDashboard;

  useEffect(() => {
    const handleFocusEvent = (event: Event) => {
      const detail = (event as CustomEvent<PromotionListingFocusDetail>).detail;
      if (!detail?.type) {
        return;
      }
      setPromotionDashboard((current) => ({ ...current, typeFilter: detail.type }));
      scrollToMonetizationSection("promoted-listings-panel");
    };

    window.addEventListener(PROMOTION_LISTING_FOCUS_EVENT, handleFocusEvent);
    return () => {
      window.removeEventListener(PROMOTION_LISTING_FOCUS_EVENT, handleFocusEvent);
    };
  }, [setPromotionDashboard]);

  useEffect(() => {
    const handleFilterEvent = (event: Event) => {
      const detail = (event as CustomEvent<PromotionDashboardFilterDetail>).detail;
      if (!detail) {
        return;
      }
      setPromotionDashboard((current) => ({
        ...current,
        typeFilter: detail.typeFilter ?? current.typeFilter,
        segmentFilter: (detail.segmentFilter as SellerSegmentFilter | undefined) ?? current.segmentFilter,
      }));
      scrollToMonetizationSection("promoted-listings-panel");
    };

    window.addEventListener(PROMOTION_DASHBOARD_FILTER_EVENT, handleFilterEvent);
    return () => {
      window.removeEventListener(PROMOTION_DASHBOARD_FILTER_EVENT, handleFilterEvent);
    };
  }, [setPromotionDashboard]);

  const exportCsv = () => {
    if (filteredListings.length === 0) {
      return;
    }
    const rows = filteredListings.map((listing) => [
      listing.id,
      listing.title,
      listing.seller_name,
      listing.type,
      "promoted",
      segmentFilter,
      typeFilter,
    ]);
    const csv = [[
      "listing_id",
      "title",
      "seller_id",
      "listing_type",
      "status",
      "active_segment",
      "active_type_filter",
    ], ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `promoted-listings-${segmentFilter}-${typeFilter}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sellerListingCounts = useMemo(
    () =>
      listings.reduce<Record<string, number>>((acc, listing) => {
        acc[listing.seller_name] = (acc[listing.seller_name] ?? 0) + 1;
        return acc;
      }, {}),
    [listings],
  );

  const listingSummary = useMemo(
    () => ({
      all: listings.length,
      multi_listing_sellers: listings.filter((listing) => sellerListingCounts[listing.seller_name] > 1).length,
      single_listing_sellers: listings.filter((listing) => sellerListingCounts[listing.seller_name] === 1).length,
    }),
    [listings, sellerListingCounts],
  );

  const typeSummary = useMemo(
    () => ({
      all: listings.length,
      product: listings.filter((listing) => listing.type === "product").length,
      service: listings.filter((listing) => listing.type === "service").length,
      hybrid: listings.filter((listing) => listing.type === "hybrid").length,
      unknown: listings.filter((listing) => listing.type === "unknown").length,
    }),
    [listings],
  );

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      const matchesSegment =
        segmentFilter === "all"
          ? true
          : segmentFilter === "multi_listing_sellers"
            ? sellerListingCounts[listing.seller_name] > 1
            : sellerListingCounts[listing.seller_name] === 1;
      const matchesType = typeFilter === "all" ? true : listing.type === typeFilter;
      return matchesSegment && matchesType;
    });
  }, [listings, segmentFilter, sellerListingCounts, typeFilter]);

  useEffect(() => {
    const handleExportEvent = (event: Event) => {
      const detail = (event as CustomEvent<MonetizationExportDetail>).detail;
      if (detail?.target !== "promoted_listings") {
        return;
      }
      highlightMonetizationSection("promoted-listings-panel");
      exportCsv();
    };

    window.addEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    return () => {
      window.removeEventListener(MONETIZATION_EXPORT_EVENT, handleExportEvent);
    };
  }, [filteredListings, segmentFilter, typeFilter]);

  const renderBody = () => {
    if (!lastUpdated && !error && listings.length === 0) {
      return <p className="text-sm text-foreground/66">Awaiting promoted listings…</p>;
    }

    if (status === "loading") {
      return <p className="text-sm text-foreground/66">Loading promoted listings…</p>;
    }

    if (error) {
      return <p className="text-sm text-rose-600">{error}</p>;
    }

    if (filteredListings.length === 0) {
      return <p className="text-sm text-foreground/66">No promoted listings right now.</p>;
    }

    return (
      <ul className="space-y-2 text-sm">
        {filteredListings.map((listing) => (
          <li key={listing.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-background px-4 py-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-foreground">{listing.title}</p>
              <p className="text-xs text-foreground/60">Seller ID {listing.seller_name}</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
              <span className="rounded-full border border-[#b94c23]/30 bg-[#fbe8dd] px-3 py-1 text-[#b94c23]">Promoted</span>
              <button
                type="button"
                disabled={removingId === listing.id}
                className="rounded-full border border-foreground/30 px-3 py-1 text-[10px] font-semibold text-foreground transition hover:border-foreground hover:text-foreground disabled:border-border/30 disabled:text-foreground/40"
                onClick={() => {
                  void removePromotion(listing.id);
                }}
              >
                {removingId === listing.id ? "Removing…" : "Remove"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section id="promoted-listings-panel" className="rounded-4xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Promoted listings</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Featured inventory</h2>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-foreground/56">{lastUpdated ?? "Awaiting data…"}</p>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground/90"
            onClick={exportCsv}
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SegmentSummaryCard
          label="All promoted"
          value={String(listingSummary.all)}
          active={segmentFilter === "all"}
          onClick={() => setPromotionDashboard((current) => ({ ...current, segmentFilter: "all" }))}
        />
        <SegmentSummaryCard
          label="Multi-listing sellers"
          value={String(listingSummary.multi_listing_sellers)}
          active={segmentFilter === "multi_listing_sellers"}
          onClick={() =>
            setPromotionDashboard((current) => ({
              ...current,
              segmentFilter: "multi_listing_sellers",
            }))
          }
        />
        <SegmentSummaryCard
          label="Single-listing sellers"
          value={String(listingSummary.single_listing_sellers)}
          active={segmentFilter === "single_listing_sellers"}
          onClick={() =>
            setPromotionDashboard((current) => ({
              ...current,
              segmentFilter: "single_listing_sellers",
            }))
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["all", "product", "service", "hybrid", "unknown"] as const).map((type) => (
          <button
            key={type}
            type="button"
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
              typeFilter === type
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:border-foreground hover:text-foreground/90"
            }`}
            onClick={() => setPromotionDashboard((current) => ({ ...current, typeFilter: type }))}
          >
            {type === "all" ? `All types (${typeSummary.all})` : `${type} (${typeSummary[type]})`}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">{renderBody()}</div>
    </section>
  );
}

function SegmentSummaryCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-[1.3rem] border px-4 py-4 text-left transition ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border/60 bg-background hover:border-foreground/40 hover:bg-white"
      }`}
      onClick={onClick}
    >
      <p
        className={`font-mono text-[11px] uppercase tracking-[0.2em] ${
          active ? "text-background/72" : "text-foreground/48"
        }`}
      >
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </button>
  );
}
