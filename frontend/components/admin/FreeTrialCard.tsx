"use client";

import { Gift, Loader2, Save, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { getFreeTrial, grantFreeTrialToExisting, saveFreeTrial, type FreeTrialConfig } from "@/lib/admin";

const label = "block text-xs font-medium text-black/70 dark:text-slate-300";
const faint = "text-[11px] leading-relaxed text-ink-faint dark:text-slate-500";

/** Admin > Settings > Free generations: what every new account can try without a plan. */
export default function FreeTrialCard() {
  const [data, setData] = useState<FreeTrialConfig | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getFreeTrial();
      setData(next);
      setEnabled(next.enabled);
      setCount(next.count);
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not load free generations." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <Gift className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Free generations</h2>
      </div>
      <p className="mb-4 text-xs text-ink-faint dark:text-slate-500">
        Every customer account can try the studio for free before choosing a plan. Each generation is one output file.
        They are given once per account and stop counting once the customer subscribes.
      </p>

      {!data ? (
        <Loader2 className="h-4 w-4 animate-spin text-ink-faint" aria-hidden />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-xs text-black/70 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-meta-500"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Give free generations to new accounts
            </label>
            <label className={label}>
              Free generations per account
              <input
                type="number"
                min={0}
                max={20}
                className="field mt-1 !w-24"
                value={count}
                onChange={(e) => setCount(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              />
            </label>
            <button
              type="button"
              className="btn-primary !text-xs"
              disabled={busy !== null}
              onClick={() =>
                void run("save", async () => {
                  const next = await saveFreeTrial({ enabled, count });
                  setData(next);
                  setNote({ ok: true, text: "Saved." });
                })
              }
            >
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
              Save
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-black/10 pt-4 dark:border-white/10">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-black dark:text-slate-100">Give them to existing accounts</p>
              <p className={faint}>
                {data.waiting
                  ? `${data.waiting} existing ${data.waiting === 1 ? "account has" : "accounts have"} no plan and never got free generations.`
                  : "Every existing account without a plan already has them."}{" "}
                Accounts that already used theirs, or that have a plan, are skipped. Safe to press more than once.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost !text-xs"
              disabled={busy !== null || !data.waiting || !data.enabled}
              onClick={() =>
                void run("grant", async () => {
                  const next = await grantFreeTrialToExisting();
                  setData(next);
                  setNote({ ok: true, text: `Gave ${next.count} free generations to ${next.given ?? 0} accounts.` });
                })
              }
            >
              {busy === "grant" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UserPlus className="h-3.5 w-3.5" aria-hidden />}
              Give to {data.waiting} {data.waiting === 1 ? "account" : "accounts"}
            </button>
          </div>
        </>
      )}
      {note ? (
        <p className={`mt-3 text-xs ${note.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>{note.text}</p>
      ) : null}
    </NeonCard>
  );
}
