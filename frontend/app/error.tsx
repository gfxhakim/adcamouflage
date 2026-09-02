"use client";

import { OctagonX, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import NeonCard from "@/components/NeonCard";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("AdCamouflage UI error:", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <NeonCard tone="danger" padding="lg" radius="xl" className="w-full max-w-md">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-300">
            <OctagonX className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Something broke in the console</h1>
            <p className="mt-1.5 text-sm text-slate-400">
              {error.message || "An unexpected client-side error occurred."}
            </p>
          </div>
          <button type="button" onClick={reset} className="btn-primary">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reload the console
          </button>
        </div>
      </NeonCard>
    </main>
  );
}
