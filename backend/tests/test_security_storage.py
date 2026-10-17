"""Unit tests for token signing and the storage helpers."""

from __future__ import annotations

import pytest

from app.security import sign_download, verify_download
from app.storage import StorageError, classify, resolve_within, sanitize_filename
from app.config import settings
from app.schemas import AssetKind


def test_token_round_trip():
    token = sign_download("asset_abc")
    assert verify_download(token, "asset_abc")
    assert not verify_download(token, "asset_xyz")


@pytest.mark.parametrize("token", ["", "garbage", "a.b", "....", "x." + "y" * 40])
def test_malformed_tokens_are_rejected(token):
    assert not verify_download(token, "asset_abc")


def test_tampered_signature_is_rejected():
    token = sign_download("asset_abc")
    payload, _, signature = token.partition(".")
    flipped = "A" if signature[0] != "A" else "B"
    assert not verify_download(f"{payload}.{flipped}{signature[1:]}", "asset_abc")


def test_expired_token_is_rejected():
    assert not verify_download(sign_download("asset_abc", ttl=-1), "asset_abc")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("my video.mp4", "my_video.mp4"),
        ("C:\\Users\\me\\clip.MOV", "clip.MOV"),
        ("", "asset"),
        ("...", "asset"),
        ("emoji-🎬-cut.mp4", "emoji-_-cut.mp4"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_sanitize_truncates_long_names():
    name = sanitize_filename("a" * 400 + ".mp4")
    assert len(name) <= 120
    assert name.endswith(".mp4")


@pytest.mark.parametrize(
    ("name", "content_type", "expected"),
    [
        ("clip.mp4", None, AssetKind.VIDEO),
        ("clip.MOV", None, AssetKind.VIDEO),
        ("photo.png", None, AssetKind.IMAGE),
        ("unknown.bin", "video/mp4", AssetKind.VIDEO),
        ("unknown.bin", "image/png", AssetKind.IMAGE),
        ("notes.txt", "text/plain", None),
    ],
)
def test_classify(name, content_type, expected):
    assert classify(name, content_type) is expected


def test_resolve_within_blocks_traversal():
    with pytest.raises(StorageError):
        resolve_within(settings.uploads_dir, "../../etc/passwd")
    assert resolve_within(settings.uploads_dir, "ok.mp4").name == "ok.mp4"
