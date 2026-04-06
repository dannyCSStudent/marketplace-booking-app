"use client";

import { useState } from "react";

import { ApiError, createApiClient } from "@/app/lib/api";
import { restoreBuyerSession } from "@/app/lib/buyer-auth";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const api = createApiClient(apiBaseUrl);

type ReviewReportButtonProps = {
  reviewId: string;
};

export function ReviewReportButton({ reviewId }: ReviewReportButtonProps) {
  const [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    <div className="mt-4 flex items-center justify-between gap-3">
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
  );
}
