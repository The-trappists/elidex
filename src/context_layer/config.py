"""Paths and settings, read from the environment and an optional .env file."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(os.getenv("CTX_ROOT", Path(__file__).resolve().parents[2]))
load_dotenv(ROOT / ".env")

DATA_DIR = ROOT / "data"
INVENTORY_DIR = DATA_DIR / "synthetic"
CASES_FILE = DATA_DIR / "synthetic" / "cases.json"
CACHE_FILE = DATA_DIR / "cache" / "extractions.json"
OUT_DIR = ROOT / "out"
STORE_FILE = OUT_DIR / "context_store.json"

# Elisa's material has times but no date: we pick one (documented in data/synthetic/README.md).
DEFAULT_THREAD_DATE = os.getenv("DEFAULT_THREAD_DATE", "2026-10-15")
DEFAULT_EMAIL_TIME = os.getenv("DEFAULT_EMAIL_TIME", "10:30")

GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", os.getenv("GOOGLE_CLOUD_LOCATION", "global"))
VERTEX_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", os.getenv("GCP_PROJECT", ""))

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
# How to ask for JSON: "json_object" (response_format), "json_schema" (strict schema) or "prompt" (no response_format).
LLM_JSON_MODE = os.getenv("LLM_JSON_MODE", "json_object")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "60"))

# Optional second provider, used when the primary fails (429, 5xx, timeout).
LLM_FALLBACK_BASE_URL = os.getenv("LLM_FALLBACK_BASE_URL", "")
LLM_FALLBACK_API_KEY = os.getenv("LLM_FALLBACK_API_KEY", "")
LLM_FALLBACK_MODEL = os.getenv("LLM_FALLBACK_MODEL", "")
LLM_FALLBACK_JSON_MODE = os.getenv("LLM_FALLBACK_JSON_MODE", LLM_JSON_MODE)


def _default_reasoning_effort(base_url: str) -> str:
    # Gemini "thinks" by default, which makes extraction calls slow; other providers may reject the parameter.
    return "low" if ("generativelanguage.googleapis.com" in base_url or "aiplatform.googleapis.com" in base_url) else ""


def _reasoning_effort(env_name: str, base_url: str) -> str:
    """"minimal", "low", "medium" or "high" are sent as `reasoning_effort`; "off" or empty sends nothing."""
    value = os.getenv(env_name, _default_reasoning_effort(base_url)).strip().lower()
    return "" if value in ("off", "none", "false", "0") else value


LLM_REASONING_EFFORT = _reasoning_effort("LLM_REASONING_EFFORT", LLM_BASE_URL)
LLM_FALLBACK_REASONING_EFFORT = _reasoning_effort("LLM_FALLBACK_REASONING_EFFORT", LLM_FALLBACK_BASE_URL)

# Optional critic provider (second opinion on extracted items; a different model family from the extractor
# decorrelates errors). Unset: the critic silently uses the primary chain. LLM_CRITIC_FALLBACK_* is tried
# when the critic fails (429, 5xx, timeout).
LLM_CRITIC_BASE_URL = os.getenv("LLM_CRITIC_BASE_URL", "")
LLM_CRITIC_API_KEY = os.getenv("LLM_CRITIC_API_KEY", "")
LLM_CRITIC_MODEL = os.getenv("LLM_CRITIC_MODEL", "")
LLM_CRITIC_JSON_MODE = os.getenv("LLM_CRITIC_JSON_MODE", LLM_JSON_MODE)
LLM_CRITIC_FALLBACK_BASE_URL = os.getenv("LLM_CRITIC_FALLBACK_BASE_URL", "")
LLM_CRITIC_FALLBACK_API_KEY = os.getenv("LLM_CRITIC_FALLBACK_API_KEY", "")
LLM_CRITIC_FALLBACK_MODEL = os.getenv("LLM_CRITIC_FALLBACK_MODEL", "")
LLM_CRITIC_FALLBACK_JSON_MODE = os.getenv("LLM_CRITIC_FALLBACK_JSON_MODE", LLM_CRITIC_JSON_MODE)
LLM_CRITIC_REASONING_EFFORT = _reasoning_effort("LLM_CRITIC_REASONING_EFFORT", LLM_CRITIC_BASE_URL)
LLM_CRITIC_FALLBACK_REASONING_EFFORT = _reasoning_effort("LLM_CRITIC_FALLBACK_REASONING_EFFORT", LLM_CRITIC_FALLBACK_BASE_URL)

MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.5"))

# Optional Neo4j mirror of the knowledge graph (`ctx graph push`, docs/knowledge-graph.md).
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE") or None


def _key_set(key: str) -> bool:
    return bool(key) and key != "your-key-here"


def google_auth_configured() -> bool:
    val = GOOGLE_APPLICATION_CREDENTIALS.strip()
    return bool(val) and val != "your-credentials.json"


def is_google_vertex_primary() -> bool:
    """True if primary LLM should route through Google Cloud Vertex AI."""
    if not google_auth_configured():
        return False
    if LLM_BASE_URL and not ("generativelanguage.googleapis.com" in LLM_BASE_URL or "aiplatform.googleapis.com" in LLM_BASE_URL):
        return not _key_set(LLM_API_KEY)
    return True


def llm_configured() -> bool:
    # A workspace connection overrides the deployment configuration. A public workspace that
    # used a personal key never falls back to the deployment key after disconnect.
    try:
        from .connections import current_connection

        registry = current_connection()
        if registry is not None:
            if registry.ai is not None:
                return True
            if not registry.allow_server_ai:
                return False
    except Exception:  # noqa: BLE001 - configuration must stay importable on its own
        pass
    has_auth = _key_set(LLM_API_KEY) or google_auth_configured()
    return has_auth and bool(LLM_MODEL)


def llm_fallback_configured() -> bool:
    return _key_set(LLM_FALLBACK_API_KEY) and bool(LLM_FALLBACK_MODEL)


def llm_critic_configured() -> bool:
    return _key_set(LLM_CRITIC_API_KEY) and bool(LLM_CRITIC_MODEL)


def llm_critic_fallback_configured() -> bool:
    return _key_set(LLM_CRITIC_FALLBACK_API_KEY) and bool(LLM_CRITIC_FALLBACK_MODEL)


# Big dataset storage, outside the app's memory (`ctx dataset load-mongo`, `load-tiger`; docs/dataset.md).
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "ctx")
TIGER_DATABASE_URL = os.getenv("TIGER_DATABASE_URL", "")
# Embeddings for the vector search: an OpenAI-compatible embedding model on the primary LLM provider.
# Empty = offline fallback (hashed words: finds similar wording, not similar meaning).
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "")
# Patterns (docs/patterns.md): cosine similarity from which two differently worded topics are the same problem.
# Only used with EMBEDDING_MODEL; calibrate with `ctx patterns --check-meaning`. 0.78 is calibrated on
# gemini-embedding-001 (2026-11-07): same problem >= 0.80, look-alikes <= 0.76. Another model needs its own value.
PATTERNS_SAME_MEANING = float(os.getenv("PATTERNS_SAME_MEANING", "0.78"))
# Dedupe (docs/dashboard.md): minimum similarity (words or embedding) to fold a new assertion into an older one.
# Calibrate with `uv run ctx dedupe-check`.
DEDUPE_THRESHOLD = float(os.getenv("DEDUPE_THRESHOLD", "0.90"))
DATASET_DIR = Path(os.getenv("DATASET_DIR", OUT_DIR / "dataset" / "demo"))


def _set(value: str) -> bool:
    return bool(value) and "your-" not in value


def mongo_configured() -> bool:
    return _set(MONGODB_URI)


def tiger_configured() -> bool:
    return _set(TIGER_DATABASE_URL)


# ---------------------------------------------------------------- dashboard

DASHBOARD_DIR = OUT_DIR / "dashboard"
DASHBOARD_STATE_FILE = Path(os.getenv("DASHBOARD_STATE_FILE", DASHBOARD_DIR / "state.json"))
DASHBOARD_LLM_CALLS_FILE = DASHBOARD_STATE_FILE.parent / "llm_calls.jsonl"
DASHBOARD_LLM_CACHE_FILE = DASHBOARD_STATE_FILE.parent / "llm_cache.json"
DASHBOARD_SEED_DIR = DATA_DIR / "dashboard"
DASHBOARD_SIM_START = os.getenv("DASHBOARD_SIM_START", "2026-10-20T07:30")
DASHBOARD_PORT = int(os.getenv("DASHBOARD_PORT", "8010"))
DASHBOARD_IDLE_SECONDS = float(os.getenv("DASHBOARD_IDLE_SECONDS", "8"))
WEB_DIST_DIR = ROOT / "web" / "dist"

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_APP_TOKEN = os.getenv("SLACK_APP_TOKEN", "")
SLACK_CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID", "")


def slack_configured() -> bool:
    return all(v and not v.startswith("your-") for v in (SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_CHANNEL_ID))
