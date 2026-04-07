import { createApiClient } from "@/app/lib/api";
import PlatformFeeForm from "@/app/admin/monetization/platform-fee-form";
import PlatformFeeSummary from "@/app/admin/monetization/platform-fee-summary";
import PlatformFeeHistory from "@/app/admin/monetization/platform-fee-history";
import PromotedListingsPanel from "@/app/admin/monetization/promoted-listings-panel";
import PromotionEventsPanel from "@/app/admin/monetization/promotion-events-panel";
import PromotionHeatmap from "@/app/admin/monetization/promotion-heatmap";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function getServerApiBaseUrl() {
  return process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function getClientApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export default async function AdminMonetizationPage() {
  const api = createApiClient(getServerApiBaseUrl());
  const activeFee = await api.getPlatformFees({ cache: "no-store" });
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

        <PromotionHeatmap />
        <PlatformFeeSummary />
        <PlatformFeeHistory />
        <PromotedListingsPanel />
        <PromotionEventsPanel />
        <section className="rounded-[2rem] border border-border bg-white p-6">
          <PlatformFeeForm activeFee={activeFee} apiBaseUrl={getClientApiBaseUrl()} />
        </section>
      </div>
    </main>
  );
}
