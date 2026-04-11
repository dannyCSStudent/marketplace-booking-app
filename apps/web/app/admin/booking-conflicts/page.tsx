import { Suspense } from "react";

import { BookingConflictsPanel } from "@/app/admin/booking-conflicts/booking-conflicts-panel";

export default function AdminBookingConflictsPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Admin Automation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Booking conflicts lane
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/72">
            Backend booking conflicts emitted when overlapping requests or auto-accept checks flag
            a schedule issue. This lane tracks the resulting notification deliveries and gives ops
            a direct jump into the booking.
          </p>
        </section>

        <Suspense
          fallback={
            <section className="card-shadow rounded-[2rem] border border-border bg-surface p-6 text-sm text-foreground/66">
              Loading booking conflicts...
            </section>
          }
        >
          <BookingConflictsPanel />
        </Suspense>
      </div>
    </main>
  );
}
