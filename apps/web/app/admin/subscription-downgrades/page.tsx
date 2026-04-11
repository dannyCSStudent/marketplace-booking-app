import { Suspense } from "react";

import { SubscriptionDowngradesPanel } from "@/app/admin/subscription-downgrades/subscription-downgrades-panel";

export default function AdminSubscriptionDowngradesPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Monetization
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Subscription downgrades
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            Backend-triggered alerts for sellers who moved to a lower subscription tier or lost
            paid perks. This lane shows the emitted notification deliveries and the underlying
            subscription events behind them.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading subscription downgrades...
            </section>
          }
        >
          <SubscriptionDowngradesPanel />
        </Suspense>
      </div>
    </main>
  );
}
