"""Thin wrapper over any OpenAI-compatible chat endpoint (Gemini, Featherless, Anthropic...)."""

from openai import OpenAI

from . import config


def complete(system: str, user: str, json_mode: bool = False) -> str:
    if not config.llm_configured():
        raise RuntimeError("LLM not configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")
    client = OpenAI(base_url=config.LLM_BASE_URL or None, api_key=config.LLM_API_KEY)
    extra = {"response_format": {"type": "json_object"}} if json_mode else {}
    resp = client.chat.completions.create(
        model=config.LLM_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0,
        **extra,
    )
    return resp.choices[0].message.content or ""
