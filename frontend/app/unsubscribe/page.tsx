import type { Metadata } from "next";
import { Suspense } from "react";

import SiteHeader from "@/components/SiteHeader";

import UnsubscribeForm from "./UnsubscribeForm";

export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
};

/** Opened from the unsubscribe link at the bottom of a group email. */
export default function UnsubscribePage() {
  return (
    <>
      <SiteHeader minimal />
      <main className="mx-auto max-w-lg px-4 pb-24 pt-16 sm:px-6">
        <Suspense fallback={null}>
          <UnsubscribeForm />
        </Suspense>
      </main>
    </>
  );
}
