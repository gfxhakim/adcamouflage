"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { previewPurgeUsers, purgeUsers, type PurgeSummary } from "@/lib/admin";

/** Settings > Danger zone: delete every customer account, keeping the admins. */
export default function DangerZoneCard({ onDone }: { onDone?: () => void }) {
  const [preview, setPreview] = useState<PurgeSummary | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    previewPurgeUsers()
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the account count."));
  }, []);

  useEffect(load, [load]);

  const phrase = preview?.confirm_phrase ?? "DELETE ALL USERS";
  const ready = !!preview && preview.users > 0 && typed.trim() === phrase && !busy;

  const run = async () => {
    if (!preview || !ready) return;
    if (!window.confirm(`Really delete ${preview.users} accounts and all their data? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const done = await purgeUsers(typed.trim(), preview.users);
      setNotice(`Deleted ${done.users} accounts. Kept: ${done.kept.join(", ")}.`);
      setTyped("");
      load();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the accounts.");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-red-700 dark:text-red-300">Danger zone</h2>
      </div>
      <p className="mb-4 text-xs text-ink-faint dark:text-slate-400">
        Delete every customer account and everything that belongs to it: batches, token balances, orders and payment
        history, activity, support chats and team seats. Admin accounts, including yours, are always kept.
        <strong className="text-red-700 dark:text-red-300"> This cannot be undone.</strong>
      </p>

      {preview ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {preview.users === 0 ? (
              <p>There are no customer accounts to delete.</p>
            ) : (
              <p>
                Will delete <strong>{preview.users}</strong> account{preview.users === 1 ? "" : "s"}, with{" "}
                {preview.batches} batches, {preview.orders} orders, {preview.token_entries} token entries,{" "}
                {preview.support_threads} support chats and {preview.team_seats} team seats.
              </p>
            )}
            <p className="mt-1 break-words">Kept: {preview.kept.join(", ") || "none"}</p>
          </div>

          {preview.users > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex-1 text-xs text-ink-faint dark:text-slate-400">
                Type <code className="font-mono font-semibold text-red-700 dark:text-red-300">{phrase}</code> to confirm
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-sm text-black outline-none focus:border-red-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                />
              </label>
              <button
                type="button"
                onClick={run}
                disabled={!ready}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 sm:self-end"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                Delete {preview.users} account{preview.users === 1 ? "" : "s"}
              </button>
            </div>
          ) : null}
        </div>
      ) : !error ? (
        <Loader2 className="h-4 w-4 animate-spin text-ink-faint" aria-hidden />
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p>
      ) : null}
    </NeonCard>
  );
}
