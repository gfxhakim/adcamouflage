/**
 * Guides: short, practical articles at /guides that help people find
 * ProteusFlow in search. A few ship with the app (BUILT_IN_GUIDES below);
 * Admin > Guides can edit them, switch them off or add new ones. Saved guides
 * win over built-in ones with the same slug.
 *
 * Bodies are a small, safe subset of Markdown (see components/guides/Markdown):
 * ## and ### headings, paragraphs, - and 1. lists, **bold**, *italic*,
 * [links](/path) and > quotes. No HTML.
 */

export interface Guide {
  slug: string;
  title: string;
  description: string;
  body: string;
  category?: string;
  cover?: string;
  cover_alt?: string;
  published?: boolean;
  created_at?: string;
  updated_at?: string;
  /** True for a guide that ships with the app and has not been edited in Admin. */
  builtin?: boolean;
}

const SHIPPED = "2026-11-16T00:00:00.000Z";

export const BUILT_IN_GUIDES: Guide[] = [
  {
    slug: "resize-video-for-reels-tiktok-shorts",
    title: "How to resize one video for Instagram Reels, TikTok and YouTube Shorts",
    description:
      "The sizes, aspect ratios and safe zones that matter when you turn one master video into vertical versions for Reels, TikTok and Shorts.",
    category: "Formats",
    body: `Most ad creatives start life in one shape, usually 16:9 from a camera or 1:1 from an old feed campaign, and then need to run everywhere. Vertical placements now get most of the attention on mobile, so a creative that is not built for 9:16 loses screen space and looks like an afterthought.

## The sizes to export

For vertical short-form placements the target is the same on all three platforms:

- **Aspect ratio:** 9:16 (portrait)
- **Resolution:** 1080 × 1920 pixels
- **Frame rate:** keep the source rate (24, 25, 30 or 60 fps); don't convert unless you have to
- **File type:** MP4 with H.264 video and AAC audio is accepted everywhere

For feed placements, 4:5 (1080 × 1350) uses more of the screen than 1:1 and is a good second version to keep. 16:9 (1920 × 1080) is still the right shape for in-stream YouTube.

Specs change from time to time, so check each platform's current ad specs before a big launch.

## Reframe, don't just stretch

Turning 16:9 into 9:16 means cropping about two thirds of the width. A plain center crop works for talking-head footage, but it cuts off products, text and faces that sit near the edges. Before you export:

1. Find the subject in each shot and keep it inside the crop.
2. Move or re-add on-screen text so nothing is cut at the sides.
3. If a shot cannot be cropped without losing the point, place it on a blurred or branded background instead of forcing a crop.

## Respect the safe zones

Each app draws its own buttons, captions and profile details over the bottom and right of a vertical video. Keep logos, prices and key words away from roughly the bottom 20% and the right-hand edge. A quick check: lay a screenshot of the app's interface over a frame of your export.

## Doing it for many files

Resizing one video by hand takes a few minutes in any editor. Doing it for every creative, in every format, for every campaign is where the hours go. The fastest routine is to make one clean master per aspect ratio, then produce everything else from those masters in batches. ProteusFlow keeps each master's size and quality, so once your 9:16 and 4:5 masters exist you can turn each into a batch of polished, branded variations with your logo and cover frame in one go.

## Quick checklist

- 9:16 at 1080 × 1920 for Reels, TikTok and Shorts
- 4:5 for feeds, 16:9 for in-stream
- Subject and text inside the crop
- Nothing important in the bottom 20% or on the right edge
- MP4 (H.264 + AAC), source frame rate`,
  },
  {
    slug: "ad-creative-variations-for-testing",
    title: "Ad creative variations: how to test more creatives without reshooting",
    description:
      "Why creative testing needs more than one version of a winning ad, which variables to change first, and how to keep tests readable.",
    category: "Creative testing",
    body: `On most ad platforms today the targeting is broad and automated, so the creative itself does most of the work of finding the right people. That makes creative testing the main lever a marketer still controls, and testing needs volume: one creative can't tell you what works.

## Why one winner is not enough

Even a strong ad wears out. As the same people see it again and again, click-through rate falls and cost per result rises. This is usually called creative fatigue. Having fresh versions ready lets you rotate them in before performance drops, instead of scrambling after it has.

## What to vary first

Change the things that viewers notice in the first seconds:

1. **The hook:** the first 1 to 3 seconds, the opening line or the first frame.
2. **The format:** vertical, square or landscape, with or without captions.
3. **The look:** color grade, framing and pacing.
4. **The offer and call to action:** price, guarantee, wording on the end card.
5. **The cover frame:** the still image people see before the video plays.

Change one main variable per test when you want a clear answer. Change several at once when you only need more good options in rotation.

## Keep tests readable

- Name every file so you can tell versions apart later, for example \`summer-sale_hookB_9x16_v3\`.
- Give each version enough spend to reach a result before you judge it.
- Keep a simple log of what changed and what happened. After a few rounds it becomes your own playbook.

## Getting the volume without the editing time

The slow part of creative testing is producing versions. ProteusFlow takes one finished video or image and renders up to ten polished variations of it in a single batch, each with its own color grade and subtle framing polish, plus your brand overlay and chosen cover frame. You keep the idea that works and get more versions of it to test.

Variations of a good ad are not a replacement for new ideas. Use them to extend a winner's life and learn which details matter, and keep making new concepts alongside.`,
  },
  {
    slug: "batch-video-editing-for-marketers",
    title: "Batch video editing for marketers: a simple weekly workflow",
    description:
      "A practical workflow for turning a handful of master videos into a full week of platform-ready ad creatives, without a timeline editor.",
    category: "Workflow",
    body: `Performance teams rarely need one perfect video. They need many good ones, in several formats, every week. Editing each file by hand in a timeline editor doesn't scale, so it helps to split the work into a few batch steps.

## 1. Start from masters

A master is the best, highest-quality version of a creative: full resolution, clean audio, no platform-specific text burned in yet. Keep masters in one folder and never edit them directly. Every version you publish should come from a master, so quality never degrades across generations of re-exports.

## 2. Decide the outputs before you edit

For each master, write down what you need: which platforms, which aspect ratios, how many variations and which brand elements. A typical set for one master might be:

- 9:16 for Reels, TikTok and Shorts
- 4:5 for feeds
- 3 to 5 variations for testing
- Logo in a corner, chosen cover frame

## 3. Process in batches

Upload all masters for the week at once and apply the same settings to the whole batch. ProteusFlow is built for this step: pick the output quality, add your logo overlay, choose how many variations, and the cloud renders the whole batch while you do something else.

## 4. Review fast

Watch each output once on a phone, with sound on and off. Check the first frame, the text, the safe zones and the audio level. Reject anything that looks wrong rather than fixing it by hand; adjust the settings and re-run the batch.

## 5. Name, upload and log

Download, name files consistently, upload to your ad accounts and note what went live. Next week, start again from the masters that performed best.

## Why this works

Batching moves the effort from repetitive clicks to decisions: which masters, which formats, how many versions. That is where a marketer's time is worth the most.`,
  },
  {
    slug: "add-logo-overlay-to-video-ads",
    title: "How to add your logo to video ads (and where to put it)",
    description:
      "Size, position, timing and opacity for a brand logo overlay on social video ads, so it builds recognition without getting in the way.",
    category: "Branding",
    body: `A small logo on every creative helps people connect the ad with your brand, especially when they scroll past without sound. Done badly, it covers the product or collides with the app's own buttons. A few simple rules avoid that.

## Use the right file

Export the logo as a **PNG with a transparent background**, at least 500 pixels wide so it stays sharp on 1080p video. Keep a light version for dark footage and a dark version for light footage.

## Size and position

- Aim for roughly **8 to 12% of the video width**. Big enough to read, small enough to ignore.
- On vertical video, the **top left or top center** is usually the safest spot. The bottom and right edges are covered by captions, buttons and profile details on Reels, TikTok and Shorts.
- Leave a margin of at least 40 pixels from the edge.

## Timing

You don't need the logo on screen the whole time. Common choices:

- **Every frame:** steady recognition, good for brand campaigns.
- **Intro only:** show it in the first seconds, then let the creative breathe.
- **End card:** a larger logo with your call to action in the final second.

## Opacity

Between 70 and 100% opacity works for most footage. Lower than that and it disappears on busy backgrounds.

## Doing it in batch

In ProteusFlow you upload the logo once, choose its position, size and when it shows, and the overlay is applied to every file and every variation in the batch, so the whole set stays consistent.`,
  },
  {
    slug: "choose-video-ad-cover-frame",
    title: "How to choose a video cover frame that gets the tap",
    description:
      "What makes a good thumbnail or cover frame for Reels, TikTok and YouTube Shorts ads, and how to pick one from your video.",
    category: "Creative testing",
    body: `The cover frame is the still image people see before a video plays: on profile grids, in feeds that don't autoplay and in some ad placements. It is a small detail that is easy to forget and easy to test.

## What a good cover frame has

- **One clear subject:** a face, the product or the result. Not a transition or a blurred moment.
- **Readable at a glance:** shown as a small tile, so fine detail disappears. Strong shapes and contrast win.
- **Eyes or action:** frames with a person looking at the camera, or with something clearly happening, tend to attract attention.
- **Matches the video:** a cover that promises something the video doesn't deliver hurts trust and watch time.

## How to pick one

1. Scrub through the video and note three or four candidate frames.
2. Look at each one at thumbnail size, about the size of a stamp on your phone.
3. Pick the one you understand fastest.
4. Keep the others and test them as variations later.

## Text on the cover

A few words can help on organic posts, but keep them inside the center of the frame, since grids crop vertical covers to a smaller shape.

## In ProteusFlow

The cover frame picker in the workspace lets you choose the exact frame for each export, so every variation in a batch can carry the cover you want.`,
  },
  {
    slug: "audio-loudness-for-social-video-ads",
    title: "Audio for social video ads: loudness, voiceover clarity and silent viewing",
    description:
      "How loud social video ads should be, how to keep voiceovers clear on phone speakers, and why captions still matter.",
    category: "Audio",
    body: `Sound is easy to neglect in a short ad, but uneven or muddy audio makes a good creative feel cheap. Most viewers hear your ad through a phone speaker, so mix for that.

## How loud is loud enough

Streaming and social platforms normalize audio toward a target loudness, commonly around **-14 LUFS integrated**. If your ad is much quieter it sounds weak next to the content around it; if it is much louder the platform turns it down and it may sound squashed. Aim for about -14 LUFS with peaks below -1 dBTP.

## Keep the voice on top

- Duck music under the voiceover by 6 to 12 dB while someone is speaking.
- Cut low rumble below roughly 80 Hz; phone speakers can't play it and it eats headroom.
- A gentle boost around 2 to 5 kHz makes speech clearer on small speakers.
- Check the mix on a phone, not only on headphones.

## Design for silent viewing too

A large share of people scroll with sound off. Burned-in captions, on-screen text for the main message and a clear visual story mean the ad still works muted.

## Consistency across a batch

When you render many versions of the same creative, mix the master properly once: every version made from it starts from the same sound. That is one more reason to keep a clean master and build variations from it, in ProteusFlow or any other tool, instead of re-mixing each export by hand.`,
  },
];

