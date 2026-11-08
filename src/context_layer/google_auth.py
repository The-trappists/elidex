"""Google Cloud authentication and Vertex AI endpoint resolver for Gemini.

Enables using Google Cloud Console credentials (e.g. Service Account JSON key or ADC)
with Google Cloud free trial credits on Vertex AI's OpenAI-compatible endpoint.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CLOUD_PLATFORM_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
_lock = threading.Lock()
_cached_credentials: Any = None
_cached_project_id: str | None = None


def resolve_credentials_path_or_info(
    cred_val: str, root_dir: Path | None = None
) -> tuple[Path | None, dict[str, Any] | None]:
    """Parse GOOGLE_APPLICATION_CREDENTIALS either as inline JSON or a file path."""
    val = cred_val.strip()
    if val.startswith("{") and val.endswith("}"):
        try:
            return None, json.loads(val)
        except Exception as e:
            logger.warning("Failed to parse inline JSON credentials: %s", e)
    path = Path(val)
    if path.is_file():
        return path.resolve(), None
    if not path.is_absolute() and root_dir:
        candidate = (root_dir / path).resolve()
        if candidate.is_file():
            return candidate, None
    return path, None


def get_google_credentials(
    cred_val: str | None = None,
    root_dir: Path | None = None,
    force_refresh: bool = False,
) -> tuple[Any, str | None]:
    """Load or return cached Google credentials and project_id."""
    global _cached_credentials, _cached_project_id

    with _lock:
        if _cached_credentials is not None and not force_refresh:
            return _cached_credentials, _cached_project_id

        val = (cred_val if cred_val is not None else os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")).strip()
        from google.oauth2 import service_account
        import google.auth

        creds = None
        project_id = None

        if val and val != "your-credentials.json":
            file_path, info = resolve_credentials_path_or_info(val, root_dir)
            if info:
                creds = service_account.Credentials.from_service_account_info(
                    info, scopes=_CLOUD_PLATFORM_SCOPES
                )
                project_id = info.get("project_id")
            elif file_path and file_path.is_file():
                creds = service_account.Credentials.from_service_account_file(
                    str(file_path), scopes=_CLOUD_PLATFORM_SCOPES
                )
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(file_path)
                try:
                    with file_path.open("r", encoding="utf-8") as f:
                        data = json.load(f)
                        project_id = data.get("project_id")
                except Exception:
                    pass

        if creds is None:
            creds, adc_project = google.auth.default(scopes=_CLOUD_PLATFORM_SCOPES)
            project_id = project_id or adc_project

        if not project_id:
            project_id = (
                getattr(creds, "project_id", None)
                or os.getenv("GOOGLE_CLOUD_PROJECT")
                or os.getenv("GCP_PROJECT")
                or os.getenv("VERTEX_PROJECT")
            )

        _cached_credentials = creds
        _cached_project_id = project_id
        return creds, project_id


def get_google_access_token(
    cred_val: str | None = None,
    root_dir: Path | None = None,
) -> str:
    """Return a fresh Google OAuth 2.0 access token for Bearer authorization."""
    creds, _ = get_google_credentials(cred_val, root_dir)
    with _lock:
        if not creds.valid or creds.expired:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
        return creds.token


def get_vertex_base_url(
    project_id: str | None = None,
    location: str | None = None,
    cred_val: str | None = None,
    root_dir: Path | None = None,
) -> str:
    """Construct the Vertex AI OpenAI-compatible base URL.

    Format: https://{host}/v1/projects/{project_id}/locations/{location}/endpoints/openapi
    """
    if not project_id:
        _, project_id = get_google_credentials(cred_val, root_dir)
    if not project_id:
        raise RuntimeError(
            "Could not determine Google Cloud project_id for Vertex AI. "
            "Set GOOGLE_CLOUD_PROJECT in .env or ensure your service account JSON contains project_id."
        )
    loc = location or os.getenv("VERTEX_LOCATION") or os.getenv("GOOGLE_CLOUD_LOCATION") or "global"
    loc = loc.strip().lower()
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    return f"https://{host}/v1/projects/{project_id}/locations/{loc}/endpoints/openapi"


def is_vertex_endpoint(base_url: str) -> bool:
    """Check if the given base_url is a Vertex AI endpoint."""
    return "aiplatform.googleapis.com" in (base_url or "")


def format_vertex_model(model: str) -> str:
    """Ensure the model identifier is properly prefixed for Vertex AI's OpenAPI endpoint.

    Vertex AI rejects bare model names like 'gemini-3.8-flash' with 400 Bad Request
    unless prefixed with publisher namespace 'google/'.
    """
    model = (model or "").strip()
    if not model or "/" in model:
        return model
    return f"google/{model}"


def reset_cached_credentials() -> None:
    """Reset cached credentials (useful for testing)."""
    global _cached_credentials, _cached_project_id
    with _lock:
        _cached_credentials = None
        _cached_project_id = None
