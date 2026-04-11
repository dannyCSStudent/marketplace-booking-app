"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createApiClient, type DeliveryFeeSettingsRead } from "@/app/lib/api";
import { invalidateMarketplaceCaches } from "@/app/lib/cache-invalidation";
import { restoreAdminSession } from "@/app/lib/admin-auth";

type DeliveryFeeFormProps = {
  activeFees: DeliveryFeeSettingsRead;
  apiBaseUrl: string;
};

type Status = "idle" | "pending" | "success" | "error";

export default function DeliveryFeeForm({ activeFees, apiBaseUrl }: DeliveryFeeFormProps) {
  const router = useRouter();
  const [label, setLabel] = useState(activeFees.name);
  const [deliveryFeeInput, setDeliveryFeeInput] = useState(String(activeFees.delivery_fee_cents ?? 0));
  const [shippingFeeInput, setShippingFeeInput] = useState(String(activeFees.shipping_fee_cents ?? 0));
  const [latestFees, setLatestFees] = useState(activeFees);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const apiClient = useMemo(() => createApiClient(apiBaseUrl), [apiBaseUrl]);

  const effectiveAtLabel = latestFees.effective_at
    ? new Date(latestFees.effective_at).toLocaleString()
    : "Not specified";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setStatus("pending");
      setMessage(null);

      const deliveryFee = Number(deliveryFeeInput);
      const shippingFee = Number(shippingFeeInput);
      if (
        !Number.isInteger(deliveryFee) ||
        !Number.isInteger(shippingFee) ||
        deliveryFee < 0 ||
        shippingFee < 0
      ) {
        setStatus("error");
        setMessage("Enter non-negative whole-dollar-cent values.");
        return;
      }

      try {
        const session = await restoreAdminSession();
        if (!session) {
          setStatus("error");
          setMessage("Sign in as an admin to update delivery fees.");
          return;
        }

        const updated = await apiClient.createDeliveryFees(
          {
            name: label.trim() || "Default delivery fees",
            delivery_fee_cents: deliveryFee,
            shipping_fee_cents: shippingFee,
          },
          { accessToken: session.access_token },
        );
        setLatestFees(updated);
        setDeliveryFeeInput(String(updated.delivery_fee_cents ?? 0));
        setShippingFeeInput(String(updated.shipping_fee_cents ?? 0));
        await invalidateMarketplaceCaches();
        router.refresh();
        setStatus("success");
        setMessage("Delivery fees saved.");
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Unable to update delivery fees.");
      }
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
            Label
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-foreground"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Delivery fee profile"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
              Delivery fee (cents)
            </label>
            <input
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold outline-none transition focus:border-foreground"
              type="number"
              min={0}
              step={1}
              value={deliveryFeeInput}
              onChange={(event) => setDeliveryFeeInput(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
              Shipping fee (cents)
            </label>
            <input
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold outline-none transition focus:border-foreground"
              type="number"
              min={0}
              step={1}
              value={shippingFeeInput}
              onChange={(event) => setShippingFeeInput(event.target.value)}
            />
          </div>
        </div>

        <p className="text-xs text-foreground/60">
          These are platform-added surcharges for physical fulfillment. Pickup and meetup remain free.
        </p>

        <div className="flex flex-col gap-2">
          <button
            className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={isPending}
          >
            Save delivery fees
          </button>
          {message ? (
            <p className={`text-sm ${status === "error" ? "text-rose-600" : "text-foreground/60"}`}>
              {message}
            </p>
          ) : null}
        </div>
      </form>

      <div className="rounded-[1.8rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/56">Active delivery fees</p>
        <div className="mt-4 space-y-3 text-sm text-foreground/70">
          <div className="flex items-center justify-between">
            <span>Delivery</span>
            <span className="font-semibold text-foreground">${((latestFees.delivery_fee_cents ?? 0) / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Shipping</span>
            <span className="font-semibold text-foreground">${((latestFees.shipping_fee_cents ?? 0) / 100).toFixed(2)}</span>
          </div>
        </div>
        <p className="mt-5 text-sm font-semibold text-foreground/60">{latestFees.name}</p>
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-foreground/56">Last effective</p>
        <p className="text-sm text-foreground/60">{effectiveAtLabel}</p>
        <p className="mt-4 text-xs text-foreground/60">
          Every new delivery or shipping order includes these platform-added fees automatically.
        </p>
      </div>
    </div>
  );
}
