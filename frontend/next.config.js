/** @type {import('next').NextConfig} */

// The browser talks only to this app's own origin; /api is proxied to the
// FastAPI service. That keeps the session cookie first-party, which is what
// lets middleware.ts guard /app, and removes CORS from the deployment entirely.
//
// API_ORIGIN is a server-side variable, so it can be changed at deploy time
// without rebuilding - unlike NEXT_PUBLIC_*, which is inlined at build time.
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
