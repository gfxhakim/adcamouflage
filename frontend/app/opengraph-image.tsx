import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { SITE_SLOGAN } from "@/lib/site";

// The picture shown when the site is shared on Facebook, WhatsApp, X, Slack...
export const alt = "ProteusFlow — video ad creative studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const mark = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/brand/proteusflow-mark-email.png")).toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "radial-gradient(circle at 80% 20%, #0866ff 0%, #031235 45%, #000 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- rendered to a PNG, not the page */}
          <img src={mark} width={96} height={96} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: "white" }}>ProteusFlow</div>
            <div style={{ fontSize: 24, color: "#7fb0ff" }}>{SITE_SLOGAN}</div>
          </div>
        </div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, marginTop: 28, maxWidth: 980 }}>
          Platform-ready video ads in minutes.
        </div>
        <div style={{ fontSize: 32, marginTop: 30, color: "rgba(255,255,255,0.75)", maxWidth: 980 }}>
          Reframe for Reels, TikTok and Shorts · brand overlays · cover frames · HD export
        </div>
      </div>
    ),
    size,
  );
}
