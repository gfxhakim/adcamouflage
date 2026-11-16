import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";

import MetaPixel from "@/components/MetaPixel";
import { DECK_THEME_SCRIPT } from "@/lib/deckThemeScript";
import { siteUrl } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE } from "@/lib/site";
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
    // No site-wide canonical: each public page sets its own, so a page that
    // forgets one never tells Google it is a copy of the home page.
    creator: SITE_NAME,
    publisher: SITE_NAME,
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: base,
      locale: "en_US",
    },
    twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
    },
    // Search engine ownership checks, as an alternative to a DNS TXT record:
    // paste the code each tool gives you into these variables on Railway `web`.
    verification: verification(),
  };
}

function verification(): Metadata["verification"] {
  const env = (name: string) => (process.env[name] || "").trim();
  const other: Record<string, string> = {};
  if (env("BING_SITE_VERIFICATION")) other["msvalidate.01"] = env("BING_SITE_VERIFICATION");
  if (env("YANDEX_VERIFICATION")) other["yandex-verification"] = env("YANDEX_VERIFICATION");
  if (env("FACEBOOK_DOMAIN_VERIFICATION")) other["facebook-domain-verification"] = env("FACEBOOK_DOMAIN_VERIFICATION");
  return {
    ...(env("GOOGLE_SITE_VERIFICATION") ? { google: env("GOOGLE_SITE_VERIFICATION") } : {}),
    ...(Object.keys(other).length ? { other } : {}),
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
        <script dangerouslySetInnerHTML={{ __html: DECK_THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        {children}
        <MetaPixel />
      </body>
    </html>
  );
}
