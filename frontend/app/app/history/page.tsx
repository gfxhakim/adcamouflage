"use client";

import clsx from "clsx";
import { Archive, Clock, Download, FileVideo, Inbox, Package } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import Header from "@/components/Header";
import DeckRail from "@/components/DeckRail";
import ThemeDock from "@/components/ThemeDock";
import NeonCard from "@/components/NeonCard";
import { absoluteUrl, getBatch } from "@/lib/api";
import { fetchMyBatches, type BatchSummary } from "@/lib/auth";
import { formatDate, timeAgo } from "@/lib/format";
import { useRequireUser } from "@/lib/useRequireUser";
import type { BatchStatus } from "@/lib/types";
import { useDeckTheme } from "@/lib/deckTheme";

/** undefined = not yet loaded; false = outputs expired / purged; BatchStatus = live. */
type LiveBatch = BatchStatus | false | undefined;

function presetName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function HistoryPage() {
  const onDark = useDeckTheme() === "dark";
  const user = useRequireUser();
  const [summaries, setSummaries] = useState<BatchSummary[] | null>(null);
  const [live, setLive] = useState<Record<string, LiveBatch>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMyBatches().then((rows) => {
      if (cancelled || !mountedRef.current) return;
      setSummaries(rows);
      // Pull live status for each batch so we can offer re-downloads while
      // the files are still inside the retention window.
      rows.forEach((row) => {
        getBatch(row.id)
          .then((status) => {
            if (mountedRef.current) setLive((prev) => ({ ...prev, [row.id]: status }));
          })
          .catch(() => {
            if (mountedRef.current) setLive((prev) => ({ ...prev, [row.id]: false }));
          });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = summaries === null;
  const empty = summaries !== null && summaries.length === 0;

  return (
    <div className="deck min-h-screen">
      <Header user={user} onDark={onDark} />

      <div className="mx-auto flex max-w-7xl gap-5 px-4 pb-40 pt-6 md:pb-24 sm:px-6 sm:pt-8 lg:px-8">
        <DeckRail onDark={onDark} />

        <main className="min-w-0 flex-1">
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              History
            </p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black dark:text-slate-50 sm:text-5xl">
              Your render batches
            </h1>
            <p className="max-w-2xl text-sm text-ink-muted dark:text-slate-400">
              Every batch you have run, newest first. Finished files can be re-downloaded until they
              are purged after the retention window.
            </p>
          </section>

          {loading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          ) : empty ? (
            <NeonCard padding="lg" radius="xl">
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Inbox className="h-8 w-8 text-ink-faint dark:text-slate-500" aria-hidden />
                <p className="text-sm text-ink-muted dark:text-slate-400">
                  No batches yet. Run your first one in the Workspace.
                </p>
                <Link href="/app" className="btn-primary !py-2.5">
                  Go to Workspace
                </Link>
              </div>
            </NeonCard>
          ) : (
            <div className="space-y-4">
              {summaries!.map((row) => {
                const status = live[row.id];
                const pending = status === undefined;
                const expired = status === false;
                const batch: BatchStatus | null = pending || expired ? null : (status as BatchStatus);
                const archive = batch?.archive_url ?? null;
                const completedAssets = batch?.assets.filter((a) => a.download_url) ?? [];

                return (
                  <NeonCard key={row.id} padding="lg" radius="xl">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="grid h-9 w-9 place-items-center rounded-lg bg-meta-500/15 text-meta-300">
                            <Package className="h-4 w-4" aria-hidden />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-black dark:text-slate-100">
                              {row.asset_count} file{row.asset_count === 1 ? "" : "s"} ·{" "}
                              {presetName(row.preset)}
                            </p>
                            <p className="text-[11px] text-ink-faint dark:text-slate-500">
                              {timeAgo(row.created_at)} · {formatDate(row.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {batch ? (
                          <span
                            className={clsx(
                              "chip !text-[10px]",
                              batch.completed === batch.total
                                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                                : "border-meta-500/40 bg-meta-500/10 text-meta-200",
                            )}
                          >
                            {batch.completed}/{batch.total} done
                            {batch.failed ? ` · ${batch.failed} failed` : ""}
                          </span>
                        ) : expired ? (
                          <span className="chip !text-[10px]">Outputs expired</span>
                        ) : pending ? (
                          <span className="chip !text-[10px]">Checking…</span>
                        ) : null}

                        {archive ? (
                          <a href={absoluteUrl(archive)} className="btn-primary !py-2 !px-3 !text-xs">
                            <Archive className="h-3.5 w-3.5" aria-hidden />
                            Download all
                          </a>
                        ) : null}
                      </div>
                    </div>

                    {completedAssets.length > 0 ? (
                      <ul className="mt-4 divide-y divide-white/5 border-t border-white/5 pt-1">
                        {completedAssets.map((asset) => (
                          <li key={asset.id} className="flex items-center justify-between gap-3 py-2">
                            <span className="flex min-w-0 items-center gap-2 text-xs text-ink-muted dark:text-slate-300">
                              <FileVideo className="h-3.5 w-3.5 shrink-0 text-meta-300" aria-hidden />
                              <span className="truncate">
                                {asset.original_filename}
                                {asset.variants_total > 1 ? ` · v${asset.variant_index + 1}` : ""}
                              </span>
                            </span>
                            <a
                              href={absoluteUrl(asset.download_url!)}
                              className="btn-ghost shrink-0 !py-1.5 !px-2.5 !text-xs"
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Download
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : expired ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
                        The output files for this batch have been purged. Re-run it in the Workspace to
                        get fresh downloads.
                      </p>
                    ) : null}
                  </NeonCard>
                );
              })}
            </div>
          )}
        </main>
      </div>
      <ThemeDock />
    </div>
  );
}
