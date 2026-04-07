import PricingAuditSummary from "@/app/admin/pricing-audit/pricing-audit-summary";

export default function AdminPricingAuditPage() {
  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="card-shadow rounded-[2rem] border border-border bg-surface-strong p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Pricing Insights
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground">
            Pricing comparison scope audit
          </h1>
          <p className="mt-4 text-sm leading-7 text-foreground/72">
            Counts of listings grouped by the comparison scope that produced the last saved price.
          </p>
        </section>

        <PricingAuditSummary />
      </div>
    </main>
  );
}
