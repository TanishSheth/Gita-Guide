# Gita Guide — Backend

FastAPI service that powers **Gita Guide**: a Retrieval-Augmented Generation (RAG) companion over the Bhagavad Gita. It embeds verses in ChromaDB, retrieves the most relevant passages for a user question, generates grounded answers with OpenAI `gpt-4o-mini`, and persists chat history, feedback, bookmarks, and usage in SQLite.

This document describes **everything** in the `backend/` folder and how the system works end-to-end.

---

## Table of contents

1. [What this service does](#1-what-this-service-does)
2. [Directory layout](#2-directory-layout)
3. [Tech stack](#3-tech-stack)
4. [Prerequisites & environment](#4-prerequisites--environment)
5. [First-time setup](#5-first-time-setup)
6. [Daily run](#6-daily-run)
7. [Dataset merge & ingest](#7-dataset-merge--ingest)
8. [Architecture overview](#8-architecture-overview)
9. [Module reference](#9-module-reference)
10. [Database models](#10-database-models)
11. [API reference](#11-api-reference)
12. [RAG pipeline (detailed)](#12-rag-pipeline-detailed)
13. [Streaming (SSE)](#13-streaming-sse)
14. [Rate limiting & usage](#14-rate-limiting--usage)
15. [CORS](#15-cors)
16. [Dependencies](#16-dependencies)
17. [Operational notes & troubleshooting](#17-operational-notes--troubleshooting)

---

## 1. What this service does

| Concern | Implementation |
|--------|----------------|
| Verse storage & search | ChromaDB + `all-MiniLM-L6-v2` embeddings |
| Answer generation | LangChain + OpenAI `gpt-4o-mini` |
| Chat persistence | SQLite (`gita_chat.db`) via SQLAlchemy |
| Feedback | Thumbs up/down on assistant messages |
| Chat bookmarks | `bookmarked` flag on chat sessions |
| Soft rate limit | 30 chat requests / rolling hour (global) |
| Verse browsing | List/get verses by chapter for Explore UI |

The frontend (Vite/React on `:5173`) talks to this API on `:8000`.

---

## 2. Directory layout

```text
backend/
├── app/
│   ├── main.py           # FastAPI app, all HTTP routes, SSE, rate limit
│   ├── database.py       # SQLAlchemy engine, SessionLocal, get_db
│   ├── models.py         # ORM: ChatSession, ChatMessage, UsageEvent
│   ├── schemas.py        # Pydantic request/response models
│   └── rag_engine.py     # Embeddings, Chroma, retrieval, LLM
├── scripts/
│   └── merge_datasets.py # Merge JSON + CSV → ingestible CSV
├── data/
│   ├── gita_sample.csv   # Small sample for quick /ingest
│   ├── merged_gita.csv   # Full merged corpus (after merge)
│   └── raw/              # Optional source dumps for merging
│       ├── i8o8i_gita.csv
│       └── vedicscriptures_json/slok/…
├── chroma_store/         # Persistent Chroma vector DB (created on ingest)
├── gita_chat.db          # SQLite chat DB (created on first run)
├── requirements.txt
├── .env.example
├── .env                  # Local secrets (do not commit)
├── venv/                 # Local virtualenv (do not commit)
└── README.md             # This file
```

**Working directory:** always start uvicorn from `backend/` so relative paths (`./gita_chat.db`, `data/…`, `chroma_store/`) resolve correctly.

---

## 3. Tech stack

- **Python 3.11** (recommended; 3.13 often breaks `chroma-hnswlib` on Windows)
- **FastAPI** + **Uvicorn**
- **SQLAlchemy 2** + **SQLite**
- **ChromaDB 0.5.x**
- **sentence-transformers** (`all-MiniLM-L6-v2`)
- **LangChain** + **langchain-openai** (`ChatOpenAI`)
- **httpx==0.27.2** (pinned for OpenAI client compatibility)

---

## 4. Prerequisites & environment

### Required

| Item | Notes |
|------|--------|
| Python 3.11 | Create venv with this version |
| OpenAI API key | Used by `gpt-4o-mini` |

### `.env`

Copy from `.env.example`:

```env
# Required for LLM calls in app/rag_engine.py (ChatOpenAI, gpt-4o-mini)
OPENAI_API_KEY=sk-your-openai-api-key-here
```

Loaded via `python-dotenv` when `main.py` imports. No other env vars are currently used (DB path, CORS, model name, and rate limit are hardcoded).

---

## 5. First-time setup

```bash
cd backend
python -m venv venv

# Windows PowerShell
.\venv\Scripts\Activate.ps1

# macOS / Linux
# source venv/bin/activate

pip install -r requirements.txt

# Windows
copy .env.example .env
# macOS / Linux: cp .env.example .env
# Then edit .env and set OPENAI_API_KEY
```

First `pip install` can take several minutes (PyTorch / sentence-transformers).

Build or obtain a verse CSV (see [§7](#7-dataset-merge--ingest)), start the server, then ingest.

---

## 6. Daily run

```bash
cd backend
.\venv\Scripts\Activate.ps1   # or source venv/bin/activate

python -m uvicorn app.main:app --port 8000
```

- Prefer **without** `--reload` on Windows (venv file-watcher noise).
- If you want reload:  
  `python -m uvicorn app.main:app --reload --reload-dir app --port 8000`
- Health check: [http://localhost:8000/health](http://localhost:8000/health)
- Interactive docs: [http://localhost:8000/docs](http://localhost:8000/docs)

You do **not** need to reinstall packages or re-ingest unless the dataset or `chroma_store/` changed.

For LAN / phone access, bind all interfaces:

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 7. Dataset merge & ingest

### Expected CSV columns for `/ingest`

| Column | Required | Description |
|--------|----------|-------------|
| `chapter` | yes | Integer 1–18 |
| `verse` | yes | Verse number within chapter |
| `english_translation` | yes | Text that gets **embedded** |
| `sanskrit` | no | Devanagari |
| `transliteration` | no | Romanized |

Multi-translator English can be stored as blank-line-separated blocks, each optionally starting with `Label: text`. The RAG engine parses these into labeled translation blocks for the UI.

### Sample ingest (no file)

Uses `data/gita_sample.csv`:

```bash
curl -X POST http://localhost:8000/ingest
```

### Full corpus ingest

```bash
curl -X POST http://localhost:8000/ingest -F "file=@data/merged_gita.csv"
```

On Windows, `curl` uploads sometimes fail with connection reset. Prefer Python:

```bash
.\venv\Scripts\python.exe -c "import requests; r=requests.post('http://localhost:8000/ingest', files={'file': open('data/merged_gita.csv','rb')}); print(r.status_code, r.text)"
```

Successful full ingest reports roughly **700+** verses. Vectors live under `chroma_store/`. Document IDs are `{chapter}.{verse}` (re-ingest upserts/replaces).

### Merging two sources (`scripts/merge_datasets.py`)

Combines [vedicscriptures/bhagavad-gita](https://github.com/vedicscriptures/bhagavad-gita)-style JSON (Sanskrit + transliteration + author `et` fields) with a second CSV (e.g. i8o8i dataset):

```bash
python scripts/merge_datasets.py \
  --json data/raw/vedicscriptures_json/slok \
  --csv data/raw/i8o8i_gita.csv \
  --out data/merged_gita.csv
```

| Flag | Meaning |
|------|---------|
| `--json` | File or directory of per-verse JSON |
| `--csv` | Second translation CSV |
| `--out` | Output path (default `data/merged_gita.csv`) |
| `--csv-map` | Optional `chapter=Ch,verse=Sl,english=Translation` overrides |

Behavior:

- Prefers Sanskrit/transliteration from JSON, falls back to CSV.
- Concatenates English from both sources as labeled blocks.
- Auto-detects common header aliases (`Chapter`/`Ch`, `Verse`/`Shlok_No`, `EngMeaning`/`Enlgish Translation`, etc.).
- Skips verses with no English text.

---

## 8. Architecture overview

```text
Client (React)
    │  HTTP / SSE
    ▼
FastAPI (main.py)
    ├── SQLite  ← sessions, messages, feedback, usage
    └── rag_engine.py
            ├── SentenceTransformer embeddings
            ├── ChromaDB (verses)
            └── ChatOpenAI (gpt-4o-mini)
```

**Chat turn (streaming):**

1. Rate-limit check (30 / hour).
2. Stage or load `ChatSession` by client-provided UUID.
3. `retrieve_verses(message, top_k=3)` → primary + ±1 neighbors.
4. Emit SSE `meta` with sources.
5. Stream LLM tokens as SSE `token`.
6. Persist user + assistant messages; auto-title if still `"New Chat"`.
7. Record usage; emit SSE `done` with `assistant_message_id`.

**Draft chats:** `POST /chats` returns an ID but does **not** write to the DB. The frontend often generates its own UUID. The first successful `/chat/{id}/stream` call creates the session row.

---

## 9. Module reference

### `app/database.py`

- `SQLALCHEMY_DATABASE_URL = "sqlite:///./gita_chat.db"`
- `engine` with `check_same_thread=False` (needed for FastAPI + SQLite)
- `SessionLocal`, `Base`
- `get_db()` — FastAPI dependency; yields a session and closes it

### `app/models.py`

| Class | Table | Role |
|-------|-------|------|
| `ChatSession` | `chat_sessions` | One sidebar chat; title, bookmarked, created_at |
| `ChatMessage` | `chat_messages` | user/assistant turns; sources JSON; feedback |
| `UsageEvent` | `usage_events` | Soft metering of chat requests |

Helpers: `gen_id()` → UUID4 string.  
`ChatMessage.sources_list` safely JSON-decodes `sources`.

### `app/schemas.py`

Pydantic v2 models: `TranslationBlock`, `NeighborVerse`, `VerseSource`, `ChatMessageOut`, `ChatSessionOut`, `ChatSessionDetail`, `BookmarkChatRequest`, `ChatRequest`, `ChatResponse`, `FeedbackRequest`, `UsageOut`.

`ChatRequest` fields:

- `message: str`
- `attach_memory_context: bool = True`
- `response_mode: "brief" | "deep" | "practical" = "practical"`
- `temperature: Optional[float] = None` (engine defaults to `0.4`, clamped 0–1)

### `app/rag_engine.py`

See [§12](#12-rag-pipeline-detailed).

### `app/main.py`

- Loads `.env`
- `Base.metadata.create_all()`
- `_ensure_schema()` — adds `feedback` / `bookmarked` columns on older DBs
- CORS middleware
- All routes, SSE helpers, rate limit, persistence

### `scripts/merge_datasets.py`

Standalone CLI; not imported by the API. See [§7](#7-dataset-merge--ingest).

---

## 10. Database models

### `chat_sessions`

| Column | Type | Notes |
|--------|------|--------|
| `id` | String PK | UUID |
| `title` | String | Default `"New Chat"`; auto-set from first message |
| `bookmarked` | Boolean | Default false; used by Saved Chats UI |
| `created_at` | DateTime | UTC |

Relationship: `messages` ordered by `created_at`, cascade delete-orphan on ORM delete of one session.

### `chat_messages`

| Column | Type | Notes |
|--------|------|--------|
| `id` | String PK | UUID |
| `session_id` | FK → chat_sessions | |
| `role` | String | `"user"` \| `"assistant"` |
| `content` | Text | |
| `sources` | Text | JSON list of verse dicts (assistant only) |
| `feedback` | String? | `"up"` \| `"down"` \| null |
| `created_at` | DateTime | |

### `usage_events`

| Column | Type | Notes |
|--------|------|--------|
| `id` | String PK | |
| `kind` | String | Default `"chat"` |
| `tokens_est` | Integer | Rough estimate, not OpenAI usage |
| `created_at` | DateTime | |

### Startup migrations (`_ensure_schema`)

Not Alembic — lightweight SQLite `PRAGMA` + `ALTER TABLE`:

- Add `chat_messages.feedback` if missing
- Add `chat_sessions.bookmarked` if missing

**Note:** `DELETE /chats` (delete all) uses a bulk delete and may leave orphaned messages in SQLite because FK cascades are not enforced the same way as ORM session delete.

---

## 11. API reference

Base URL: `http://localhost:8000`

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{"status":"ok"}` — process up only |

### Ingest & verses

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ingest` | Optional `file` CSV; else sample. Returns `{status, verses_ingested}` |
| GET | `/verses?chapter=N` | `N` ∈ 1–18. List verses for chapter |
| GET | `/verses/{chapter}/{verse}` | One verse; `404` if missing |

### Usage & feedback

| Method | Path | Description |
|--------|------|-------------|
| GET | `/usage` | `{requests_last_hour, limit, tokens_today, remaining}` |
| POST | `/messages/{id}/feedback` | Body `{rating: "up"|"down"|null}` |

### Chats

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chats` | Allocates ID (not persisted until first message) |
| GET | `/chats` | Query: `q`, `since=all\|today\|7d`. Only sessions with messages. Bookmarked first |
| GET | `/chats/{id}` | Full message history + sources |
| PATCH | `/chats/{id}/bookmark` | Body `{bookmarked: bool}` |
| DELETE | `/chats/{id}` | Delete one session (+ ORM cascade messages) |
| DELETE | `/chats` | Delete all sessions |

### Chat (RAG)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/{id}` | Synchronous RAG answer |
| POST | `/chat/{id}/stream` | SSE streaming RAG answer |

Request body (both):

```json
{
  "message": "How do I deal with anxiety?",
  "attach_memory_context": true,
  "response_mode": "practical",
  "temperature": 0.4
}
```

Non-stream response includes `session_id`, `answer`, `sources`, `title`, `assistant_message_id`.

---

## 12. RAG pipeline (detailed)

### Storage

| Setting | Value |
|---------|--------|
| Path | `chroma_store/` |
| Collection | `bhagavad_gita_verses` |
| Distance | Cosine (`hnsw:space = cosine`) |
| Embedding model | `all-MiniLM-L6-v2` |
| Embedded field | `english_translation` only |
| Document ID | `{chapter}.{verse}` |

Metadata per verse: chapter, verse, sanskrit, transliteration, english_translation, JSON translations.

### Retrieval (`retrieve_verses`)

1. If collection empty → `[]`.
2. Vector query up to **8** candidates.
3. Similarity ≈ `1 - distance`.
4. Lexical overlap: tokenize query (len ≥ 3), score intersection / query token count.
5. Combined score: `0.7 * semantic + 0.3 * lexical`.
6. Keep top **`top_k`** (API uses **3**).
7. Attach same-chapter neighbors **verse−1** and **verse+1** when present.

Client-facing `similarity` is semantic (rounded), not the combined rerank score.

### Prompting

- System prompt: answer only from retrieved verses; cite as `[Chapter N, Verse M]`; no medical/legal prescription; concise, modern framing of dharma/detachment.
- Context includes transliteration + English for primaries and neighbors (Sanskrit is stored for UI, not put in LLM context).
- History: LangChain Human/AI messages when `attach_memory_context` is true.

### Response modes (`MODE_INSTRUCTIONS`)

| Mode | Behavior |
|------|----------|
| `brief` | ≤ ~2 short paragraphs or 4 bullets |
| `deep` | Fuller philosophy; capped length |
| `practical` | Short framing + 3–6 concrete steps (**default**) |

### LLM (`get_llm`)

| Setting | Value |
|---------|--------|
| Model | `gpt-4o-mini` |
| Temperature | Default `0.4`, clamped `[0, 1]` |
| Max tokens | `800` |

`generate_answer` / `generate_answer_stream` share the same prompt chain; stream yields token chunks.

---

## 13. Streaming (SSE)

`POST /chat/{chat_id}/stream` returns `text/event-stream`.

Headers set by the app include `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

Event encoding:

```text
event: EVENT_NAME
data: {"…": "json"}

```

| Event | When | Payload (typical) |
|-------|------|-------------------|
| `meta` | Before tokens | `session_id`, `sources` |
| `token` | Each LLM chunk | `{content}` |
| `done` | After persist + usage | `session_id`, `title`, `answer`, `assistant_message_id` |
| `error` | Failure / rate limit | `detail`, optional `code: "rate_limit"` |

The stream handler opens its **own** DB session inside the generator (the request-scoped session would close too early).

---

## 14. Rate limiting & usage

| Setting | Value |
|---------|--------|
| Limit | `RATE_LIMIT_PER_HOUR = 30` |
| Scope | **Global** (no auth / no per-IP key) |
| Window | Rolling last hour of `usage_events` with `kind == "chat"` |
| When counted | After a **successful** completed answer |
| Token estimate | `(len(message) + len(answer)) // 4`, minimum 1 — **not** OpenAI billing tokens |
| Tokens today | Sum of estimates since UTC midnight |

HTTP **429** when exceeded (sync route and stream `error` event).

---

## 15. CORS

Allowed origins:

- `http://localhost:5173`
- `http://localhost:3000`

Credentials, all methods, and all headers allowed. Other origins (e.g. phone via LAN IP) need middleware updates if browsers block them.

---

## 16. Dependencies

From `requirements.txt`:

| Package | Role |
|---------|------|
| `fastapi` | API framework |
| `uvicorn[standard]` | ASGI server |
| `sqlalchemy` | ORM / SQLite |
| `pydantic` | Validation |
| `python-dotenv` | `.env` loading |
| `chromadb` | Vector store |
| `sentence-transformers` | Local embeddings |
| `langchain` / `langchain-openai` | Prompt + LLM chain |
| `langchain-community` | Community extras (available to stack) |
| `openai` | OpenAI client under LangChain |
| `httpx==0.27.2` | **Pinned** — newer httpx breaks this OpenAI/LangChain combo |
| `pandas` | Listed for data tooling; merge script uses stdlib `csv` |
| `python-multipart` | CSV file upload to `/ingest` |

---

## 17. Operational notes & troubleshooting

| Problem | What to try |
|---------|-------------|
| `chroma-hnswlib` build fails | Use Python **3.11**, not 3.13 |
| OpenAI / httpx client errors | Reinstall from `requirements.txt` (httpx pin) |
| Ingest curl fails on Windows | Use the Python `requests` upload one-liner |
| No verses / empty Explore | Run `/ingest` with `merged_gita.csv` |
| Bookmark / feedback 404 | Restart uvicorn so latest `main.py` is loaded |
| Rate limit message | Wait for the rolling hour window; check `GET /usage` |
| Paths / missing `data/` | Run uvicorn from `backend/` |
| `--reload` floods console | Drop `--reload` or use `--reload-dir app` |
| Phone / LAN API | `--host 0.0.0.0` + update frontend `API_BASE` + CORS if needed |

### Swap the LLM

Change `get_llm()` in `rag_engine.py`. Retrieval and prompt assembly stay the same.

### What persists across restarts

- `chroma_store/` — vectors  
- `gita_chat.db` — chats, feedback, bookmarks, usage  
- `.env` — API key  

Re-ingest only after dataset changes or deleting `chroma_store/`.
