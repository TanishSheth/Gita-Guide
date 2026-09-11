"""
Core RAG logic:
  - Query rewrite (HyDE-style standalone search query) via a small LLM call
  - Embeds text with sentence-transformers (all-MiniLM-L6-v2)
  - Stores / queries verses in a local persistent ChromaDB collection
  - Cross-encoder rerank over a larger candidate pool (fallback: hybrid score)
  - Builds a system+history+context prompt and calls the LLM via LangChain
"""
import json
import os
import re
from typing import Any, Dict, Iterator, List, Literal, Optional

os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import chromadb
from chromadb.utils import embedding_functions
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from .llm import LlmConfig, get_chat_model

CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "chroma_store")
COLLECTION_NAME = "bhagavad_gita_verses"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
CANDIDATE_POOL = 15
RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

ResponseMode = Literal["brief", "deep", "practical"]
LanguageCode = Literal["en", "hi", "gu", "es"]

SYSTEM_PROMPT = (
    "{language_instructions}\n\n"
    "You are a wise philosophical guide. Answer the user's life questions "
    "drawing EXCLUSIVELY from the provided retrieved Bhagavad Gita verses. "
    "Do not invent generic self-help scripts, sample dialogues, or advice that "
    "is not grounded in those verses. Do not offer prescriptive medical/legal "
    "advice. Contextualize the ancient wisdom (like Dharma or detachment) for "
    "modern challenges. Base your tone on the conversation history.\n\n"
    "Style rules: Follow the response mode below exactly — modes differ in length, "
    "structure, and depth. Do not mix formats across modes. Give a complete answer "
    "for the selected mode (not a fragment). Never end with a teaser without "
    "delivering what you promised. Lead with the useful insight; do not open with "
    "long essays or restating the question. Avoid filler and repeating the same idea "
    "twice. If prior chat turns used a different mode or length, ignore their format "
    "and match the current mode only. You may use light Markdown (**bold** for labels "
    "only). Finish every list you start.\n\n"
    "Grounding (mandatory): Include at least one inline verse citation from the "
    "retrieved context below. If no retrieved verse supports the answer, say "
    "briefly that the retrieved verses do not directly address this and answer "
    "only from what is provided.\n\n"
    "Citation format (mandatory — use exactly this, every provider):\n"
    "- Write citations as (Chapter N.V) where N = chapter number and V = verse "
    "number — e.g. (Chapter 9.32), (Chapter 2.47), (Chapter 6.17).\n"
    "- When listing points, put the citation inside the bold label: "
    "**Point title (Chapter N.V):** explanation text.\n"
    "- Do NOT use [Chapter N, Verse M], (Chapter N, Verse M), verse ranges "
    "(e.g. 70-71), trailing citations after colons, or 'Action Step' labels.\n"
    "- Cite only PRIMARY verses from the context below. One citation per point "
    "is enough.\n\n"
    "{mode_instructions}\n\n"
    "Retrieved verses are provided in English for your grounding; still write "
    "your final answer in the required output language above.\n"
    "Retrieved verses (your ONLY source of truth for this answer):\n{context}"
)

LANGUAGE_NAMES: Dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "gu": "Gujarati",
    "es": "Spanish",
}

LANGUAGE_INSTRUCTIONS: Dict[str, str] = {
    "en": (
        "OUTPUT LANGUAGE (mandatory): English. Write the entire answer in English."
    ),
    "hi": (
        "OUTPUT LANGUAGE (mandatory): Hindi.\n"
        "- Write the ENTIRE answer body in Hindi using Devanagari script only.\n"
        "- Do not use English sentences (except citation tags).\n"
        "- Keep verse citations exactly as (Chapter N.V).\n"
        "- Write 3–5 distinct points as a complete answer."
    ),
    "gu": (
        "OUTPUT LANGUAGE (mandatory): Gujarati.\n"
        "- Write the ENTIRE answer body in Gujarati using Gujarati script "
        "(e.g. આ, કર્મ, ધર્મ) — not Latin/Roman letters.\n"
        "- Do NOT write Hindi Devanagari (हिन्दी). Gujarati ≠ Hindi.\n"
        "- Do not use English sentences (except citation tags).\n"
        "- Keep verse citations exactly as (Chapter N.V).\n"
        "- Write 3–5 distinct points as a complete answer."
    ),
    "es": (
        "OUTPUT LANGUAGE (mandatory): Spanish.\n"
        "- Write the ENTIRE answer body in Spanish (every sentence).\n"
        "- Do not mix in English paragraphs or English step titles.\n"
        "- Keep verse citations exactly as (Chapter N.V)."
    ),
}

