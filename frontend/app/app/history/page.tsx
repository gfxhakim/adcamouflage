"use client";

import clsx from "clsx";
import { Archive, Clock, Inbox, Loader2, Package, Radar, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DownloadLink from "@/components/DownloadLink";
import JobCard from "@/components/JobCard";
import NeonCard from "@/components/NeonCard";
import ProgressBar from "@/components/ProgressBar";
import ThemeDock from "@/components/ThemeDock";
import WorkspaceShell from "@/components/WorkspaceShell";
import { cancelAsset, getBatch, getPresets } from "@/lib/api";
import { fetchMyBatches, type BatchSummary } from "@/lib/auth";
import { formatDate, plural, timeAgo } from "@/lib/format";
import type { BatchStatus } from "@/lib/types";
import { useRequireUser } from "@/lib/useRequireUser";

function isBatchActive(batch: BatchStatus | null | undefined): boolean {
  if (!batch) return false;
  if (batch.status === "queued" || batch.status === "processing") return true;
  return batch.assets.some((asset) => asset.status === "queued" || asset.status === "processing");
}

function batchBadge(batch: BatchStatus | null | undefined, retentionHours: number) {
  if (batch === undefined) {
    return {
      label: "Loading",
      className: "border-black/10 text-ink-muted dark:border-white/15 dark:text-slate-300",
    };
  }
  if (batch === null) {
    return {
      label: `Cleared after ${retentionHours}h`,
      className: "border-black/10 text-ink-faint dark:border-white/10 dark:text-slate-500",
    };
  }
  const activeCount = batch.assets.filter(
    (asset) => asset.status === "queued" || asset.status === "processing",
  ).length;
  if (activeCount > 0 || batch.status === "processing") {
    return {
      label: "Rendering",
      className: "border-meta-500/40 bg-meta-500/10 text-meta-700 dark:text-meta-300",
    };
  }
  if (batch.status === "queued") {
    return {
      label: "Queued",
      className: "border-meta-500/35 bg-meta-50 text-meta-700 dark:bg-meta-500/10 dark:text-meta-300",
    };
  }
  if (batch.completed > 0 && batch.failed > 0) {
    return {
      label: "Partial",
      className: "border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
    };
  }
  if (batch.completed > 0) {
    return {
      label: "Ready",
      className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (batch.assets.every((asset) => asset.status === "cancelled")) {
    return {
      label: "Stopped",
      className: "border-black/15 text-ink-muted dark:border-white/15 dark:text-slate-300",
    };
  }
  return {
    label: "Failed",
    className: "border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-300",
  };
}

/**
 * Exports & live renders history.
 *
 * Keeps tracking background jobs after the user leaves the workspace step card,
 * switches pages, or submits additional batches. Outputs stay downloadable for
 * the server retention window (48 hours after rendering finishes).
 */
export default function HistoryPage() {
  const user = useRequireUser();
  const [retentionHours, setRetentionHours] = useState(48);
  const [summaries, setSummaries] = useState<BatchSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, BatchStatus | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [archiveProblem, setArchiveProblem] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadHistory = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [rows, catalogue] = await Promise.all([
        fetchMyBatches(),
        getPresets().catch(() => null),
      ]);
      if (!mountedRef.current) return;
      if (catalogue?.limits?.retention_hours) {
        setRetentionHours(catalogue.limits.retention_hours);
      }
      setSummaries(rows);
      const settled = await Promise.allSettled(rows.map((row) => getBatch(row.id)));
      if (!mountedRef.current) return;
      const map: Record<string, BatchStatus | null> = {};
      rows.forEach((row, index) => {
        const result = settled[index];
        map[row.id] = result.status === "fulfilled" ? result.value : null;
      });
      setDetails(map);
    } catch {
      if (mountedRef.current) setSummaries((prev) => prev ?? []);
    } finally {
      if (mountedRef.current && !quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadHistory(false);
    return () => {
      mountedRef.current = false;
    };
  }, [loadHistory]);

  const activeBatchIds = useMemo(() => {
    if (!summaries) return [];
    return summaries
      .map((row) => row.id)
      .filter((id) => isBatchActive(details[id]));
  }, [details, summaries]);

  const activeKey = activeBatchIds.join(",");

  // Poll every active background batch so in-progress files update live here too.
  useEffect(() => {
    if (!activeKey) return;
    const ids = activeKey.split(",").filter(Boolean);
    const timer = window.setInterval(() => {
      void Promise.allSettled(ids.map((id) => getBatch(id))).then((settled) => {
        if (!mountedRef.current) return;
        setDetails((prev) => {
          const next = { ...prev };
          ids.forEach((id, index) => {
            const result = settled[index];
            next[id] = result.status === "fulfilled" ? result.value : null;
          });
          return next;
        });
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeKey]);

  const handleCancelAsset = useCallback(async (assetId: string, batchId: string) => {
    try {
      await cancelAsset(assetId);
      const updated = await getBatch(batchId).catch(() => null);
      if (!mountedRef.current) return;
      if (updated) {
        setDetails((prev) => ({ ...prev, [batchId]: updated }));
      }
    } catch {
      /* Ignore cancel race if the render already completed. */
    }
  }, []);

  return (
    <WorkspaceShell deck user={user}>
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label">History &amp; live queue</p>
            <h1 className="mt-1 font-display text-3xl font-normal text-black dark:text-slate-50">
              Renders &amp; Downloads
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted dark:text-slate-400">
              Active jobs continue rendering on our servers even when you switch pages, scroll, or
              launch a new batch. Completed files remain available for{" "}
              <span className="font-semibold text-black dark:text-slate-200">
                {retentionHours} hours
              </span>{" "}
              after rendering finishes before automatic cleanup.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-end">
            {activeBatchIds.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-meta-500/40 bg-meta-500/10 px-3 py-1 font-mono text-[11px] font-medium text-meta-700 dark:text-meta-300">
                <Radar className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                {plural(activeBatchIds.length, "batch", "batches")} rendering live
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void loadHistory(false)}
              disabled={refreshing}
              className="btn-ghost !py-1.5 !text-xs"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Refresh
            </button>
            <Link href="/app" className="btn-primary !py-1.5 !text-xs">
              Back to workspace
            </Link>
          </div>
        </div>

        {archiveProblem ? (
          <p
            role="status"
            className="mb-4 rounded-xl border border-amber-400/50 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {archiveProblem}
          </p>
        ) : null}

        {summaries === null ? (
          <NeonCard padding="lg" radius="xl" className="py-12 text-center text-xs text-ink-muted">
            Loading your renders…
          </NeonCard>
        ) : summaries.length === 0 ? (
          <NeonCard padding="lg" radius="xl" className="flex flex-col items-center py-14 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-black/10 bg-black/[0.03] text-ink-muted dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
              <Inbox className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-medium text-black dark:text-slate-100">
              No renders yet
            </p>
            <p className="mt-1 max-w-sm text-xs text-ink-muted dark:text-slate-400">
              Upload creatives in the workspace (minimum 5 total outputs per batch) and every active
              render and finished export will appear right here.
            </p>
            <Link href="/app" className="btn-primary mt-5">
              Open workspace
            </Link>
          </NeonCard>
        ) : (
          <div className="space-y-4">
            {summaries.map((summary) => {
              const batch = details[summary.id];
              const active = isBatchActive(batch);
              const badge = batchBadge(batch, retentionHours);
              const activeAssetsCount =
                batch?.assets.filter(
                  (asset) => asset.status === "queued" || asset.status === "processing",
                ).length ?? 0;

              return (
                <NeonCard key={summary.id} padding="md" radius="xl" glow={active}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="chip font-mono capitalize">{summary.preset}</span>
                        <span className="text-sm font-medium text-black dark:text-slate-100">
                          {plural(summary.asset_count, "output")}
                        </span>
                        <span
                          className={clsx(
                            "rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint dark:text-slate-500">
                        <Clock className="h-3 w-3" aria-hidden />
                        <span>
                          {timeAgo(summary.created_at)} · {formatDate(summary.created_at)}
                        </span>
                        {batch ? (
                          <span className="font-mono text-ink-muted dark:text-slate-400">
                            ·{" "}
                            {activeAssetsCount > 0
                              ? `${activeAssetsCount} in progress · ${batch.completed}/${batch.total} ready`
                              : `${batch.completed}/${batch.total} ready`}
                            {batch.failed > 0 ? ` · ${batch.failed} failed (0 tokens charged)` : ""}
                          </span>
                        ) : null}
                      </p>
                    </div>

                    {batch?.archive_url && batch.completed > 0 ? (
                      <DownloadLink
                        href={batch.archive_url}
                        fresh={async () => (await getBatch(summary.id)).archive_url}
                        onProblem={setArchiveProblem}
                        className="btn-primary !px-3.5 !py-1.5 !text-xs"
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden />
                        Download all ({batch.completed})
                      </DownloadLink>
                    ) : batch === null ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint dark:text-slate-500">
                        <Package className="h-3 w-3" aria-hidden />
                        Deleted after {retentionHours}h window
                      </span>
                    ) : null}
                  </div>

                  {batch && active ? (
                    <div className="mt-3 space-y-1.5 rounded-xl border border-meta-500/25 bg-meta-500/[0.06] px-3 py-2.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-meta-700 dark:text-meta-300">
                          Background render in progress ({activeAssetsCount} remaining)
                        </span>
                        <span className="font-mono tabular-nums text-meta-700 dark:text-meta-300">
                          {Math.round(batch.progress)}%
                        </span>
                      </div>
                      <ProgressBar
                        value={batch.progress}
                        active
                        tone="neon"
                        label="Batch render progress"
                      />
                    </div>
                  ) : null}

                  {batch && batch.assets.length > 0 ? (
                    <div className="mt-3 space-y-2.5">
                      {batch.assets.map((asset) => (
                        <JobCard
                          key={asset.id}
                          asset={asset}
                          onCancel={(assetId) => void handleCancelAsset(assetId, summary.id)}
                        />
                      ))}
                    </div>
                  ) : null}
                </NeonCard>
              );
            })}
          </div>
        )}
      </div>
      <ThemeDock />
    </WorkspaceShell>
  );
}
