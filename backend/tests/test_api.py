"""HTTP-level tests driving the whole pipeline through the inline worker."""

from __future__ import annotations

import io
import json
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import JobStatus
from app.security import sign_download

from .conftest import requires_ffmpeg


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
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
    assert "hero_shot" in download.headers["content-disposition"]
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
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        names = bundle.namelist()
        assert "camouflage-manifest.json" in names
        assert len(names) == 5
        manifest = json.loads(bundle.read("camouflage-manifest.json"))
        assert len(manifest["assets"]) == 4
        assert all(entry["applied"] for entry in manifest["assets"])


def test_download_requires_a_valid_token(client, sample_image):
    response = _upload(client, [("files", ("x.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset_id = status["assets"][0]["id"]

    assert client.get(f"/api/v1/assets/{asset_id}/download?token=bogus").status_code == 403
    # A token signed for a different resource must not unlock this one.
    other = sign_download("asset_someone_else")
    assert client.get(f"/api/v1/assets/{asset_id}/download?token={other}").status_code == 403


def test_expired_token_is_refused(client, sample_image):
    response = _upload(client, [("files", ("y.jpg", sample_image.read_bytes(), "image/jpeg"))])
    batch_id = response.json()["batch_id"]
    status = _wait_for_batch(client, batch_id)
    asset_id = status["assets"][0]["id"]
    expired = sign_download(asset_id, ttl=-10)
    assert client.get(f"/api/v1/assets/{asset_id}/download?token={expired}").status_code == 403


def test_unknown_ids_return_404(client):
    assert client.get("/api/v1/batches/batch_missing").status_code == 404
    assert client.get("/api/v1/assets/asset_missing").status_code == 404


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