LANGUAGE_LOCK: Dict[str, str] = {
    "en": "Reminder: answer fully in English.",
    "hi": (
        "CRITICAL REMINDER: Your next message must be entirely in Hindi "
        "(Devanagari). Ignore that prior turns may be in English."
    ),
    "gu": (
        "CRITICAL REMINDER: Your next message must be entirely in Gujarati "
        "script (ગુજરાતી). Do not use Hindi Devanagari or English body text. "
        "Ignore that prior turns may be in English. Write each idea once. "
        "Do not loop or copy a previous sentence."
    ),
    "es": (
        "CRITICAL REMINDER: Your next message must be entirely in Spanish. "
        "Do not answer in English. Ignore that prior turns may be in English."
    ),
}

REWRITE_SYSTEM = (
    "You rewrite user questions into standalone English search queries for "
    "retrieving Bhagavad Gita verses from a vector database. "
    "Incorporate relevant context from recent chat turns when the latest "
    "message is vague or referential (e.g. \"tell me more about that\"). "
    "Prefer concrete themes, concepts, and life situations over pronouns. "
    "Output ONLY the search query — no quotes, labels, or preamble."
)

MODE_INSTRUCTIONS: Dict[str, str] = {
    "brief": (
        "Response mode: BRIEF (~120–180 words, hard maximum ~200 words).\n"
        "Structure (mandatory):\n"
        "1) One opening sentence: the core Gita insight with (Chapter N.V).\n"
        "2) Exactly 3 bullet points (one line each): direct answers to the user's "
        "question, each as **Label (Chapter N.V):** one sentence.\n"
        "3) One closing sentence: the key distinction in plain language.\n"
        "Forbidden in BRIEF: numbered step lists longer than 3 items, tables, "
        "ASCII diagrams, scenario scripts, multi-section guides, follow-up questions "
        "('let me know which situation'), references to 'we already covered', "
        "headers like 'Step 1', or content over 200 words."
    ),
    "deep": (
        "Response mode: DEEP (~450–700 words).\n"
        "Structure (mandatory):\n"
        "1) Open with the philosophical tension in the question, grounded in a "
        "retrieved verse (Chapter N.V).\n"
        "2) Write 3–4 short paragraphs unpacking concepts from the verses — what "
        "the teaching means, its nuances, and how it applies to inner life.\n"
        "3) Each paragraph must cite at least one retrieved verse as (Chapter N.V).\n"
        "4) Close with one synthesizing paragraph connecting the teaching to modern "
        "inner life (not a how-to checklist).\n"
        "Forbidden in DEEP: numbered action steps, daily practice toolkits, "
        "scenario A/B scripts, comparison tables, 'here is a framework', or "
        "prescriptive step-by-step guides. This mode is for meaning and wisdom, "
        "not instructions."
    ),
    "practical": (
        "Response mode: PRACTICAL (~250–380 words).\n"
        "Structure (mandatory):\n"
        "1) One framing sentence citing a retrieved verse (Chapter N.V).\n"
        "2) Exactly 4–5 numbered action steps (1. 2. 3. …). Format each as "
        "**Step title (Chapter N.V):** 1–2 sentences of concrete guidance.\n"
        "3) One short example sentence applying a step to a common situation "
        "(work, relationship, or anxiety).\n"
        "Forbidden in PRACTICAL: long philosophical essays, multi-paragraph "
        "conceptual unpacking, comparison tables, ASCII flowcharts, 5+ sections "
        "with sub-headers, or answers longer than ~380 words. Do not ask follow-up "
        "questions — deliver the full step list."
    ),
}

