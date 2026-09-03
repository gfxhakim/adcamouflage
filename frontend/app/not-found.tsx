import Link from "next/link";
import { Compass } from "lucide-react";

import NeonCard from "@/components/NeonCard";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-black/10 bg-meta-50 text-meta-500">
            <Compass className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-black">Page not found</h1>
            <p className="mt-1.5 text-sm text-ink-subtle">
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
