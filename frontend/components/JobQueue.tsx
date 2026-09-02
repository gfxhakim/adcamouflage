"use client";

import clsx from "clsx";
import { Archive, Inbox, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { absoluteUrl } from "@/lib/api";
import type { BatchStatus } from "@/lib/types";
import JobCard from "./JobCard";
import NeonCard from "./NeonCard";
import ProgressBar from "./ProgressBar";

interface JobQueueProps {
  batch: BatchStatus | null;
  polling: boolean;
  error: string | null;
  onCancel: (assetId: string) => void;
  onRefresh: () => void;
  onDiscard: () => void;
}

export function JobQueue({
  batch,
  polling,
  error,
  onCancel,
  onRefresh,
  onDiscard,
}: JobQueueProps) {
  if (!batch) {
    return (
      <NeonCard tone="muted" padding="lg" radius="xl" className="h-full">
        <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-slate-500">
            <Inbox className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-300">No active batch</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
              Drop your assets on the left, pick a camouflage profile, and the mutation queue will
              appear here with live progress.
            </p>
          </div>
        </div>
      </NeonCard>
    );
  }

  const running = batch.total - batch.completed - batch.failed;
  const allDone = running <= 0;

  return (
    <div className="space-y-4">
      <NeonCard
        tone={batch.failed > 0 ? "danger" : allDone ? "success" : "default"}
        padding="none"
        radius="xl"
      >
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-100">
                  {allDone ? "Batch complete" : "Mutating assets"}
                </p>
                {polling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" aria-hidden />
                ) : null}
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{batch.batch.id}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                className="btn-ghost !px-2.5 !py-1.5 !text-xs"
                aria-label="Refresh batch status"
              >
                <RefreshCw className={clsx("h-3.5 w-3.5", polling && "animate-spin")} aria-hidden />
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="btn-danger !px-2.5 !py-1.5 !text-xs"
                aria-label="Delete this batch and its files"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
              {batch.archive_url ? (
                <a
                  href={absoluteUrl(batch.archive_url)}
                  className="btn-primary !px-3 !py-1.5 !text-xs"
                  download
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden />
                  Download all
                </a>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <ProgressBar
              value={batch.progress}
              active={!allDone}
              tone={batch.failed > 0 ? "danger" : allDone ? "success" : "neon"}
              label="Batch progress"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">
              {Math.round(batch.progress)}%
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip !text-[10px]">{batch.total} assets</span>
            <span className="chip !text-[10px] !text-emerald-300">{batch.completed} done</span>
            {running > 0 ? (
              <span className="chip !text-[10px] !text-cyan-300">{running} in flight</span>
            ) : null}
            {batch.failed > 0 ? (
              <span className="chip !text-[10px] !text-rose-300">{batch.failed} failed</span>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[11px] text-amber-200">
              {error}
            </p>
          ) : null}
        </div>
      </NeonCard>

      <div className="space-y-3">
        {batch.assets.map((asset) => (
          <JobCard key={asset.id} asset={asset} onCancel={onCancel} />
        ))}
      </div>
    </div>
  );
}

export default JobQueue;