MODE_LOCK: Dict[str, str] = {
    "brief": (
        "MODE LOCK — BRIEF is active. Your reply MUST stay under ~200 words. "
        "Use only: 1 insight sentence + 3 bullets + 1 closing sentence. "
        "Ignore the length and format of any earlier assistant replies in this chat."
    ),
    "deep": (
        "MODE LOCK — DEEP is active. Write a philosophical essay (~450–700 words). "
        "No numbered action steps, toolkits, or scenarios. "
        "Ignore step-list formats from earlier assistant replies in this chat."
    ),
    "practical": (
        "MODE LOCK — PRACTICAL is active. Give 4–5 numbered action steps (~250–380 words). "
        "No long essays or tables. "
        "Ignore essay-style formats from earlier assistant replies in this chat."
    ),
}

_TOKEN_RE = re.compile(r"[a-z0-9']+", re.I)
_TRANSLATION_LABEL_RE = re.compile(
    r"^(?P<label>[^:\n]{1,80}):\s*(?P<body>.+)$", re.S
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[।.!?؟])\s+")
_ADJACENT_REPEAT_RE = re.compile(r"(.{24,160}?)\1+", re.DOTALL)

_embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name=EMBEDDING_MODEL_NAME
)
_client = chromadb.PersistentClient(path=CHROMA_PATH)

_reranker = None
_reranker_failed = False


def get_collection():
    return _client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=_embedding_fn,
        metadata={"hnsw:space": "cosine"},
    )


def _get_reranker():
    """Lazy-load cross-encoder; return None if unavailable."""
    global _reranker, _reranker_failed
    if _reranker_failed:
        return None
    if _reranker is None:
        try:
            from sentence_transformers import CrossEncoder

            _reranker = CrossEncoder(RERANKER_MODEL)
        except Exception:
            _reranker_failed = True
            return None
    return _reranker


def transform_query(
    user_message: str,
    history: Optional[List[Dict[str, str]]] = None,
    llm_config: Optional[LlmConfig] = None,
) -> str:
    """
    HyDE-style preprocessing: rewrite conversational / referential input into a
    standalone English retrieval query before hitting ChromaDB.
    Falls back to the raw message on any failure.
    Local Ollama skips this extra LLM call unless the latest message is a
    short follow-up that needs chat history to make sense.
    """
    raw = (user_message or "").strip()
    if not raw:
        return raw

    hist = history or []
    cfg = llm_config or LlmConfig()
    local = (cfg.provider or "").lower() == "ollama"
    words = raw.split()
    referential = bool(
        re.search(
            r"\b(it|that|this|those|them|more|continue|also|why|how so)\b",
            raw,
            re.I,
        )
    )
    if local and not (hist and (len(words) < 8 or referential)):
        return raw

    # Skip rewrite for already-clear standalone questions with no history
    if not hist and len(words) >= 6:
        return raw

    recent = hist[-6:] if hist else []
    hist_lines = []
    for h in recent:
        role = h.get("role", "user")
        content = (h.get("content") or "")[:400]
        hist_lines.append(f"{role}: {content}")
    hist_block = "\n".join(hist_lines) if hist_lines else "(none)"

    try:
        llm = get_chat_model(llm_config or LlmConfig(), temperature=0, language="en")
        resp = llm.invoke(
            [
                SystemMessage(content=REWRITE_SYSTEM),
                HumanMessage(
                    content=(
                        f"Recent chat history:\n{hist_block}\n\n"
                        f"Latest user message:\n{raw}\n\n"
                        "Standalone search query:"
                    )
                ),
            ]
        )
        rewritten = (getattr(resp, "content", None) or "").strip().strip('"').strip("'")
        return rewritten or raw
    except Exception:
        return raw


def parse_translations(english: str) -> List[Dict[str, str]]:
    """Split labeled translation blocks (Author: text) from merged English text."""
    if not english or not str(english).strip():
        return []
    text = str(english).strip()
    chunks = re.split(r"\n\s*\n", text)
    out: List[Dict[str, str]] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = _TRANSLATION_LABEL_RE.match(chunk)
        if m:
            out.append(
                {"label": m.group("label").strip(), "text": m.group("body").strip()}
            )
        else:
            out.append({"label": "Translation", "text": chunk})
    return out


