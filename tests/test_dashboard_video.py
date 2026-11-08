"""Tests for serving demo video and poster in the dashboard."""

from fastapi.testclient import TestClient

from context_layer.dashboard.app import create_app


def test_demo_video_served_with_ranges():
    app = create_app()
    client = TestClient(app)

    # Standard GET
    res = client.get("/elidex-demo.mp4")
    assert res.status_code in (200, 206)
    assert "video/mp4" in res.headers.get("content-type", "")
    assert int(res.headers.get("content-length", 0)) > 1_000_000

    # Range request (first 1024 bytes)
    res_range = client.get("/elidex-demo.mp4", headers={"Range": "bytes=0-1023"})
    assert res_range.status_code == 206
    assert len(res_range.content) == 1024
    assert res_range.headers.get("content-range", "").startswith("bytes 0-1023/")


def test_demo_poster_served():
    app = create_app()
    client = TestClient(app)

    res = client.get("/demo-poster.jpg")
    assert res.status_code == 200
    assert "image/jpeg" in res.headers.get("content-type", "")
    assert len(res.content) > 10_000


def test_demo_subtitles_served():
    app = create_app()
    client = TestClient(app)

    res = client.get("/subtitles-en.vtt")
    assert res.status_code == 200
    assert "text/vtt" in res.headers.get("content-type", "")
    assert b"WEBVTT" in res.content
