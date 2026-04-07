import Link from "next/link";
import { Suspense } from "react";

import { DeliveryOpsPanel } from "@/app/admin/deliveries/delivery-ops-panel";

export default function AdminDeliveriesPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                Admin Operations
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
                Delivery queue
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground/72">
                Internal delivery retry and notification triage for operational readiness.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-foreground hover:text-foreground"
                href="/listings/export"
                passHref={false}
              >
                Download listings CSV
              </Link>
              <Link
                className="rounded-full border border-border bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent transition hover:border-accent hover:text-accent"
                href="/admin/pricing-audit"
                passHref={false}
              >
                View pricing audit
              </Link>
            </div>
          </div>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading delivery operations queue...
            </section>
          }
        >
          <DeliveryOpsPanel />
        </Suspense>
      </div>
    </main>
  );
}
