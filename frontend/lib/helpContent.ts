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
  { id: "upload", label: "Load", time: "10s", line: "Load your master video or image" },
  { id: "configure", label: "Settings", time: "15s", line: "Pick platform & variation profile" },
  { id: "overlay", label: "Overlay", time: "20s", line: "Optional: logo overlay & poster" },
  { id: "run", label: "Render", time: "15s", line: "Render & download studio variations" },
];

/** The one-line "How this step works" strip on top of each step card. */
export const HELP_STRIPS: Record<HelpStepId, string> = {
  upload: "Drop the finished creative you want to batch. Several files at once is fine: each one is processed separately.",
  configure: "Choose the target platform first, then a variation profile. Balanced fits most campaigns; Studio Pro or Dynamic adds deeper variation.",
  overlay: "Both tools here are optional. Skip this step if you don't need a logo watermark or a custom cover frame.",
  run: "Check the token cost, start the render, then download each variation or the whole batch as a zip.",
};

export const HELP_TIPS: Record<HelpStepId, HelpTip[]> = {
  upload: [
    {
      anchor: "load.drop",
      title: "Drop your master creative here",
      body: "Videos (MP4, MOV) and images (JPG, PNG) work. Use your clean, high-resolution master export.",
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
      title: "Where will the creative run?",
      body: "Meta, TikTok or YouTube. This sets the aspect ratio and delivery rules the variations are built for.",
    },
    {
      anchor: "settings.profile",
      title: "Pick a variation profile",
      body: "Balanced works for most campaigns. Choose Studio Pro (Gen-4) when your video has burned-in subtitles, or Dynamic for deeper visual & audio variation.",
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
      title: "Download your variations",
      body: "Each file appears here when it's done, with a full export report. Download right away: files are deleted after the retention window.",
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
      "Use the finished master export, not a project file or a screen recording.",
      "Load several creatives at once: each one gets its own variations.",
    ],
    tip: "Keep the original file name. It makes the downloaded variations easy to match.",
  },
  {
    id: "configure",
    title: "Choose settings",
    meta: "Platform · profile · copies",
    points: [
      "Platform: Meta, TikTok or YouTube sets the frame and length rules.",
      "Profile: Light for subtle polish, Balanced by default, Studio Pro (Gen-4) for subtitle-safe precision, Dynamic or Max Studio for maximum variation.",
      "Copies: how many independent variations you want per upload.",
    ],
    tip: "Testing across multiple campaigns or ad sets? Render a dedicated variation for each placement.",
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
    meta: "Zip + export report",
    points: [
      "Check the token cost line, then press Render.",
      "Renders keep going if you close the tab. Come back to the queue any time.",
      "Download each variation or the whole batch as a zip with its export report.",
    ],
    warning: "Files are deleted automatically after the retention window. Download your zip right away.",
  },
];

export const HELP_PRACTICES: string[] = [
  "Start with Balanced or Studio Pro (Gen-4) for broadcast-ready color, framing, and audio polish.",
  "Generate a dedicated variation for each campaign or ad set to keep your creative testing organized.",
  "Always upload your original clean master rather than re-processing an already exported variation.",
  "Use the built-in Brand Overlay and Poster Frame tools to keep your branding consistent across every batch.",
];

export const HELP_TOKENS: string[] = [
  "One uploaded file × one copy = one generation.",
  "The cost of the whole batch is shown on the Render step before you start.",
  "Tokens come with your plan for each 30-day period; top up any time from My plan.",
];

export const HELP_TROUBLE: { q: string; a: string }[] = [
  { q: "The Next button is greyed out", a: "Load at least one file on the Load step first." },
  { q: "Render is disabled", a: "Check the messages under the button: not enough tokens, no active plan, or an overlay that still needs an image." },
  { q: "Subtitles sit close to the frame edge", a: "Choose Studio Pro (Gen-4 Precision) or disable Smart edge framing so edge pixels remain untouched." },
  { q: "My download link is gone", a: "Files are deleted after the retention window. Upload the original again and render a new batch." },
];

/** Browser storage keys, so the tour and each step's tips show only once. */
export const HELP_STORAGE = {
  tourDone: "help.tourDone",
  drawerSeen: "help.drawerSeen",
  tipsSeen: (id: HelpStepId) => `help.tips.${id}`,
};
