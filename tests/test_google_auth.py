"""Tests for Google Cloud Console / Vertex AI credentials and endpoint resolution."""

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from context_layer import config, google_auth, llm


@pytest.fixture(autouse=True)
def _reset_auth_cache():
    google_auth.reset_cached_credentials()
    yield
    google_auth.reset_cached_credentials()


def test_resolve_credentials_inline_json():
    raw_json = json.dumps({"type": "service_account", "project_id": "inline-proj-123"})
    path, info = google_auth.resolve_credentials_path_or_info(raw_json)
    assert path is None
    assert info == {"type": "service_account", "project_id": "inline-proj-123"}


def test_resolve_credentials_relative_file(tmp_path):
    cred_file = tmp_path / "svc_account.json"
    cred_file.write_text('{"project_id": "file-proj-456"}', encoding="utf-8")

    path, info = google_auth.resolve_credentials_path_or_info("svc_account.json", root_dir=tmp_path)
    assert info is None
    assert path == cred_file.resolve()


def test_format_vertex_model():
    assert google_auth.format_vertex_model("gemini-3.8-flash") == "google/gemini-3.8-flash"
    assert google_auth.format_vertex_model("google/gemini-3.8-flash") == "google/gemini-3.8-flash"
    assert google_auth.format_vertex_model("meta/llama-3.1-70b") == "meta/llama-3.1-70b"
    assert google_auth.format_vertex_model("") == ""


def test_is_vertex_endpoint():
    assert google_auth.is_vertex_endpoint(
        "https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi"
    )
    assert google_auth.is_vertex_endpoint(
        "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi"
    )
    assert not google_auth.is_vertex_endpoint("https://generativelanguage.googleapis.com/v1beta/openai/")
    assert not google_auth.is_vertex_endpoint("https://api.openai.com/v1")


def test_get_vertex_base_url_global_and_regional():
    url_global = google_auth.get_vertex_base_url(project_id="test-p", location="global")
    assert url_global == "https://aiplatform.googleapis.com/v1/projects/test-p/locations/global/endpoints/openapi"

    url_regional = google_auth.get_vertex_base_url(project_id="test-p", location="us-central1")
    assert (
        url_regional
        == "https://us-central1-aiplatform.googleapis.com/v1/projects/test-p/locations/us-central1/endpoints/openapi"
    )


def test_get_vertex_base_url_missing_project_raises(monkeypatch):
    monkeypatch.setattr(google_auth, "get_google_credentials", lambda *a, **k: (None, None))
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    monkeypatch.delenv("VERTEX_PROJECT", raising=False)

    with pytest.raises(RuntimeError, match="Could not determine Google Cloud project_id"):
        google_auth.get_vertex_base_url()


