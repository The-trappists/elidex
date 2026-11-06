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

MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.5"))


def llm_configured() -> bool:
    return bool(LLM_API_KEY) and LLM_API_KEY != "your-key-here" and bool(LLM_MODEL)
