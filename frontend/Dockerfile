# syntax=docker/dockerfile:1
# The project lives in /web, never /app: Next.js 14 mixes up the route folder
# app/app (the workspace at /app) with the home page when the project folder
# itself is called /app, and serves the workspace at / instead of the landing
# page. Keep this folder name anything but "app".
FROM node:22-alpine AS deps
WORKDIR /web
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /web
COPY --from=deps /web/node_modules ./node_modules
COPY . .

# The browser calls this app's own origin and /api is proxied to API_ORIGIN.
# Next writes rewrite destinations into .next/routes-manifest.json during
# `next build`, so API_ORIGIN must be known here - setting it only at runtime
# leaves the proxy pointing at the default and every /api call returns 500.
# Railway passes service variables to declared build args automatically;
# Compose passes it under build.args.
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=${API_ORIGIN} \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Needed at runtime too: middleware.ts reads it on each request to ask the API
# whether a session is an admin's. Keep it the same as the build value.
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=${API_ORIGIN}

RUN addgroup -g 10001 -S nodejs && adduser -u 10001 -S nextjs -G nodejs

COPY --from=builder /web/public ./public
COPY --from=builder /web/.next ./.next
COPY --from=builder /web/node_modules ./node_modules
COPY --from=builder /web/package.json ./package.json
COPY --from=builder /web/next.config.js ./next.config.js

USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start"]
