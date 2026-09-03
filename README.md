# AdCamouflage

Ad camouflage, media mutation and asset fingerprint stripping as a full-stack
service. Upload creatives; get back derivatives that look the same to a person
and read as completely different files to an automated matcher.

<sub>Next.js · Tailwind · FastAPI · Celery · Redis · FFmpeg · OpenCV</sub>

---

## What it actually does

Every asset is rebuilt from scratch through three independent layers. None of
them is a metadata edit — the output is a genuinely new encode.

| Layer | Video | Image |
| --- | --- | --- |
| **Geometry** | Micro-crop 2–4px per side (more at high intensity), then a Lanczos resample to new even dimensions. Every pixel is recomputed, so pixel- and block-hash matching fails. | Same crop + resample. |
| **Signal** | Temporal noise (`noise=alls=…:allf=t+u`, a fresh grain pattern per frame), sub-perceptual brightness / contrast / gamma / saturation drift, hue rotation, unsharp micro-pass. | Dual-band noise (smooth field + fine grain), contrast/gamma/hue/saturation drift, unsharp. |
| **Timing** | Frame rate staggered onto a different broadcast rate (23.976 / 25 / 29.97 / …), plus a few frames trimmed off each end. | — |
| **Audio** | `asetrate` + `atempo` pitch shift that leaves duration intact, an independent tempo nudge, a high-pass and a gain trim — enough to desync speech-to-text and audio-fingerprint matching. | — |
| **Provenance** | `-map_metadata -1`, chapters dropped, bitexact muxing, **plus** the encoder signatures that flag misses (see below). | EXIF, XMP, ICC and PNG text chunks are gone by construction — the file is re-encoded from a bare pixel array. |
| **Deep scramble** *(optional)* | An OpenCV pass that rewrites every frame with a slowly drifting noise field, sub-pixel affine jitter and a per-frame gamma wobble before re-encode. This is what breaks perceptual-hash *sequences* rather than single frames. | — |

### The encoder signatures most tools leave behind

`-map_metadata -1` only clears tag dictionaries. Three fingerprints survive it,
and `backend/app/scrub.py` removes all three:

1. **The x264/x265 SEI user-data NAL.** x264 writes its version *and its entire
   option string* (`x264 - core 164 … cabac=1 ref=3 deblock=…`) into the
   bitstream. That is a near-unique encoder fingerprint. Removed with the
   `filter_units` bitstream filter.
2. **The MP4/MOV `compressorname`** field inside the `avc1` sample-description
   box, which ffmpeg fills with `Lavc libx264`.
3. **Matroska/WebM `MuxingApp` / `WritingApp` / per-track `ENCODER`** elements.

The MP4 and Matroska passes overwrite fixed-size fields in place, so no box
offset or index in the file moves and the output stays byte-valid.

The test suite asserts this directly — `test_scrub.py` greps the finished bytes
for `x264`, `Lavc`, `Lavf`, the source camera model and the editor name, and
fails if any of them survive.

---

## Quick start

### Windows

**1 · Install the three prerequisites.** Open **Command Prompt** and paste:

```bat
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

Then **close that window and open a new one** — installers only add themselves
to `PATH` for new terminals. Check they took:

```bat
python --version
node --version
ffmpeg -version
```

If `ffmpeg` still is not recognised, see [Windows troubleshooting](#windows-troubleshooting).

**2 · Get the code.** With git:

```bat
git clone https://github.com/gfxhakim/adcamouflage.git
cd adcamouflage
```

No git? Download the ZIP from the repository's green **Code** button, extract
it, then `cd` into the extracted folder.

**3 · Start it.**

```bat
scripts\start.bat
```

(Or just double-click `start.bat` in the `scripts` folder.)

The first run takes a few minutes while it installs dependencies. When it
finishes it prints:

```
  AdCamouflage is up

    Web UI     http://localhost:3000
    API docs   http://localhost:8000/api/docs
