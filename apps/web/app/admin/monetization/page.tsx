import { createApiClient } from "@/app/lib/api";
import DeliveryFeeForm from "@/app/admin/monetization/delivery-fee-form";
import DeliveryFeeHistory from "@/app/admin/monetization/delivery-fee-history";
import MonetizationActivityLog from "@/app/admin/monetization/monetization-activity-log";
import { MonetizationActivityProvider } from "@/app/admin/monetization/monetization-activity-context";
import MonetizationExportCenter from "@/app/admin/monetization/monetization-export-center";
import { MonetizationPinnedPresetsProvider } from "@/app/admin/monetization/monetization-pinned-presets-context";
import { MonetizationPreferencesProvider } from "@/app/admin/monetization/monetization-preferences-context";
import MonetizationQuickAccess from "@/app/admin/monetization/monetization-quick-access";
import MonetizationViewPresets from "@/app/admin/monetization/monetization-view-presets";
import MonetizationWatchlist from "@/app/admin/monetization/monetization-watchlist";
import PlatformFeeForm from "@/app/admin/monetization/platform-fee-form";
import PlatformFeeSummary from "@/app/admin/monetization/platform-fee-summary";
import PlatformFeeHistory from "@/app/admin/monetization/platform-fee-history";
import SellerSubscriptionsPanel from "@/app/admin/monetization/seller-subscriptions-panel";
import { SubscriptionAnalyticsProvider } from "@/app/admin/monetization/subscription-analytics-context";
import SubscriptionHistoryPanel from "@/app/admin/monetization/subscription-history-panel";
import PromotedListingsPanel from "@/app/admin/monetization/promoted-listings-panel";
import { PromotionAnalyticsProvider } from "@/app/admin/monetization/promotion-analytics-context";
import PromotionEventsPanel from "@/app/admin/monetization/promotion-events-panel";
import PromotionHeatmap from "@/app/admin/monetization/promotion-heatmap";
import PromotionOverviewCard from "@/app/admin/monetization/promotion-overview-card";
import SubscriptionSummaryPanel from "@/app/admin/monetization/subscription-summary-panel";
import SubscriptionTiersPanel from "@/app/admin/monetization/subscription-tiers-panel";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function getServerApiBaseUrl() {
  return process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function getClientApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export default async function AdminMonetizationPage() {
  const api = createApiClient(getServerApiBaseUrl());
  const [activeFee, activeDeliveryFees] = await Promise.all([
    api.getPlatformFees({ cache: "no-store" }),
    api.getDeliveryFees({ cache: "no-store" }),
  ]);
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                Monetization
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
                Platform fee configuration
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
                Control the platform fee that is automatically added to every order and booking.
                Create a new rate to take effect immediately and keep a record of historical changes.
              </p>
            </div>
          </div>
        </section>

        <MonetizationPreferencesProvider>
          <PromotionAnalyticsProvider>
            <MonetizationPinnedPresetsProvider>
              <MonetizationActivityProvider>
                <MonetizationQuickAccess />
                <MonetizationExportCenter />
                <MonetizationViewPresets />
                <MonetizationActivityLog />
                <PromotionOverviewCard />
                <PromotionHeatmap />
                <PromotedListingsPanel />
                <PromotionEventsPanel />
                <PlatformFeeSummary />
                <PlatformFeeHistory />
                <DeliveryFeeHistory />
                <SubscriptionAnalyticsProvider>
                  <MonetizationWatchlist />
                  <SubscriptionSummaryPanel />
                  <SubscriptionHistoryPanel />
                  <SubscriptionTiersPanel />
                  <SellerSubscriptionsPanel />
                </SubscriptionAnalyticsProvider>
              </MonetizationActivityProvider>
            </MonetizationPinnedPresetsProvider>
          </PromotionAnalyticsProvider>
        </MonetizationPreferencesProvider>
        <section className="rounded-[2rem] border border-border bg-white p-6">
          <PlatformFeeForm activeFee={activeFee} apiBaseUrl={getClientApiBaseUrl()} />
        </section>
        <section className="rounded-[2rem] border border-border bg-white p-6">
          <DeliveryFeeForm activeFees={activeDeliveryFees} apiBaseUrl={getClientApiBaseUrl()} />
        </section>
      </div>
    </main>
  );
}
