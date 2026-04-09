"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import type { MonetizationActivityEntry } from "@/app/admin/monetization/monetization-preferences-types";

type MonetizationActivityContextValue = {
  entries: MonetizationActivityEntry[];
  recordActivity: (activity: Omit<MonetizationActivityEntry, "id" | "createdAt">) => void;
};

const MAX_ENTRIES = 8;

const MonetizationActivityContext = createContext<MonetizationActivityContextValue | null>(null);

export function MonetizationActivityProvider({ children }: { children: ReactNode }) {
  const {
    preferences: { activityLog: entries },
    setActivityLog,
  } = useMonetizationPreferences();

  const value = useMemo<MonetizationActivityContextValue>(
    () => ({
      entries,
      recordActivity: (activity) => {
        setActivityLog((current) => [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            ...activity,
          },
          ...current,
        ].slice(0, MAX_ENTRIES));
      },
    }),
    [entries, setActivityLog],
  );

  return <MonetizationActivityContext.Provider value={value}>{children}</MonetizationActivityContext.Provider>;
}

export function useMonetizationActivity() {
  const context = useContext(MonetizationActivityContext);
  if (!context) {
    throw new Error("useMonetizationActivity must be used within MonetizationActivityProvider");
  }
  return context;
}
