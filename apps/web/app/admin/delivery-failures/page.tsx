import { Suspense } from "react";

import { DeliveryFailuresPanel } from "@/app/admin/delivery-failures/delivery-failures-panel";

export default function AdminDeliveryFailuresPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Automation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Delivery failures lane
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            Worker-side notification failures that exhausted retries. This lane tracks the queued
            alert deliveries that fire after a notification row hits its final failure state, and
            lets operators retry the original delivery or manage the acknowledge / clear history
            from one place.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading delivery failures...
            </section>
          }
        >
          <DeliveryFailuresPanel />
        </Suspense>
      </div>
    </main>
  );
}
