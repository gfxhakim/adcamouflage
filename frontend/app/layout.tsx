import type { Metadata, Viewport } from "next";

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
  themeColor: "#020617",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
