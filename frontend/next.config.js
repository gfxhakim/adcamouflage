/** @type {import('next').NextConfig} */

// The browser talks only to this app's own origin; /api is proxied to the
// FastAPI service. That keeps the session cookie first-party, which is what
// lets middleware.ts guard /app, and removes CORS from the deployment entirely.
//
// API_ORIGIN is read when `next build` runs: Next bakes rewrite destinations
// into .next/routes-manifest.json, so changing it later needs a rebuild. The
// Dockerfile takes it as a build arg for that reason.
const API_ORIGIN = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
