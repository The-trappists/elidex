"""Text embeddings for the vector search.

Two modes, chosen by EMBEDDING_MODEL:
- a model name: embeddings from the primary LLM provider (any OpenAI-compatible `/embeddings` endpoint);
- empty: a deterministic hashed bag of words. It runs offline and needs no key, and finds texts with similar
  *words*, not similar *meaning*. Fine for tests and a demo without a key; use a model for the real thing.

Vectors are L2-normalised, so cosine similarity is the dot product. Never mix modes in one collection: the mode
and dimension are stored next to the vectors (see mongo_store.py).
"""

from __future__ import annotations

import hashlib
import math
import re

from . import config
from .connections import current_connection
from .demo_policy import current_policy

HASH_DIM = 256
_WORD = re.compile(r"[a-z0-9]+")


def _offline() -> bool:
    """Personal or blocked public workspaces never use deployment embedding credentials."""
    registry = current_connection()
    if registry is not None and (registry.ai is not None or not registry.allow_server_ai):
        return True
    return current_policy() is not None


def mode() -> str:
    return f"model:{config.EMBEDDING_MODEL}" if config.EMBEDDING_MODEL and not _offline() else f"hash:{HASH_DIM}"


def hash_embed(text: str, dim: int = HASH_DIM) -> list[float]:
    """Hashing trick over words and word pairs, signed, normalised."""
    words = _WORD.findall(text.lower())
    vec = [0.0] * dim
    for token in words + [f"{a}_{b}" for a, b in zip(words, words[1:])]:
        h = int.from_bytes(hashlib.md5(token.encode()).digest()[:8], "big")
        vec[h % dim] += 1.0 if (h >> 63) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed(texts: list[str], batch: int = 64) -> list[list[float]]:
    """One vector per text, in order."""
    if not config.EMBEDDING_MODEL or _offline():
        return [hash_embed(t) for t in texts]
    from openai import OpenAI

    from .llm import providers

    found = providers()
    if not found:
        raise SystemExit("EMBEDDING_MODEL is set but no LLM provider is configured (LLM_* in .env).")
    p = found[0]
    api_key = p.api_key
    model = config.EMBEDDING_MODEL
    if p.is_vertex or ("aiplatform.googleapis.com" in (p.base_url or "")):
        from . import google_auth

        api_key = google_auth.get_google_access_token(
            cred_val=config.GOOGLE_APPLICATION_CREDENTIALS,
            root_dir=config.ROOT,
        )
        model = google_auth.format_vertex_model(model)
    client = OpenAI(base_url=p.base_url or None, api_key=api_key, timeout=config.LLM_TIMEOUT)
    out: list[list[float]] = []
    for i in range(0, len(texts), batch):
        chunk = texts[i : i + batch]
        resp = client.embeddings.create(model=model, input=chunk)
        out += ordered_vectors(resp.data, len(chunk))
    return out


def ordered_vectors(data: list, expected: int) -> list[list[float]]:
    """Normalised vectors in input order. `index` is sorted on when every item has one; Gemini's OpenAI-compatible
    endpoint leaves it empty (None), and then the order of the response is the order of the input."""
    items = list(data)
    if items and all(getattr(d, "index", None) is not None for d in items):
        items.sort(key=lambda d: d.index)
    if len(items) != expected:
        raise SystemExit(f"The embedding endpoint returned {len(items)} vectors for {expected} texts: lower the batch size or retry.")
    out = []
    for item in items:
        v = item.embedding
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        out.append([x / norm for x in v])
    return out