def _meta_to_verse(meta: Dict[str, Any], similarity: Optional[float] = None) -> Dict[str, Any]:
    english = meta.get("english_translation", "") or ""
    translations = []
    raw_t = meta.get("translations")
    if raw_t:
        try:
            translations = json.loads(raw_t) if isinstance(raw_t, str) else raw_t
        except (json.JSONDecodeError, TypeError):
            translations = []
    if not translations:
        translations = parse_translations(english)

    verse = {
        "chapter": int(meta["chapter"]),
        "verse": int(meta["verse"]),
        "sanskrit": meta.get("sanskrit", "") or "",
        "transliteration": meta.get("transliteration", "") or "",
        "english_translation": english,
        "translations": translations,
    }
    if similarity is not None:
        verse["similarity"] = round(float(similarity), 4)
    return verse


def ingest_verses(rows: List[Dict[str, Any]]) -> int:
    collection = get_collection()
    ids, docs, metadatas = [], [], []
    for row in rows:
        vid = f"{row['chapter']}.{row['verse']}"
        english = str(row["english_translation"])
        translations = parse_translations(english)
        ids.append(vid)
        docs.append(english)
        metadatas.append(
            {
                "chapter": int(row["chapter"]),
                "verse": int(row["verse"]),
                "sanskrit": row.get("sanskrit", ""),
                "transliteration": row.get("transliteration", ""),
                "english_translation": english,
                "translations": json.dumps(translations),
            }
        )
    collection.upsert(ids=ids, documents=docs, metadatas=metadatas)
    return len(ids)


def _tokenize(text: str) -> set:
    return {t.lower() for t in _TOKEN_RE.findall(text or "") if len(t) > 2}


def _lexical_overlap(query: str, doc: str) -> float:
    q = _tokenize(query)
    d = _tokenize(doc)
    if not q or not d:
        return 0.0
    return len(q & d) / len(q)


def get_verse(chapter: int, verse: int) -> Optional[Dict[str, Any]]:
    collection = get_collection()
    vid = f"{chapter}.{verse}"
    try:
        result = collection.get(ids=[vid], include=["metadatas"])
    except Exception:
        return None
    metas = result.get("metadatas") or []
    if not metas or metas[0] is None:
        return None
    return _meta_to_verse(metas[0])


def list_verses_by_chapter(chapter: int) -> List[Dict[str, Any]]:
    collection = get_collection()
    if collection.count() == 0:
        return []
    result = collection.get(
        where={"chapter": {"$eq": int(chapter)}},
        include=["metadatas"],
    )
    verses = []
    for meta in result.get("metadatas") or []:
        if meta:
            verses.append(_meta_to_verse(meta))
    verses.sort(key=lambda v: v["verse"])
    return verses