```

Open **http://localhost:3000**. Press **Ctrl-C** in the window to stop.

> Windows uses the in-process worker rather than Celery, because Celery's
> prefork pool does not run on Windows. It executes the identical rendering
> code, just inside the API process — fine for local use.

### macOS and Linux

```bash
git clone https://github.com/gfxhakim/adcamouflage.git
cd adcamouflage
./scripts/start.sh
```

Prerequisites: Python 3.11+, Node 20+, FFmpeg. Redis is optional — with it you
get the full Celery queue, without it the launcher falls back to the in-process
worker and says so.

```bash
sudo apt-get install ffmpeg        # Debian / Ubuntu
brew install ffmpeg                # macOS
```

### Docker (any OS)

If you have Docker Desktop, this needs nothing else installed:

```bash
./scripts/start-docker.sh           # macOS / Linux
docker compose up --build           # Windows, after copying .env.example to .env
```

### Launcher options

Both launchers pass arguments through to `scripts/start.py`:

```bash
python scripts/start.py --api-port 8001 --web-port 3001   # ports already taken
python scripts/start.py --inline                          # skip Celery, render in-process
python scripts/start.py --no-web                          # API and worker only
```

---

## Windows troubleshooting

**`'ffmpeg' is not recognized as an internal or external command`**
The installer added it to `PATH`, but your current terminal was opened before
that happened. Close every Command Prompt window and open a new one. If it still
fails, restart the machine — `winget` occasionally defers the `PATH` update
until then.

**`'python' is not recognized`**
Windows ships a stub that opens the Microsoft Store. Either install from
python.org (tick *Add python.exe to PATH*), or use `py` instead of `python`.
`start.bat` already prefers `py` when it exists.

**`Port 8000 is already in use`**
Something else holds the port. Either close it, or run
`scripts\start.bat --api-port 8001 --web-port 3001`.

**The window flashes and closes when double-clicking `start.bat`**
It should pause on error, but if it does not, run it from Command Prompt
instead so you can read the message.

**PowerShell instead of cmd?**
Same command, prefixed: `.\scripts\start.bat`

---

## Running the pieces yourself

Two options. Docker is the fastest way to see it running; the local path is
better for development.

### Option A — Docker Compose

```bash
cp .env.example .env
# Required: the key that signs download links.
python3 -c "import secrets; print('ADCAM_SECRET_KEY=' + secrets.token_urlsafe(48))" >> .env

docker compose up --build -d
```

Open **http://localhost:3000**. The API is on **http://localhost:8000**, with
interactive docs at **http://localhost:8000/api/docs**.

```bash
docker compose logs -f          # follow everything
docker compose up -d --scale worker=4   # more render capacity
docker compose down -v          # stop and drop the media volume
```

### Option B — Run it locally

**Prerequisites:** Python 3.11+, Node 20+, Redis 7+, and FFmpeg 6+ on `PATH`.

```bash
# ffmpeg
sudo apt-get install ffmpeg        # Debian / Ubuntu
brew install ffmpeg                # macOS
winget install Gyan.FFmpeg         # Windows

ffmpeg -version                    # must print a version
```

**1 · Install dependencies**

```bash
make setup
# equivalent to:
#   python3 -m venv .venv
#   .venv/bin/pip install -r backend/requirements-dev.txt
#   cd frontend && npm install
```

**2 · Configure**

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Set `ADCAM_SECRET_KEY` in `.env` to a random string. Everything else has a
working default.

**3 · Start Redis**

```bash
redis-server            # or: docker run -p 6379:6379 redis:7-alpine
```

**4 · Start the services — one per terminal**

```bash
make backend     # FastAPI on :8000
make worker      # Celery render worker
make beat        # optional: retention sweeps every 15 min
make frontend    # Next.js on :3000
```

Open **http://localhost:3000**.

> **Running without Redis or Celery.** Set `ADCAM_INLINE_WORKER=true` and the API
> executes renders on a local thread pool instead. Convenient for a laptop or
> CI; not for production, where a slow render would tie up a request worker.

---

## Using it

1. **Load assets** — drag videos and images onto the drop zone, or click to
   browse. Up to 25 files per batch, 2GB each (both configurable).
2. **Configure camouflage** — pick a profile, or flip individual layers and the
   profile becomes `custom`:
   - **Stealth** — minimum visible change; breaks byte and pixel hashes only.
   - **Balanced** — the default; geometry, noise, colour and audio all shift.
   - **Aggressive** — adds the per-frame OpenCV scramble. Slower, much harder to match.
   - **Nuclear** — everything on, frame mirrored. Maximum divergence.

   Set **variants** to 2–5 to get that many mutually distinct copies of each
   upload. Set a **seed** to make a render reproducible — the same seed and
   settings always produce the same output.
3. **Run** — the batch is queued and each asset reports live progress parsed
   from ffmpeg itself, not estimated. Renders continue if you close the tab.
4. **Collect** — download each variant, or the whole batch as a zip that
   includes `camouflage-manifest.json` listing every mutation applied and the
   before/after hashes.

---

## Project layout

```
adcamouflage/
├── backend/
│   ├── app/
│   │   ├── main.py         FastAPI routes: upload, status, download, archive, cancel, delete
│   │   ├── mutator.py      The mutation engine — filter graphs, the OpenCV pass, metrics
│   │   ├── scrub.py        SEI / compressorname / EBML signature removal
│   │   ├── compare.py      Forensic original-vs-camouflaged report (also a CLI)
│   │   ├── ffmpeg.py       ffprobe wrapper + progress streamed from `-progress pipe:1`
│   │   ├── tasks.py        Celery tasks and the throttled progress reporter
│   │   ├── queue.py        Dispatch: Celery in production, thread pool inline
│   │   ├── storage.py      Redis-backed job store (with an in-process fallback) + file safety
│   │   ├── security.py     HMAC download tokens, optional API-key gate
│   │   ├── schemas.py      Pydantic models and the preset definitions
│   │   └── config.py       Settings, all overridable via ADCAM_* env vars
│   ├── tests/              60 tests against real encoded media
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── page.tsx        The dashboard: upload, options, live queue
│   │   ├── layout.tsx
│   │   └── globals.css     The synchronised neon border system + design tokens
│   ├── components/
│   │   ├── NeonCard.tsx    The rotating-border glass panel every surface is built from
│   │   ├── UploadZone.tsx  Drag-and-drop with client-side validation
│   │   ├── OptionsPanel.tsx
│   │   ├── JobQueue.tsx / JobCard.tsx
│   │   ├── ProgressBar.tsx / StatTile.tsx / Header.tsx
│   ├── lib/                API client, types, formatters
│   ├── tailwind.config.js
│   └── Dockerfile
├── scripts/
│   ├── start.py            The launcher: prerequisites, deps, Redis, API, worker, UI
│   ├── start.bat           Windows wrapper around start.py
│   ├── start.sh            macOS / Linux wrapper around start.py
│   └── start-docker.sh     One-command Compose launch
├── docker-compose.yml
├── Makefile
└── .env.example
```

---

## The synchronised neon borders

Every card, panel and tile is wrapped in the same rotating multi-colour border.
The interesting part is that they stay **in phase** — including cards that mount
minutes after page load, like a job card appearing in the queue.

Animating each element independently does not achieve that: two elements with
the same 6s animation started at different times are permanently out of phase.
So the rotation runs exactly once, on `:root`, over a registered custom
property:

```css
@property --neon-angle {
  syntax: "<angle>";
  inherits: true;      /* ← the whole trick */
  initial-value: 0deg;
}

