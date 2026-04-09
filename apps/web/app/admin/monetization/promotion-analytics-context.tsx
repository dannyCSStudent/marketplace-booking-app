"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  createApiClient,
  type Listing,
  type ListingPromotionDetail,
  type ListingPromotionEvent,
  type ListingPromotionSummary,
} from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";
import type { PromotionListingTypeFilter } from "@/app/admin/monetization/promotion-listing-focus";
import { normalizePromotionListingType } from "@/app/admin/monetization/promotion-formatting";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export type PromotedListingRecord = {
  id: string;
  title: string;
  seller_name: string;
  type: PromotionListingTypeFilter;
};

type PromotionAnalyticsContextValue = {
  events: ListingPromotionEvent[];
  summary: Array<{
    label: string;
    count: number;
    type: PromotionListingTypeFilter;
  }>;
  listingTypeById: Record<string, PromotionListingTypeFilter>;
  promotedListings: PromotedListingRecord[];
  status: "idle" | "loading" | "error";
  error: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  removePromotion: (listingId: string) => Promise<void>;
  removingId: string | null;
};

const PromotionAnalyticsContext = createContext<PromotionAnalyticsContextValue | null>(null);

export function PromotionAnalyticsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<ListingPromotionEvent[]>([]);
  const [summary, setSummary] = useState<
    Array<{ label: string; count: number; type: PromotionListingTypeFilter }>
  >([]);
  const [promotedListings, setPromotedListings] = useState<PromotedListingRecord[]>([]);
  const [listingTypeById, setListingTypeById] = useState<Record<string, PromotionListingTypeFilter>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const api = useMemo(() => createApiClient(CLIENT_API_BASE_URL), []);

  const fetchAll = async () => {
    setStatus("loading");
    setError(null);

    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to view promotion analytics.");
        return;
      }

      const [summaryRows, eventRows, listingRows, promotedRows] = await Promise.all([
        api.listPromotionSummary({ accessToken: session.access_token }),
        api.listPromotionEvents({ accessToken: session.access_token }),
        api.get<{ items: Listing[]; total: number }>("/listings", { accessToken: session.access_token }),
        api.listPromotedListings({ accessToken: session.access_token }),
      ]);

      const typeById = Object.fromEntries(
        listingRows.items.map((listing) => [
          listing.id,
          ((listing.type as PromotionListingTypeFilter | undefined) ?? "unknown"),
        ]),
      );

      setListingTypeById(typeById);
      setSummary(
        summaryRows
          .map((entry: ListingPromotionSummary) => ({
            label: entry.type.toUpperCase(),
            count: entry.count,
            type: normalizePromotionListingType(entry.type),
          }))
          .sort((left, right) => right.count - left.count),
      );
      setEvents(eventRows);
      setPromotedListings(
        promotedRows.slice(0, 5).map((entry: ListingPromotionDetail) => ({
          id: entry.id,
          title: entry.title,
          seller_name: entry.seller_id,
          type: typeById[entry.id] ?? "unknown",
        })),
      );
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load promotion analytics.");
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchAll();
    })();
  }, []);

  const removePromotion = async (listingId: string) => {
    setRemovingId(listingId);
    setStatus("loading");
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to update promoted listings.");
        setRemovingId(null);
        return;
      }

      await api.promoteListing(listingId, { is_promoted: false }, { accessToken: session.access_token });
      await fetchAll();
      setRemovingId(null);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to remove promotion.");
      setRemovingId(null);
    }
  };

  const value = useMemo<PromotionAnalyticsContextValue>(
    () => ({
      events,
      summary,
      listingTypeById,
      promotedListings,
      status,
      error,
      lastUpdated,
      refresh: fetchAll,
      removePromotion,
      removingId,
    }),
    [events, summary, listingTypeById, promotedListings, status, error, lastUpdated, removingId],
  );

  return (
    <PromotionAnalyticsContext.Provider value={value}>
      {children}
    </PromotionAnalyticsContext.Provider>
  );
}

export function usePromotionAnalytics() {
  const context = useContext(PromotionAnalyticsContext);
  if (!context) {
    throw new Error("usePromotionAnalytics must be used within PromotionAnalyticsProvider");
  }
  return context;
}
