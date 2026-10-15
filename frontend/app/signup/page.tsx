import type { Metadata } from "next";
import { Suspense } from "react";

import AuthPanel from "@/components/AuthPanel";
import { BrandLogoFull } from "@/components/BrandLogo";
import NeonCard from "@/components/NeonCard";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Create an account — AdCamouflage",
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
        <BrandLogoFull className="relative mb-6 w-28 sm:w-36" />
        <Suspense
          fallback={
            <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
              <div className="h-[380px] animate-pulse rounded-lg bg-black/[0.03]" />
            </NeonCard>
          }
        >
          <AuthPanel mode="signup" />
        </Suspense>
      </main>
    </>
  );
}
