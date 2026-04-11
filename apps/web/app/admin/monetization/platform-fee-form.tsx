"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApiClient, PlatformFeeRateRead } from "@repo/api-client";
import { invalidateMarketplaceCaches } from "@/app/lib/cache-invalidation";

type MonetizationFormProps = {
  activeFee: PlatformFeeRateRead;
  apiBaseUrl: string;
};

type Status = "idle" | "pending" | "success" | "error";

export default function PlatformFeeForm({ activeFee, apiBaseUrl }: MonetizationFormProps) {
  const router = useRouter();
  const [label, setLabel] = useState(activeFee.name);
  const initialPercent = useMemo(() => {
    const parsed = Number(activeFee.rate);
    return Number.isFinite(parsed) ? (parsed * 100).toFixed(2) : "0.00";
  }, [activeFee.rate]);
  const [percentInput, setPercentInput] = useState(initialPercent);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [latestFee, setLatestFee] = useState(activeFee);
  const [isPending, startTransition] = useTransition();

  const displayPercent = useMemo(() => {
    const parsed = Number(latestFee.rate);
    return `${Number.isFinite(parsed) ? (parsed * 100).toFixed(2) : "0.00"}%`;
  }, [latestFee.rate]);

  const effectiveAtLabel = latestFee.effective_at
    ? new Date(latestFee.effective_at).toLocaleString()
    : "Not specified";

  const apiClient = useMemo(() => createApiClient(apiBaseUrl), [apiBaseUrl]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setStatus("pending");
      setMessage(null);

      const parsed = Number(percentInput);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setStatus("error");
        setMessage("Enter a rate between 0 and 100.");
        return;
      }

      try {
        const payload = {
          name: label.trim() || `Platform fee ${new Date().toLocaleDateString()}`,
          rate: (parsed / 100).toFixed(4),
        };

        const updated = await apiClient.createPlatformFeeRate(payload);
        setLatestFee(updated);
        setPercentInput((Number(updated.rate) * 100).toFixed(2));
        await invalidateMarketplaceCaches();
        router.refresh();
        setStatus("success");
        setMessage("Platform fee saved.");
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Unable to update platform fee.");
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
            placeholder="Platform fee"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/60">
            Rate (%)
          </label>
          <div className="mt-2 flex items-end gap-3">
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold outline-none transition focus:border-foreground"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={percentInput}
              onChange={(event) => setPercentInput(event.target.value)}
            />
            <span className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/60">
              %
            </span>
          </div>
          <p className="mt-1 text-xs text-foreground/60">
            Enter the percentage that shoppers will see; the system stores this as a decimal value.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={isPending}
          >
            Save rate
          </button>
          {message && (
            <p
              className={`text-sm ${
                status === "error" ? "text-rose-600" : "text-foreground/60"
              }`}
            >
              {message}
            </p>
          )}
        </div>
      </form>

      <div className="rounded-[1.8rem] border border-border/60 bg-linear-to-br from-background to-surface/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground/56">Active rate</p>
        <p className="text-4xl font-semibold tracking-[-0.04em] text-foreground">{displayPercent}</p>
        <p className="mt-1 text-sm font-semibold text-foreground/60">{latestFee.name}</p>
        <p className="mt-5 text-xs uppercase tracking-[0.18em] text-foreground/56">Last effective</p>
        <p className="text-sm text-foreground/60">{effectiveAtLabel}</p>
        <p className="mt-4 text-xs text-foreground/60">
          Every new order and booking uses this rate automatically.
        </p>
      </div>
    </div>
  );
}
