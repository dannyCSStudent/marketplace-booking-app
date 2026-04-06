import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReceiptPanel } from "@/app/transactions/[kind]/[id]/receipt-panel";

export default async function TransactionReceiptPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;

  if ((kind !== "order" && kind !== "booking") || !id) {
    notFound();
  }

  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/48">
              Buyer Receipt
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
              {kind === "order" ? "Order confirmation" : "Booking confirmation"}
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Back to Marketplace
          </Link>
        </div>

        <Suspense fallback={null}>
          <ReceiptPanel kind={kind} id={id} />
        </Suspense>
      </div>
    </main>
  );
}