@keyframes neon-rotate { to { --neon-angle: 360deg; } }

:root { animation: neon-rotate 6s linear infinite; }

.neon-frame {
  background: conic-gradient(
    from var(--neon-angle),
    var(--neon-1), var(--neon-2), var(--neon-3), var(--neon-4), var(--neon-1)
  );
  padding: var(--border-width);   /* the ring is the parent's padding */
}
```

Because the property is *inherited*, every descendant reads the same computed
angle on the same frame. A card that mounts mid-rotation inherits the angle
already in flight rather than restarting its own.

The ring itself is the element's padding: the gradient is the parent's
background and the content sits on an opaque `.neon-inner` glass surface
(`bg-slate-950/90 backdrop-blur-xl`, `border-white/10`) on top of it. The outer
bloom is the same gradient, blurred — so the glow can never drift out of phase
with the border it belongs to.

Engines without `@property` (checked with `@supports`) fall back to a static
linear-gradient rim, and `prefers-reduced-motion` stops the rotation entirely.

---

## Configuration

All backend settings are environment variables prefixed `ADCAM_`. See
[`.env.example`](.env.example) for the annotated list. The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `ADCAM_SECRET_KEY` | random per process | **Pin this in production.** Signs download tokens; unset means links break across API replicas. |
| `ADCAM_STORAGE_ROOT` | `/tmp/adcamouflage` | Must be a shared volume when API and workers run on separate hosts. |
| `ADCAM_REDIS_URL` | `redis://localhost:6379/0` | Broker, result backend and job store. |
| `ADCAM_INLINE_WORKER` | `false` | `true` runs renders in-process instead of on Celery. |
| `ADCAM_MAX_UPLOAD_MB` | `2048` | Enforced while streaming, so an oversized upload is aborted mid-flight. |
| `ADCAM_MAX_BATCH_FILES` | `25` | Per batch. |
| `ADCAM_RETENTION_HOURS` | `24` | Uploads, renders and job records are purged after this. |
| `ADCAM_VIDEO_MAX_DURATION` | `1800` | Longer sources are rejected up front. |
| `ADCAM_API_KEY` | unset | When set, every mutating endpoint requires `X-API-Key`. |
| `ADCAM_CORS_ORIGINS` | `localhost:3000` | Comma-separated. |

Frontend: `NEXT_PUBLIC_API_URL` (and optionally `NEXT_PUBLIC_API_KEY`). These
are inlined at build time — rebuild after changing them.

---

## API

