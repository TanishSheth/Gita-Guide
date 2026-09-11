"""
Per-user LLM wiring: Ollama (default, local/free) or a cloud company API.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx

_OPENAI_REASONING_MODEL_RE = re.compile(r"^o\d", re.I)

DEFAULT_PROVIDER = "ollama"
DEFAULT_OLLAMA_MODEL = os.getenv("OLLAMA_DEFAULT_MODEL", "llama3.2")
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")

SUGGESTED_OLLAMA = [
    {"id": "llama3.2", "label": "Llama 3.2 - small, good laptop default"},
    {"id": "llama3.1", "label": "Llama 3.1"},
    {"id": "mistral", "label": "Mistral"},
    {"id": "qwen2.5", "label": "Qwen 2.5"},
    {"id": "qwen3.5", "label": "Qwen 3.5"},
    {"id": "gemma2", "label": "Gemma 2"},
    {"id": "phi3", "label": "Phi-3"},
    {"id": "llama3", "label": "Llama 3"},
]

OPENAI_MODELS = [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4.1-mini",
    "gpt-4.1",
    "o4-mini",
    "o3-mini",
]

# Known companies. Cloud ones use OpenAI-compatible HTTP unless api_style says otherwise.
COMPANIES: List[Dict[str, Any]] = [
    {
        "id": "ollama",
        "label": "Ollama (local)",
        "needs_key": False,
        "needs_base_url": False,
        "base_url": DEFAULT_OLLAMA_URL,
        "api_style": "ollama",
        "models": [row["id"] for row in SUGGESTED_OLLAMA],
        "key_placeholder": "",
        "hint": "Free local models. Install Ollama, then pull a model.",
    },
    {
        "id": "openai",
        "label": "OpenAI",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://api.openai.com/v1",
        "api_style": "openai",
        "models": OPENAI_MODELS,
        "key_placeholder": "sk-…",
        "hint": "Uses your OpenAI API key.",
    },
    {
        "id": "google",
        "label": "Google",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_style": "openai",
        "models": [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ],
        "key_placeholder": "AIza…",
        "hint": "Gemini models via your Google AI Studio key.",
    },
    {
        "id": "anthropic",
        "label": "Anthropic",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://api.anthropic.com/v1",
        "api_style": "anthropic",
        "models": [
            "claude-sonnet-4-5",
            "claude-opus-4-1",
            "claude-3-5-sonnet-latest",
            "claude-3-5-haiku-latest",
            "claude-3-opus-latest",
        ],
        "key_placeholder": "sk-ant-…",
        "hint": "Claude models via your Anthropic key.",
    },
    {
        "id": "deepseek",
        "label": "DeepSeek",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://api.deepseek.com",
        "api_style": "openai",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "key_placeholder": "sk-…",
        "hint": "DeepSeek Chat and Reasoner models.",
    },
    {
        "id": "xai",
        "label": "Grok (xAI)",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://api.x.ai/v1",
        "api_style": "openai",
        "models": ["grok-3", "grok-3-mini", "grok-2-latest", "grok-2"],
        "key_placeholder": "xai-…",
        "hint": "Grok models via your xAI key.",
    },
    {
        "id": "groq",
        "label": "Groq",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://api.groq.com/openai/v1",
        "api_style": "openai",
        "models": [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
        ],
        "key_placeholder": "gsk_…",
        "hint": "Fast open models hosted by Groq.",
    },
    {
        "id": "mistral",
        "label": "Mistral",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://api.mistral.ai/v1",
        "api_style": "openai",
        "models": [
            "mistral-small-latest",
            "mistral-large-latest",
            "codestral-latest",
            "open-mistral-nemo",
        ],
        "key_placeholder": "…",
        "hint": "Mistral Cloud models.",
    },
    {
        "id": "openrouter",
        "label": "OpenRouter",
        "needs_key": True,
        "needs_base_url": False,
        "base_url": "https://openrouter.ai/api/v1",
        "api_style": "openai",
        "models": [
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-sonnet",
            "google/gemini-2.0-flash-001",
            "meta-llama/llama-3.3-70b-instruct",
            "deepseek/deepseek-chat",
        ],
        "key_placeholder": "sk-or-…",
        "hint": "One key for many labs. Type a model id if it is not listed.",
    },
    {
        "id": "custom",
        "label": "Other (OpenAI-compatible)",
        "needs_key": True,
        "needs_base_url": True,
        "base_url": None,
        "api_style": "openai",
        "models": [],
        "key_placeholder": "sk-…",
        "hint": "Any host that speaks the OpenAI Chat Completions API.",
    },
]

COMPANY_BY_ID: Dict[str, Dict[str, Any]] = {c["id"]: c for c in COMPANIES}
PROVIDERS = tuple(c["id"] for c in COMPANIES)

MODE_TOKEN_BUDGETS: Dict[str, int] = {
    "brief": 650,
    "practical": 1800,
    "deep": 4096,
}

MODE_TEMPERATURES: Dict[str, float] = {
    "brief": 0.25,
    "practical": 0.35,
    "deep": 0.55,
}


def output_token_budget(mode: str, language: str = "en") -> int:
    """Shared output limits for every provider (mapped to max_tokens / num_predict)."""
    m = (mode or "practical").strip().lower()
    if m not in MODE_TOKEN_BUDGETS:
        m = "practical"
    budget = MODE_TOKEN_BUDGETS[m]
    if language != "en":
        budget = min(budget + 400, 4500)
    return budget


def _is_native_openai(provider: Optional[str]) -> bool:
    return (provider or "").strip().lower() == "openai"


def _is_openai_reasoning_model(model: Optional[str]) -> bool:
    """Native OpenAI o-series models expect max_completion_tokens."""
    return bool(_OPENAI_REASONING_MODEL_RE.match((model or "").strip()))


def _token_limit_kwargs(
    provider: Optional[str], model: Optional[str], max_tokens: int
) -> Dict[str, int]:
    """
    Map output budget to the field each host accepts.

    OpenAI-compatible APIs (Google, Groq, DeepSeek, OpenRouter, …) use
    max_tokens. Only native OpenAI reasoning models use max_completion_tokens.
    """
    if _is_native_openai(provider) and _is_openai_reasoning_model(model):
        return {"max_completion_tokens": max_tokens}
    return {"max_tokens": max_tokens}


def _compat_chat_payload(model: str, messages: List[Dict[str, str]], max_tokens: int, spec: Dict[str, Any]) -> Dict[str, Any]:
    """Build chat/completions JSON for probes; omit params unsupported by the host."""
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        **_token_limit_kwargs(spec.get("id"), model, max_tokens),
    }
    return payload


def get_company(provider: Optional[str]) -> Dict[str, Any]:
    key = (provider or DEFAULT_PROVIDER).strip().lower()
    return COMPANY_BY_ID.get(key) or COMPANY_BY_ID[DEFAULT_PROVIDER]


def company_ids() -> Tuple[str, ...]:
    return PROVIDERS


def is_ollama(provider: Optional[str]) -> bool:
    return (provider or "").strip().lower() == "ollama"


@dataclass
class LlmConfig:
    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_OLLAMA_MODEL
    api_key: Optional[str] = None
    base_url: Optional[str] = None

    def normalized(self) -> "LlmConfig":
        provider = (self.provider or DEFAULT_PROVIDER).strip().lower()
        if provider not in COMPANY_BY_ID:
            provider = DEFAULT_PROVIDER
        spec = COMPANY_BY_ID[provider]
        model = (self.model or "").strip()
        if not model:
            if provider == "ollama":
                model = DEFAULT_OLLAMA_MODEL
            elif spec.get("models"):
                model = spec["models"][0]
            else:
                model = DEFAULT_OPENAI_MODEL
        stored = (self.base_url or "").strip().rstrip("/") or None
        if provider == "ollama":
            base = stored or DEFAULT_OLLAMA_URL
        elif provider == "custom":
            base = stored
        else:
            base = spec.get("base_url")
        key = (self.api_key or "").strip() or None
        return LlmConfig(provider=provider, model=model, api_key=key, base_url=base)

    def cache_key(self) -> str:
        cfg = self.normalized()
        return f"{cfg.provider}:{cfg.model}"


def mask_api_key(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    raw = key.strip()
    if len(raw) <= 8:
        return "••••"
    return f"{raw[:4]}…{raw[-4:]}"


def match_installed_model(requested: str, installed: List[str]) -> Optional[str]:
    req = (requested or "").strip()
    if not req:
        return None
    if req in installed:
        return req
    prefix = req if ":" in req else f"{req}:"
    for name in installed:
        if name == req or name.startswith(prefix):
            return name
    lowered = {n.lower(): n for n in installed}
    return lowered.get(req.lower())


def pick_default_ollama_model(installed: Optional[List[str]] = None) -> str:
    names = installed
    if names is None:
        _, _, names = list_ollama_models()
    for sug in SUGGESTED_OLLAMA:
        matched = match_installed_model(sug["id"], names)
        if matched:
            return matched
    if names:
        return names[0]
    return DEFAULT_OLLAMA_MODEL


def config_from_user(user) -> LlmConfig:
    cfg = LlmConfig(
        provider=getattr(user, "llm_provider", None) or DEFAULT_PROVIDER,
        model=getattr(user, "llm_model", None) or "",
        api_key=getattr(user, "llm_api_key", None),
        base_url=getattr(user, "llm_base_url", None),
    ).normalized()
    if cfg.provider == "ollama":
        _, _, installed = list_ollama_models(cfg.base_url)
        matched = match_installed_model(cfg.model, installed)
        if matched:
            cfg.model = matched
        elif installed and cfg.model.split(":")[0] in (
            DEFAULT_OLLAMA_MODEL,
            "llama3.2",
        ):
            cfg.model = pick_default_ollama_model(installed)
    return cfg


def ollama_base(url: Optional[str] = None) -> str:
    return (url or DEFAULT_OLLAMA_URL).rstrip("/")


_ollama_cache: Dict[str, Any] = {"url": None, "at": 0.0, "result": None}


def list_ollama_models(base_url: Optional[str] = None) -> Tuple[bool, str, List[str]]:
    """
    Return (reachable, message, model_names).
    """
    host = ollama_base(base_url)
    now = time.time()
    cached = _ollama_cache
    if (
        cached["result"]
        and cached["url"] == host
        and now - float(cached["at"]) < 20
    ):
        return cached["result"]

    url = f"{host}/api/tags"
    try:
        with httpx.Client(timeout=1.5) as client:
            res = client.get(url)
        res.raise_for_status()
        payload = res.json() or {}
        names = []
        for row in payload.get("models") or []:
            name = (row.get("name") or row.get("model") or "").strip()
            if name:
                names.append(name)
        names.sort()
        if names:
            result = (
                True,
                f"Ollama is running with {len(names)} local model(s).",
                names,
            )
        else:
            result = (
                True,
                "Ollama is running, but no models are installed. Try: ollama pull llama3.2",
                [],
            )
    except Exception:
        result = (
            False,
            "Ollama is not reachable. Install from https://ollama.com, start the app, "
            "then run: ollama pull llama3.2",
            [],
        )
    _ollama_cache.update({"url": host, "at": now, "result": result})
    return result


def _company_public(spec: Dict[str, Any], ollama_models: Optional[List[str]] = None) -> Dict[str, Any]:
    models = list(spec.get("models") or [])
    if spec["id"] == "ollama" and ollama_models:
        models = list(dict.fromkeys([*ollama_models, *models]))
    return {
        "id": spec["id"],
        "label": spec["label"],
        "needs_key": bool(spec.get("needs_key")),
        "needs_base_url": bool(spec.get("needs_base_url")),
        "models": models,
        "key_placeholder": spec.get("key_placeholder") or "sk-…",
        "hint": spec.get("hint") or "",
    }


def status_payload(user=None) -> Dict[str, Any]:
    cfg = config_from_user(user) if user is not None else LlmConfig().normalized()
    reachable, message, installed = list_ollama_models(
        cfg.base_url if cfg.provider == "ollama" else None
    )
    return {
        "default_provider": DEFAULT_PROVIDER,
        "ollama_base_url": ollama_base(cfg.base_url if cfg.provider == "ollama" else None),
        "ollama_online": reachable,
        "ollama_message": message,
        "ollama_models": installed,
        "suggested_ollama": SUGGESTED_OLLAMA,
        "openai_models": OPENAI_MODELS,
        "companies": [_company_public(c, installed) for c in COMPANIES],
        "providers": [
            {
                "id": c["id"],
                "label": c["label"],
                "needs_key": bool(c.get("needs_key")),
            }
            for c in COMPANIES
        ],
    }


def _normalize_model_id(name: str) -> str:
    """Strip provider prefixes like models/gemini-2.5-flash -> gemini-2.5-flash."""
    raw = (name or "").strip()
    if not raw:
        return ""
    if raw.lower().startswith("models/"):
        raw = raw.split("/", 1)[1]
    return raw.strip().lower()


def _collect_model_ids(payload: Any) -> List[str]:
    ids: List[str] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("data") or payload.get("models") or []
    else:
        rows = []
    if not isinstance(rows, list):
        return ids
    for row in rows:
        if isinstance(row, str) and row.strip():
            ids.append(_normalize_model_id(row))
            continue
        if not isinstance(row, dict):
            continue
        for key in ("id", "name", "model"):
            val = row.get(key)
            if isinstance(val, str) and val.strip():
                ids.append(_normalize_model_id(val))
                break
    return [x for x in ids if x]


def _model_available(requested: str, listed: List[str]) -> bool:
    req = _normalize_model_id(requested)
    if not req:
        return False
    normalized = [_normalize_model_id(name) for name in listed if name]
    if req in normalized:
        return True
    if match_installed_model(requested, listed):
        return True
    for n in normalized:
        if n == req or n.startswith(req + ":") or n.startswith(req + "-"):
            return True
        if req.startswith(n + "-") or req.startswith(n + ":"):
            return True
        # Anthropic dated ids: claude-3-5-sonnet-20241022 vs claude-3-5-sonnet-latest
        short = n.rsplit("-", 1)[0]
        if short == req or req.startswith(short + "-"):
            return True
    return False


def _probe_chat_completion(cfg: LlmConfig, spec: Dict[str, Any]) -> Dict[str, Any]:
    """Verify the model with a tiny chat request (more reliable than /models for Google)."""
    base = (cfg.base_url or "").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {**_auth_headers(cfg), "Content-Type": "application/json"}
    payload = _compat_chat_payload(
        cfg.model,
        [{"role": "user", "content": "Reply with OK."}],
        5,
        spec,
    )
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.post(url, headers=headers, json=payload)
        body = (res.text or "")[:800]
        if res.status_code in (401, 403):
            return {
                "ok": False,
                "message": "The API key is invalid. Check it and try again.",
                "fields": {"api_key": "The API key is invalid. Check it and try again."},
            }
        if res.status_code >= 400:
            mapped = _http_field_error(res.status_code, body, spec)
            return {
                "ok": False,
                "message": next(iter(mapped.values())),
                "fields": mapped,
            }
        return {
            "ok": True,
            "message": f"{spec.get('label')} is ready.",
            "fields": {},
        }
    except httpx.TimeoutException:
        msg = f"Timed out reaching {spec.get('label')}. Try again."
        return {"ok": False, "message": msg, "fields": {"provider": msg}}
    except httpx.RequestError:
        msg = f"Could not reach {spec.get('label')}. Check your connection."
        return {"ok": False, "message": msg, "fields": {"provider": msg}}


def _auth_headers(cfg: LlmConfig) -> Dict[str, str]:
    spec = get_company(cfg.provider)
    headers = {"Accept": "application/json"}
    key = cfg.api_key or ""
    if spec.get("api_style") == "anthropic":
        headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
        headers["Authorization"] = f"Bearer {key}"
    else:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _http_field_error(status_code: int, body: str, spec: Dict[str, Any]) -> Dict[str, str]:
    low = f"{status_code} {body}".lower()
    fields: Dict[str, str] = {}
    if status_code in (401, 403) or any(
        s in low
        for s in (
            "invalid api",
            "incorrect api",
            "invalid_api_key",
            "unauthorized",
            "authentication",
            "api key not valid",
            "invalid x-api-key",
        )
    ):
        fields["api_key"] = "The API key is invalid. Check it and try again."
        return fields
    if status_code == 404 or "model" in low and any(
        s in low for s in ("not found", "does not exist", "unknown model", "invalid model")
    ):
        fields["model"] = "The model selected is not available."
        return fields
    if status_code == 429:
        fields["api_key"] = "This key is rate-limited. Wait a moment or check billing."
        return fields
    if spec.get("needs_base_url"):
        fields["base_url"] = "The API host rejected this request. Check the base URL."
    else:
        fields["provider"] = body.strip()[:240] or f"{spec.get('label')} returned an error."
    return fields


def probe_llm_config(config: LlmConfig) -> Dict[str, Any]:
    """
    Talk to the provider and return {ok, message, fields}.
    Does not persist anything.
    """
    cfg = config.normalized()
    spec = get_company(cfg.provider)
    fields: Dict[str, str] = {}

    if not cfg.model:
        fields["model"] = "Choose or type a model name."
    if spec.get("needs_key") and not cfg.api_key:
        fields["api_key"] = "Add an API key to use this company."
    if spec.get("needs_base_url") and not cfg.base_url:
        fields["base_url"] = "Add the API base URL for this host."
    if fields:
        return {
            "ok": False,
            "message": next(iter(fields.values())),
            "fields": fields,
        }

    if cfg.provider == "ollama":
        reachable, message, installed = list_ollama_models(cfg.base_url)
        if not reachable:
            return {
                "ok": False,
                "message": message,
                "fields": {"provider": message},
            }
        if not _model_available(cfg.model, installed):
            msg = (
                f"The model selected is not available. "
                f"In a terminal run: ollama pull {cfg.model}"
            )
            return {"ok": False, "message": msg, "fields": {"model": msg}}
        return {"ok": True, "message": "Ollama is ready.", "fields": {}}

    url = f"{(cfg.base_url or '').rstrip('/')}/models"
    try:
        with httpx.Client(timeout=12.0) as client:
            res = client.get(url, headers=_auth_headers(cfg))
        body = (res.text or "")[:800]
        if res.status_code in (401, 403):
            mapped = _http_field_error(res.status_code, body, spec)
            return {
                "ok": False,
                "message": next(iter(mapped.values())),
                "fields": mapped,
            }
        if res.status_code == 404:
            if spec.get("needs_base_url"):
                msg = (
                    "Could not find the models endpoint. "
                    "Check the base URL (it usually ends with /v1)."
                )
                return {"ok": False, "message": msg, "fields": {"base_url": msg}}
            return {
                "ok": True,
                "message": f"{spec.get('label')} accepted the key.",
                "fields": {},
            }
        if res.status_code >= 400:
            mapped = _http_field_error(res.status_code, body, spec)
            return {
                "ok": False,
                "message": next(iter(mapped.values())),
                "fields": mapped,
            }
        try:
            payload = res.json()
        except Exception:
            payload = {}
        listed = _collect_model_ids(payload)
        if listed and _model_available(cfg.model, listed):
            return {
                "ok": True,
                "message": f"{spec.get('label')} is ready.",
                "fields": {},
            }
        # Model list missing or id mismatch — verify with a real chat call (all cloud hosts).
        return _probe_chat_completion(cfg, spec)
    except httpx.TimeoutException:
        msg = f"Timed out reaching {spec.get('label')}. Try again."
        field = "base_url" if spec.get("needs_base_url") else "provider"
        return {"ok": False, "message": msg, "fields": {field: msg}}
    except httpx.RequestError:
        msg = (
            f"Could not reach {spec.get('label')}. Check your connection"
            + (" and the base URL." if spec.get("needs_base_url") else ".")
        )
        field = "base_url" if spec.get("needs_base_url") else "provider"
        return {"ok": False, "message": msg, "fields": {field: msg}}


def friendly_llm_error(exc: BaseException, config: LlmConfig) -> str:
    cfg = config.normalized()
    spec = get_company(cfg.provider)
    text = str(exc) or exc.__class__.__name__
    low = text.lower()
    if cfg.provider == "ollama":
        if any(
            s in low
            for s in (
                "connection",
                "refused",
                "connecterror",
                "10061",
                "timed out",
                "timeout",
                "name or service not known",
            )
        ):
            return (
                "Ollama is not running. Install it from https://ollama.com, start it, "
                f"then pull a model: ollama pull {cfg.model}"
            )
        if "not found" in low or "404" in low or "pull" in low:
            return (
                f"Ollama does not have the model '{cfg.model}'. "
                f"In a terminal run: ollama pull {cfg.model}"
            )
    if spec.get("needs_key"):
        if "401" in low or "403" in low or "invalid api" in low or "incorrect api" in low:
            return "The API key was rejected. Check it in Settings."
        if "api key" in low and ("required" in low or "missing" in low):
            return "Add an API key in Settings to use this company."
        if "model" in low and any(
            s in low for s in ("not found", "does not exist", "unknown", "invalid")
        ):
            return "The model selected is not available. Open Settings and choose another."
    return text


def require_ready(config: LlmConfig) -> LlmConfig:
    cfg = config.normalized()
    spec = get_company(cfg.provider)
    if spec.get("needs_key") and not cfg.api_key:
        raise ValueError("Add your API key in Settings before using this company.")
    if spec.get("needs_base_url") and not cfg.base_url:
        raise ValueError(
            "Add the API base URL in Settings (for example https://api.groq.com/openai/v1)."
        )
    return cfg


def _chat_openai(cfg: LlmConfig, temp: float, max_tokens: int):
    from langchain_openai import ChatOpenAI

    spec = get_company(cfg.provider)
    kwargs: Dict[str, Any] = {
        "model": cfg.model,
        "temperature": temp,
        **_token_limit_kwargs(cfg.provider, cfg.model, max_tokens),
    }
    # frequency_penalty is native OpenAI only; other hosts reject it (e.g. Google).
    if _is_native_openai(cfg.provider):
        kwargs["frequency_penalty"] = 0.4
    if cfg.api_key:
        kwargs["api_key"] = cfg.api_key
    if cfg.provider != "openai" and cfg.base_url:
        kwargs["base_url"] = cfg.base_url
    if spec.get("api_style") == "anthropic":
        kwargs["default_headers"] = {
            "anthropic-version": "2023-06-01",
            "x-api-key": cfg.api_key or "",
        }
    try:
        return ChatOpenAI(**kwargs)
    except TypeError:
        kwargs.pop("api_key", None)
        kwargs.pop("base_url", None)
        kwargs.pop("frequency_penalty", None)
        kwargs.pop("max_completion_tokens", None)
        kwargs.pop("default_headers", None)
        if "max_tokens" not in kwargs:
            kwargs["max_tokens"] = max_tokens
        if cfg.api_key:
            kwargs["openai_api_key"] = cfg.api_key
        if cfg.provider != "openai" and cfg.base_url:
            kwargs["openai_api_base"] = cfg.base_url
        return ChatOpenAI(**kwargs)


def get_chat_model(
    config: LlmConfig,
    temperature: float = 0.4,
    language: str = "en",
    response_mode: str = "practical",
):
    cfg = require_ready(config)
    mode = (response_mode or "practical").strip().lower()
    if mode not in MODE_TOKEN_BUDGETS:
        mode = "practical"
    temp = MODE_TEMPERATURES.get(mode, 0.4)
    if temperature is not None and abs(float(temperature) - 0.4) > 0.01:
        temp = max(0.0, min(1.0, float(temperature)))
    max_tokens = output_token_budget(mode, language)
    if cfg.provider == "ollama" and language in ("hi", "gu"):
        temp = max(temp, 0.5)

    if cfg.provider == "ollama":
        try:
            from langchain_community.chat_models import ChatOllama
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("langchain-community is required for Ollama.") from exc
        kwargs = {
            "model": cfg.model,
            "temperature": temp,
            "base_url": cfg.base_url or DEFAULT_OLLAMA_URL,
            "num_predict": max_tokens,
            "repeat_penalty": 1.4 if language in ("hi", "gu") else 1.2,
            "repeat_last_n": 256,
        }
        try:
            return ChatOllama(num_ctx=8192, keep_alive=600, **kwargs)
        except TypeError:
            kwargs.pop("repeat_penalty", None)
            kwargs.pop("repeat_last_n", None)
            try:
                return ChatOllama(**kwargs)
            except TypeError:
                return ChatOllama(
                    model=cfg.model,
                    temperature=temp,
                    base_url=cfg.base_url or DEFAULT_OLLAMA_URL,
                    num_predict=max_tokens,
                )

    return _chat_openai(cfg, temp, max_tokens)
