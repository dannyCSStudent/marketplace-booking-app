import { Suspense } from "react";

import { OrderFraudWatchPanel } from "@/app/admin/order-fraud-watch/order-fraud-watch-panel";

export default function AdminOrderFraudWatchPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Automation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Order fraud watch lane
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            Buyer-triggered order exception bursts surfaced over a rolling window. This lane
            aggregates repeated cancellations after accepted orders, highlights the buyers with the
            strongest exception patterns, and lets operators review the latest affected order from
            one place.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading order fraud watch...
            </section>
          }
        >
          <OrderFraudWatchPanel />
        </Suspense>
      </div>
    </main>
  );
}
