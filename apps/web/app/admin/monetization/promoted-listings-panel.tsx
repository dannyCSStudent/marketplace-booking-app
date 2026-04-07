"use client";

import { useEffect, useState } from "react";

import { ApiError, createApiClient, type ListingPromotionDetail } from "@/app/lib/api";
import { restoreAdminSession } from "@/app/lib/admin-auth";

const CLIENT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type PromotedListing = {
  id: string;
  title: string;
  seller_name: string;
};

export default function PromotedListingsPanel() {
  const [listings, setListings] = useState<PromotedListing[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchPromotedListings = async (accessToken: string) => {
    const api = createApiClient(CLIENT_API_BASE_URL);
    const data = await api.listPromotedListings({ accessToken });
    return data
      .slice(0, 5)
      .map((entry: ListingPromotionDetail) => ({
        id: entry.id,
        title: entry.title,
        seller_name: entry.seller_id,
      }));
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setStatus("loading");
      setError(null);
      try {
        const session = await restoreAdminSession();
        if (!session) {
          if (!cancelled) {
            setStatus("error");
            setError("Sign in as an admin to monitor promoted listings.");
          }
          return;
        }

        if (cancelled) {
          return;
        }

        const promoted = await fetchPromotedListings(session.access_token);
        if (cancelled) {
          return;
        }
        setListings(promoted);
        setLastFetchedAt(new Date().toLocaleString());
        setStatus("idle");
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "Unable to load promoted listings.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const removePromotion = async (listingId: string) => {
    setRemovingId(listingId);
    setStatus("loading");
    setError(null);
    try {
      const session = await restoreAdminSession();
      if (!session) {
        setStatus("error");
        setError("Sign in as an admin to update promoted listings.");
        setRemovingId(null);
        return;
      }

      const api = createApiClient(CLIENT_API_BASE_URL);
      await api.promoteListing(listingId, { is_promoted: false }, { accessToken: session.access_token });
      const promoted = await fetchPromotedListings(session.access_token);
      setListings(promoted);
      setLastFetchedAt(new Date().toLocaleString());
      setStatus("idle");
      setRemovingId(null);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Unable to remove promotion.");
      setRemovingId(null);
    }
  };

  const renderBody = () => {
    if (status === "loading") {
      return <p className="text-sm text-foreground/66">Loading promoted listings…</p>;
    }

    if (error) {
      return <p className="text-sm text-rose-600">{error}</p>;
    }

    if (listings.length === 0) {
      return <p className="text-sm text-foreground/66">No promoted listings right now.</p>;
    }

    return (
      <ul className="space-y-2 text-sm">
        {listings.map((listing) => (
          <li key={listing.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-background px-4 py-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-foreground">{listing.title}</p>
              <p className="text-xs text-foreground/60">Seller ID {listing.seller_name}</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
              <span className="rounded-full border border-[#b94c23]/30 bg-[#fbe8dd] px-3 py-1 text-[#b94c23]">Promoted</span>
              <button
                type="button"
                disabled={removingId === listing.id}
                className="rounded-full border border-foreground/30 px-3 py-1 text-[10px] font-semibold text-foreground transition hover:border-foreground hover:text-foreground disabled:border-border/30 disabled:text-foreground/40"
                onClick={() => removePromotion(listing.id)}
              >
                {removingId === listing.id ? "Removing…" : "Remove"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section className="rounded-4xl border border-border bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">Promoted listings</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Featured inventory</h2>
        </div>
        <p className="text-xs text-foreground/56">{lastFetchedAt ?? "Awaiting data…"}</p>
      </div>
      <div className="mt-4 space-y-3">{renderBody()}</div>
    </section>
  );
}
