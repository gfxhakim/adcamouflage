# Deploying to Railway

Four pieces: two services built from this repo, plus Railway's managed Postgres
and Redis.

```
                    Internet
                       │
                       ▼
            ┌──────────────────────┐
            │  web  (Next.js)      │  ← the only public service
            │  your-app.up.railway │
            └──────────┬───────────┘
                       │  /api/*  over Railway's private network
                       ▼
            ┌──────────────────────┐
            │  api                 │  uvicorn + celery worker + beat
            │  api.railway.internal│  + volume mounted at /data
            └────┬────────────┬────┘
                 ▼            ▼
            ┌─────────┐  ┌──────────┐
            │  Redis  │  │ Postgres │
            └─────────┘  └──────────┘
```

## Why the API service runs the workers too

**A Railway volume attaches to exactly one service.** The API writes uploads and
serves outputs; the workers write renders — they must see the same disk. So the
API service runs uvicorn, a Celery worker and the beat scheduler together, and
owns the volume (`backend/entrypoint.sh` does this).

Renders still go through the Redis queue, so a long encode never blocks an HTTP
request; the worker is simply a sibling process instead of a sibling service.

To split them onto separate services later, move storage off local disk to S3 or
Cloudflare R2 first — two Railway services cannot share one volume.

## Setup

### 1. Postgres and Redis

In your Railway project: **New → Database → Add PostgreSQL**, then again for
**Redis**. Railway creates `DATABASE_URL` and `REDIS_URL` variables you will
reference below.

### 2. The `api` service

**New → GitHub Repo →** this repository.

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Builder | Dockerfile (auto-detected) |
| Custom Start Command | `/usr/local/bin/entrypoint.sh` |
| Health Check Path | `/api/v1/health` |

Add a **Volume** mounted at **`/data`** (Settings → Volumes). Size it for your
throughput; outputs are deleted on the retention timer, so it does not grow
without bound.

Variables:

```bash
# Railway's Postgres URL is postgresql://…; SQLAlchemy needs the psycopg driver.
ADCAM_DATABASE_URL=${{Postgres.DATABASE_URL}}
ADCAM_REDIS_URL=${{Redis.REDIS_URL}}

ADCAM_STORAGE_ROOT=/data
ADCAM_ENVIRONMENT=production

# REQUIRED. Generate once and never change it, or every session and download
# link is invalidated:
#   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
ADCAM_SECRET_KEY=<paste>

# The browser only ever talks to the web service, which is HTTPS.
ADCAM_COOKIE_SECURE=true
ADCAM_COOKIE_SAMESITE=lax

ADCAM_WORKER_CONCURRENCY=2
ADCAM_MAX_UPLOAD_MB=512
ADCAM_RETENTION_HOURS=24
ADCAM_ALLOW_REGISTRATION=true
```

> Railway's URL comes through as `postgresql://`. The app rewrites that to
> `postgresql+psycopg://` on startup, so the reference above works as-is.

**Do not give this service a public domain.** It is reached over Railway's
private network, which keeps the API off the public internet entirely.

### 3. The `web` service

**New → GitHub Repo →** the same repository.

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Builder | Dockerfile |
| Public Networking | Generate a domain (this is the one people visit) |

Variables:

```bash
# Railway's private network is IPv6; the entrypoint binds :: for this to resolve.
API_ORIGIN=http://api.railway.internal:8000
NODE_ENV=production
```

If you named the API service something other than `api`, change the hostname to
match.

### 4. Deploy

Both services build on push. Open the web service's domain, create the first
account, and you are live.

## After launch

**Close sign-ups** once your team is in — set `ADCAM_ALLOW_REGISTRATION=false`
on the `api` service and redeploy. Existing users keep signing in; registration
returns 403.

**More render capacity.** Raise `ADCAM_WORKER_CONCURRENCY` and give the `api`
service more CPU. Rendering is CPU-bound, so cores are what matter. Note that
concurrency multiplies memory use — 2 is a sensible start.

**Back up Postgres.** Railway can take scheduled backups on the database
service. Accounts and batch history live there. Store `ADCAM_SECRET_KEY`
somewhere safe too; losing it signs everyone out.

## The upload-size limit — read this before going live

With the private-network layout, browser uploads pass through the Next.js
service before reaching FastAPI. That path is subject to Railway's request
limits and to Node buffering, so **very large files can fail** even though the
API would accept them.

Start with `ADCAM_MAX_UPLOAD_MB=512` and test with your largest real creative.
If you need bigger uploads, two options:

1. **Give the `api` service its own public domain** and set
   `NEXT_PUBLIC_API_URL=https://api-yourproject.up.railway.app` on the web
   service. The browser then uploads straight to FastAPI. This is cross-origin,
   so also set on the API service:
   ```bash
   ADCAM_CORS_ORIGINS=https://your-web-domain.up.railway.app
   ADCAM_COOKIE_SAMESITE=none     # required cross-site
   ADCAM_COOKIE_SECURE=true       # required whenever SAMESITE=none
   ```
   `NEXT_PUBLIC_*` is inlined at build time, so the web service must rebuild
   after setting it. The trade-off: the Next middleware can no longer read the
   cookie, so `/app` is guarded client-side only — every API call is still
   checked server-side, which is what actually protects the data.

2. **Move to object storage** (S3/R2) with presigned uploads, which also unlocks
   splitting the workers onto their own service. That is a code change, not
   configuration — tell me if you want it.

## Cost

Railway bills on usage. Roughly, for light use: Postgres and Redis a few dollars
each, the web service a few dollars, and the API service dominated by how much
CPU time your renders consume. Expect **$15–40/month** for a small team, more if
you render constantly. A fixed-price VPS with `docker-compose.prod.yml` is
cheaper at sustained load; Railway is easier to operate.

## Troubleshooting

**`api` starts then exits.** Check `ADCAM_SECRET_KEY` is set — the service
refuses to run without it in production. The deploy log shows the reason.

**`web` returns 502.** `API_ORIGIN` does not resolve. Confirm the API service's
name matches the hostname, and that it is listening (its log prints
`starting api on [::]:<port>`).

**Renders stay queued.** `ADCAM_REDIS_URL` is wrong, or the worker did not
start. The API log should show `celery@… ready` shortly after boot, and
`/api/v1/health` reports `worker_mode: celery` plus the queue depth.

**Everyone signed out after a deploy.** `ADCAM_SECRET_KEY` changed. Pin it.

**Uploads fail at a certain size.** See the section above.
