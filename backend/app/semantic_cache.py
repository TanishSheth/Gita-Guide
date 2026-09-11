"""
Semantic response cache keyed by query embeddings (Chroma collection).
Returns prior answers when cosine similarity >= threshold (default 0.95).
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List, Optional

os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import chromadb
from chromadb.utils import embedding_functions

CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "chroma_store")
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
CACHE_COLLECTION = "gita_semantic_cache_v4"
DEFAULT_THRESHOLD = 0.95

_embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name=EMBEDDING_MODEL_NAME
)
_client = chromadb.PersistentClient(path=CHROMA_PATH)


def _collection():
    return _client.get_or_create_collection(
        name=CACHE_COLLECTION,
        embedding_function=_embedding_fn,
        metadata={"hnsw:space": "cosine"},
    )


def _cache_id(query: str, response_mode: str, language: str, model_key: str) -> str:
    raw = f"{model_key}|{response_mode}|{language}|{query.strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def lookup(
    query: str,
    response_mode: str = "practical",
    language: str = "en",
    threshold: float = DEFAULT_THRESHOLD,
    model_key: str = "ollama:llama3.2",
) -> Optional[Dict[str, Any]]:
    """
    Return {"answer": str, "sources": list, "similarity": float} or None.
    """
    q = (query or "").strip()
    if not q:
        return None
    col = _collection()
    if col.count() == 0:
        return None

    try:
        results = col.query(
            query_texts=[q],
            n_results=min(3, col.count()),
            where={
                "$and": [
                    {"response_mode": {"$eq": response_mode}},
                    {"language": {"$eq": language}},
                    {"model_key": {"$eq": model_key}},
                ]
            },
            include=["documents", "metadatas", "distances"],
        )
    except Exception:
        return None

    metas = (results.get("metadatas") or [[]])[0]
    dists = (results.get("distances") or [[]])[0]
    docs = (results.get("documents") or [[]])[0]
    if not metas:
        return None

    dist = float(dists[0])
    sim = 1.0 - dist
    if sim < threshold:
        return None

    meta = metas[0] or {}
    try:
        sources = json.loads(meta.get("sources_json") or "[]")
    except json.JSONDecodeError:
        sources = []
    answer = docs[0] if docs else meta.get("answer", "")
    return {
        "answer": answer or "",
        "sources": sources,
        "similarity": round(sim, 4),
    }


def store(
    query: str,
    answer: str,
    sources: List[Dict[str, Any]],
    response_mode: str = "practical",
    language: str = "en",
    model_key: str = "ollama:llama3.2",
) -> None:
    q = (query or "").strip()
    if not q or not (answer or "").strip():
        return
    col = _collection()
    cid = _cache_id(q, response_mode, language, model_key)
    slim_sources = []
    for v in sources or []:
        slim_sources.append(
            {
                "chapter": v.get("chapter"),
                "verse": v.get("verse"),
                "sanskrit": v.get("sanskrit", ""),
                "transliteration": v.get("transliteration", ""),
                "english_translation": v.get("english_translation", ""),
                "similarity": v.get("similarity"),
                "translations": v.get("translations") or [],
                "neighbors": v.get("neighbors") or [],
            }
        )
    col.upsert(
        ids=[cid],
        documents=[answer],
        metadatas=[
            {
                "query": q[:2000],
                "response_mode": response_mode,
                "language": language,
                "model_key": model_key,
                "sources_json": json.dumps(slim_sources),
            }
        ],
    )
