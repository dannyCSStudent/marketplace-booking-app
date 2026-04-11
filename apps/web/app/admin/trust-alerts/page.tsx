import { Suspense } from "react";

import { TrustAlertsPanel } from "@/app/admin/trust-alerts/trust-alerts-panel";

export default function AdminTrustAlertsPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Trust
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Trust alerts lane
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            Dedicated seller-risk interventions driven by the backend trust queue. This lane is for
            cross-workspace trust monitoring, not review or transaction triage.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading trust alerts...
            </section>
          }
        >
          <TrustAlertsPanel />
        </Suspense>
      </div>
    </main>
  );
}
