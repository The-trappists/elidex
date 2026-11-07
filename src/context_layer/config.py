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
    return "low" if "generativelanguage.googleapis.com" in base_url else ""


def _reasoning_effort(env_name: str, base_url: str) -> str:
    """"minimal", "low", "medium" or "high" are sent as `reasoning_effort`; "off" or empty sends nothing."""
    value = os.getenv(env_name, _default_reasoning_effort(base_url)).strip().lower()
    return "" if value in ("off", "none", "false", "0") else value


LLM_REASONING_EFFORT = _reasoning_effort("LLM_REASONING_EFFORT", LLM_BASE_URL)
LLM_FALLBACK_REASONING_EFFORT = _reasoning_effort("LLM_FALLBACK_REASONING_EFFORT", LLM_FALLBACK_BASE_URL)

MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.5"))

# Optional Neo4j mirror of the knowledge graph (`ctx graph push`, docs/knowledge-graph.md).
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE") or None


def _key_set(key: str) -> bool:
    return bool(key) and key != "your-key-here"


def llm_configured() -> bool:
    return _key_set(LLM_API_KEY) and bool(LLM_MODEL)


def llm_fallback_configured() -> bool:
    return _key_set(LLM_FALLBACK_API_KEY) and bool(LLM_FALLBACK_MODEL)


# ---------------------------------------------------------------- workbench

WORKBENCH_DIR = OUT_DIR / "workbench"
WORKBENCH_STATE_FILE = Path(os.getenv("WORKBENCH_STATE_FILE", WORKBENCH_DIR / "state.json"))
WORKBENCH_LLM_CALLS_FILE = WORKBENCH_STATE_FILE.parent / "llm_calls.jsonl"
WORKBENCH_LLM_CACHE_FILE = WORKBENCH_STATE_FILE.parent / "llm_cache.json"
WORKBENCH_SEED_DIR = DATA_DIR / "workbench"
WORKBENCH_SIM_START = os.getenv("WORKBENCH_SIM_START", "2026-10-20T07:30")
WORKBENCH_IDLE_SECONDS = float(os.getenv("WORKBENCH_IDLE_SECONDS", "8"))
WEB_DIST_DIR = ROOT / "web" / "dist"
DEMO_DIST_DIR = ROOT / "demo" / "dist"  # product demo (static, built with --base=/demo/), served at /demo/

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_APP_TOKEN = os.getenv("SLACK_APP_TOKEN", "")
SLACK_CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID", "")


def slack_configured() -> bool:
    return all(v and not v.startswith("your-") for v in (SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_CHANNEL_ID))
