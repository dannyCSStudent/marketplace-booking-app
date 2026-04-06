import { Suspense } from "react";

import { TransactionSupportPanel } from "@/app/admin/transactions/transaction-support-panel";

export default function AdminTransactionsPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Support
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Transactions queue
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            This is the internal order and booking support queue for transaction visibility,
            status history, and buyer or seller issue triage.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading transactions queue...
            </section>
          }
        >
          <TransactionSupportPanel />
        </Suspense>
      </div>
    </main>
  );
}
