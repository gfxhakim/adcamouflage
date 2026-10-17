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
| Config File Path | `/backend/railway.json` |

`backend/railway.json` sets the Dockerfile build, the start command
(`/usr/local/bin/entrypoint.sh`), the `/api/v1/health` health check, the restart
policy and a single replica, so nothing else needs setting by hand. Railway does
not look inside the Root Directory for this file, which is why its path is given
explicitly.

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

# Pin the port. Railway otherwise injects its own PORT, and the web service's
# API_ORIGIN below would point at the wrong one.
PORT=8000

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
| Config File Path | `/frontend/railway.json` |
| Public Networking | Generate a domain (this is the one people visit) |

Variables:

```bash
# Railway's private network is IPv6; the entrypoint binds :: for this to resolve.
API_ORIGIN=http://api.railway.internal:8000
NODE_ENV=production
```

If you named the API service something other than `api`, change the hostname to
match.

`API_ORIGIN` is used while the image builds (Next fixes the proxy target at
build time) and while the site runs (the `/admin` page uses it to recognise the
admin), so after changing it, redeploy the `web` service.

### 4. Deploy

Both services build on push. Open the web service's domain, create the first
account, and you are live.

## After launch

**Turn on the admin panel.** On the `api` service open **Variables → New
Variable** and add:

- `ADCAM_ADMIN_EMAILS`: the email you will sign in with (several emails can be
  separated by commas).
- `ADCAM_ADMIN_PASSWORD`: a password of at least 10 characters for the first of
  those emails. The account is created for you on the next deploy, so you do not
  need to sign up. Changing this variable later resets the password, which is
  also how you get back in if you forget it.

Let it redeploy, then sign in on the web domain's `/login` page with that email
and password: admins land straight in the admin panel instead of the
workspace. If you are already signed in, the login page says as whom and offers
a **Continue** button, which takes the admin to the panel too; to switch
accounts, just sign in with the other email and password. You can also type
`/admin` after the address (bookmark it).
If the site keeps sending you to the workspace, check that both variables are
on the `api` service (not `web`), that the api service redeployed after you
added them, and that you signed in with the first admin email. Nothing in the app
links to it: customers who try `/admin` see the normal "page not found" screen,
and the admin API answers them with a plain 404. It has four tabs:

- **Overview**: revenue, users, activity feed, who needs attention, system health.
- **Users**: search and filter, add a user by hand, export to CSV, and per user:
  change plan, limit or end date, renew (+1 month, +3 months, +1 year), reset
  usage, private notes, new password, sign out everywhere, suspend, make admin,
  delete.
- **Analytics**: monthly and yearly revenue, paying users, active users, sign-ups
  and files per day, revenue by plan, top users, and who hit or is near their
  limit or whose plan is ending.
- **Settings**: open or close sign-ups, the plan new users start on, currency,
  an announcement banner for every workspace, and each plan's name, price and
  monthly limit.

New sign-ups start on the plan named by `ADCAM_DEFAULT_PLAN` (`free`, 10 files a
month, unless you change it). Accounts created before the admin panel existed
stay unlimited until you move them onto a plan.

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

**`/api/v1/health` on the web domain returns a bare "Internal Server Error".**
The web service cannot reach the API. Check `API_ORIGIN` is set on `web`, then
redeploy `web` so the new value is built in.

**`web` returns 502.** `API_ORIGIN` does not resolve. Confirm the API service's
name matches the hostname, that `PORT=8000` is set on it, and that it is
listening (its log prints `starting api on [::]:8000`).

**Renders stay queued.** `ADCAM_REDIS_URL` is wrong, or the worker did not
start. The API log should show `celery@… ready` shortly after boot, and
`/api/v1/health` reports `worker_mode: celery` plus the queue depth.

**Everyone signed out after a deploy.** `ADCAM_SECRET_KEY` changed. Pin it.

**Uploads fail at a certain size.** See the section above.
