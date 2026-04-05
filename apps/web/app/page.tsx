import { Suspense } from "react";
import { SellerWorkspace } from "@/app/components/seller-workspace";
import { formatCurrency, getMarketplaceData } from "@/app/lib/api";

const readinessItems = [
  "Live Supabase auth and table-backed API are active.",
  "Seeded seller, categories, and listings are available for demos.",
  "Orders and bookings can now be created against real rows.",
];

const buildNextItems = [
  "Add web auth so the seller can operate as themselves instead of demo mode.",
  "Ship create listing and update listing forms backed by authenticated routes.",
  "Expose incoming orders and bookings in the seller dashboard.",
];

const operationsChecklist = [
  "Seller profile is published and publicly addressable by slug.",
  "Mixed inventory model is working: product, service, and hybrid listings.",
  "Local fulfillment is visible in the catalog and ready for UI-specific controls.",
];

export default async function Home() {
  const { seller, listings, listingsTotal, apiBaseUrl } = await getMarketplaceData();
  const sellerListings = seller
    ? listings.filter((listing) => listing.seller_id === seller.id)
    : [];
  const productCount = sellerListings.filter((listing) => listing.type === "product").length;
  const serviceCount = sellerListings.filter((listing) => listing.type === "service").length;
  const hybridCount = sellerListings.filter((listing) => listing.type === "hybrid").length;
  const activeRevenueSurface = sellerListings.reduce(
    (total, listing) => total + (listing.price_cents ?? 0),
    0,
  );

  return (
    <main className="grain min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="card-shadow overflow-hidden rounded-[2rem] border border-border bg-surface-strong">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[1.4fr_0.9fr] lg:px-10 lg:py-10">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.28em] text-accent-deep/75">
                <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1">
                  Seller Ops Console
                </span>
                <span>Local marketplace + booking</span>
              </div>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl lg:text-6xl">
                  Run the seller side like an operating system, not a listing page.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-foreground/72 sm:text-lg">
                  This web app is now showing a real seller snapshot from your seeded backend.
                  It is the right shell for onboarding, listing management, and incoming
                  transaction workflows.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label="Seeded Listings"
                  value={String(sellerListings.length || listingsTotal)}
                  tone="accent"
                />
                <MetricCard
                  label="Visible Revenue Surface"
                  value={formatCurrency(activeRevenueSurface, "USD")}
                  tone="olive"
                />
                <MetricCard
                  label="API Source"
                  value="Live"
                  tone="gold"
                />
              </div>
            </div>

            <div className="card-shadow rounded-[1.6rem] border border-border bg-[#fff8ed] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/55">
                    Demo Seller
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                    {seller?.display_name ?? "Waiting for seller profile"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-foreground/68">
                    {seller?.bio ??
                      "Connect the seeded seller profile to see storefront details and listing ownership."}
                  </p>
                </div>
                <div className="rounded-2xl border border-accent/20 bg-accent px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white">
                  Live
                </div>
              </div>
              <div className="mt-6 grid gap-3 text-sm text-foreground/72">
                <InfoRow label="Slug" value={seller?.slug ?? "not loaded"} />
                <InfoRow
                  label="Location"
                  value={[seller?.city, seller?.state, seller?.country].filter(Boolean).join(", ") || "not set"}
                />
                <InfoRow
                  label="Custom Orders"
                  value={seller?.accepts_custom_orders ? "Enabled" : "Disabled"}
                />
                <InfoRow label="API Base URL" value={apiBaseUrl} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
                  Inventory Surface
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                  Listings ready for real seller workflows
                </h2>
              </div>
              <div className="flex gap-2 text-xs uppercase tracking-[0.2em] text-foreground/58">
                <span className="rounded-full border border-border px-3 py-2">
                  Product {productCount}
                </span>
                <span className="rounded-full border border-border px-3 py-2">
                  Service {serviceCount}
                </span>
                <span className="rounded-full border border-border px-3 py-2">
                  Hybrid {hybridCount}
                </span>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              {sellerListings.length > 0 ? (
                sellerListings.map((listing) => (
                  <article
                    key={listing.id}
                    className="rounded-[1.5rem] border border-border bg-white/70 p-5 transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-background">
                            {listing.type}
                          </span>
                          <span className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/48">
                            {listing.city}, {listing.state}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-2xl font-semibold tracking-[-0.04em]">
                            {listing.title}
                          </h3>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/68">
                            {listing.description}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-[1.25rem] border border-border bg-[#f9f1e2] px-4 py-3 text-right">
                        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/48">
                          Starting At
                        </p>
                        <p className="mt-1 text-xl font-semibold">
                          {formatCurrency(listing.price_cents, listing.currency)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-border bg-white/55 p-8 text-sm leading-6 text-foreground/66">
                  No seller-owned listings were returned. If the API is running, check that
                  `NEXT_PUBLIC_API_BASE_URL` points at the FastAPI service.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <Panel title="Platform Readiness" items={readinessItems} />
            <Panel title="Seller Console Goals" items={operationsChecklist} />
            <Panel title="Immediate Next Build" items={buildNextItems} accent />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="card-shadow rounded-[2rem] border border-border bg-[#213018] p-6 text-white">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/60">
              Demo Mode
            </p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-[-0.04em]">
              The dashboard is now anchored to real marketplace records, not starter copy.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/72">
              The next meaningful move is authenticated seller actions: create listing, edit
              inventory, and review incoming orders and bookings from one place.
            </p>
            <div className="mt-6 rounded-[1.5rem] border border-white/12 bg-white/8 p-4 font-mono text-xs leading-6 text-white/78">
              demo-seller@localmarket.test / ChangeMe123!
              <br />
              demo-buyer@localmarket.test / ChangeMe123!
            </div>
          </div>

          <div className="card-shadow rounded-[2rem] border border-border bg-surface p-6">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
              Why This Matters
            </p>
            <div className="mt-3 grid gap-4 text-sm leading-7 text-foreground/74 sm:grid-cols-3">
              <div className="rounded-[1.4rem] border border-border bg-white/65 p-4">
                Product listings prove local inventory can coexist with pickup and meetup.
              </div>
              <div className="rounded-[1.4rem] border border-border bg-white/65 p-4">
                Service listings prove booking can live in the same seller operating model.
              </div>
              <div className="rounded-[1.4rem] border border-border bg-white/65 p-4">
                Hybrid listings prove local commerce is broader than a plain marketplace clone.
              </div>
            </div>
          </div>
        </section>

        <Suspense fallback={null}>
          <SellerWorkspace />
        </Suspense>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "olive" | "gold";
}) {
  const tones = {
    accent: "bg-accent text-white",
    olive: "bg-olive text-white",
    gold: "bg-gold text-foreground",
  };

  return (
    <div className={`rounded-[1.4rem] p-4 ${tones[tone]}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] opacity-80">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/45">
        {label}
      </span>
      <span className="max-w-[65%] text-right">{value}</span>
    </div>
  );
}

function Panel({
  title,
  items,
  accent = false,
}: {
  title: string;
  items: string[];
  accent?: boolean;
}) {
  const panelClass = accent
    ? "border-accent/28 bg-[#fff0e8]"
    : "border-border bg-surface";

  return (
    <section className={`card-shadow rounded-[1.7rem] border p-5 ${panelClass}`}>
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">{title}</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div
            key={item}
            className="rounded-[1.2rem] border border-black/6 bg-white/62 px-4 py-3 text-sm leading-6 text-foreground/74"
          >
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}
