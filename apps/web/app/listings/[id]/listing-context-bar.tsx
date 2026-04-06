"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

function titleCaseLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ListingContextBar({
  storefrontHref,
}: {
  storefrontHref?: string | null;
}) {
  const searchParams = useSearchParams();
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
  const fromParam = searchParams.get("from");
  const safeFromHref =
    fromParam && fromParam.startsWith("/") && !fromParam.startsWith("//") ? fromParam : null;
  const originSliceSummary = useMemo(() => {
    if (!safeFromHref) {
      return null;
    }

    const parsedUrl = new URL(safeFromHref, "https://marketplace.local");
    const params = parsedUrl.searchParams;
    const parts: string[] = [];
    const query = params.get("q")?.trim();
    const type = params.get("type");
    const sort = params.get("sort");
    const local = params.get("local");

    if (type && type !== "all") {
      parts.push(titleCaseLabel(type));
    }
    if (local === "1") {
      parts.push("Local Only");
    }
    if (sort === "price_low") {
      parts.push("Lowest Price");
    }
    if (sort === "price_high") {
      parts.push("Highest Price");
    }
    if (query) {
      parts.push(`Search: "${query}"`);
    }

    return parts.length > 0 ? parts.join(" · ") : "Default marketplace slice";
  }, [safeFromHref]);

  async function copyCurrentListingLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkFeedback("Link copied");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    } catch {
      setLinkFeedback("Copy failed");
      window.setTimeout(() => setLinkFeedback(null), 2000);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[1.25rem] border border-border bg-white/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/46">
              Discovery Context
            </p>
            <p className="mt-2 text-sm text-foreground/72">
              {safeFromHref
                ? "Return to the catalog slice that led you here or copy this listing link."
                : "Copy this listing link or continue browsing the seller and marketplace surfaces."}
            </p>
            {originSliceSummary ? (
              <div className="mt-3 rounded-[1rem] border border-accent/20 bg-accent/8 px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-deep/72">
                  Seen In Browse
                </p>
                <div className="mt-2 inline-flex rounded-full border border-accent/18 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/72">
                  {originSliceSummary}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {linkFeedback ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                {linkFeedback}
              </span>
            ) : null}
            <button
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => void copyCurrentListingLink()}
              type="button"
            >
              Copy Listing Link
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {safeFromHref ? (
          <Link
            href={safeFromHref}
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Back to Previous Slice
          </Link>
        ) : null}
        {storefrontHref ? (
          <Link
            href={storefrontHref}
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Back to Storefront
          </Link>
        ) : null}
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
        >
          Marketplace Home
        </Link>
      </div>
    </div>
  );
}
