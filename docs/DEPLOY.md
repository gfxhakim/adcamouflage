# Deploying AdCamouflage

The stack is Caddy (TLS) in front of Next.js and FastAPI, with Postgres for
accounts and Redis for the render queue. Everything runs from one Compose file.

## What you need

1. **A server.** Rendering is CPU-bound, so cores matter more than anything
   else. A 4-core / 8GB VPS handles a steady trickle of short clips; 8 cores if
   several people upload at once. Any provider with plain Docker works — Hetzner,
   DigitalOcean, Vultr, Linode, a Lightsail instance, or your own box.
2. **A domain** pointed at the server's IP with an `A` record. Caddy gets the
   TLS certificate automatically, so nothing else is needed for HTTPS.
3. **Docker and the Compose plugin** on the server.

> **Why not Vercel or Netlify?** They host the Next.js front end well, but the
> render workers need FFmpeg, long-running CPU time and a shared disk, which
> serverless platforms do not provide. You would end up running the backend
> elsewhere anyway. One box running Compose is simpler and cheaper here.

## Deploy

```bash
git clone https://github.com/gfxhakim/adcamouflage.git
cd adcamouflage
cp .env.example .env
```

Fill in the four required values in `.env`:

```bash
SITE_DOMAIN=camouflage.example.com
ADCAM_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
POSTGRES_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
ADCAM_ALLOW_REGISTRATION=true
```

Then bring it up:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f
```

Open `https://SITE_DOMAIN`, create the first account, and you are running.

## Day-to-day

```bash
# More render capacity (renders are CPU-bound; scale workers, not concurrency)
docker compose -f docker-compose.prod.yml up -d --scale worker=4

# Update to the latest code
git pull && docker compose -f docker-compose.prod.yml up -d --build

# Logs for one service
docker compose -f docker-compose.prod.yml logs -f worker

# Stop (volumes are kept)
docker compose -f docker-compose.prod.yml down
```

### Close sign-ups once your team is in

```bash
# in .env
ADCAM_ALLOW_REGISTRATION=false
docker compose -f docker-compose.prod.yml up -d api
```

Existing users keep signing in; `/auth/register` starts returning 403.

### Back up

Two things hold state worth keeping. Rendered outputs are disposable — they are
deleted on the retention timer anyway.

```bash
# Accounts and batch history
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U adcam adcamouflage | gzip > backup-$(date +%F).sql.gz

# Restore
gunzip -c backup-2026-01-01.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U adcam adcamouflage
```

Keep `ADCAM_SECRET_KEY` somewhere safe too. Changing it signs everyone out and
invalidates every outstanding download link.

## How the pieces fit

```
                    ┌──────────────┐
   https://…  ───►  │    Caddy     │  TLS, one origin
                    └──────┬───────┘
                   /api/*  │  everything else
                  ┌────────┴────────┐
                  ▼                 ▼
            ┌──────────┐      ┌──────────┐
            │ FastAPI  │      │ Next.js  │
            └────┬─────┘      └──────────┘
                 │ enqueue
                 ▼
            ┌──────────┐   ┌──────────┐   ┌──────────┐
            │  Redis   │◄──│  Worker  │──►│  /data   │  shared volume
            └──────────┘   └──────────┘   └──────────┘
                 ▲
            ┌────┴─────┐
            │ Postgres │  accounts, batch history
            └──────────┘
```

Caddy routes `/api/*` straight to FastAPI and everything else to Next.js. Both
therefore answer on **one origin**, which matters more than it looks:

- the session cookie is first-party, so it can stay `Secure` + `SameSite=lax`
  rather than the weaker `SameSite=none` a cross-domain setup forces;
- the Next middleware can read it and guard `/app`;
- there is no CORS configuration to get wrong;
- large uploads go straight to FastAPI instead of through the Node process.

## Configuration worth knowing

| Variable | Default | Why you would change it |
| --- | --- | --- |
| `SITE_DOMAIN` | — | **Required.** The domain Caddy gets a certificate for. |
| `ADCAM_SECRET_KEY` | — | **Required.** Signs sessions and download links. Must be identical across every API replica. |
| `POSTGRES_PASSWORD` | — | **Required.** |
| `ADCAM_ALLOW_REGISTRATION` | `true` | Set `false` to close sign-ups. |
| `ADCAM_MAX_UPLOAD_MB` | `2048` | Raise `MAX_UPLOAD_SIZE` in `.env` to match, or Caddy rejects first. |
| `ADCAM_RETENTION_HOURS` | `24` | How long uploads, outputs and download links survive. |
| `ADCAM_VIDEO_MAX_DURATION` | `1800` | Longer sources are rejected up front. |
| `ADCAM_SESSION_TTL_HOURS` | `336` | How long a sign-in lasts. |
| `ADCAM_MIN_PASSWORD_LENGTH` | `10` | Minimum on sign-up. |

## Scaling past one box

The API is stateless, so it scales horizontally as soon as two things are true:

1. **Shared storage.** The API writes uploads and serves outputs; workers write
   renders. Point `ADCAM_STORAGE_ROOT` at the same NFS/EFS mount on every
   service, or move to object storage.
2. **One `ADCAM_SECRET_KEY`** everywhere, or download links signed by one
   replica will be refused by another.

Workers scale independently and need no inbound access at all — only Redis,
Postgres and the shared volume.

## Troubleshooting

**Caddy cannot get a certificate.** Check that the `A` record resolves to the
server and that ports 80 and 443 are open. `docker compose -f
docker-compose.prod.yml logs caddy` states the reason.

**Uploads fail near a size limit.** Raise `MAX_UPLOAD_SIZE` (Caddy) *and*
`ADCAM_MAX_UPLOAD_MB` (API). The smaller of the two wins.

**Renders stay queued.** The worker is not running or cannot reach Redis:
`docker compose -f docker-compose.prod.yml logs worker`. `/api/v1/health`
reports `ffmpeg`, `redis` and the queue depth.

**Everyone was signed out.** `ADCAM_SECRET_KEY` changed — most often because it
was left unset and a restart generated a fresh one. Pin it in `.env`.
