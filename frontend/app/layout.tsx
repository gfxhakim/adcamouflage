import type { Metadata, Viewport } from "next";

import IntroScreen from "@/components/IntroScreen";
import { INTRO_GATE_SCRIPT } from "@/lib/intro";

import "./globals.css";

export const metadata: Metadata = {
  title: "AdCamouflage — Media Mutation & Fingerprint Stripping",
  description:
    "Camouflage ad creatives at scale: micro-crop and resample geometry, inject temporal noise, stagger frame rates, shift audio pitch and strip every provenance tag from the container.",
  applicationName: "AdCamouflage",
  keywords: [
    "ad camouflage",
    "media mutation",
    "fingerprint stripping",
    "metadata removal",
    "video processing",
  ],
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The gate script below may mark <html> before React hydrates it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_GATE_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <IntroScreen />
        {children}
      </body>
    </html>
  );
}
