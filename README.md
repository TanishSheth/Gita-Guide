# Gita Guide — RAG Philosophical Companion

A full-stack Retrieval-Augmented Generation app that answers life questions using retrieved verses from the Bhagavad Gita.

**Detailed docs**
- [backend/README.md](./backend/README.md) — API, RAG pipeline, database, ingest, every module
- [frontend/README.md](./frontend/README.md) — UI architecture, components, state, themes, panels

**Stack**
- **Backend:** Python, FastAPI, SQLAlchemy (SQLite), ChromaDB, LangChain, sentence-transformers (`all-MiniLM-L6-v2`), OpenAI `gpt-4o-mini`
- **Frontend:** React (Vite), Tailwind CSS

## Features

- Streaming chat answers with verse citations
- Brief / Deep / Practical response modes + answer language (EN / HI / GU / ES)
- HyDE-style query rewrite before retrieval; cross-encoder rerank over top-15 candidates
- Semantic response cache (≥95% embedding similarity) to skip redundant LLM calls
- Telemetry for latency, cache hits, and thumbs feedback (`GET /telemetry/summary`; optional LangSmith)
- Sources panel with multi-translator verse cards, neighboring verses, and Sanskrit TTS play
- Verse explorer (browse by chapter, “Ask about this verse”)
- Chat history: draft chats, search, date filters, delete, bookmarks
- Markdown export of conversations
- Light + dark themes (sage/parchment light; warm charcoal dark)
- Usage meter with a soft limit of **30 chat requests per hour**

## Project layout

```
gita-rag/
  backend/
    app/
      main.py           # FastAPI app + routes
      database.py       # SQLAlchemy engine/session
      models.py         # ORM models
      schemas.py        # Pydantic models
      rag_engine.py     # Query rewrite, embeddings, Chroma, rerank, LLM
      semantic_cache.py # Embedding similarity response cache
    data/
      gita_sample.csv   # Small sample dataset
      merged_gita.csv   # Full merged dataset (after merge step)
    scripts/
      merge_datasets.py # Merge JSON + CSV verse sources
    chroma_store/       # Vector DB (created on ingest)
    gita_chat.db        # SQLite chat DB (created on first run)
    requirements.txt
    .env.example
  frontend/
    src/
      components/
        Sidebar.jsx
        ChatWindow.jsx
        SourcePanel.jsx
      App.jsx
      api.js
      index.css
    package.json
  README.md
```

---

## Prerequisites

Install these before the first-time setup:

| Tool | Notes |
|------|--------|
| **Python 3.11** | Recommended. Python 3.13 can break `chroma-hnswlib` on Windows. |
| **Node.js 18+** | For the Vite frontend (`npm`) |
| **OpenAI API key** | Used by `gpt-4o-mini` in `rag_engine.py` |

---

## First-time setup

Do this once on a new machine (or after a fresh clone).

### 1. Backend: virtualenv + dependencies

```bash
cd backend
python -m venv venv
```

Activate the venv:

```bash
# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# macOS / Linux
source venv/bin/activate
```

Install packages (first install can take several minutes because of PyTorch / sentence-transformers):

```bash
pip install -r requirements.txt
```

### 2. Environment variables

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Edit `backend/.env` and set your key:

```
OPENAI_API_KEY=sk-your-openai-api-key-here
```

### 3. (Optional but recommended) Build the full verse CSV

If you already have `backend/data/merged_gita.csv`, skip this.

