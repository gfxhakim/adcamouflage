#!/usr/bin/env python3
"""Launch AdCamouflage on Windows, macOS or Linux with one command.

    python scripts/start.py

Checks prerequisites, generates the signing key, installs dependencies on the
first run, starts the API, a render worker and the web UI, then prints the URLs.
Ctrl-C stops everything.

The launcher is Python rather than a shell script so Windows, macOS and Linux
all run the same, tested code path.
"""

from __future__ import annotations

import argparse
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = os.name == "nt"

# --------------------------------------------------------------------------
# console
# --------------------------------------------------------------------------


def _supports_colour() -> bool:
    if not sys.stdout.isatty():
        return False
    if IS_WINDOWS:
        # Windows 10+ consoles need virtual-terminal processing turned on.
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            return bool(kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7))
        except Exception:
            return False
    return True


COLOUR = _supports_colour()


def _paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOUR else text


def say(message: str) -> None:
    print(f"{_paint('36;1', '==>')} {message}", flush=True)


def warn(message: str) -> None:
    print(f"{_paint('33', 'warning:')} {message}", flush=True)


def fail(message: str) -> None:
    print(f"\n{_paint('31;1', 'error:')} {message}\n", file=sys.stderr, flush=True)
    sys.exit(1)


# --------------------------------------------------------------------------
# paths and process helpers
# --------------------------------------------------------------------------


def venv_dir() -> Path:
    return ROOT / ".venv"


def venv_bin(name: str) -> Path:
    """Path to an executable inside the virtualenv, per-platform."""

    if IS_WINDOWS:
        return venv_dir() / "Scripts" / f"{name}.exe"
    return venv_dir() / "bin" / name


def node_command(executable: str, *args: str) -> list[str]:
    """Build a runnable argv for npm/npx.

    On Windows these resolve to ``.cmd`` shims, which must go through cmd.exe;
    passing them to CreateProcess directly is unreliable.
    """

    resolved = shutil.which(executable)
    if resolved is None:
        fail(f"{executable} was not found on PATH. Install Node.js 20 or newer.")
    if IS_WINDOWS and Path(resolved).suffix.lower() in {".cmd", ".bat"}:
        comspec = os.environ.get("COMSPEC", "cmd.exe")
        return [comspec, "/c", resolved, *args]
    return [resolved, *args]


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.6)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def http_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 400
    except (urllib.error.URLError, OSError, ValueError):
        return False


# --------------------------------------------------------------------------
# prerequisites
# --------------------------------------------------------------------------


def check_prerequisites() -> None:
    if sys.version_info < (3, 11):
        fail(
            f"Python 3.11 or newer is required; this is {sys.version.split()[0]}.\n"
            "     Windows: winget install Python.Python.3.12\n"
            "     macOS:   brew install python@3.12"
        )

    if shutil.which("node") is None or shutil.which("npm") is None:
        fail(
            "Node.js 20 or newer is required (node and npm must be on PATH).\n"
            "     Windows: winget install OpenJS.NodeJS.LTS\n"
            "     macOS:   brew install node\n"
            "     Linux:   sudo apt-get install nodejs npm"
        )

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        fail(
            "ffmpeg and ffprobe must be on PATH - they are the mutation engine.\n"
            "     Windows: winget install Gyan.FFmpeg  (then open a NEW terminal)\n"
            "     macOS:   brew install ffmpeg\n"
            "     Linux:   sudo apt-get install ffmpeg"
        )


# --------------------------------------------------------------------------
# environment
# --------------------------------------------------------------------------


def ensure_env_file() -> None:
    env_path = ROOT / ".env"
    example = ROOT / ".env.example"

    if not env_path.exists():
        if not example.exists():
            fail(".env.example is missing - is this a complete checkout?")
        say("Creating .env with a generated signing key")
        env_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")

    text = env_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    needs_key = any(
        line.strip() in {"ADCAM_SECRET_KEY=", "ADCAM_SECRET_KEY=change-me-in-production"}
        for line in lines
    )
    if needs_key:
        key = secrets.token_urlsafe(48)
        env_path.write_text(
            "\n".join(
                f"ADCAM_SECRET_KEY={key}" if line.startswith("ADCAM_SECRET_KEY=") else line
                for line in lines
            )
            + "\n",
            encoding="utf-8",
        )


