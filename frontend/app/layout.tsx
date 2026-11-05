import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";

import IntroScreen from "@/components/IntroScreen";
import MetaPixel from "@/components/MetaPixel";
import { DECK_THEME_SCRIPT } from "@/lib/deckThemeScript";
import { INTRO_GATE_SCRIPT } from "@/lib/intro";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, siteUrl } from "@/lib/site";
import "./globals.css";

// Headlines: Instrument Serif (the blue part set in italic). Text: Geist.
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// Read on each request so SITE_URL set on Railway applies without a rebuild.
export async function generateMetadata(): Promise<Metadata> {
  const base = siteUrl();
  return {
    metadataBase: new URL(base),
    title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: SITE_KEYWORDS,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: base,
      locale: "en_US",
    },
    twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
    robots: { index: true, follow: true },
    // Paste the code from Google Search Console / Meta Business domain verification into these env vars.
    verification: {
      ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
      ...(process.env.FACEBOOK_DOMAIN_VERIFICATION
        ? { other: { "facebook-domain-verification": process.env.FACEBOOK_DOMAIN_VERIFICATION } }
        : {}),
    },
  };
}

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
        <script dangerouslySetInnerHTML={{ __html: DECK_THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <IntroScreen />
        {children}
        <MetaPixel />
      </body>
    </html>
  );
}
