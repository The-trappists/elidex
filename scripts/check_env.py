#!/usr/bin/env python3
"""Pre-deployment verification script for .env.

Run by a human locally before deploying or copying .env to the VM:
    uv run python scripts/check_env.py

Checks:
1. Deployment / Caddy variables (DOMAIN, BASIC_AUTH_USER, BASIC_AUTH_HASH)
2. LLM configuration (GOOGLE_APPLICATION_CREDENTIALS or LLM_API_KEY + LLM_MODEL)
3. Live LLM connectivity & token resolution
4. Docker Compose config compatibility
5. Optional services (Slack, Embeddings, Databases)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv

ENV_FILE = ROOT / ".env"


def _check(status: bool, label: str, detail: str = "", warn: bool = False) -> bool:
    if status:
        icon = "\033[92m[PASS]\033[0m"
    elif warn:
        icon = "\033[93m[WARN]\033[0m"
    else:
        icon = "\033[91m[FAIL]\033[0m"
    msg = f"  {icon} {label}"
    if detail:
        msg += f" \033[90m({detail})\033[0m"
    print(msg)
    return status or warn


def main() -> int:
    print("\n" + "=" * 60)
    print(" Context Dashboard Pre-Deployment .env Verification")
    print("=" * 60 + "\n")

    if not ENV_FILE.is_file():
        print(f"\033[91m[FAIL]\033[0m .env not found at {ENV_FILE}")
        print("       Copy .env.example to .env first: cp .env.example .env\n")
        return 1

    load_dotenv(ENV_FILE)

    passed = True

    # 1. Deployment / Caddy Auth
    print("\033[1m1. Deployment & Web Access (Caddy / Docker)\033[0m")
    domain = os.getenv("DOMAIN", "").strip()
    user = os.getenv("BASIC_AUTH_USER", "").strip()
    pw_hash = os.getenv("BASIC_AUTH_HASH", "").strip()

    if not domain or domain in ("your-domain-here", "example.com"):
        _check(False, "DOMAIN", "Required for HTTPS. Use '<server-ip>.sslip.io' or your domain", warn=True)
    else:
        _check(True, "DOMAIN", f"Configured: {domain}")

    if not user:
        passed = _check(False, "BASIC_AUTH_USER", "Missing. Set e.g. BASIC_AUTH_USER=team") and passed
    else:
        _check(True, "BASIC_AUTH_USER", f"User: {user}")

    if not pw_hash:
        passed = _check(False, "BASIC_AUTH_HASH", "Missing. Generate with caddy hash-password") and passed
    elif not pw_hash.startswith(("$2a$", "$2b$", "$2y$")):
        passed = _check(False, "BASIC_AUTH_HASH", "Must be a bcrypt hash starting with $2a$, $2b$ or $2y$") and passed
    else:
        _check(True, "BASIC_AUTH_HASH", "Valid bcrypt hash format")

    # 2. LLM Configuration
    print("\n\033[1m2. LLM & Authentication\033[0m")
    from context_layer import config, google_auth, llm

    model = os.getenv("LLM_MODEL", config.LLM_MODEL).strip()
    cred_val = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    api_key = os.getenv("LLM_API_KEY", "").strip()
    base_url = os.getenv("LLM_BASE_URL", "").strip()

    if not model:
        passed = _check(False, "LLM_MODEL", "Missing. Set e.g. LLM_MODEL=gemini-3.8-flash") and passed
    else:
        _check(True, "LLM_MODEL", f"Model: {model}")

    using_google = False
    if cred_val and cred_val != "your-credentials.json":
        using_google = True
        path, info = google_auth.resolve_credentials_path_or_info(cred_val, ROOT)
        if info:
            _check(True, "GOOGLE_APPLICATION_CREDENTIALS", f"Inline JSON service account (project_id: {info.get('project_id', 'unknown')})")
        elif path and path.is_file():
            _check(True, "GOOGLE_APPLICATION_CREDENTIALS", f"File exists: {path}")
        else:
            passed = _check(False, "GOOGLE_APPLICATION_CREDENTIALS", f"File not found: {cred_val}") and passed

        # Test token generation
        try:
            token = google_auth.get_google_access_token(cred_val, ROOT)
            if token:
                _check(True, "Google OAuth Token", "Generated fresh access token successfully")
            else:
                passed = _check(False, "Google OAuth Token", "Failed to obtain access token") and passed
        except Exception as e:
            passed = _check(False, "Google OAuth Token", f"Error: {e}") and passed

        # Test Vertex base URL
        try:
            vertex_url = google_auth.get_vertex_base_url(cred_val=cred_val, root_dir=ROOT)
            _check(True, "Vertex AI Base URL", vertex_url)
        except Exception as e:
            passed = _check(False, "Vertex AI Base URL", f"Error: {e}") and passed

    elif api_key and api_key != "your-key-here":
        _check(True, "LLM_API_KEY", f"Standard API key set (base_url: {base_url or 'default'})")
    else:
        passed = _check(False, "LLM Credentials", "Neither GOOGLE_APPLICATION_CREDENTIALS nor LLM_API_KEY is configured") and passed

    # 3. Live LLM Ping Check
    print("\n\033[1m3. Live LLM Connectivity (Ping)\033[0m")
    if config.llm_configured():
        chain = llm.providers()
        if chain:
            p = chain[0]
            try:
                print(f"  ... contacting {p.model} via {p.name} provider ...")
                text, trace, exc = llm.call_provider(p, "Reply with the single word: pong", "ping", json=False, emit=False)
                if exc is None and text:
                    _check(True, "LLM Ping", f"Response: '{text.strip()}' in {trace['latency_ms']} ms")
                else:
                    err = trace.get("error") or str(exc)
                    passed = _check(False, "LLM Ping", f"Failed: {err}") and passed
            except Exception as e:
                passed = _check(False, "LLM Ping", f"Exception: {e}") and passed
        else:
            passed = _check(False, "LLM Providers", "No provider resolved in chain") and passed
    else:
        _check(False, "LLM Ping", "Skipped: LLM not configured", warn=True)

    # 4. Docker Compose Compatibility
    print("\n\033[1m4. Docker Compose Configuration\033[0m")
    compose_bin = shutil.which("docker")
    compose_file = ROOT / "deploy" / "docker-compose.yml"
    if compose_bin and compose_file.is_file():
        res = subprocess.run(
            ["docker", "compose", "-f", str(compose_file), "--env-file", str(ENV_FILE), "config", "-q"],
            capture_output=True,
            text=True,
        )
        if res.returncode == 0:
            _check(True, "Docker Compose config", "Valid syntax and environment variables")
        else:
            err = res.stderr.strip().split("\n")[0] if res.stderr else "syntax error"
            _check(False, "Docker Compose config", f"Validation warning: {err}", warn=True)
    else:
        _check(True, "Docker Compose check", "Docker CLI not detected locally (skipping)")

    # 5. Optional Integrations
    print("\n\033[1m5. Optional Services\033[0m")
    slack_bot = os.getenv("SLACK_BOT_TOKEN", "").strip()
    slack_app = os.getenv("SLACK_APP_TOKEN", "").strip()
    if slack_bot and slack_bot != "your-bot-token":
        if slack_bot.startswith("xoxb-") and slack_app.startswith("xapp-"):
            _check(True, "Slack Bridge", "Tokens present with valid prefix")
        else:
            _check(False, "Slack Bridge", "Tokens should start with xoxb- and xapp-", warn=True)
    else:
        _check(True, "Slack Bridge", "Not configured (optional)")

    embed_model = os.getenv("EMBEDDING_MODEL", "").strip()
    if embed_model:
        _check(True, "Embedding Model", f"Set to {embed_model}")
    else:
        _check(True, "Embedding Model", "Offline hash-based fallback (optional)")

    neo4j_pwd = os.getenv("NEO4J_PASSWORD", "").strip()
    if neo4j_pwd and not neo4j_pwd.startswith("your-"):
        _check(True, "Neo4j", f"Configured ({os.getenv('NEO4J_URI', 'bolt://localhost:7687')})")
    else:
        _check(True, "Neo4j", "Not configured (optional)")

    print("\n" + "=" * 60)
    if passed:
        print("\033[92mAll critical checks passed! Your .env is ready to deploy.\033[0m")
        print("=" * 60 + "\n")
        return 0
    else:
        print("\033[91mSome critical checks failed. Please fix the issues above before deploying.\033[0m")
        print("=" * 60 + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