To merge [vedicscriptures/bhagavad-gita](https://github.com/vedicscriptures/bhagavad-gita) JSON with a second CSV (e.g. [i8o8i-Developer/Bhagwat-Gita-DataSet](https://github.com/i8o8i-Developer/Bhagwat-Gita-DataSet)):

```bash
cd backend
python scripts/merge_datasets.py \
  --json /path/to/vedicscriptures/bhagavad-gita/slok \
  --csv /path/to/Bhagwat-Gita-DataSet.csv \
  --out data/merged_gita.csv
```

The script:
- Uses Sanskrit + transliteration from the JSON when available
- Combines English translations from both sources (labeled by origin)
- Auto-detects common CSV headers; override with `--csv-map` if needed:

```bash
python scripts/merge_datasets.py \
  --json /path/to/slok \
  --csv /path/to/other.csv \
  --csv-map chapter=Ch,verse=Sl,english=Translation \
  --out data/merged_gita.csv
```

### 4. Start the backend and ingest verses

With the venv still active:

```bash
cd backend
python -m uvicorn app.main:app --port 8000
```

Prefer **without** `--reload` on Windows (the venv file watcher can be noisy). If you want reload:

```bash
python -m uvicorn app.main:app --reload --reload-dir app --port 8000
```

In a **second** terminal (venv active), ingest. Sample dataset:

```bash
curl -X POST http://localhost:8000/ingest
```

Full merged dataset (recommended):

```bash
# Windows PowerShell — if curl upload fails, use Python instead:
cd backend
.\venv\Scripts\python.exe -c "import requests; r=requests.post('http://localhost:8000/ingest', files={'file': open('data/merged_gita.csv','rb')}); print(r.status_code, r.text)"
```

Or with curl:

```bash
curl -X POST http://localhost:8000/ingest -F "file=@data/merged_gita.csv"
```

A successful full ingest reports roughly **700+** verses. Chroma data is stored under `backend/chroma_store/`.

> **Note:** On Windows, `curl` uploads sometimes fail with connection reset. Prefer the Python `requests` one-liner above.

### 5. Frontend: install + run

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

You should see Gita Guide with an empty chat. Ask a question to confirm backend + ingest + API key all work.

---

## After first-time setup (daily use)

You do **not** need to reinstall packages, recreate the venv, or re-ingest (unless you change the dataset).

### 1. Start the backend

```bash
cd backend
.\venv\Scripts\Activate.ps1          # Windows
# source venv/bin/activate           # macOS / Linux

python -m uvicorn app.main:app --port 8000
```

Leave this terminal open. Health check: http://localhost:8000/health

### 2. Start the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**

### 3. Stop

Press `Ctrl+C` in each terminal when you are done.

### When you *do* need to re-ingest

- You replaced or updated `merged_gita.csv` / `gita_sample.csv`
- You deleted `backend/chroma_store/`
- Retrieval returns no sources / “verse not found”

Then start the backend and run the ingest step from First-time setup §4 again.

---

## Access from your phone or another laptop (same Wi‑Fi)

Each time your PC gets a new IP (common on Wi‑Fi), update two files, then start the servers for network access.

### 1. Same network
Phone/laptop and PC must be on the **same Wi‑Fi** (not a guest/isolated network).

### 2. Get this PC’s IPv4 address
Windows (PowerShell):

```powershell
ipconfig
```

Look under your **Wi‑Fi** adapter for **IPv4 Address** (e.g. `10.0.0.158`).

### 3. Update the frontend API URL
In `frontend/src/api.js`:

```js
// Desktop only (this PC):
// const API_BASE = 'http://localhost:8000'

// Phone / other laptop on same Wi‑Fi:
const API_BASE = 'http://YOUR_IP:8000'
```

Example: `const API_BASE = 'http://10.0.0.158:8000'`

### 4. Update backend CORS
In `backend/app/main.py`, add your UI origin to `allow_origins` (same IP, port **5173**):

```python
allow_origins=[
    "http://localhost:5173",
    "http://localhost:3000",
    "http://YOUR_IP:5173",
],
```

Example: `"http://10.0.0.158:5173"`

Restart the backend after changing this file.

### 5. Start both servers (bound to the network)

**Backend** (from `backend/`, venv active):

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Frontend** (from `frontend/`):

```powershell
npm run dev
```

(`vite.config.js` already sets `host: '0.0.0.0'`, so the frontend is reachable on the LAN.)

### 6. Open on the phone / other laptop
In the browser:

```text
http://YOUR_IP:5173
```

Example: `http://10.0.0.158:5173`  
Use **`http://`**, not `https://`.

### 7. Firewall (usually once)
Windows Firewall must allow inbound TCP **5173** and **8000** on private/public networks.  
If the page never loads from another device, run `allow-phone-firewall.ps1` **as Administrator**, or manually allow those ports.

### When you’re back on this PC only
Switch `API_BASE` in `api.js` back to `http://localhost:8000` and open `http://localhost:5173`.

### Checklist if it fails
| Symptom | Likely fix |
|---------|------------|
| Page won’t load | Wrong IP, servers not on `0.0.0.0`, or firewall blocking 5173 |
| Page loads, chat fails | Wrong `API_BASE` or CORS origin missing / backend not restarted |
| Worked yesterday, not today | IP changed — run `ipconfig` and update `api.js` + `main.py` again |

---

## API summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| POST | `/ingest` | Load CSV, embed verses, upsert to ChromaDB |
| GET | `/verses?chapter=N` | List verses for a chapter |
| GET | `/verses/{chapter}/{verse}` | Get one verse |
| GET | `/usage` | Requests this hour + tokens today |
| POST | `/messages/{id}/feedback` | Thumbs up/down on an assistant message |
| POST | `/chats` | Create a new empty chat session |
| GET | `/chats` | List chats (`q`, `since` query params) |
| GET | `/chats/{id}` | Full message history |
| DELETE | `/chats/{id}` | Delete a chat |
| POST | `/chat/{id}` | Non-streaming RAG reply |
| POST | `/chat/{id}/stream` | Streaming SSE RAG reply |

---

## Swapping the LLM

`backend/app/rag_engine.py` uses OpenAI `gpt-4o-mini` via `get_llm()`. To use another provider or a local model, swap that function — retrieval and prompt assembly stay the same.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `chroma-hnswlib` / build errors on install | Use **Python 3.11**, not 3.13 |
| OpenAI / httpx client errors | `requirements.txt` pins `httpx==0.27.2` — reinstall from that file |
| Frontend can’t reach backend | Confirm uvicorn is on port **8000**; check `frontend/src/api.js` |
| Ingest via curl fails on Windows | Use the Python `requests` upload one-liner above |
| No verses in Sources / Explore | Run `/ingest` again with `merged_gita.csv` |
| Rate limit message | Soft cap is 30 chat requests/hour; wait or check Usage in the sidebar |
| `--reload` floods the console | Run without `--reload`, or use `--reload-dir app` |
