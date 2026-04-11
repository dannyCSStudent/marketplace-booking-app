import { Suspense } from "react";

import { InventoryAlertsPanel } from "@/app/admin/inventory-alerts/inventory-alerts-panel";

export default function AdminInventoryAlertsPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Automation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Inventory alerts lane
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            Automated seller inventory alerts emitted from listing writes when stock is low or out
            of stock. This lane tracks the resulting notification deliveries so ops can review the
            alert load and jump back into the affected seller or listing.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading inventory alerts...
            </section>
          }
        >
          <InventoryAlertsPanel />
        </Suspense>
      </div>
    </main>
  );
}
