/** @type {import('next').NextConfig} */

// The browser talks only to this app's own origin; /api is proxied to the
// FastAPI service. That keeps the session cookie first-party, which is what
// lets middleware.ts guard /app, and removes CORS from the deployment entirely.
//
// API_ORIGIN is read when `next build` runs: Next bakes rewrite destinations
// into .next/routes-manifest.json, so changing it later needs a rebuild. The
// Dockerfile takes it as a build arg for that reason. middleware.ts also reads
// it at runtime, so the running server needs the same value.
const API_ORIGIN = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },

  // The old per-platform pages now live as a choice in the workspace's Settings step.
  async redirects() {
    return ["meta", "tiktok", "youtube"].map((name) => ({
      source: `/app/${name}`,
      destination: "/app",
      permanent: false,
    }));
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // SAMEORIGIN, not DENY: Admin > Landing / Workspace previews the site in a frame.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Browsers only ever reach the site over https once they have seen it.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // No camera, microphone, location or payment APIs for embedded content.
          // (Screen recording for support uses getDisplayMedia, allowed for the site itself.)
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(self)",
          },
          // Only this site may frame its pages, no plugins, and no <base> hijack.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
