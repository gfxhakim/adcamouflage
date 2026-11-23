"""HTTP-level tests driving the whole pipeline through the inline worker."""

from __future__ import annotations

import io
import json
import time
import zipfile
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, settings
from app.main import _output_filename, _with_fresh_links, app
from app.schemas import AssetJob, JobStatus
from app.security import sign_download
from app.storage import get_store

from .conftest import grant_max_period, requires_ffmpeg


@pytest.fixture(scope="module")
def client():
    """A signed-in client. Every batch endpoint now requires a session."""

    with TestClient(app) as test_client:
        credentials = {"email": "api-tests@example.com", "password": "correct-horse-battery"}
        response = test_client.post("/api/v1/auth/register", json=credentials)
        if response.status_code == 409:
            response = test_client.post("/api/v1/auth/login", json=credentials)
        assert response.status_code in (200, 201), response.text
        grant_max_period(credentials["email"])
        yield test_client


def _wait_for_batch(client: TestClient, batch_id: str, timeout: float = 180.0) -> dict:
    deadline = time.time() + timeout
    payload: dict = {}
    while time.time() < deadline:
        response = client.get(f"/api/v1/batches/{batch_id}")
        assert response.status_code == 200, response.text
        payload = response.json()
        if payload["completed"] + payload["failed"] >= payload["total"]:
            return payload
        time.sleep(0.25)
    pytest.fail(f"batch {batch_id} did not settle in {timeout}s: {payload}")


def _saved_name(response) -> str:
    """The file name a browser would save this download under."""

    header = response.headers["content-disposition"]
    if "filename*=utf-8''" in header:
        return unquote(header.split("filename*=utf-8''", 1)[1])
    return header.split('filename="', 1)[1].rstrip('"')


def _upload(client: TestClient, files, options: dict | None = None):
    data = {"options": json.dumps(options)} if options else {}
    return client.post("/api/v1/batches", files=files, data=data)


def test_health_reports_engine_state(client):
    body = client.get("/api/v1/health").json()
    assert body["status"] in {"ok", "degraded"}
    assert body["worker_mode"] == "inline"
    assert isinstance(body["ffmpeg"], bool)


def test_presets_endpoint_lists_every_profile(client):
    body = client.get("/api/v1/presets").json()
    ids = {preset["id"] for preset in body["presets"]}
    assert {"stealth", "balanced", "aggressive", "nuclear", "custom"} <= ids
    assert body["limits"]["max_batch_files"] > 0
    assert "mp4" in body["formats"]["video"]


def test_rejects_unsupported_file_type(client):
    response = _upload(client, [("files", ("notes.txt", b"hello world", "text/plain"))])
    assert response.status_code == 422
    assert "rejected" in response.json()["detail"]


def test_rejects_empty_upload_list(client):
    assert client.post("/api/v1/batches", data={}).status_code == 422


def test_rejects_malformed_options(client, sample_image):
    response = _upload(
        client,
        [("files", ("a.jpg", sample_image.read_bytes(), "image/jpeg"))],
        {"intensity": 500},
    )
    assert response.status_code == 422


def test_image_batch_completes_and_downloads(client, sample_image):
    response = _upload(
        client,
        [("files", ("hero shot.jpg", sample_image.read_bytes(), "image/jpeg"))],
        {"preset": "balanced", "seed": 42},
    )
    assert response.status_code == 202, response.text
    batch_id = response.json()["batch_id"]

    status = _wait_for_batch(client, batch_id)
    assert status["completed"] == 1, status
    assert status["status"] == JobStatus.COMPLETED.value
    assert status["progress"] == 100.0

    asset = status["assets"][0]
    assert asset["applied"]
    assert asset["metrics"]["residual_exif_tags"] == 0
    assert asset["download_url"]

    download = client.get(asset["download_url"])
    assert download.status_code == 200
    assert len(download.content) > 0
    # The saved file is the uploaded name, as it was written, with "flow" added.
    assert asset["original_filename"] == "hero shot.jpg"
    assert _saved_name(download) == "hero shotflow.jpg"
    assert b"EOS R5" not in download.content


