import type { Metadata } from "next";
import { Suspense } from "react";

import { BrandLogoFull } from "@/components/BrandLogo";
import ForgotPanel from "@/components/ForgotPanel";
import NeonCard from "@/components/NeonCard";
import SiteHeader from "@/components/SiteHeader";
import { SITE_SLOGAN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Reset your password",
  alternates: { canonical: "/forgot-password" },
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <SiteHeader minimal />
      <main className="relative flex min-h-[calc(100vh-4.5rem)] flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-72 max-w-3xl animate-float-slow rounded-full bg-meta-500/[0.07] blur-3xl"
          aria-hidden
        />
        <BrandLogoFull className="relative w-32 sm:w-40" />
        <p className="relative mb-6 mt-3 text-center text-sm font-medium tracking-wide text-ink-subtle">{SITE_SLOGAN}</p>
        <Suspense
          fallback={
            <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
              <div className="h-[300px] animate-pulse rounded-lg bg-black/[0.03]" />
            </NeonCard>
          }
        >
          <ForgotPanel />
        </Suspense>
      </main>
    </>
  );
}
