# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
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
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Kept for reference only: the proxy target was fixed at build time above.
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=${API_ORIGIN}

RUN addgroup -g 10001 -S nodejs && adduser -u 10001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js

USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start"]
