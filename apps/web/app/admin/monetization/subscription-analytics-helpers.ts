import type {
  SellerSubscriptionEventRead,
  SellerSubscriptionRead,
  SubscriptionTierRead,
} from "@/app/lib/api";

export type SubscriptionPerkKey = "analytics" | "priority" | "storefront";

export type SubscriptionPlanDiff = {
  priceDeltaCents: number;
  gainedPerks: string[];
  lostPerks: string[];
  unchangedPerks: string[];
};

export type SubscriptionEventDestructiveMeta = {
  priceDeltaCents: number;
  lostPerks: string[];
  hasValueDrop: boolean;
  hasPerkRemoval: boolean;
  isDestructive: boolean;
};

export function formatSubscriptionPerkLabel(key: SubscriptionPerkKey) {
  if (key === "analytics") {
    return "Analytics";
  }
  if (key === "priority") {
    return "Priority visibility";
  }
  return "Premium storefront";
}

export function buildSubscriptionPlanDiff(
  currentSubscription: Pick<
    SellerSubscriptionRead,
    | "monthly_price_cents"
    | "analytics_enabled"
    | "priority_visibility"
    | "premium_storefront"
  > | null,
  nextTier: Pick<
    SubscriptionTierRead,
    | "monthly_price_cents"
    | "analytics_enabled"
    | "priority_visibility"
    | "premium_storefront"
  > | null,
): SubscriptionPlanDiff | null {
  if (!nextTier) {
    return null;
  }

  const currentMonthlyPriceCents = currentSubscription?.monthly_price_cents ?? 0;
  const nextMonthlyPriceCents = nextTier.monthly_price_cents ?? 0;
  const priceDeltaCents = nextMonthlyPriceCents - currentMonthlyPriceCents;
  const gainedPerks: string[] = [];
  const lostPerks: string[] = [];
  const unchangedPerks: string[] = [];
  const perkDefinitions = [
    {
      key: "analytics" as const,
      current: Boolean(currentSubscription?.analytics_enabled),
      next: Boolean(nextTier.analytics_enabled),
    },
    {
      key: "priority" as const,
      current: Boolean(currentSubscription?.priority_visibility),
      next: Boolean(nextTier.priority_visibility),
    },
    {
      key: "storefront" as const,
      current: Boolean(currentSubscription?.premium_storefront),
      next: Boolean(nextTier.premium_storefront),
    },
  ];

  perkDefinitions.forEach((perk) => {
    const label = formatSubscriptionPerkLabel(perk.key);
    if (!perk.current && perk.next) {
      gainedPerks.push(label);
      return;
    }
    if (perk.current && !perk.next) {
      lostPerks.push(label);
      return;
    }
    if (perk.next) {
      unchangedPerks.push(label);
    }
  });

  return {
    priceDeltaCents,
    gainedPerks,
    lostPerks,
    unchangedPerks,
  };
}

export function buildSubscriptionEventDestructiveMeta(
  event: Pick<
    SellerSubscriptionEventRead,
    "action" | "from_tier_id" | "to_tier_id"
  >,
  tiersById: Record<string, SubscriptionTierRead>,
): SubscriptionEventDestructiveMeta {
  const fromTier = event.from_tier_id ? tiersById[event.from_tier_id] : undefined;
  const toTier = event.to_tier_id ? tiersById[event.to_tier_id] : undefined;
  const planDiff = buildSubscriptionPlanDiff(fromTier ?? null, toTier ?? null);
  const priceDeltaCents = planDiff?.priceDeltaCents ?? 0;
  const lostPerks = planDiff?.lostPerks ?? [];
  const hasValueDrop = priceDeltaCents < 0;
  const hasPerkRemoval = lostPerks.length > 0;

  return {
    priceDeltaCents,
    lostPerks,
    hasValueDrop,
    hasPerkRemoval,
    isDestructive: event.action === "downgrade" || hasValueDrop || hasPerkRemoval,
  };
}