def _attach_neighbors(primary: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    enriched = []
    for hit in primary:
        neighbors = []
        for nv in (hit["verse"] - 1, hit["verse"] + 1):
            if nv < 1:
                continue
            n = get_verse(hit["chapter"], nv)
            if n:
                neighbors.append(
                    {
                        "chapter": n["chapter"],
                        "verse": n["verse"],
                        "sanskrit": n["sanskrit"],
                        "transliteration": n["transliteration"],
                        "english_translation": n["english_translation"],
                        "translations": n.get("translations", []),
                    }
                )
        enriched.append({**hit, "neighbors": neighbors})
    return enriched


def retrieve_verses(
    query: str,
    top_k: int = 3,
    candidate_pool: int = CANDIDATE_POOL,
    skip_rerank: bool = False,
) -> List[Dict[str, Any]]:
    """
    Vector fetch a larger candidate pool, cross-encoder rerank to top_k,
    then attach ±1 neighbors. Falls back to 0.7*semantic + 0.3*lexical.
    """
    collection = get_collection()
    if collection.count() == 0:
        return []

    fetch_n = min(max(candidate_pool, top_k), collection.count())
    results = collection.query(query_texts=[query], n_results=fetch_n)
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    candidates = []
    for meta, dist in zip(metadatas, distances):
        sim = 1 - dist
        verse = _meta_to_verse(meta, similarity=sim)
        candidates.append(verse)

    if not candidates:
        return []

    reranker = None if skip_rerank else _get_reranker()
    if reranker is not None:
        try:
            pairs = [
                [query, c.get("english_translation", "") or ""] for c in candidates
            ]
            scores = reranker.predict(pairs)
            for verse, score in zip(candidates, scores):
                verse["_score"] = float(score)
        except Exception:
            reranker = None

    if reranker is None:
        for verse in candidates:
            sim = float(verse.get("similarity") or 0.0)
            lex = _lexical_overlap(query, verse.get("english_translation", ""))
            verse["_score"] = 0.7 * sim + 0.3 * lex

    candidates.sort(key=lambda v: v["_score"], reverse=True)
    primary = []
    for v in candidates[:top_k]:
        v.pop("_score", None)
        primary.append(v)

    return _attach_neighbors(primary)


def get_llm(
    temperature: float = 0.4,
    language: str = "en",
    llm_config: Optional[LlmConfig] = None,
    response_mode: str = "practical",
):
    return get_chat_model(
        llm_config or LlmConfig(),
        temperature=temperature,
        language=language,
        response_mode=response_mode,
    )


def format_context(verses: List[Dict[str, Any]], compact: bool = False) -> str:
    if not verses:
        return "No verses were retrieved."
    blocks = []
    for v in verses:
        english = v.get("english_translation") or ""
        if compact and len(english) > 420:
            english = english[:420].rsplit(" ", 1)[0] + "…"
        if compact:
            blocks.append(
                f"PRIMARY [Chapter {v['chapter']}, Verse {v['verse']}]\n"
                f"English: {english}"
            )
            continue
        blocks.append(
            f"PRIMARY [Chapter {v['chapter']}, Verse {v['verse']}]\n"
            f"Transliteration: {v['transliteration']}\n"
            f"English: {english}"
        )
        for n in v.get("neighbors") or []:
            blocks.append(
                f"NEIGHBOR of [Chapter {v['chapter']}, Verse {v['verse']}] "
                f"— [Chapter {n['chapter']}, Verse {n['verse']}]\n"
                f"Transliteration: {n['transliteration']}\n"
                f"English: {n['english_translation']}"
            )
    return "\n\n".join(blocks)


def build_history_messages(history: List[Dict[str, str]]):
    msgs = []
    for h in history:
        if h["role"] == "user":
            msgs.append(HumanMessage(content=h["content"]))
        else:
            msgs.append(AIMessage(content=h["content"]))
    return msgs


def _build_chain_inputs(
    user_message: str,
    retrieved_verses: List[Dict[str, Any]],
    history: List[Dict[str, str]],
    attach_memory_context: bool,
    response_mode: ResponseMode = "practical",
    language: str = "en",
    compact: bool = False,
) -> Dict[str, Any]:
    lang = language if language in LANGUAGE_INSTRUCTIONS else "en"
    lang_name = LANGUAGE_NAMES.get(lang, "English")
    mode_key = response_mode if response_mode in MODE_INSTRUCTIONS else "practical"
    mode = MODE_INSTRUCTIONS[mode_key]
    if compact:
        mode += (
            " Use Markdown in every answer: * for bullet lines, **bold** for labels, "
            "*italic* for emphasis, ++underline++ if needed. Example bullet: "
            "* **Point title (Chapter N.V):** one sentence."
        )
        if mode_key == "brief":
            mode += " Hard cap ~150 words for this local model."
        elif mode_key == "practical":
            mode += (
                " Keep ~250–320 words. Numbered steps must be 1. 2. 3. in order "
                "(never repeat 1.). Put each verse citation as (Chapter N.V) "
                "right after the point it supports."
            )
        elif mode_key == "deep":
            mode += " Keep philosophical; ~400–550 words for this local model."
    mode_lock = MODE_LOCK.get(mode_key, MODE_LOCK["practical"])
    return {
        "context": format_context(retrieved_verses, compact=compact),
        "mode_instructions": mode,
        "mode_lock": mode_lock,
        "language_instructions": LANGUAGE_INSTRUCTIONS[lang],
        "language_lock": LANGUAGE_LOCK[lang],
        "history": build_history_messages(
            history[-4:] if compact and history else history
        )
        if attach_memory_context
        else [],
        "question": (
            f"{user_message}\n\n"
            f"(Write your full answer in {lang_name} only.)"
            if lang != "en"
            else user_message
        ),
    }


def _prompt_template() -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            MessagesPlaceholder("history"),
            # After history so English prior turns cannot override language choice
            ("system", "{language_lock}"),
            ("system", "{mode_lock}"),
            ("human", "{question}"),
        ]
    )


