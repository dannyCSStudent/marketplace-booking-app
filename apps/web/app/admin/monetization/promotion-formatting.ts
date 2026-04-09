import type { PromotionListingTypeFilter } from "@/app/admin/monetization/promotion-listing-focus";

export function escapeCsvValue(value: string | number | boolean | null | undefined) {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }
  return normalized;
}

export function normalizePromotionListingType(label: string): PromotionListingTypeFilter {
  const normalized = label.toLowerCase();
  if (normalized === "product" || normalized === "service" || normalized === "hybrid") {
    return normalized;
  }
  return "unknown";
}

export function formatPromotionListingTypeLabel(type: PromotionListingTypeFilter) {
  if (type === "all") {
    return "All";
  }
  if (type === "unknown") {
    return "Unknown";
  }
  return type[0].toUpperCase() + type.slice(1);
}

export function formatPromotionTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function formatPromotionPlatformFee(rate: string) {
  const numeric = Number(rate);
  if (Number.isNaN(numeric)) {
    return rate;
  }

  return `${(numeric * 100).toFixed(2)}%`;
}

export function truncatePromotionEntityId(value: string) {
  if (!value) {
    return "";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
