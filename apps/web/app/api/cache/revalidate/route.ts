import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

const CACHE_TAGS = [
  "marketplace-data",
  "seller-storefront-data",
  "listing-detail-data",
  "buyer-dashboard-data",
  "seller-workspace-data",
  "admin-review-moderation-data",
  "admin-transaction-support-data",
  "admin-monetization-data",
];

export async function POST() {
  for (const tag of CACHE_TAGS) {
    revalidateTag(tag);
  }

  return NextResponse.json({ ok: true, tags: CACHE_TAGS });
}
