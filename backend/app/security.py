"""Download-token signing and optional API-key enforcement."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import Header, HTTPException, status

from .config import settings


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def sign_download(resource_id: str, ttl: int | None = None) -> str:
    """Return an opaque, expiring token that authorises one resource."""

    expires = int(time.time()) + int(ttl or settings.download_token_ttl)
    payload = f"{resource_id}:{expires}".encode("utf-8")
    signature = hmac.new(settings.secret_key.encode("utf-8"), payload, hashlib.sha256).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature[:24])}"


def verify_download(token: str, resource_id: str) -> bool:
    if not token or "." not in token:
        return False
    encoded_payload, _, encoded_signature = token.partition(".")
    try:
        payload = _b64decode(encoded_payload)
        signature = _b64decode(encoded_signature)
    except (ValueError, TypeError):
        return False

    expected = hmac.new(settings.secret_key.encode("utf-8"), payload, hashlib.sha256).digest()[:24]
    if not hmac.compare_digest(expected, signature):
        return False

    try:
        signed_resource, _, expires_raw = payload.decode("utf-8").rpartition(":")
        expires = int(expires_raw)
    except (UnicodeDecodeError, ValueError):
        return False

    if signed_resource != resource_id:
        return False
    return expires >= int(time.time())


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """No-op when ``ADCAM_API_KEY`` is unset; enforced when it is."""

    if not settings.api_key:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid X-API-Key header is required.",
        )
