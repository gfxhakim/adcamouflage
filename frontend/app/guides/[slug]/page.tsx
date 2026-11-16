import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import GuideShell, { GUIDE_BODY_CLASS, GuideCta } from "@/components/guides/GuideShell";
import Markdown, { plainText } from "@/components/guides/Markdown";
import { formatGuideDate, loadGuide, loadGuides, readingMinutes } from "@/lib/guides";
import { jsonLd, siteUrl } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

function summary(description: string, body: string): string {
  const text = (description || plainText(body)).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157).replace(/\s+\S*$/, "")}…` : text;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = await loadGuide(params.slug);
  if (!guide) return { title: "Guide not found", robots: { index: false, follow: true } };
  const description = summary(guide.description, guide.body);
  const path = `/guides/${guide.slug}`;
  // The guide's own cover, else the site's link-preview picture.
  const image = guide.cover
    ? { url: guide.cover, alt: guide.cover_alt || guide.title }
    : { url: "/opengraph-image", width: 1200, height: 630, alt: `${SITE_NAME} guides` };
  return {
    title: guide.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      locale: "en_US",
      title: guide.title,
      description,
      url: path,
      ...(guide.updated_at ? { modifiedTime: guide.updated_at } : {}),
      ...(guide.created_at ? { publishedTime: guide.created_at } : {}),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: guide.title, description, images: [image] },
  };
}

export default async function GuidePage({ params }: Props) {
  const guide = await loadGuide(params.slug);
  if (!guide) notFound();
  const others = (await loadGuides()).filter((g) => g.slug !== guide.slug).slice(0, 3);
  const base = siteUrl();
  const url = `${base}/guides/${guide.slug}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: guide.title,
        description: summary(guide.description, guide.body),
        url,
        mainEntityOfPage: url,
        ...(guide.created_at ? { datePublished: guide.created_at } : {}),
        ...(guide.updated_at ? { dateModified: guide.updated_at } : {}),
        ...(guide.cover ? { image: guide.cover.startsWith("/") ? `${base}${guide.cover}` : guide.cover } : {}),
        author: { "@type": "Organization", name: SITE_NAME, url: `${base}/` },
        publisher: { "@id": `${base}/#org` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${base}/` },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${base}/guides` },
          { "@type": "ListItem", position: 3, name: guide.title, item: url },
        ],
      },
    ],
  };

  return (
    <GuideShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <ol className="flex flex-wrap gap-1.5">
          <li><Link href="/" className="hover:text-neutral-900">{SITE_NAME}</Link> /</li>
          <li><Link href="/guides" className="hover:text-neutral-900">Guides</Link></li>
        </ol>
      </nav>
      <article className="mt-6">
        <header>
          {guide.category ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta-600">{guide.category}</p>
          ) : null}
          <h1 className="mt-2 text-[2.1rem] font-semibold leading-tight tracking-tight text-neutral-900 sm:text-5xl">{guide.title}</h1>
          {guide.description ? <p className="mt-4 text-lg leading-relaxed text-neutral-600">{guide.description}</p> : null}
          <p className="mt-4 text-sm text-neutral-500">
            By the {SITE_NAME} team ·{" "}
            {guide.updated_at ? <time dateTime={guide.updated_at}>Updated {formatGuideDate(guide.updated_at)}</time> : null} ·{" "}
            {readingMinutes(guide.body)} min read
          </p>
        </header>
        {guide.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={guide.cover} alt={guide.cover_alt || ""} className="mt-8 w-full rounded-2xl" loading="eager" />
        ) : null}
        <div className={`mt-8 ${GUIDE_BODY_CLASS}`}>
          <Markdown source={guide.body} />
        </div>
      </article>

      <GuideCta />

      {others.length ? (
        <section className="mt-14" aria-labelledby="more-guides">
          <h2 id="more-guides" className="text-xl font-semibold tracking-tight text-neutral-900">More guides</h2>
          <ul className="mt-4 space-y-3">
            {others.map((g) => (
              <li key={g.slug}>
                <Link href={`/guides/${g.slug}`} className="text-meta-600 underline underline-offset-2 hover:text-meta-500">
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </GuideShell>
  );
}
