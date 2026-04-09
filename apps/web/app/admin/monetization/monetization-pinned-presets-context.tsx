"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useMonetizationPreferences } from "@/app/admin/monetization/monetization-preferences-context";
import { sortMonetizationPresetIdsByDefaultOrder } from "@/app/admin/monetization/monetization-preset-lookup";

type MonetizationPinnedPresetsContextValue = {
  pinnedPresetIds: string[];
  isPinned: (id: string) => boolean;
  togglePinnedPreset: (id: string) => void;
  movePinnedPresetEarlier: (id: string) => void;
  movePinnedPresetLater: (id: string) => void;
  resetPinnedPresetOrder: () => void;
};

const MonetizationPinnedPresetsContext = createContext<MonetizationPinnedPresetsContextValue | null>(null);

export function MonetizationPinnedPresetsProvider({ children }: { children: ReactNode }) {
  const {
    preferences: { pinnedPresetIds },
    setPinnedPresetIds,
  } = useMonetizationPreferences();

  const value = useMemo<MonetizationPinnedPresetsContextValue>(
    () => ({
      pinnedPresetIds,
      isPinned: (id) => pinnedPresetIds.includes(id),
      togglePinnedPreset: (id) => {
        setPinnedPresetIds((current) =>
          current.includes(id) ? current.filter((entry) => entry !== id) : [id, ...current],
        );
      },
      movePinnedPresetEarlier: (id) => {
        setPinnedPresetIds((current) => {
          const index = current.indexOf(id);
          if (index <= 0) {
            return current;
          }
          const next = [...current];
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          return next;
        });
      },
      movePinnedPresetLater: (id) => {
        setPinnedPresetIds((current) => {
          const index = current.indexOf(id);
          if (index === -1 || index >= current.length - 1) {
            return current;
          }
          const next = [...current];
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
          return next;
        });
      },
      resetPinnedPresetOrder: () => {
        setPinnedPresetIds((current) => sortMonetizationPresetIdsByDefaultOrder(current));
      },
    }),
    [pinnedPresetIds, setPinnedPresetIds],
  );

  return (
    <MonetizationPinnedPresetsContext.Provider value={value}>
      {children}
    </MonetizationPinnedPresetsContext.Provider>
  );
}

export function useMonetizationPinnedPresets() {
  const context = useContext(MonetizationPinnedPresetsContext);
  if (!context) {
    throw new Error("useMonetizationPinnedPresets must be used within MonetizationPinnedPresetsProvider");
  }
  return context;
}
