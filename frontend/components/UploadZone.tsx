"use client";

import clsx from "clsx";
import { FileVideo, Image as ImageIcon, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import NeonCard from "./NeonCard";

const VIDEO_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv", "flv", "ts", "3gp",
];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "heic", "heif", "gif"];

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

export function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(extensionOf(name));
}

export function isSupported(name: string): boolean {
  const extension = extensionOf(name);
  return VIDEO_EXTENSIONS.includes(extension) || IMAGE_EXTENSIONS.includes(extension);
}

interface UploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  maxFiles: number;
  maxSizeMb: number;
  disabled?: boolean;
}

export function UploadZone({
  files,
  onFilesChange,
  maxFiles,
  maxSizeMb,
  disabled = false,
}: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const inputId = useId();

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const rejected: string[] = [];
      const accepted: File[] = [];
      const seen = new Set(files.map((file) => `${file.name}:${file.size}`));

      Array.from(incoming).forEach((file) => {
        const key = `${file.name}:${file.size}`;
        if (!isSupported(file.name)) {
          rejected.push(`${file.name} — unsupported file type`);
          return;
        }
        if (file.size === 0) {
          rejected.push(`${file.name} — the file is empty`);
          return;
        }
        if (file.size > maxSizeMb * 1024 * 1024) {
          rejected.push(`${file.name} — over the ${maxSizeMb}MB limit`);
          return;
        }
        if (seen.has(key)) {
          rejected.push(`${file.name} — already queued`);
          return;
        }
        seen.add(key);
        accepted.push(file);
      });

      const room = maxFiles - files.length;
      if (accepted.length > room) {
        rejected.push(`Only ${maxFiles} files fit in one batch; the rest were dropped.`);
      }

      setWarnings(rejected);
      if (accepted.length > 0) {
        onFilesChange([...files, ...accepted.slice(0, Math.max(0, room))]);
      }
    },
    [files, maxFiles, maxSizeMb, onFilesChange],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (disabled) return;
      if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
    },
    [addFiles, disabled],
  );

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
      >
        <NeonCard
          tone={dragging || files.length > 0 ? "default" : "muted"}
          padding="none"
          radius="xl"
          interactive={!disabled}
          className={clsx("transition-transform", dragging && "scale-[1.01]")}
        >
          <label
            htmlFor={inputId}
            className={clsx(
              "relative flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center transition-colors",
              dragging && "bg-cyan-400/[0.07]",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="grid-backdrop pointer-events-none absolute inset-0 opacity-40" aria-hidden />
            <span
              className={clsx(
                "relative grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 transition-all",
                dragging ? "scale-110 border-cyan-400/60 text-cyan-200 shadow-neon" : "text-slate-300",
              )}
            >
              <UploadCloud className="h-6 w-6" aria-hidden />
            </span>
            <span className="relative">
              <span className="block text-sm font-semibold text-slate-100">
                {dragging ? "Release to queue these assets" : "Drop videos or images here"}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                or click to browse · up to {maxFiles} files · {maxSizeMb}MB each
              </span>
            </span>
            <span className="relative flex flex-wrap justify-center gap-1.5">
              {["MP4", "MOV", "WEBM", "JPG", "PNG", "WEBP"].map((format) => (
                <span key={format} className="chip !text-[10px]">
                  {format}
                </span>
              ))}
            </span>
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              multiple
              disabled={disabled}
              accept={[...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS].map((e) => `.${e}`).join(",")}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </NeonCard>
      </div>

      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3 text-xs text-amber-200">
          <div className="flex items-start justify-between gap-3">
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setWarnings([])}
              className="shrink-0 rounded-md p-1 text-amber-300/70 transition-colors hover:bg-amber-400/10 hover:text-amber-100"
              aria-label="Dismiss warnings"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="label">
              Queued · {files.length}/{maxFiles} · {formatBytes(totalBytes)}
            </p>
            <button
              type="button"
              className="text-[11px] font-medium text-slate-400 transition-colors hover:text-rose-300 disabled:opacity-40"
              onClick={() => onFilesChange([])}
              disabled={disabled}
            >
              Clear all
            </button>
          </div>

          <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {files.map((file, index) => {
              const video = isVideo(file.name);
              return (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="group flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 transition-colors hover:border-cyan-400/30 hover:bg-cyan-400/[0.04]"
                >
                  <span
                    className={clsx(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5",
                      video ? "text-fuchsia-300" : "text-cyan-300",
                    )}
                  >
                    {video ? (
                      <FileVideo className="h-4 w-4" aria-hidden />
                    ) : (
                      <ImageIcon className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-200">
                      {file.name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {formatBytes(file.size)} · {video ? "video" : "image"}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                    className="shrink-0 rounded-md p-1.5 text-slate-500 opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                    aria-label={`Remove ${file.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default UploadZone;
