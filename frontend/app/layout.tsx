import type { Metadata, Viewport } from "next";

import NeonDriver from "@/components/NeonDriver";
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
    <html lang="en">
      <body className="min-h-screen">
        {/* Keeps the neon borders rotating where CSS cannot animate them. */}
        <NeonDriver />
        {children}
      </body>
    </html>
  );
}