def load_env() -> dict[str, str]:
    """Read .env into a dict, leaving values already in the environment alone."""

    env = dict(os.environ)
    env_path = ROOT / ".env"
    if not env_path.exists():
        return env

    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # A real environment variable wins over the file.
        if key and key not in os.environ:
            env[key] = value
    return env


def resolve_storage_root(env: dict[str, str]) -> Path:
    """Anchor a relative storage root to the repo, not to each service's cwd."""

    raw = env.get("ADCAM_STORAGE_ROOT") or str(ROOT / "storage")
    path = Path(os.path.expanduser(raw))
    if not path.is_absolute():
        path = ROOT / path
    path = path.resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


# --------------------------------------------------------------------------
# dependencies
# --------------------------------------------------------------------------


def ensure_virtualenv() -> None:
    if venv_bin("python").exists():
        return
    say("Creating the Python virtualenv")
    subprocess.run([sys.executable, "-m", "venv", str(venv_dir())], check=True)
    subprocess.run(
        [str(venv_bin("python")), "-m", "pip", "install", "--quiet", "--upgrade", "pip"],
        check=False,
    )


def backend_deps_present() -> bool:
    probe = subprocess.run(
        [str(venv_bin("python")), "-c", "import fastapi, celery, cv2, PIL, redis"],
        capture_output=True,
    )
    return probe.returncode == 0


def ensure_backend_deps() -> None:
    if backend_deps_present():
        return
    say("Installing backend dependencies (a few minutes on the first run)")
    result = subprocess.run(
        [
            str(venv_bin("python")),
            "-m",
            "pip",
            "install",
            "--quiet",
            "-r",
            str(ROOT / "backend" / "requirements.txt"),
        ]
    )
    if result.returncode != 0:
        fail("Installing the backend dependencies failed. Scroll up for pip's output.")


def ensure_frontend_deps() -> None:
    if (ROOT / "frontend" / "node_modules").is_dir():
        return
    say("Installing frontend dependencies")
    result = subprocess.run(
        node_command("npm", "install", "--no-audit", "--no-fund"),
        cwd=ROOT / "frontend",
    )
    if result.returncode != 0:
        fail("npm install failed. Scroll up for npm's output.")


# --------------------------------------------------------------------------
# redis
# --------------------------------------------------------------------------


def redis_reachable(env: dict[str, str]) -> bool:
    url = env.get("ADCAM_REDIS_URL", "redis://localhost:6379/0")
    probe = subprocess.run(
        [
            str(venv_bin("python")),
            "-c",
            "import sys, redis;"
            "redis.Redis.from_url(sys.argv[1], socket_connect_timeout=1.5).ping()",
            url,
        ],
        capture_output=True,
    )
    return probe.returncode == 0