@requires_ffmpeg
def test_mixed_batch_variants_and_archive(client, sample_video, sample_image):
    response = _upload(
        client,
        [
            ("files", ("promo.mp4", sample_video.read_bytes(), "video/mp4")),
            ("files", ("banner.jpg", sample_image.read_bytes(), "image/jpeg")),
        ],
        {"preset": "aggressive", "variants": 2, "seed": 7},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert len(body["accepted"]) == 4  # two assets x two variants
    batch_id = body["batch_id"]

    status = _wait_for_batch(client, batch_id, timeout=300)
    assert status["failed"] == 0, status
    assert status["completed"] == 4
    assert status["archive_url"]

    # Variants of the same source must not be byte-identical.
    video_hashes = {
        asset["metrics"]["output_sha256"]
        for asset in status["assets"]
        if asset["original_filename"] == "promo.mp4"
    }
    assert len(video_hashes) == 2

    archive = client.get(status["archive_url"])
    assert archive.status_code == 200
    # The zip holds the media files only, each named "<uploaded name>flow".
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        assert sorted(bundle.namelist()) == [
            "bannerflow_v1.jpg",
            "bannerflow_v2.jpg",
            "promoflow_v1.mp4",
            "promoflow_v2.mp4",
        ]

    # Each copy downloads under its own name, and so does its thumbnail.
    first_video = next(
        asset
        for asset in status["assets"]
        if asset["original_filename"] == "promo.mp4" and asset["variant_index"] == 0
    )
    single = client.get(first_video["download_url"])
    assert _saved_name(single) == "promoflow_v1.mp4"


@requires_ffmpeg
def test_thumbnail_download_is_named_after_the_file(client, sample_video):
    response = _upload(
        client,
        [("files", ("promo.mp4", sample_video.read_bytes(), "video/mp4"))],
        {"preset": "stealth", "seed": 3, "poster": {"enabled": True, "timestamp": 1.0}},
    )
    assert response.status_code == 202, response.text
    status = _wait_for_batch(client, response.json()["batch_id"], timeout=300)
    assert status["completed"] == 1, status
    asset = status["assets"][0]

    video = client.get(asset["download_url"])
    assert _saved_name(video) == "promoflow.mp4"

    poster = client.get(asset["poster_url"])
    assert poster.status_code == 200
    assert _saved_name(poster) == "promoflow_poster.jpg"


def test_download_requires_a_valid_token(client, sample_image):
    response = _upload(client, [("files", ("x.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset_id = status["assets"][0]["id"]

    assert client.get(f"/api/v1/assets/{asset_id}/download?token=bogus").status_code == 403
    # A token signed for a different resource must not unlock this one.
    other = sign_download("asset_someone_else")
    assert client.get(f"/api/v1/assets/{asset_id}/download?token={other}").status_code == 403
    # And a valid token is not a substitute for being signed in.
    valid = sign_download(asset_id)
    assert TestClient(app).get(f"/api/v1/assets/{asset_id}/download?token={valid}").status_code == 401


def test_expired_token_is_refused(client, sample_image):
    response = _upload(client, [("files", ("y.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset_id = status["assets"][0]["id"]
    expired = sign_download(asset_id, ttl=-10)
    assert client.get(f"/api/v1/assets/{asset_id}/download?token={expired}").status_code == 403


def test_links_are_signed_when_read_so_they_do_not_go_stale(client, sample_image):
    """A link stored at render time dies after an hour; the file lives a day.

    Reading the batch (or the asset) must hand out a link that works, whatever
    was stored, or the browser saves the error reply as ``download.json``.
    """

    response = _upload(client, [("files", ("late.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset_id = status["assets"][0]["id"]

    # What the worker stored has expired, as it would an hour after the render.
    stale = f"/api/v1/assets/{asset_id}/download?token={sign_download(asset_id, ttl=-10)}"
    get_store().update_asset(asset_id, download_url=stale)
    assert client.get(stale).status_code == 403

    from_batch = client.get(f"/api/v1/batches/{batch_id}").json()["assets"][0]["download_url"]
    assert from_batch != stale
    assert client.get(from_batch).status_code == 200

    from_asset = client.get(f"/api/v1/assets/{asset_id}").json()["download_url"]
    assert from_asset != stale
    assert client.get(from_asset).status_code == 200


def test_purged_files_get_no_download_link(client, sample_image):
    response = _upload(client, [("files", ("gone.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset = status["assets"][0]
    assert asset["download_url"] and status["archive_url"]
    archive_url = status["archive_url"]

    # The retention sweep removes the file while the job record is still there.
    (settings.outputs_dir / asset["output_filename"]).unlink()

    after = client.get(f"/api/v1/batches/{batch_id}").json()
    assert after["completed"] == 1
    assert after["assets"][0]["download_url"] is None
    assert after["archive_url"] is None
    assert client.get(f"/api/v1/assets/{asset['id']}").json()["download_url"] is None
    # An old zip link says the files are gone instead of sending an empty zip.
    assert client.get(archive_url).status_code == 410


def test_unfinished_assets_have_no_links():
    queued = AssetJob(batch_id="batch_x", original_filename="a.mp4", stored_filename="a.mp4", kind="video", size_bytes=1)
    assert _with_fresh_links(queued).download_url is None
    assert _with_fresh_links(queued) is queued

    # A link left behind by an earlier run (cancel racing the finish, a task
    # that ran twice) must not be handed out for a file that did not complete.
    for status in (JobStatus.CANCELLED, JobStatus.FAILED, JobStatus.PROCESSING):
        leftover = queued.model_copy(
            update={
                "status": status,
                "output_filename": "asset_1.mp4",
                "download_url": "/api/v1/assets/asset_1/download?token=old",
                "poster_url": "/api/v1/assets/asset_1/poster?token=old",
            }
        )
        cleaned = _with_fresh_links(leftover)
        assert cleaned.download_url is None and cleaned.poster_url is None


def test_uploaded_names_keep_their_letters_and_spaces(client, sample_image):
    """ "Old name + flow" has to hold for names with spaces, accents and other alphabets."""

    names = ["été (final).jpg", "إعلان جديد.jpg", "реклама.jpg"]
    response = _upload(client, [("files", (name, sample_image.read_bytes(), "image/jpeg")) for name in names])
    assert response.status_code == 202, response.text
    status = _wait_for_batch(client, response.json()["batch_id"])
    assert status["completed"] == 3, status

    saved = {asset["original_filename"]: _saved_name(client.get(asset["download_url"])) for asset in status["assets"]}
    assert saved == {
        "été (final).jpg": "été (final)flow.jpg",
        "إعلان جديد.jpg": "إعلان جديدflow.jpg",
        "реклама.jpg": "рекламаflow.jpg",
    }

    archive = client.get(status["archive_url"])
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        assert sorted(bundle.namelist()) == sorted(saved.values())


@pytest.mark.parametrize(
    ("original", "rendered", "index", "total", "expected"),
    [
        ("clip.mp4", "asset_1.mp4", 0, 1, "clipflow.mp4"),
        ("clip.mp4", "asset_1.mp4", 1, 3, "clipflow_v2.mp4"),
        ("my.summer.ad.MOV", "asset_1.mov", 0, 1, "my.summer.adflow.mov"),
        ("photo.jpeg", "asset_1.jpeg", 0, 1, "photoflow.jpeg"),
        # No extension on the upload: the rendered file's extension is used.
        ("clip", "asset_1.mp4", 0, 1, "clipflow.mp4"),
    ],
)
def test_download_name_is_the_uploaded_name_plus_flow(original, rendered, index, total, expected):
    asset = AssetJob(
        batch_id="batch_x",
        original_filename=original,
        stored_filename=original,
        kind="video",
        size_bytes=1,
        output_filename=rendered,
        variant_index=index,
        variants_total=total,
    )
    assert _output_filename(asset) == expected


def test_unknown_ids_return_404(client):
    assert client.get("/api/v1/batches/batch_missing").status_code == 404
    assert client.get("/api/v1/assets/asset_missing").status_code == 404


def test_anonymous_callers_are_turned_away():
    assert TestClient(app).get("/api/v1/batches/batch_missing").status_code == 401


def test_delete_batch_removes_files(client, sample_image):
    response = _upload(client, [("files", ("z.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    _wait_for_batch(client, batch_id)

    deleted = client.delete(f"/api/v1/batches/{batch_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted_files"] >= 1
    assert client.get(f"/api/v1/batches/{batch_id}").status_code == 404


def test_cancel_rejects_finished_assets(client, sample_image):
    response = _upload(client, [("files", ("w.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset_id = status["assets"][0]["id"]
    assert client.post(f"/api/v1/assets/{asset_id}/cancel").status_code == 409


def test_default_retention_and_min_batch_limits(client, monkeypatch):
    monkeypatch.delenv("ADCAM_MIN_BATCH_GENERATIONS", raising=False)
    monkeypatch.delenv("ADCAM_RETENTION_HOURS", raising=False)
    defaults = Settings(_env_file=None)
    assert defaults.retention_hours == 48
    assert defaults.min_batch_generations == 5

    presets = client.get("/api/v1/presets")
    assert presets.status_code == 200
    limits = presets.json()["limits"]
    assert "min_batch_generations" in limits
    assert "retention_hours" in limits


def test_min_batch_generations_blocks_small_batches_without_charge_and_allows_five(
    client, sample_image, monkeypatch
):
    monkeypatch.setattr(settings, "min_batch_generations", 5)
    before_me = client.get("/api/v1/auth/me").json()
    before_uploads = set(p.name for p in settings.uploads_dir.iterdir())
    img_bytes = sample_image.read_bytes()

    blocked = _upload(
        client,
        [("files", ("too-small.jpg", img_bytes, "image/jpeg"))],
        options={"variants": 4},
    )
    assert blocked.status_code == 422, blocked.text
    assert "5" in blocked.json()["detail"]

    after_blocked_me = client.get("/api/v1/auth/me").json()
    assert after_blocked_me["tokens_usable"] == before_me["tokens_usable"]
    assert set(p.name for p in settings.uploads_dir.iterdir()) == before_uploads

    ok_variants = _upload(
        client,
        [("files", ("five-vars.jpg", img_bytes, "image/jpeg"))],
        options={"variants": 5},
    )
    assert ok_variants.status_code == 202, ok_variants.text
    settled_variants = _wait_for_batch(client, ok_variants.json()["batch_id"])
    assert settled_variants["completed"] == 5

    ok_files = _upload(
        client,
        [("files", (f"f{i}.jpg", img_bytes, "image/jpeg")) for i in range(5)],
        options={"variants": 1},
    )
    assert ok_files.status_code == 202, ok_files.text
    settled_files = _wait_for_batch(client, ok_files.json()["batch_id"])
    assert settled_files["completed"] == 5


def test_save_asset_refreshes_batch_ttl_on_terminal_state(monkeypatch):
    store = get_store()
    touched: list[str] = []
    original = store.touch_batch_ttl

    def _spy(batch_id: str) -> None:
        touched.append(batch_id)
        original(batch_id)

    monkeypatch.setattr(store, "touch_batch_ttl", _spy)

    active = AssetJob(
        batch_id="batch_ttl_test",
        original_filename="clip.jpg",
        stored_filename="clip.jpg",
        kind="image",
        size_bytes=123,
        status=JobStatus.PROCESSING,
    )
    store.save_asset(active)
    assert touched == []

    active.status = JobStatus.COMPLETED
    store.save_asset(active)
    assert touched == ["batch_ttl_test"]