export function builtInGuide(slug: string): Guide | undefined {
  const guide = BUILT_IN_GUIDES.find((g) => g.slug === slug);
  return guide ? { ...guide, builtin: true, published: true, created_at: SHIPPED, updated_at: SHIPPED } : undefined;
}

interface PublicGuides {
  guides: Guide[];
  unpublished: string[];
}

function apiOrigin(): string {
  return (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");
}

/** Server: what the API holds (empty if it can't be reached; built-in guides still show). */
async function loadSaved(): Promise<PublicGuides> {
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/guides`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { guides: [], unpublished: [] };
    const data = (await response.json()) as Partial<PublicGuides>;
    return {
      guides: Array.isArray(data.guides) ? data.guides.filter((g) => g && typeof g.slug === "string") : [],
      unpublished: Array.isArray(data.unpublished) ? data.unpublished : [],
    };
  } catch {
    return { guides: [], unpublished: [] };
  }
}

/** Server: every published guide, newest first. Saved guides replace built-in ones with the same slug. */
export async function loadGuides(): Promise<Guide[]> {
  const saved = await loadSaved();
  const hidden = new Set(saved.unpublished);
  const bySlug = new Map<string, Guide>();
  for (const guide of BUILT_IN_GUIDES) {
    if (!hidden.has(guide.slug)) bySlug.set(guide.slug, builtInGuide(guide.slug)!);
  }
  for (const guide of saved.guides) bySlug.set(guide.slug, { ...guide, builtin: false });
  return Array.from(bySlug.values()).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

export async function loadGuide(slug: string): Promise<Guide | undefined> {
  return (await loadGuides()).find((g) => g.slug === slug);
}

/** Rough reading time, for the guide header. */
export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220));
}

export function formatGuideDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
