import { Suspense } from "react";
import Link from "next/link";

import { BuyerActivityPanel } from "@/app/buyer/activity-panel";

export default function BuyerActivityPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/48">
              Buyer Activity
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Orders, bookings, and seller updates
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Marketplace Home
          </Link>
        </div>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading buyer activity...
            </section>
          }
        >
          <BuyerActivityPanel />
        </Suspense>
      </div>
    </main>
  );
}
