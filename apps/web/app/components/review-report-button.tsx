"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, createApiClient } from "@/app/lib/api";
import { invalidateMarketplaceCaches } from "@/app/lib/cache-invalidation";
import { restoreBuyerSession } from "@/app/lib/buyer-auth";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);
const REVIEW_REPORT_HISTORY_KEY = "buyer_review_report_history";

type ReviewReportHistoryEntry = {
  reviewId: string;
  createdAt: string;
};

export function getBuyerReviewReportHistory(): ReviewReportHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.sessionStorage.getItem(REVIEW_REPORT_HISTORY_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as ReviewReportHistoryEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.reviewId === "string" &&
        typeof entry.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function formatReportTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return parsed.toLocaleString();
}

type ReviewReportButtonProps = {
  reviewId: string;
};

export function ReviewReportButton({ reviewId }: ReviewReportButtonProps) {
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recentReports, setRecentReports] = useState<ReviewReportHistoryEntry[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      setRecentReports(getBuyerReviewReportHistory());
    } catch {
      window.sessionStorage.removeItem(REVIEW_REPORT_HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(REVIEW_REPORT_HISTORY_KEY, JSON.stringify(recentReports));
  }, [recentReports]);

  const latestReport = useMemo(() => recentReports[0] ?? null, [recentReports]);

  async function handleReport() {
    if (reporting) {
      return;
    }

    setReporting(true);
    setMessage(null);
    try {
      const session = await restoreBuyerSession();
      if (!session) {
        setMessage("Sign in as a buyer to report a review.");
        return;
      }

      await api.createReviewReport(
        reviewId,
        {
          reason: "inaccurate_or_abusive",
          notes: "Reported from the public review surface.",
        },
        { accessToken: session.access_token },
      );
      setRecentReports((current) => [
        {
          reviewId,
          createdAt: new Date().toISOString(),
        },
        ...current.filter((entry) => entry.reviewId !== reviewId),
      ].slice(0, 5));
      await invalidateMarketplaceCaches();
      router.refresh();
      setMessage("Review reported for moderation.");
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message);
      } else if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Unable to report this review right now.");
      }
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/66 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
          disabled={reporting}
          onClick={() => void handleReport()}
          type="button"
        >
          {reporting ? "Reporting..." : "Report Review"}
        </button>
        {message ? <p className="text-xs text-foreground/52">{message}</p> : null}
      </div>
      {latestReport ? (
        <div className="rounded-[1rem] border border-border bg-background/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/46">
              Recent Report
            </p>
            {latestReport.reviewId === reviewId ? (
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                Reported this session
              </span>
            ) : null}
            <button
              className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
              onClick={() => setRecentReports([])}
              type="button"
            >
              Clear history
            </button>
          </div>
          <p className="mt-2 text-xs text-foreground/58">
            {latestReport.reviewId === reviewId
              ? `This review was reported from this browser session at ${formatReportTimestamp(latestReport.createdAt)}.`
              : `Latest report saved for review ${latestReport.reviewId.slice(0, 8)} at ${formatReportTimestamp(latestReport.createdAt)}.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
