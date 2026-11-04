/**
 * Built-in wording for the workspace help: the welcome tour, the help drawer
 * and the step tips. Every string here is only the fallback; Admin >
 * Workspace can rewrite any of it under the "Help" group.
 */

export type HelpStepId = "upload" | "configure" | "overlay" | "run";

export interface HelpTip {
  /** Matches a `data-tour="…"` attribute on the workspace page. */
  anchor: string;
  title: string;
  body: string;
}

export interface HelpGuideSection {
  id: HelpStepId;
  title: string;
  /** The short grey line on the right of the closed section. */
  meta: string;
  points: string[];
  tip?: string;
  warning?: string;
}

export const HELP_STEPS: { id: HelpStepId; label: string; time: string; line: string }[] = [
  { id: "upload", label: "Load", time: "10s", line: "Load your winning video or image" },
  { id: "configure", label: "Settings", time: "15s", line: "Pick platform & camouflage profile" },
  { id: "overlay", label: "Overlay", time: "20s", line: "Optional: logo overlay & poster" },
  { id: "run", label: "Render", time: "15s", line: "Render & download fresh copies" },
];

/** The one-line "How this step works" strip on top of each step card. */
export const HELP_STRIPS: Record<HelpStepId, string> = {
  upload: "Drop the finished ad you want to reuse. Several files at once is fine: each one is treated separately.",
  configure: "Choose the platform first, then a profile. Balanced fits most ads; Aggressive is for creatives that were already rejected.",
  overlay: "Both tools here are optional. Skip this step if you don't need a logo or a custom cover frame.",
  run: "Check the token cost, start the run, then download each copy or the whole batch as a zip.",
};

export const HELP_TIPS: Record<HelpStepId, HelpTip[]> = {
  upload: [
    {
      anchor: "load.drop",
      title: "Drop your winning ad here",
      body: "Videos (MP4, MOV) and images (JPG, PNG) work. Use the finished export, the exact file that was performing or got flagged.",
    },
    {
      anchor: "stepper",
      title: "Four steps, in order",
      body: "Load, Settings, Overlay, Render. The other steps unlock as soon as at least one file is loaded.",
    },
    {
      anchor: "help",
      title: "Help is always one click away",
      body: "Open this button any time for the full guide, best practices and answers about tokens.",
    },
  ],
  configure: [
    {
      anchor: "settings.platform",
      title: "Where will the ad run?",
      body: "Meta, TikTok or YouTube. This sets the frame and length rules the copies are made for.",
    },
    {
      anchor: "settings.profile",
      title: "Pick a camouflage profile",
      body: "Balanced works for most ads. If the platform already rejected this creative, switch to Aggressive. Use Nuclear only for banned files: it changes the most.",
    },
  ],
  overlay: [
    {
      anchor: "overlay.logo",
      title: "Optional: add your logo",
      body: "Upload a PNG and place it on the frame. Flash modes show it on and off at a rhythm you choose.",
    },
    {
      anchor: "overlay.poster",
      title: "Optional: choose the cover",
      body: "Pick the frame platforms show before the video plays. Leave it off to keep the default.",
    },
  ],
  run: [
    {
      anchor: "render.run",
      title: "Check the cost, then run",
      body: "One output file is one generation. The exact token cost is shown here before you start.",
    },
    {
      anchor: "render.queue",
      title: "Download your fresh copies",
      body: "Each file appears here when it's done, with a report of what changed. Download right away: files are deleted after the retention window.",
    },
  ],
};

export const HELP_GUIDE: HelpGuideSection[] = [
  {
    id: "upload",
    title: "Load your assets",
    meta: "MP4 · MOV · JPG · PNG",
    points: [
      "Drag files onto the drop zone or click it to browse.",
      "Use the finished export, not a project file or a screen recording.",
      "Load several creatives at once: each one gets its own copies.",
    ],
    tip: "Keep the original file name. It makes the downloaded copies easy to match.",
  },
  {
    id: "configure",
    title: "Choose settings",
    meta: "Platform · profile · copies",
    points: [
      "Platform: Meta, TikTok or YouTube sets the frame and length rules.",
      "Profile: Stealth for fresh ads, Balanced by default, Aggressive for rejected ads, Nuclear for banned creatives.",
      "Copies: how many unique files you want. One per ad account.",
    ],
    tip: "Launching on several ad accounts? Render one copy per account. Never reuse the same copy twice.",
  },
  {
    id: "overlay",
    title: "Overlay & poster (optional)",
    meta: "Logo · flash · cover",
    points: [
      "Add up to 6 logos or badges and drag them into place on the preview.",
      "Choose when each logo shows: always, intro only, frame ranges, or a flash rhythm.",
      "Pick a poster frame to control the cover image.",
    ],
    warning: "Flashing more than 3 times a second can affect people with photosensitive epilepsy.",
  },
  {
    id: "run",
    title: "Render & download",
    meta: "Zip + change report",
    points: [
      "Check the token cost line, then press Run.",
      "Renders keep going if you close the tab. Come back to the queue any time.",
      "Download each copy or the whole batch as a zip with its change report.",
    ],
    warning: "Files are deleted automatically after the retention window. Download your zip right away.",
  },
];

export const HELP_PRACTICES: string[] = [
  "Start with Balanced. Move up to Aggressive only if a copy gets rejected.",
  "One fresh copy per ad account, so accounts are never linked by the same file.",
  "Don't re-upload a copy you already ran; render a new one instead.",
  "Keep the hook and the offer the same. Only the file fingerprint needs to change.",
];

export const HELP_TOKENS: string[] = [
  "One uploaded file × one copy = one generation.",
  "The cost of the whole batch is shown on the Render step before you start.",
  "Tokens come with your plan for each 30-day period; top up any time from My plan.",
];

export const HELP_TROUBLE: { q: string; a: string }[] = [
  { q: "The Next button is greyed out", a: "Load at least one file on the Load step first." },
  { q: "Run is disabled", a: "Check the messages under the button: not enough tokens, no active plan, or an overlay that still needs an image." },
  { q: "A copy was still rejected", a: "Render a new copy with a stronger profile (Aggressive) and upload that one instead." },
  { q: "My download link is gone", a: "Files are deleted after the retention window. Upload the original again and render new copies." },
];

/** Browser storage keys, so the tour and each step's tips show only once. */
export const HELP_STORAGE = {
  tourDone: "help.tourDone",
  drawerSeen: "help.drawerSeen",
  tipsSeen: (id: HelpStepId) => `help.tips.${id}`,
};
