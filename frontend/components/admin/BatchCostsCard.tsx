"use client";

import { Loader2, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { getBatchCosts, saveCostRates, type BatchCosts, type CostRates } from "@/lib/admin";
import { timeAgo } from "@/lib/format";

const RATE_FIELDS: { key: keyof CostRates; label: string; hint: string; step: string }[] = [
  { key: "egress_per_gb", label: "Download bandwidth, $ per GB", hint: "Railway network egress price", step: "0.001" },
  { key: "vcpu_per_minute", label: "vCPU, $ per minute", hint: "Railway vCPU price", step: "0.000001" },
  { key: "gb_ram_per_minute", label: "RAM, $ per GB-minute", hint: "Railway memory price", step: "0.000001" },
  { key: "vcpus_busy", label: "vCPUs busy while rendering", hint: "How many cores a render keeps busy on average", step: "0.1" },
  { key: "ram_gb", label: "RAM used while rendering, GB", hint: "Peak worker memory", step: "0.05" },
];

/** Small amounts need a third decimal: $0.012, $0.12, $1.20. */
function cost(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.1) return `$${Number(value.toFixed(3)) || 0.001}`;
  return `$${value.toFixed(2)}`;
}

function length(seconds: number): string {
  if (!seconds) return "";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}

function resolutionName(resolution: string): string {
  const [w, h] = resolution.split("x").map(Number);
  if (!w || !h) return "";
  const short = Math.min(w, h);
  if (short >= 2000) return "4K";
  return `${short}p`;
}

/**
 * What each batch costs on the hosting bill: worker time plus the bandwidth
 * of the downloads. The rates are editable so the numbers follow the host's prices.
 */
export default function BatchCostsCard({ refreshKey, onSelectUser }: { refreshKey: number; onSelectUser: (id: number) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<BatchCosts | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getBatchCosts(days);
      setData(next);
      setRates(Object.fromEntries(Object.entries(next.rates).map(([k, v]) => [k, String(v)])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load batch costs.");
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const save = async () => {
    const parsed = Object.fromEntries(RATE_FIELDS.map((f) => [f.key, Number(rates[f.key])])) as unknown as CostRates;
    if (Object.values(parsed).some((v) => !Number.isFinite(v) || v < 0)) {
      setError("Rates must be numbers, zero or more.");
      return;
    }
    setBusy(true);
    try {
      await saveCostRates(parsed);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rates.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-black dark:text-slate-100">
            <Server className="h-4 w-4 text-meta-500" aria-hidden />
            Batch costs
          </h3>
          <p className="mt-0.5 text-xs text-ink-faint dark:text-slate-500">
            What each batch costs us on hosting: render time plus download bandwidth. Measured from real batches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="field !w-auto !py-1.5 !text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Range">
            <option value={1}>Today</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close rates" : "Edit rates"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      {!data ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-faint dark:text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading
        </p>
      ) : (
        <>
          {editing ? (
            <div className="mt-4 rounded-xl border border-black/10 p-3 dark:border-white/10">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {RATE_FIELDS.map((field) => (
                  <label key={field.key} className="block" title={field.hint}>
                    <span className="label">{field.label}</span>
                    <input
                      className="field mt-1"
                      type="number"
                      min={0}
                      step={field.step}
                      value={rates[field.key] ?? ""}
                      onChange={(e) => setRates((r) => ({ ...r, [field.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <button type="button" className="btn-primary mt-3 !py-2 !text-xs" disabled={busy} onClick={() => void save()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                Save rates
              </button>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Batches", value: String(data.totals.batches), hint: `${data.totals.outputs} outputs` },
              { label: "Average per batch", value: cost(data.totals.average), hint: "render + downloads" },
              { label: "Render time cost", value: cost(data.totals.compute), hint: "CPU and memory" },
              { label: "Download cost", value: cost(data.totals.egress), hint: `total ${cost(data.totals.total)}` },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-black/10 px-3 py-2.5 dark:border-white/10">
                <p className="text-[11px] text-ink-faint dark:text-slate-500">{tile.label}</p>
                <p className="text-lg font-semibold tabular-nums text-black dark:text-slate-100">{tile.value}</p>
                <p className="text-[11px] text-ink-faint dark:text-slate-500">{tile.hint}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div>
              <p className="label mb-2">Expected cost of a batch of 5</p>
              <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="text-ink-faint dark:text-slate-500">
                    <tr className="border-b border-black/[0.06] dark:border-white/10">
                      <th className="px-3 py-2 font-medium">Video length</th>
                      <th className="px-3 py-2 text-right font-medium">1080p</th>
                      <th className="px-3 py-2 text-right font-medium">4K</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] dark:divide-white/10">
                    {data.estimate.map((row) => (
                      <tr key={row.seconds}>
                        <td className="px-3 py-2 text-black dark:text-slate-100">{length(row.seconds)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-black dark:text-slate-100">{cost(row["1080p"])}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-black dark:text-slate-100">{cost(row["4K"])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-ink-faint dark:text-slate-500">
                Heaviest settings, each file downloaded once. Every extra download adds its bandwidth again.
              </p>
            </div>

            <div>
              <p className="label mb-2">Latest batches</p>
              {data.batches.length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-ink-faint dark:border-white/10 dark:text-slate-500">
                  No batches measured in this range yet. New batches show here as they finish.
                </p>
              ) : (
                <div className="max-h-96 overflow-auto rounded-xl border border-black/10 dark:border-white/10">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="sticky top-0 bg-white text-ink-faint dark:bg-slate-900 dark:text-slate-500">
                      <tr className="border-b border-black/[0.06] dark:border-white/10">
                        <th className="px-3 py-2 font-medium">Customer</th>
                        <th className="px-3 py-2 font-medium">Batch</th>
                        <th className="px-3 py-2 text-right font-medium">Render</th>
                        <th className="px-3 py-2 text-right font-medium">Downloads</th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.06] dark:divide-white/10">
                      {data.batches.map((batch) => (
                        <tr key={batch.batch_id}>
                          <td className="max-w-[180px] px-3 py-2">
                            {batch.user_id ? (
                              <button type="button" className="block max-w-full truncate font-medium text-meta-600 hover:underline dark:text-meta-300" onClick={() => onSelectUser(batch.user_id as number)}>
                                {batch.email || `user ${batch.user_id}`}
                              </button>
                            ) : (
                              <span className="text-ink-faint">deleted user</span>
                            )}
                            <span className="block text-[11px] text-ink-faint dark:text-slate-500">{timeAgo(batch.created_at)}</span>
                          </td>
                          <td className="px-3 py-2 text-black dark:text-slate-100">
                            {batch.outputs} {batch.outputs === 1 ? "output" : "outputs"}
                            <span className="block text-[11px] text-ink-faint dark:text-slate-500">
                              {[resolutionName(batch.resolution), length(batch.duration_seconds), `${batch.output_mb} MB`].filter(Boolean).join(" · ")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-black dark:text-slate-100">
                            {cost(batch.compute)}
                            <span className="block text-[11px] text-ink-faint dark:text-slate-500">{length(batch.render_seconds) || "0 s"}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-black dark:text-slate-100">
                            {cost(batch.egress)}
                            <span className="block text-[11px] text-ink-faint dark:text-slate-500">{batch.downloads} so far</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-black dark:text-slate-100">{cost(batch.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </NeonCard>
  );
}
