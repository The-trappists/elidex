"""Shared fixtures. Tests run offline, whatever is in a developer's .env.

config.py loads .env at import. Without the `_offline` fixture, any test that starts the workbench on a machine with a
real key calls the real LLM provider (slow, flaky timeouts, paid calls), and could reach a real database or Slack.
A test that needs a configured provider sets it itself (monkeypatch config.llm_configured or the variables),
which runs after this fixture and wins.
"""

import pytest

from context_layer import config
from context_layer.dataset.build import generate

_OFFLINE = [
    "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL",
    "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_MODEL",
    "LLM_CRITIC_BASE_URL", "LLM_CRITIC_API_KEY", "LLM_CRITIC_MODEL",
    "LLM_CRITIC_FALLBACK_BASE_URL", "LLM_CRITIC_FALLBACK_API_KEY", "LLM_CRITIC_FALLBACK_MODEL",
    "EMBEDDING_MODEL", "MONGODB_URI", "TIGER_DATABASE_URL", "NEO4J_PASSWORD",
    "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_CHANNEL_ID",
]


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    for name in _OFFLINE:
        if hasattr(config, name):
            monkeypatch.setattr(config, name, "")


@pytest.fixture(scope="session")
def tiny_dataset(tmp_path_factory):
    """A real `tiny` dataset (60 sites, 2,000 threads, about 2 s) generated once for the whole session."""
    root = tmp_path_factory.mktemp("company") / "tiny"
    generate(root, "tiny", seed=7, workers=2, log=lambda *_: None)
    return root