def test_llm_configured_with_google_credentials(monkeypatch):
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    monkeypatch.setattr(config, "GOOGLE_APPLICATION_CREDENTIALS", "credentials.json")
    monkeypatch.setattr(config, "LLM_MODEL", "gemini-3.8-flash")
    assert config.google_auth_configured()
    assert config.llm_configured()

    monkeypatch.setattr(config, "LLM_MODEL", "")
    assert not config.llm_configured()

    monkeypatch.setattr(config, "LLM_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(config, "GOOGLE_APPLICATION_CREDENTIALS", "")
    assert not config.llm_configured()


def test_is_google_vertex_primary(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_APPLICATION_CREDENTIALS", "credentials.json")
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    monkeypatch.setattr(config, "LLM_BASE_URL", "")
    assert config.is_google_vertex_primary()

    # Old generativelanguage URL should still route to Vertex when GOOGLE_APPLICATION_CREDENTIALS is set
    monkeypatch.setattr(config, "LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
    assert config.is_google_vertex_primary()

    # Explicit Vertex URL
    monkeypatch.setattr(
        config,
        "LLM_BASE_URL",
        "https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi",
    )
    assert config.is_google_vertex_primary()

    # Non-Google URL with explicit API key should NOT route to Vertex
    monkeypatch.setattr(config, "LLM_BASE_URL", "https://api.featherless.ai/v1")
    monkeypatch.setattr(config, "LLM_API_KEY", "real-featherless-key")
    assert not config.is_google_vertex_primary()


def test_providers_constructs_vertex_provider(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_APPLICATION_CREDENTIALS", "credentials.json")
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    monkeypatch.setattr(config, "LLM_BASE_URL", "")
    monkeypatch.setattr(config, "LLM_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(config, "VERTEX_LOCATION", "global")
    monkeypatch.setattr(
        google_auth,
        "get_vertex_base_url",
        lambda **k: "https://aiplatform.googleapis.com/v1/projects/my-gcp-proj/locations/global/endpoints/openapi",
    )

    chain = llm.providers()
    assert len(chain) == 1
    p = chain[0]
    assert p.name == "primary"
    assert p.is_vertex is True
    assert "aiplatform.googleapis.com" in p.base_url
    assert p.model == "gemini-3.8-flash"


def test_call_provider_vertex_authenticates_and_prefixes_model(monkeypatch):
    monkeypatch.setattr(google_auth, "get_google_access_token", lambda **k: "mock-oauth-bearer-token")

    captured_init = {}
    captured_call = {}

    class FakeOpenAI:
        def __init__(self, base_url=None, api_key=None, **kw):
            captured_init["base_url"] = base_url
            captured_init["api_key"] = api_key
            self.chat = MagicMock()

            def fake_create(**create_kw):
                captured_call.update(create_kw)
                choice = MagicMock()
                choice.message.content = "pong"
                resp = MagicMock()
                resp.choices = [choice]
                resp.usage = None
                return resp

            self.chat.completions.create = fake_create

    monkeypatch.setattr(llm, "OpenAI", FakeOpenAI)

    p = llm.Provider(
        name="primary",
        base_url="https://aiplatform.googleapis.com/v1/projects/my-p/locations/global/endpoints/openapi",
        api_key="",
        model="gemini-3.8-flash",
        json_mode="json_object",
        is_vertex=True,
    )

    text, trace, exc = llm.call_provider(p, "system prompt", "user prompt", json=False, emit=False)

    assert exc is None
    assert text == "pong"
    assert captured_init["api_key"] == "mock-oauth-bearer-token"
    assert "aiplatform.googleapis.com" in captured_init["base_url"]
    assert captured_call["model"] == "google/gemini-3.8-flash"
    assert trace["error"] is None


def test_embed_vertex_uses_token_and_prefixes_model(monkeypatch):
    from context_layer import embed

    monkeypatch.setattr(config, "EMBEDDING_MODEL", "text-embedding-005")
    monkeypatch.setattr(google_auth, "get_google_access_token", lambda **k: "mock-embed-token")

    p = llm.Provider(
        name="primary",
        base_url="https://aiplatform.googleapis.com/v1/projects/my-p/locations/global/endpoints/openapi",
        api_key="",
        model="gemini-3.8-flash",
        json_mode="json_object",
        is_vertex=True,
    )
    monkeypatch.setattr(llm, "providers", lambda: [p])

    captured = {}

    class FakeOpenAI:
        def __init__(self, base_url=None, api_key=None, **kw):
            captured["base_url"] = base_url
            captured["api_key"] = api_key
            self.embeddings = MagicMock()

            def fake_create(model=None, input=None):
                captured["model"] = model
                captured["input"] = input
                resp = MagicMock()
                item = MagicMock()
                item.index = 0
                item.embedding = [0.1, 0.2, 0.3]
                resp.data = [item]
                return resp

            self.embeddings.create = fake_create

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    vectors = embed.embed(["sample network telemetry text"])
    assert len(vectors) == 1
    assert pytest.approx(sum(x * x for x in vectors[0]), 1e-5) == 1.0
    assert captured["api_key"] == "mock-embed-token"
    assert captured["model"] == "google/text-embedding-005"