Full OpenAPI docs at `/api/docs`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Engine status: ffmpeg, Redis, worker mode, queue depth. |
| `GET` | `/api/v1/presets` | Preset definitions, limits and supported formats. |
| `POST` | `/api/v1/batches` | Multipart upload. `files[]` plus a JSON `options` field. Returns `202`. |
| `GET` | `/api/v1/batches/{id}` | Batch status with per-asset progress, applied mutations and metrics. |
| `GET` | `/api/v1/batches/{id}/archive?token=` | Zip of every finished output plus the manifest. |
| `GET` | `/api/v1/assets/{id}` | One asset's record. |
| `GET` | `/api/v1/assets/{id}/download?token=` | The mutated file. |
| `POST` | `/api/v1/assets/{id}/cancel` | Revoke a queued or running render. |
| `DELETE` | `/api/v1/batches/{id}` | Cancel outstanding work and delete every file. |

```bash
curl -X POST http://localhost:8000/api/v1/batches \
  -F "files=@promo.mp4" \
  -F 'options={"preset":"aggressive","variants":2}'
```

Download links are HMAC-signed and scoped to a single resource id, so a token
for one asset cannot be replayed against another, and they expire after
`ADCAM_DOWNLOAD_TOKEN_TTL` seconds.

---

## Verifying a mutation

`app.compare` diffs an original against its camouflaged derivative and reports
what actually changed, so the claim can be checked rather than trusted:

```bash
cd backend
../.venv/bin/python -m app.compare original.mp4 camouflaged.mp4
../.venv/bin/python -m app.compare original.mp4 camouflaged.mp4 --json
```

It separates three questions that are easy to conflate:

| Layer | Measured with | What a change means |
| --- | --- | --- |
| **File identity** | SHA-256, size | Exact-hash blocklists and dedupe indexes miss. |
| **Provenance** | container tags, byte-level encoder/device signature scan | Nothing ties the file back to its source, camera or editor. |
| **Structure** | resolution, frame rate, duration, codecs | Frame-level and pixel-hash alignment is broken. |
| **Picture** | pHash / dHash / aHash distance, SSIM, PSNR | High SSIM with a low pHash distance means it still *looks* the same. |
| **Audio** | spectral centroid ratio, waveform correlation | Lost sample alignment desyncs ASR and audio fingerprinting. |

The verdict block then states, per class of matcher, whether it would still link
the two files.

**What the numbers show in practice.** Measured on a 1280x720 / 30fps clip with
camera and editor metadata, comparing each preset against the original:

| Preset | pHash distance | SSIM | Exact hash | Provenance | Audio fingerprint | Robust pHash |
| --- | --- | --- | --- | --- | --- | --- |
| Stealth | 3.3 / 63 | 0.926 | broken | broken | broken | **still matches** |
| Balanced | 3.8 / 63 | 0.911 | broken | broken | broken | **still matches** |
| Aggressive | 5.1 / 63 | 0.880 | broken | broken | broken | **still matches** |
| Nuclear | 30.2 / 63 | 0.463 | broken | broken | broken | does not match |

Read that honestly: every profile defeats byte hashing, metadata linkage and
audio fingerprinting. Only **Nuclear** moves a robust DCT perceptual hash past a
typical match threshold, and it does so because it mirrors the frame — which a
viewer will notice if the creative contains text or a logo.

That trade-off is inherent, not a defect. A mutation that keeps the ad looking
identical necessarily keeps it perceptually similar; perceptual hashes are
designed to survive exactly the crops, grades and re-encodes this tool applies.
Use the strong profiles when perceptual divergence matters more than pixel
fidelity, and check the result with this report rather than assuming.

---

## Tests

```bash
make test          # or: cd backend && ../.venv/bin/python -m pytest
```

60 tests. They generate real media with ffmpeg and run it through the whole
pipeline rather than mocking the engine — geometry and frame-rate changes are
verified with `ffprobe`, metadata removal is verified by grepping the output
bytes, variant distinctness is verified by hashing, and the HTTP tests drive a
full upload → poll → download → zip cycle through the inline worker.

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

---

## Production notes

- **Pin `ADCAM_SECRET_KEY`.** Every replica must agree or download links break.
- **Scale workers, not concurrency.** Renders are CPU-bound; `docker compose up
  -d --scale worker=4` beats raising `-c` on one worker.
- **Storage must be shared.** The API writes uploads and serves outputs; the
  workers write renders. Point `ADCAM_STORAGE_ROOT` at the same volume, or an
  NFS/EFS mount, for every service.
- **Put a reverse proxy in front** and raise its body-size limit to match
  `ADCAM_MAX_UPLOAD_MB` (nginx defaults to 1MB and will reject uploads first).
- **Keep beat running** — it is what enforces the retention window.
- The API is stateless; run as many replicas as you like behind a load balancer.

---

## Scope and intent

This tool is for teams that own their creatives and need many distinct
deliverables from one master — per-placement variants, A/B copies, and assets
whose files carry no camera, editing-suite or device provenance.

Use it on media you own or are licensed to distribute, and within the terms of
the platforms you publish to. Mutating an asset does not change what it says or
who it belongs to.