def _norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def collapse_repeated_text(text: str) -> str:
    """Drop consecutive duplicate sentences/paragraphs from a looping generation."""
    if not text:
        return ""
    collapsed = text
    for _ in range(6):
        nxt = _ADJACENT_REPEAT_RE.sub(r"\1", collapsed)
        if nxt == collapsed:
            break
        collapsed = nxt

    paragraphs: List[str] = []
    seen_paras = set()
    for para in re.split(r"\n\s*\n", collapsed.strip()):
        para = para.strip()
        if not para:
            continue
        sentences: List[str] = []
        seen_sents = set()
        chunks = _SENTENCE_SPLIT_RE.split(para) if _SENTENCE_SPLIT_RE.search(para) else [para]
        for sent in chunks:
            sent = sent.strip()
            if not sent:
                continue
            key = _norm_text(sent)
            if key in seen_sents:
                continue
            seen_sents.add(key)
            sentences.append(sent)
        if not sentences:
            continue
        joined = " ".join(sentences)
        key = _norm_text(joined)
        if key in seen_paras:
            continue
        if any(key in prev or prev in key for prev in seen_paras):
            # Later copy of the same idea (often a shorter echo of the first para).
            if any(key == prev or key in prev for prev in seen_paras):
                continue
        seen_paras.add(key)
        paragraphs.append(joined)
    return "\n\n".join(paragraphs).strip()


_CITATION_RE = re.compile(
    r"(?:\[|\()?Chapter\s+\d+(?:\s*,\s*Verse\s+\d+|\.\d+)(?:\]|\))?",
    re.I,
)

# Match any citation variant for normalization → (Chapter N.V)
_CITATION_VARIANT_RE = re.compile(
    r"""
    \[?\(?\b(?:Chapter|Ch\.?)\s+(\d+)\s*            # chapter number
    (?:
        ,\s*Verses?\s+(\d+)(?:\s*[–-]\s*\d+)?       # , Verse M  or range
      | \.(\d+)                                      # .V dot notation
      | [\s:\-–]+(?:Verse\s+)?(\d+)(?:\s*[–-]\s*\d+)?  # space/colon separated
    )
    \)?\]?
    """,
    re.I | re.X,
)


def _canonical_citation(chapter: str, verse: str) -> str:
    return f"(Chapter {int(chapter)}.{int(verse)})"


def normalize_markdown_formatting(text: str) -> str:
    """Standardize markdown from local/cloud models before display."""
    if not text:
        return text
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"\\([*_`\[\]()#+\-.!|{}\\])", r"\1", cleaned)
    cleaned = re.sub(
        r"^[\t ]*"
        r"[\u2022\u2023\u2043\u2219\u25AA\u25CF\u25E6\u00B7\u25CB\u2013\u2014\-]"
        r"[\t ]+",
        "* ",
        cleaned,
        flags=re.MULTILINE,
    )
    cleaned = re.sub(
        r"<(?:strong|b)>\s*(.*?)\s*</(?:strong|b)>",
        r"**\1**",
        cleaned,
        flags=re.I | re.S,
    )
    cleaned = re.sub(
        r"<(?:em|i)>\s*(.*?)\s*</(?:em|i)>",
        r"*\1*",
        cleaned,
        flags=re.I | re.S,
    )
    cleaned = re.sub(
        r"<u>\s*(.*?)\s*</u>",
        r"++\1++",
        cleaned,
        flags=re.I | re.S,
    )
    return cleaned


