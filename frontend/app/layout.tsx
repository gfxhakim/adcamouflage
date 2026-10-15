import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";

import IntroScreen from "@/components/IntroScreen";
import { INTRO_GATE_SCRIPT } from "@/lib/intro";

import "./globals.css";

// Headlines: Instrument Serif (the blue part set in italic). Text: Geist.
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable}`}
    >
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