def start_redis_if_available() -> subprocess.Popen | None:
    if shutil.which("redis-server") is None:
        return None
    say("Starting Redis")
    return subprocess.Popen(
        ["redis-server", "--port", "6379", "--save", "", "--appendonly", "no"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch AdCamouflage locally.")
    parser.add_argument("--api-port", type=int, default=int(os.environ.get("API_PORT", 8000)))
    parser.add_argument("--web-port", type=int, default=int(os.environ.get("WEB_PORT", 3000)))
    parser.add_argument(
        "--inline",
        action="store_true",
        help="Force the in-process worker instead of Celery, even if Redis is up.",
    )
    parser.add_argument(
        "--no-web",
        action="store_true",
        help="Start only the API and worker (useful when running the UI yourself).",
    )
    args = parser.parse_args()

    os.chdir(ROOT)
    check_prerequisites()

    for port, label in ((args.api_port, "API"), (args.web_port, "web UI")):
        if args.no_web and label == "web UI":
            continue
        if port_in_use(port):
            fail(
                f"Port {port} is already in use, so the {label} cannot start.\n"
                f"     Stop whatever is using it, or pass a different port:\n"
                f"       python scripts/start.py --api-port 8001 --web-port 3001"
            )

    ensure_env_file()
    ensure_virtualenv()
    ensure_backend_deps()
    if not args.no_web:
        ensure_frontend_deps()

    env = load_env()
    storage = resolve_storage_root(env)
    env["ADCAM_STORAGE_ROOT"] = str(storage)
    env["NEXT_PUBLIC_API_URL"] = env.get(
        "NEXT_PUBLIC_API_URL", f"http://localhost:{args.api_port}"
    )
    env["PYTHONUNBUFFERED"] = "1"

    processes: list[tuple[str, subprocess.Popen]] = []
    redis_process: subprocess.Popen | None = None

    # Celery's prefork pool does not work on Windows, so the in-process worker
    # is the supported path there. It runs the identical rendering code.
    use_celery = not args.inline and not IS_WINDOWS

    if use_celery:
        if not redis_reachable(env):
            redis_process = start_redis_if_available()
            if redis_process is not None:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and not redis_reachable(env):
                    time.sleep(0.4)
        use_celery = redis_reachable(env)

    if use_celery:
        env["ADCAM_INLINE_WORKER"] = "false"
        mode = "Celery worker + Redis"
    else:
        env["ADCAM_INLINE_WORKER"] = "true"
        if IS_WINDOWS and not args.inline:
            mode = "in-process worker (Celery's prefork pool is not supported on Windows)"
        else:
            mode = "in-process worker (no Redis found)"
            warn("Redis is not reachable; rendering in-process instead.")

    def shutdown(*_: object) -> None:
        print()
        say("Shutting down")
        for _label, process in processes:
            if process.poll() is None:
                process.terminate()
        for _label, process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
        if redis_process is not None and redis_process.poll() is None:
            redis_process.terminate()

    try:
        say(f"Starting the API on :{args.api_port}")
        processes.append(
            (
                "api",
                subprocess.Popen(
                    [
                        str(venv_bin("python")),
                        "-m",
                        "uvicorn",
                        "app.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(args.api_port),
                    ],
                    cwd=ROOT / "backend",
                    env=env,
                ),
            )
        )

        if use_celery:
            say("Starting the render worker")
            processes.append(
                (
                    "worker",
                    subprocess.Popen(
                        [
                            str(venv_bin("celery")),
                            "-A",
                            "app.celery_app.celery_app",
                            "worker",
                            "-Q",
                            "mutations",
                            "-c",
                            "2",
                            "--loglevel=warning",
                        ],
                        cwd=ROOT / "backend",
                        env=env,
                    ),
                )
            )

        if not args.no_web:
            say(f"Starting the web UI on :{args.web_port}")
            processes.append(
                (
                    "web",
                    subprocess.Popen(
                        node_command("npm", "run", "dev", "--", "-p", str(args.web_port)),
                        cwd=ROOT / "frontend",
                        env=env,
                    ),
                )
            )

        api_url = f"http://localhost:{args.api_port}"
        web_url = f"http://localhost:{args.web_port}"

        deadline = time.monotonic() + 180
        target = api_url + "/api/v1/health"
        while time.monotonic() < deadline:
            if any(process.poll() is not None for _label, process in processes):
                fail("A service exited during start-up. Its output is above.")
            if http_ok(target) and (args.no_web or http_ok(web_url, timeout=3)):
                break
            time.sleep(1)

        print(
            f"""
  {_paint('1', 'AdCamouflage is up')}

    Web UI     {_paint('36', web_url if not args.no_web else '(not started)')}
    API docs   {_paint('36', api_url + '/api/docs')}
    Engine     {mode}
    Storage    {storage}

  {_paint('2', 'Press Ctrl-C to stop everything.')}
""",
            flush=True,
        )

        while True:
            for label, process in processes:
                code = process.poll()
                if code is not None:
                    warn(f"the {label} process exited with code {code}; shutting down")
                    return 1
            time.sleep(1)

    except KeyboardInterrupt:
        return 0
    finally:
        shutdown()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
