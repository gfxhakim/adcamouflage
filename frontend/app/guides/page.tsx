import type { Metadata } from "next";
import Link from "next/link";

import GuideShell from "@/components/guides/GuideShell";
import { formatGuideDate, loadGuides, readingMinutes } from "@/lib/guides";
import { jsonLd, siteUrl } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

const TITLE = "Guides: video ad creatives, formats and creative testing";
const DESCRIPTION =
  "Practical guides for marketers and media buyers: resizing video for Reels, TikTok and Shorts, creative testing, batch editing, logo overlays, cover frames and audio.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION, url: "/guides", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/opengraph-image"] },
};

export default async function GuidesPage() {
  const guides = await loadGuides();
  const base = siteUrl();
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: TITLE,
        description: DESCRIPTION,
        url: `${base}/guides`,
        isPartOf: { "@id": `${base}/#website` },
        hasPart: guides.map((g) => ({ "@type": "Article", headline: g.title, url: `${base}/guides/${g.slug}` })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${base}/` },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${base}/guides` },
        ],
      },
    ],
  };

  return (
    <GuideShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta-600">{SITE_NAME} guides</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
        Guides for making better video ad creatives
      </h1>
      <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-neutral-600">{DESCRIPTION}</p>

      <ul className="mt-10 divide-y divide-black/10 border-y border-black/10">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/guides/${guide.slug}`} className="group block py-6">
              {guide.category ? (
                <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">{guide.category}</span>
              ) : null}
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900 group-hover:text-meta-600 sm:text-2xl">
                {guide.title}
              </h2>
              {guide.description ? <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">{guide.description}</p> : null}
              <p className="mt-2 text-xs text-neutral-500">
                {formatGuideDate(guide.updated_at)} · {readingMinutes(guide.body)} min read
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </GuideShell>
  );
}
