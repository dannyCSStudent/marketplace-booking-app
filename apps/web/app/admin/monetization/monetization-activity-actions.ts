"use client";

import {
  MONETIZATION_EXPORT_EVENT,
  type MonetizationExportDetail,
  type MonetizationExportTarget,
} from "@/app/admin/monetization/monetization-export-events";
import {
  PROMOTION_DASHBOARD_FILTER_EVENT,
  type PromotionDashboardFilterDetail,
} from "@/app/admin/monetization/promotion-dashboard-filters";
import {
  SUBSCRIPTION_HISTORY_FILTER_EVENT,
  type SubscriptionHistoryFilterDetail,
} from "@/app/admin/monetization/subscription-history-filters";

export function triggerMonetizationExport(target: MonetizationExportTarget) {
  const detail: MonetizationExportDetail = { target };
  window.dispatchEvent(new CustomEvent(MONETIZATION_EXPORT_EVENT, { detail }));
}

export async function triggerMonetizationExportBundle(targets: MonetizationExportTarget[]) {
  for (const [index, target] of targets.entries()) {
    if (index > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    triggerMonetizationExport(target);
  }
}

export function applySubscriptionHistoryFilter(detail: SubscriptionHistoryFilterDetail) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_HISTORY_FILTER_EVENT, { detail }));
  document.getElementById("subscription-history-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function applyPromotionDashboardFilter(detail: PromotionDashboardFilterDetail) {
  window.dispatchEvent(new CustomEvent(PROMOTION_DASHBOARD_FILTER_EVENT, { detail }));
  document.getElementById("promotion-events-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export async function applyMonetizationWorkflow(options: {
  subscriptionDetail?: SubscriptionHistoryFilterDetail;
  promotionDetail?: PromotionDashboardFilterDetail;
  targets: MonetizationExportTarget[];
}) {
  if (options.subscriptionDetail) {
    applySubscriptionHistoryFilter(options.subscriptionDetail);
  }
  if (options.promotionDetail) {
    applyPromotionDashboardFilter(options.promotionDetail);
  }
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  await triggerMonetizationExportBundle(options.targets);
}
