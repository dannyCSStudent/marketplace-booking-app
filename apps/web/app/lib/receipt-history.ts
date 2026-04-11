"use client";

export type RecentReceiptKind = "order" | "booking";

export type RecentReceiptEntry = {
  kind: RecentReceiptKind;
  id: string;
  label: string;
  detail: string;
  href: string;
  lastSeenAt: string;
};

const RECENT_RECEIPTS_KEY = "buyer_recent_receipts";
const MAX_RECENT_RECEIPTS = 4;

function readRecentReceipts() {
  if (typeof window === "undefined") {
    return [];
  }

  const stored = window.sessionStorage.getItem(RECENT_RECEIPTS_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as RecentReceiptEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is RecentReceiptEntry =>
        Boolean(
          entry &&
            (entry.kind === "order" || entry.kind === "booking") &&
            typeof entry.id === "string" &&
            typeof entry.label === "string" &&
            typeof entry.detail === "string" &&
            typeof entry.href === "string" &&
            typeof entry.lastSeenAt === "string",
        ),
    );
  } catch {
    return [];
  }
}

function writeRecentReceipts(entries: RecentReceiptEntry[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    RECENT_RECEIPTS_KEY,
    JSON.stringify(entries.slice(0, MAX_RECENT_RECEIPTS)),
  );
}

export function getRecentReceipts() {
  return readRecentReceipts();
}

export function setRecentReceipt(next: RecentReceiptEntry) {
  const entries = readRecentReceipts().filter(
    (entry) => !(entry.kind === next.kind && entry.id === next.id),
  );

  entries.unshift(next);
  writeRecentReceipts(entries);

  return entries.slice(0, MAX_RECENT_RECEIPTS);
}

export function clearRecentReceipts() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(RECENT_RECEIPTS_KEY);
}
