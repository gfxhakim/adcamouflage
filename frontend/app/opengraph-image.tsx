import { ImageResponse } from "next/og";

// The picture shown when the site is shared on Facebook, WhatsApp, X, Slack...
export const alt = "BluCloacking — video ad creative editor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        <div style={{ fontSize: 34, letterSpacing: 6, color: "#7fb0ff" }}>BLUCLOACKING</div>
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
