"use client";

import clsx from "clsx";
import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { ApiError, absoluteUrl } from "@/lib/api";

export const DOWNLOAD_GONE = "This file is no longer available. Render it again to get a new copy.";

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 410) return DOWNLOAD_GONE;
    if (error.status === 401) return "You have been signed out. Sign in again to download.";
    if (error.status === 0) return "Could not reach the server. Check your connection and try again.";
    return error.message;
  }
  return "The download could not start. Try again.";
}

/** Hand a checked link to the browser as a normal file download. */
function startDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

interface DownloadLinkProps {
  /** The link from the last status read. Kept for "open in new tab". */
  href: string;
  /**
   * Ask the server for the link again, right before the download starts.
   * Resolves with nothing when the file is gone.
   */
  fresh: () => Promise<string | null | undefined>;
  /** Gets a message when the download cannot start, and null when it does. */
  onProblem?: (message: string | null) => void;
  className?: string;
  children: ReactNode;
}

/**
 * A download button that checks its link first.
 *
 * Download links are signed and expire, and files are purged after the
 * retention window. A plain `<a download>` pointed at a dead link makes the
 * browser save the server's error reply as a file called `download.json`. So
 * this asks for a fresh link on click and, if the file is gone, says so on the
 * page instead of saving anything.
 */
export function DownloadLink({ href, fresh, onProblem, className, children }: DownloadLinkProps) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>) => {
      // "Open in new tab" and similar are the browser's business.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      onProblem?.(null);
      try {
        const url = await fresh();
        if (url) startDownload(absoluteUrl(url));
        else onProblem?.(DOWNLOAD_GONE);
      } catch (error) {
        onProblem?.(problemText(error));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [fresh, onProblem],
  );

  return (
    <a
      href={absoluteUrl(href)}
      onClick={handleClick}
      className={clsx(className, busy && "cursor-progress opacity-70")}
      aria-busy={busy || undefined}
      download
    >
      {children}
    </a>
  );
}

export default DownloadLink;
