import Link from "next/link";
import { Compass } from "lucide-react";

import NeonCard from "@/components/NeonCard";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-cyan-300">
            <Compass className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Page not found</h1>
            <p className="mt-1.5 text-sm text-slate-400">
              That route does not exist in the console.
            </p>
          </div>
          <Link href="/" className="btn-primary">
            Back to the dashboard
          </Link>
        </div>
      </NeonCard>
    </main>
  );
}
