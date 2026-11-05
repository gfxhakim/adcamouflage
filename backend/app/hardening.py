"""Request-level protections shared by every router.

* ``client_ip`` - the visitor's address as seen behind Railway's edge and the
  web service's proxy.
* ``RateLimiter`` / ``rate_limit`` - in-process sliding-window limits for the
  endpoints worth abusing (sign-up, sign-in, support chat, checkout, payment
  proofs). One API instance runs on Railway, so in-process is enough; behind
  several replicas put a shared limiter at the edge as well.
* ``SecurityMiddleware`` - security headers on every API response, the
  ``Secure`` flag on the session cookie whenever the request arrived over
  HTTPS, and a cap on JSON/form bodies so a huge payload cannot exhaust memory
  (file uploads stream to disk with their own caps).
* ``sniff_media`` - checks a stored upload's first bytes so a file renamed to
  ``.png`` is not accepted as an image.
"""

from __future__ import annotations

import ipaddress
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Callable

from fastapi import HTTPException, Request, status
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import settings

# --------------------------------------------------------------------------
# client address
# --------------------------------------------------------------------------


def _valid_ip(value: str) -> str | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    """The visitor's IP address.

    Railway's edge sets ``X-Real-IP`` to the address that connected to it and
    the web service passes request headers through to the API unchanged, so
    that header is the one a visitor cannot choose. ``X-Forwarded-For`` is
    not used here because its left-most entries come from the visitor.
    """

    real = _valid_ip(request.headers.get(settings.client_ip_header or "x-real-ip", ""))
    if real:
        return real
    return request.client.host if request.client else "unknown"


# --------------------------------------------------------------------------
# rate limits
# --------------------------------------------------------------------------

_LIMITERS: list["RateLimiter"] = []


class RateLimiter:
    """Sliding-window counter per key, bounded in memory."""

    def __init__(self, name: str, limit: int, window_seconds: int, max_keys: int = 50_000) -> None:
        self.name = name
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: "OrderedDict[str, list[float]]" = OrderedDict()
        self._lock = threading.Lock()
        _LIMITERS.append(self)

    def _recent(self, key: str, now: float) -> list[float]:
        stamps = [stamp for stamp in self._hits.get(key, ()) if now - stamp < self.window]
        if stamps:
            self._hits[key] = stamps
            self._hits.move_to_end(key)
        else:
            self._hits.pop(key, None)
        return stamps

    def blocked(self, key: str) -> bool:
        if not settings.rate_limits_enabled:
            return False
        with self._lock:
            return len(self._recent(key, time.monotonic())) >= self.limit

    def hit(self, key: str) -> None:
        if not settings.rate_limits_enabled:
            return
        now = time.monotonic()
        with self._lock:
            stamps = self._recent(key, now)
            stamps.append(now)
            self._hits[key] = stamps
            self._hits.move_to_end(key)
            while len(self._hits) > self.max_keys:
                self._hits.popitem(last=False)

    def check_and_hit(self, key: str, detail: str) -> None:
        if self.blocked(key):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail,
                headers={"Retry-After": str(self.window)},
            )
        self.hit(key)

    def clear(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


def reset_rate_limits() -> None:
    """Forget every counter (tests, and a manual reset from a shell)."""

    for limiter in _LIMITERS:
        limiter.clear()


TOO_MANY = "Too many requests. Wait a few minutes and try again."


def rate_limit(name: str, limit: int, window_seconds: int, detail: str = TOO_MANY) -> Callable[[Request], None]:
    """A route dependency that limits calls per client IP."""

    limiter = RateLimiter(name, limit, window_seconds)

    def _dependency(request: Request) -> None:
        limiter.check_and_hit(f"{name}:{client_ip(request)}", detail)

    _dependency.limiter = limiter  # type: ignore[attr-defined]
    return _dependency


# --------------------------------------------------------------------------
# headers, cookie flag and body cap
# --------------------------------------------------------------------------

SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
)

# Paths whose responses are pages rendered by the API itself (the Volet pay
# page posts a form to Volet), so a strict frame/script policy would break them.
_HTML_PATH_PREFIXES = ("/api/v1/billing/orders/",)

MULTIPART = b"multipart/form-data"


def _request_is_https(scope: Scope) -> bool:
    if scope.get("scheme") == "https":
        return True
    for name, value in scope.get("headers", ()):
        if name == b"x-forwarded-proto" and value.split(b",")[0].strip().lower() == b"https":
            return True
    return False


class SecurityMiddleware:
    """Pure ASGI so streamed downloads and uploads are not buffered."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", ()))
        content_type = headers.get(b"content-type", b"").lower()
        if not content_type.startswith(MULTIPART):
            raw_length = headers.get(b"content-length")
            if raw_length is not None:
                try:
                    too_big = int(raw_length) > settings.max_body_bytes
                except ValueError:
                    too_big = True
                if too_big:
                    await _plain(send, 413, b'{"detail":"Request body is too large."}')
                    return

        https = _request_is_https(scope)
        cookie_prefix = f"{settings.cookie_name}=".encode("latin-1")
        path = scope.get("path", "")

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                out = []
                present = set()
                for name, value in message.get("headers", ()):
                    lname = name.lower()
                    present.add(lname)
                    if https and lname == b"set-cookie" and value.startswith(cookie_prefix):
                        if b"secure" not in value.lower():
                            value = value + b"; Secure"
                    out.append((name, value))
                for name, value in SECURITY_HEADERS:
                    if name not in present:
                        if name == b"x-frame-options" and path.startswith(_HTML_PATH_PREFIXES):
                            continue
                        out.append((name, value))
                if https and b"strict-transport-security" not in present:
                    out.append((b"strict-transport-security", b"max-age=31536000"))
                if path.startswith(("/api/v1/auth", "/api/v1/billing", "/api/v1/admin")) and b"cache-control" not in present:
                    out.append((b"cache-control", b"no-store"))
                message["headers"] = out
            await send(message)

        await self.app(scope, receive, send_wrapper)


async def _plain(send: Send, code: int, body: bytes) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": code,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})


# --------------------------------------------------------------------------
# upload content checks
# --------------------------------------------------------------------------


def sniff_media(path: Path) -> str | None:
    """Return 'image' or 'video' from a file's signature, or None if neither.

    Covers the formats the app accepts: PNG, JPEG, GIF, WEBP, MP4/MOV/M4V
    (ISO base media), WEBM/MKV (Matroska).
    """

    try:
        with path.open("rb") as handle:
            head = handle.read(32)
    except OSError:
        return None
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image"
    if head.startswith(b"\xff\xd8\xff"):
        return "image"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image"
    if head[4:8] in (b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip"):
        return "video"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video"
    return None
