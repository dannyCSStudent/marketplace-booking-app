"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  ApiError,
  createApiClient,
  type SellerSubscriptionAssign,
  type SellerSubscriptionEventRead,
  type SellerSubscriptionRead,
  type SubscriptionTierCreate,
  type SubscriptionTierRead,
} from "@/app/lib/api";
import { invalidateMarketplaceCaches } from "@/app/lib/cache-invalidation";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type SubscriptionAnalyticsContextValue = {
  tiers: SubscriptionTierRead[];
  subscriptions: SellerSubscriptionRead[];
  events: SellerSubscriptionEventRead[];
  status: "idle" | "loading" | "error";
  error: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  createTier: (body: SubscriptionTierCreate) => Promise<void>;
  assignSubscription: (body: SellerSubscriptionAssign) => Promise<void>;
};

const SubscriptionAnalyticsContext = createContext<SubscriptionAnalyticsContextValue | null>(null);

export function SubscriptionAnalyticsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [tiers, setTiers] = useState<SubscriptionTierRead[]>([]);
  const [subscriptions, setSubscriptions] = useState<SellerSubscriptionRead[]>([]);
  const [events, setEvents] = useState<SellerSubscriptionEventRead[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const api = useMemo(() => createApiClient(CLIENT_API_BASE_URL), []);

  const fetchAll = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to view subscription analytics.");
        return;
      }

      const [tierRows, subscriptionRows, eventRows] = await Promise.all([
        api.listSubscriptionTiers({ accessToken: session.access_token }),
        api.listSellerSubscriptions({ accessToken: session.access_token }),
        api.listSellerSubscriptionEvents({ accessToken: session.access_token }),
      ]);
      setTiers(tierRows);
      setSubscriptions(subscriptionRows);
      setEvents(eventRows);
      setLastUpdated(new Date().toLocaleString());
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to load subscription analytics.");
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await fetchAll();
    })();
  }, [fetchAll]);

  const createTier = async (body: SubscriptionTierCreate) => {
    const session = await restoreAdminSession();
    if (!session) {
      throw new ApiError(401, "Sign in as an admin to create subscription tiers.");
    }

    await api.createSubscriptionTier(body, { accessToken: session.access_token });
    await fetchAll();
    await invalidateMarketplaceCaches();
    router.refresh();
  };

  const assignSubscription = async (body: SellerSubscriptionAssign) => {
    const session = await restoreAdminSession();
    if (!session) {
      throw new ApiError(401, "Sign in as an admin to assign subscriptions.");
    }

    await api.assignSellerSubscription(body, { accessToken: session.access_token });
    await fetchAll();
    await invalidateMarketplaceCaches();
    router.refresh();
  };

  const value: SubscriptionAnalyticsContextValue = {
    tiers,
    subscriptions,
    events,
    status,
    error,
    lastUpdated,
    refresh: fetchAll,
    createTier,
    assignSubscription,
  };

  return (
    <SubscriptionAnalyticsContext.Provider value={value}>
      {children}
    </SubscriptionAnalyticsContext.Provider>
  );
}

export function useSubscriptionAnalytics() {
  const context = useContext(SubscriptionAnalyticsContext);
  if (!context) {
    throw new Error("useSubscriptionAnalytics must be used within SubscriptionAnalyticsProvider");
  }
  return context;
}
