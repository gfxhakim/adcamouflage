"use client";

import clsx from "clsx";
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Download,
  FileVideo,
  Fingerprint,
  Image as ImageIcon,
  Loader2,
  OctagonX,
  Timer,
  X,
} from "lucide-react";
import { useState } from "react";

import { absoluteUrl } from "@/lib/api";
import { elapsed, formatBytes, formatDelta, shortHash } from "@/lib/format";
import type { AssetJob } from "@/lib/types";
import NeonCard, { type NeonTone } from "./NeonCard";
import ProgressBar from "./ProgressBar";

const TONE_BY_STATUS: Record<AssetJob["status"], NeonTone> = {
  queued: "muted",
  processing: "default",
  completed: "success",
  failed: "danger",
  cancelled: "muted",
};

const STATUS_TEXT: Record<AssetJob["status"], string> = {
  queued: "text-slate-400",
  processing: "text-cyan-300",
  completed: "text-emerald-300",
  failed: "text-rose-300",
  cancelled: "text-slate-500",
};

function StatusIcon({ status }: { status: AssetJob["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4" aria-hidden />;
    case "failed":
      return <OctagonX className="h-4 w-4" aria-hidden />;
    case "cancelled":
      return <CircleSlash className="h-4 w-4" aria-hidden />;
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
    default:
      return <Timer className="h-4 w-4" aria-hidden />;
  }
}

interface JobCardProps {
  asset: AssetJob;
  onCancel?: (assetId: string) => void;
}

export function JobCard({ asset, onCancel }: JobCardProps) {
  const [expanded, setExpanded] = useState(false);
  const active = asset.status === "processing" || asset.status === "queued";
  const metrics = asset.metrics ?? {};
  const sizeDelta = formatDelta(metrics.source_bytes, metrics.output_bytes);

  return (
    <NeonCard tone={TONE_BY_STATUS[asset.status]} padding="none" radius="lg" className="animate-fade-up">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span
            className={clsx(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5",
              asset.kind === "video" ? "text-fuchsia-300" : "text-cyan-300",
            )}
          >
            {asset.kind === "video" ? (
              <FileVideo className="h-4 w-4" aria-hidden />
            ) : (
              <ImageIcon className="h-4 w-4" aria-hidden />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">
                  {asset.original_filename}
                  {asset.variants_total > 1 ? (
                    <span className="ml-1.5 font-mono text-[11px] text-fuchsia-300">
                      v{asset.variant_index + 1}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                  <span>{formatBytes(asset.size_bytes)}</span>
                  {metrics.source_resolution ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono">
                        {metrics.source_resolution}
                        {metrics.output_resolution ? ` → ${metrics.output_resolution}` : ""}
                      </span>
                    </>
                  ) : null}
                  {asset.started_at ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{elapsed(asset.started_at, asset.finished_at)}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={clsx(
                    "flex items-center gap-1.5 text-[11px] font-medium capitalize",
                    STATUS_TEXT[asset.status],
                  )}
                >
                  <StatusIcon status={asset.status} />
                  <span className="hidden sm:inline">
                    {asset.status === "processing" ? asset.stage : asset.status}
                  </span>
                </span>

                {active && onCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel(asset.id)}
                    className="rounded-md p-1 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                    aria-label={`Cancel ${asset.original_filename}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            {asset.status !== "completed" || asset.progress < 100 ? (
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar
                  value={asset.progress}
                  active={asset.status === "processing"}
                  tone={
                    asset.status === "failed"
                      ? "danger"
                      : asset.status === "cancelled"
                        ? "muted"
                        : "neon"
                  }
                  label={`${asset.original_filename} progress`}
                />
                <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-500">
                  {Math.round(asset.progress)}%
                </span>
              </div>
            ) : null}

            {asset.error ? (
              <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                {asset.error}
              </p>
            ) : null}

            {asset.status === "completed" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {asset.download_url ? (
                  <a
                    href={absoluteUrl(asset.download_url)}
                    className="btn-primary !px-3 !py-1.5 !text-xs"
                    download
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Download
                    <span className="opacity-70">{formatBytes(asset.output_size_bytes)}</span>
                  </a>
                ) : null}

                {sizeDelta ? <span className="chip !text-[10px]">size {sizeDelta}</span> : null}

                {typeof metrics.dhash_distance === "number" ? (
                  <span className="chip !text-[10px]" title="Perceptual hash distance from the original">
                    <Fingerprint className="h-3 w-3 text-fuchsia-300" aria-hidden />
                    pHash Δ {metrics.dhash_distance}
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="ml-auto flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-cyan-300"
                  aria-expanded={expanded}
                >
                  {expanded ? "Hide" : "Report"}
                  <ChevronDown
                    className={clsx("h-3 w-3 transition-transform", expanded && "rotate-180")}
                    aria-hidden
                  />
                </button>
              </div>
            ) : null}

            {expanded && asset.status === "completed" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-slate-900/50 p-3">
                <div>
                  <p className="label mb-1.5">Applied mutations</p>
                  <ul className="space-y-1">
                    {asset.applied.map((entry) => (
                      <li key={entry} className="flex gap-2 text-[11px] text-slate-400">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-400" aria-hidden />
                        {entry}
                      </li>
                    ))}
                  </ul>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div className="col-span-2 flex justify-between gap-2">
                    <dt className="text-slate-500">Source SHA-256</dt>
                    <dd className="truncate font-mono text-slate-400">
                      {shortHash(metrics.source_sha256, 16)}
                    </dd>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <dt className="text-slate-500">Output SHA-256</dt>
                    <dd className="truncate font-mono text-emerald-300">
                      {shortHash(metrics.output_sha256, 16)}
                    </dd>
                  </div>
                  {metrics.source_fps ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Frame rate</dt>
                      <dd className="font-mono text-slate-300">
                        {metrics.source_fps} → {metrics.output_fps}
                      </dd>
                    </div>
                  ) : null}
                  {typeof metrics.residual_exif_tags === "number" ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">EXIF left</dt>
                      <dd className="font-mono text-emerald-300">{metrics.residual_exif_tags}</dd>
                    </div>
                  ) : null}
                  {metrics.residual_tags ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Provenance tags</dt>
                      <dd className="font-mono text-emerald-300">
                        {metrics.residual_tags.length}
                      </dd>
                    </div>
                  ) : null}
                  {typeof metrics.scrubbed_signatures === "number" ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Signatures wiped</dt>
                      <dd className="font-mono text-slate-300">{metrics.scrubbed_signatures}</dd>
                    </div>
                  ) : null}
                  {typeof metrics.seed === "number" ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Seed</dt>
                      <dd className="font-mono text-slate-300">{metrics.seed}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </NeonCard>
  );
}

export default JobCard;
