"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/transactions", label: "Transactions" },
  { href: "/admin/deliveries", label: "Deliveries" },
  { href: "/admin/delivery-failures", label: "Delivery failures" },
  { href: "/admin/trust-alerts", label: "Trust alerts" },
  { href: "/admin/inventory-alerts", label: "Inventory alerts" },
  { href: "/admin/order-exceptions", label: "Order exceptions" },
  { href: "/admin/booking-conflicts", label: "Booking conflicts" },
  { href: "/admin/review-anomalies", label: "Review anomalies" },
  { href: "/admin/review-response-reminders", label: "Review reminders" },
  { href: "/admin/subscription-downgrades", label: "Subscription downgrades" },
  { href: "/admin/pricing-audit", label: "Pricing audit" },
  { href: "/admin/monetization", label: "Monetization" },
  { href: "/admin/reviews", label: "Reviews" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-[1.5rem] border border-border bg-background/80 px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-foreground/60">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.18em] transition ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