def normalize_citations(text: str) -> str:
    """Rewrite all citation variants to local-model format: (Chapter N.V)."""
    if not text:
        return text

    def _replace(match: re.Match) -> str:
        chapter = match.group(1)
        verse = match.group(2) or match.group(3) or match.group(4)
        if not verse:
            return match.group(0)
        return _canonical_citation(chapter, verse)

    return _CITATION_VARIANT_RE.sub(_replace, text)


def finalize_answer(streamed: str, processed: str) -> str:
    """Never return a post-processed answer shorter than what was streamed."""
    s = (streamed or "").strip()
    p = (processed or "").strip()
    if not p:
        return s
    if not s:
        return p
    return p if len(p) >= len(s) else s


def is_cacheable_answer(text: str) -> bool:
    """Skip caching truncated or ungrounded replies."""
    t = (text or "").strip()
    if len(t) < 120:
        return False
    if not _CITATION_RE.search(t):
        return False
    if re.search(
        r"(?:here is a step-by-step|here is a guide|follow these steps)\s*[.:]?\s*$",
        t,
        re.I,
    ):
        return False
    return True


def maybe_collapse_repeated_text(text: str) -> str:
    """Only trim loops when the model actually started repeating itself."""
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    if text_has_generation_loop(cleaned):
        return collapse_repeated_text(cleaned)
    return cleaned


def text_has_generation_loop(text: str) -> bool:
    if not text or len(text) < 80:
        return False
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) >= 2:
        last, prev = _norm_text(paras[-1]), _norm_text(paras[-2])
        if last and last == prev and len(last) >= 30:
            return True
        if last and prev and (last in prev or prev in last) and min(len(last), len(prev)) >= 40:
            return True
    for size in (32, 48, 64, 96, 128):
        if len(text) < size * 3:
            continue
        a, b, c = text[-size:], text[-2 * size : -size], text[-3 * size : -2 * size]
        if a.strip() and a == b == c:
            return True
    tail = text[-70:]
    if len(tail.strip()) >= 40 and text.count(tail) >= 3:
        return True
    return False


def generate_answer(
    user_message: str,
    retrieved_verses: List[Dict[str, Any]],
    history: List[Dict[str, str]],
    attach_memory_context: bool,
    response_mode: ResponseMode = "practical",
    temperature: float = 0.4,
    language: str = "en",
    llm_config: Optional[LlmConfig] = None,
) -> str:
    compact = (llm_config.provider if llm_config else "") == "ollama"
    chain = _prompt_template() | get_llm(temperature, language, llm_config, response_mode)
    response = chain.invoke(
        _build_chain_inputs(
            user_message,
            retrieved_verses,
            history,
            attach_memory_context,
            response_mode,
            language,
            compact,
        )
    )
    return finalize_generated_answer(response.content or "")


def finalize_generated_answer(streamed: str) -> str:
    processed = maybe_collapse_repeated_text(streamed)
    processed = normalize_markdown_formatting(processed)
    processed = normalize_citations(processed)
    return finalize_answer(streamed, processed)


def generate_answer_stream(
    user_message: str,
    retrieved_verses: List[Dict[str, Any]],
    history: List[Dict[str, str]],
    attach_memory_context: bool,
    response_mode: ResponseMode = "practical",
    temperature: float = 0.4,
    language: str = "en",
    llm_config: Optional[LlmConfig] = None,
) -> Iterator[str]:
    compact = (llm_config.provider if llm_config else "") == "ollama"
    chain = _prompt_template() | get_llm(temperature, language, llm_config, response_mode)
    buf = ""
    for chunk in chain.stream(
        _build_chain_inputs(
            user_message,
            retrieved_verses,
            history,
            attach_memory_context,
            response_mode,
            language,
            compact,
        )
    ):
        content = getattr(chunk, "content", None)
        if not content:
            continue
        buf += content
        yield content
        # Only cut off local models that loop in long generations.
        if compact and text_has_generation_loop(buf):
            break
