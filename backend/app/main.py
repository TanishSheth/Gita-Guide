"""
FastAPI entrypoint for the Bhagavad Gita RAG guide.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
import io
import json
import csv as csv_module
import os
import time
from datetime import datetime, timedelta
from typing import List, Literal, Optional

os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from . import models, schemas, rag_engine, semantic_cache, auth, llm
from .database import engine, get_db, Base, SessionLocal, commit_with_retry

load_dotenv()

RATE_LIMIT_PER_HOUR = 30

Base.metadata.create_all(bind=engine)


def _ensure_schema():
    """Add columns/tables that create_all won't migrate on existing DBs."""
    with engine.begin() as conn:
        msg_cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(chat_messages)")).fetchall()
        }
        if "feedback" not in msg_cols:
            conn.execute(text("ALTER TABLE chat_messages ADD COLUMN feedback VARCHAR"))

        session_cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(chat_sessions)")).fetchall()
        }
        if "bookmarked" not in session_cols:
            conn.execute(
                text(
                    "ALTER TABLE chat_sessions ADD COLUMN bookmarked BOOLEAN DEFAULT 0"
                )
            )
        if "user_id" not in session_cols:
            conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN user_id VARCHAR"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id "
                    "ON chat_sessions (user_id)"
                )
            )

        usage_cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(usage_events)")).fetchall()
        }
        if usage_cols:
            if "latency_ms" not in usage_cols:
                conn.execute(
                    text("ALTER TABLE usage_events ADD COLUMN latency_ms INTEGER")
                )
            if "cached" not in usage_cols:
                conn.execute(
                    text(
                        "ALTER TABLE usage_events ADD COLUMN cached BOOLEAN DEFAULT 0"
                    )
                )
            if "user_id" not in usage_cols:
                conn.execute(text("ALTER TABLE usage_events ADD COLUMN user_id VARCHAR"))
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_usage_events_user_id "
                        "ON usage_events (user_id)"
                    )
                )

        user_cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
        }
        if user_cols:
            if "llm_provider" not in user_cols:
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN llm_provider VARCHAR DEFAULT 'ollama'"
                    )
                )
            if "llm_model" not in user_cols:
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN llm_model VARCHAR DEFAULT 'llama3.2'"
                    )
                )
            if "llm_api_key" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN llm_api_key VARCHAR"))
            if "llm_base_url" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN llm_base_url VARCHAR"))


_ensure_schema()

app = FastAPI(title="Bhagavad Gita RAG Guide")

_allowed_origins_env = os.getenv("CORS_ORIGINS", "")
_custom_origins = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]
_default_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://10.0.0.158:5173",
    "http://10.241.254.84:5173",
    "https://tanishsheth.com",
    "http://tanishsheth.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _custom_origins,
    allow_origin_regex=r"https://.*\.vercel\.app|https://.*\.tanishsheth\.com|https://tanishsheth\.com|https://.*\.hf\.space|https://.*\.onrender\.com|https://.*\.loca\.lt|http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _auto_ingest_startup():
    """Auto-ingest verses on initial container boot if collection is empty."""
    try:
        col = rag_engine.get_collection()
        if col.count() == 0:
            csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "merged_gita.csv")
            if not os.path.exists(csv_path):
                csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "gita_sample.csv")
            if os.path.exists(csv_path):
                with open(csv_path, "r", encoding="utf-8") as f:
                    rows = list(csv_module.DictReader(f))
                if rows:
                    count = rag_engine.ingest_verses(rows)
                    print(f"[startup] Auto-ingested {count} verses into Chroma vector store.")
    except Exception as exc:
        print(f"[startup] Auto-ingest note: {exc}")



def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _auto_title(message: str) -> str:
    return (message[:40] + "…") if len(message) > 40 else message


def _get_or_stage_session(
    chat_id: str, db: Session, user: models.User
) -> models.ChatSession:
    session = db.query(models.ChatSession).filter_by(id=chat_id).first()
    if session:
        if session.user_id and session.user_id != user.id:
            raise HTTPException(404, "Chat session not found")
        if not session.user_id:
            session.user_id = user.id
        return session
    session = models.ChatSession(id=chat_id, title="New Chat", user_id=user.id)
    db.add(session)
    return session


def _owned_session(chat_id: str, db: Session, user: models.User) -> models.ChatSession:
    session = (
        db.query(models.ChatSession)
        .filter_by(id=chat_id, user_id=user.id)
        .first()
    )
    if not session:
        raise HTTPException(404, "Chat session not found")
    return session


def _user_out(user: models.User) -> schemas.UserOut:
    cfg = llm.config_from_user(user)
    return schemas.UserOut(
        id=user.id,
        email=user.email,
        name=user.name or "",
        llm_provider=cfg.provider,
        llm_model=cfg.model,
        llm_base_url=(
            (user.llm_base_url or cfg.base_url)
            if cfg.provider in ("custom", "ollama")
            else None
        ),
        has_api_key=bool(user.llm_api_key),
        api_key_hint=llm.mask_api_key(user.llm_api_key),
    )


def _llm_config(user: models.User) -> llm.LlmConfig:
    return llm.config_from_user(user)


def _auth_response(
    token: str, remember: bool, user: models.User
) -> schemas.AuthResponse:
    return schemas.AuthResponse(
        token=token,
        remember=remember,
        idle_minutes=auth.IDLE_TIMEOUT_MINUTES,
        user=_user_out(user),
    )


def _verse_to_schema(v: dict) -> schemas.VerseSource:
    return schemas.VerseSource(
        chapter=v["chapter"],
        verse=v["verse"],
        sanskrit=v.get("sanskrit", ""),
        transliteration=v.get("transliteration", ""),
        english_translation=v.get("english_translation", ""),
        similarity=v.get("similarity"),
        translations=[
            schemas.TranslationBlock(**t) for t in (v.get("translations") or [])
        ],
        neighbors=[
            schemas.NeighborVerse(
                chapter=n["chapter"],
                verse=n["verse"],
                sanskrit=n.get("sanskrit", ""),
                transliteration=n.get("transliteration", ""),
                english_translation=n.get("english_translation", ""),
                translations=[
                    schemas.TranslationBlock(**t)
                    for t in (n.get("translations") or [])
                ],
            )
            for n in (v.get("neighbors") or [])
        ],
    )


def _sources_for_client(retrieved: list) -> list:
    """Strip heavy neighbor nests for SSE JSON size; keep translations."""
    out = []
    for v in retrieved:
        item = {
            "chapter": v["chapter"],
            "verse": v["verse"],
            "sanskrit": v.get("sanskrit", ""),
            "transliteration": v.get("transliteration", ""),
            "english_translation": v.get("english_translation", ""),
            "similarity": v.get("similarity"),
            "translations": v.get("translations") or [],
            "neighbors": [
                {
                    "chapter": n["chapter"],
                    "verse": n["verse"],
                    "sanskrit": n.get("sanskrit", ""),
                    "transliteration": n.get("transliteration", ""),
                    "english_translation": n.get("english_translation", ""),
                    "translations": n.get("translations") or [],
                }
                for n in (v.get("neighbors") or [])
            ],
        }
        out.append(item)
    return out


def _persist_turn(
    session: models.ChatSession,
    message: str,
    answer: str,
    retrieved: list,
    db: Session,
) -> tuple[str, str]:
    user_msg = models.ChatMessage(
        session_id=session.id, role="user", content=message, sources="[]"
    )
    ai_msg = models.ChatMessage(
        session_id=session.id,
        role="assistant",
        content=answer,
        sources=json.dumps(_sources_for_client(retrieved)),
    )
    db.add(user_msg)
    db.add(ai_msg)
    if session.title == "New Chat":
        session.title = _auto_title(message)
    commit_with_retry(db)
    db.refresh(ai_msg)
    return session.title, ai_msg.id


def _requests_last_hour(db: Session, user_id: Optional[str] = None) -> int:
    since = datetime.utcnow() - timedelta(hours=1)
    query = db.query(models.UsageEvent).filter(
        models.UsageEvent.kind == "chat",
        models.UsageEvent.created_at >= since,
    )
    if user_id:
        query = query.filter(models.UsageEvent.user_id == user_id)
    return query.count()


def _tokens_today(db: Session, user_id: Optional[str] = None) -> int:
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    query = db.query(models.UsageEvent).filter(
        models.UsageEvent.kind == "chat",
        models.UsageEvent.created_at >= start,
    )
    if user_id:
        query = query.filter(models.UsageEvent.user_id == user_id)
    rows = query.all()
    return sum(r.tokens_est or 0 for r in rows)


def _check_rate_limit(db: Session, user_id: Optional[str] = None):
    used = _requests_last_hour(db, user_id)
    if used >= RATE_LIMIT_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit reached: {RATE_LIMIT_PER_HOUR} chat requests per hour. "
                "Please wait before asking again."
            ),
        )


def _record_usage(
    db: Session,
    message: str,
    answer: str,
    *,
    user_id: Optional[str] = None,
    latency_ms: Optional[int] = None,
    cached: bool = False,
    detail: Optional[dict] = None,
    message_id: Optional[str] = None,
    kind: Optional[str] = None,
):
    tokens_est = max(1, (len(message) + len(answer)) // 4)
    event_kind = kind or ("cache_hit" if cached else "chat")
    db.add(
        models.UsageEvent(
            user_id=user_id,
            kind="chat",
            tokens_est=tokens_est if not cached else max(1, tokens_est // 20),
            latency_ms=latency_ms,
            cached=cached,
        )
    )
    db.add(
        models.TelemetryEvent(
            kind=event_kind,
            message_id=message_id,
            latency_ms=latency_ms,
            tokens_est=tokens_est if not cached else 0,
            cached=cached,
            detail=json.dumps(detail or {}),
        )
    )
    commit_with_retry(db)


def _usage_payload(db: Session, user_id: Optional[str] = None) -> schemas.UsageOut:
    used = _requests_last_hour(db, user_id)
    return schemas.UsageOut(
        requests_last_hour=used,
        limit=RATE_LIMIT_PER_HOUR,
        tokens_today=_tokens_today(db, user_id),
        remaining=max(0, RATE_LIMIT_PER_HOUR - used),
    )


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
@app.post("/auth/register", response_model=schemas.AuthResponse)
def register(req: schemas.RegisterRequest, db: Session = Depends(get_db)):
    auth.validate_password(req.password)
    email = auth.normalize_email(str(req.email))
    existing = db.query(models.User).filter_by(email=email).first()
    if existing:
        raise HTTPException(409, "An account with this email already exists.")
    name = (req.name or "").strip()[:80]
    user = models.User(
        email=email,
        name=name,
        password_hash=auth.hash_password(req.password),
        llm_provider=llm.DEFAULT_PROVIDER,
        llm_model=llm.pick_default_ollama_model(),
    )
    db.add(user)
    commit_with_retry(db)
    db.refresh(user)
    token, _ = auth.create_auth_session(db, user, remember=False)
    return _auth_response(token, False, user)


@app.post("/auth/login", response_model=schemas.AuthResponse)
def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    email = auth.normalize_email(str(req.email))
    user = db.query(models.User).filter_by(email=email).first()
    if not user or not auth.verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password.")
    token, _ = auth.create_auth_session(db, user, remember=bool(req.remember))
    return _auth_response(token, bool(req.remember), user)


@app.post("/auth/logout")
def logout(
    creds: Optional[auth.HTTPAuthorizationCredentials] = Depends(auth.bearer_scheme),
    db: Session = Depends(get_db),
):
    if creds and creds.credentials:
        session = auth.get_auth_session(db, creds.credentials)
        if session:
            auth.revoke_auth_session(db, session)
    return {"status": "ok"}


@app.get("/auth/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(auth.get_current_user)):
    return _user_out(user)


@app.get("/llm/status", response_model=schemas.LlmStatusOut)
def llm_status(user: models.User = Depends(auth.get_current_user)):
    return llm.status_payload(user)


@app.patch("/auth/llm", response_model=schemas.UserOut)
def update_llm_settings(
    req: schemas.LlmSettingsUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    provider = (req.llm_provider or "").strip().lower()
    if provider not in llm.COMPANY_BY_ID:
        raise HTTPException(
            400,
            {
                "message": "Choose a company from the list.",
                "fields": {"provider": "Choose a company from the list."},
            },
        )
    model = (req.llm_model or "").strip()
    if not model:
        raise HTTPException(
            400,
            {
                "message": "Choose or type a model name.",
                "fields": {"model": "Choose or type a model name."},
            },
        )
    spec = llm.get_company(provider)
    base = (req.llm_base_url or "").strip().rstrip("/") or None
    if not spec.get("needs_base_url") and provider != "ollama":
        base = None
    if req.clear_api_key:
        key_to_use = None
    elif req.api_key is not None and req.api_key.strip():
        key_to_use = req.api_key.strip()
    else:
        key_to_use = user.llm_api_key

    probe = llm.probe_llm_config(
        llm.LlmConfig(
            provider=provider,
            model=model,
            api_key=key_to_use,
            base_url=base,
        )
    )
    if not probe.get("ok"):
        raise HTTPException(400, probe)

    user.llm_provider = provider
    user.llm_model = model[:120]
    user.llm_base_url = base if provider in ("custom", "ollama") else None
    if req.clear_api_key:
        user.llm_api_key = None
    elif req.api_key is not None and req.api_key.strip():
        user.llm_api_key = req.api_key.strip()
    commit_with_retry(db)
    db.refresh(user)
    return _user_out(user)


@app.post("/auth/forgot-password", response_model=schemas.ForgotPasswordResponse)
def forgot_password(req: schemas.ForgotPasswordRequest, db: Session = Depends(get_db)):
    generic = (
        "If that email is registered, you can reset the password with the link we sent."
    )
    email = auth.normalize_email(str(req.email))
    user = db.query(models.User).filter_by(email=email).first()
    if not user:
        return schemas.ForgotPasswordResponse(
            status="ok", message=generic, emailed=False
        )
    raw = auth.create_password_reset(db, user)
    url = auth.reset_url_for_token(raw)
    emailed = auth.send_reset_email(user.email, url)
    # When SMTP is not configured, return the one-time link so local/dev still works.
    return schemas.ForgotPasswordResponse(
        status="ok",
        message=generic if emailed else "Use the reset link below. It expires soon.",
        emailed=emailed,
        reset_url=None if emailed else url,
    )


@app.post("/auth/reset-password", response_model=schemas.AuthResponse)
def reset_password(req: schemas.ResetPasswordRequest, db: Session = Depends(get_db)):
    auth.validate_password(req.password)
    user = auth.consume_password_reset(db, req.token)
    user.password_hash = auth.hash_password(req.password)
    db.query(models.AuthSession).filter_by(user_id=user.id).delete()
    commit_with_retry(db)
    db.refresh(user)
    token, _ = auth.create_auth_session(db, user, remember=False)
    return _auth_response(token, False, user)


# --------------------------------------------------------------------------
# Ingestion
# --------------------------------------------------------------------------
@app.post("/ingest")
def ingest(file: UploadFile | None = File(default=None)):
    if file is not None:
        raw = file.file.read().decode("utf-8")
    else:
        with open("data/gita_sample.csv", "r", encoding="utf-8") as f:
            raw = f.read()

    reader = csv_module.DictReader(io.StringIO(raw))
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "CSV contained no rows.")

    count = rag_engine.ingest_verses(rows)
    return {"status": "ok", "verses_ingested": count}


# --------------------------------------------------------------------------
# Verses explorer
# --------------------------------------------------------------------------
@app.get("/verses", response_model=List[schemas.VerseSource])
def list_verses(
    chapter: int = Query(..., ge=1, le=18),
    _user: models.User = Depends(auth.get_current_user),
):
    verses = rag_engine.list_verses_by_chapter(chapter)
    return [_verse_to_schema(v) for v in verses]


@app.get("/verses/{chapter}/{verse}", response_model=schemas.VerseSource)
def get_verse(
    chapter: int,
    verse: int,
    _user: models.User = Depends(auth.get_current_user),
):
    v = rag_engine.get_verse(chapter, verse)
    if not v:
        raise HTTPException(404, "Verse not found. Has the dataset been ingested?")
    return _verse_to_schema(v)


# --------------------------------------------------------------------------
# Usage
# --------------------------------------------------------------------------
@app.get("/usage", response_model=schemas.UsageOut)
def get_usage(
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    return _usage_payload(db, user.id)


@app.get("/telemetry/summary", response_model=schemas.TelemetrySummary)
def telemetry_summary(
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user),
):
    """Aggregate latency / cache / feedback signals for offline eval (Ragas, etc.)."""
    rows = db.query(models.TelemetryEvent).all()
    chat_events = sum(1 for r in rows if r.kind == "chat")
    cache_hits = sum(1 for r in rows if r.kind == "cache_hit" or r.cached)
    feedback_up = 0
    feedback_down = 0
    latencies = []
    for r in rows:
        if r.latency_ms is not None and r.kind in ("chat", "cache_hit"):
            latencies.append(r.latency_ms)
        if r.kind == "feedback":
            try:
                detail = json.loads(r.detail or "{}")
            except json.JSONDecodeError:
                detail = {}
            rating = detail.get("rating")
            if rating == "up":
                feedback_up += 1
            elif rating == "down":
                feedback_down += 1
    avg = round(sum(latencies) / len(latencies), 1) if latencies else None
    return schemas.TelemetrySummary(
        chat_events=chat_events,
        cache_hits=cache_hits,
        feedback_up=feedback_up,
        feedback_down=feedback_down,
        avg_latency_ms=avg,
        tokens_today=_tokens_today(db),
    )


# --------------------------------------------------------------------------
# Feedback
# --------------------------------------------------------------------------
@app.post("/messages/{message_id}/feedback")
def set_feedback(
    message_id: str,
    req: schemas.FeedbackRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    msg = db.query(models.ChatMessage).filter_by(id=message_id).first()
    if not msg:
        raise HTTPException(404, "Message not found")
    session = (
        db.query(models.ChatSession)
        .filter_by(id=msg.session_id, user_id=user.id)
        .first()
    )
    if not session:
        raise HTTPException(404, "Message not found")
    if msg.role != "assistant":
        raise HTTPException(400, "Feedback is only allowed on assistant messages")
    msg.feedback = req.rating
    db.add(
        models.TelemetryEvent(
            kind="feedback",
            message_id=message_id,
            detail=json.dumps({"rating": req.rating}),
        )
    )
    commit_with_retry(db)
    return {"status": "ok", "message_id": message_id, "feedback": msg.feedback}


# --------------------------------------------------------------------------
# Chat session management
# --------------------------------------------------------------------------
@app.post("/chats", response_model=schemas.ChatSessionOut)
def create_chat(_user: models.User = Depends(auth.get_current_user)):
    return schemas.ChatSessionOut(
        id=models.gen_id(),
        title="New Chat",
        created_at=datetime.utcnow(),
        bookmarked=False,
    )


@app.get("/chats", response_model=List[schemas.ChatSessionOut])
def list_chats(
    q: Optional[str] = Query(default=None),
    since: Literal["all", "today", "7d"] = Query(default="all"),
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.ChatSession).filter(
        models.ChatSession.user_id == user.id,
        models.ChatSession.messages.any(),
    )

    if since == "today":
        start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(models.ChatSession.created_at >= start)
    elif since == "7d":
        query = query.filter(
            models.ChatSession.created_at >= datetime.utcnow() - timedelta(days=7)
        )

    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                models.ChatSession.title.ilike(term),
                models.ChatSession.messages.any(models.ChatMessage.content.ilike(term)),
            )
        )

    return (
        query.distinct()
        .order_by(
            models.ChatSession.bookmarked.desc(),
            models.ChatSession.created_at.desc(),
        )
        .all()
    )


@app.patch("/chats/{chat_id}/bookmark", response_model=schemas.ChatSessionOut)
def set_chat_bookmark(
    chat_id: str,
    req: schemas.BookmarkChatRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    session = _owned_session(chat_id, db, user)
    session.bookmarked = bool(req.bookmarked)
    commit_with_retry(db)
    db.refresh(session)
    return session


@app.get("/chats/{chat_id}", response_model=schemas.ChatSessionDetail)
def get_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    session = _owned_session(chat_id, db, user)

    out_messages = []
    for m in session.messages:
        out_messages.append(
            schemas.ChatMessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                sources=m.sources_list,
                feedback=m.feedback,
                created_at=m.created_at,
            )
        )
    return schemas.ChatSessionDetail(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        bookmarked=bool(session.bookmarked),
        messages=out_messages,
    )


@app.delete("/chats/{chat_id}")
def delete_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    session = _owned_session(chat_id, db, user)
    db.delete(session)
    commit_with_retry(db)
    return {"status": "deleted"}


@app.delete("/chats")
def delete_all_chats(
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    count = (
        db.query(models.ChatSession)
        .filter(models.ChatSession.user_id == user.id)
        .delete()
    )
    commit_with_retry(db)
    return {"status": "deleted", "count": count}


# --------------------------------------------------------------------------
# Core RAG chat endpoint
# --------------------------------------------------------------------------
@app.post("/chat/{chat_id}", response_model=schemas.ChatResponse)
def chat(
    chat_id: str,
    req: schemas.ChatRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    _check_rate_limit(db, user.id)
    session = _get_or_stage_session(chat_id, db, user)
    t0 = time.perf_counter()
    try:
        llm_cfg = llm.require_ready(_llm_config(user))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    model_key = llm_cfg.cache_key()

    history = [{"role": m.role, "content": m.content} for m in session.messages]
    search_query = rag_engine.transform_query(
        req.message, history, llm_config=llm_cfg
    )
    language = req.language or "en"

    cached = semantic_cache.lookup(
        search_query,
        response_mode=req.response_mode,
        language=language,
        model_key=model_key,
    )
    if cached:
        retrieved = cached["sources"]
        answer = cached["answer"]
        title, assistant_id = _persist_turn(session, req.message, answer, retrieved, db)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        _record_usage(
            db,
            req.message,
            answer,
            user_id=user.id,
            latency_ms=latency_ms,
            cached=True,
            message_id=assistant_id,
            detail={
                "search_query": search_query,
                "cache_similarity": cached.get("similarity"),
                "response_mode": req.response_mode,
                "language": language,
            },
        )
        return schemas.ChatResponse(
            session_id=session.id,
            answer=answer,
            sources=[_verse_to_schema(v) for v in retrieved],
            title=title,
            assistant_message_id=assistant_id,
        )

    retrieved = rag_engine.retrieve_verses(
        search_query,
        top_k=3,
        candidate_pool=10 if llm_cfg.provider == "ollama" else 15,
        skip_rerank=False,
    )
    try:
        answer = rag_engine.generate_answer(
            user_message=req.message,
            retrieved_verses=retrieved,
            history=history,
            attach_memory_context=req.attach_memory_context,
            response_mode=req.response_mode,
            temperature=0.4 if req.temperature is None else req.temperature,
            language=language,
            llm_config=llm_cfg,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, llm.friendly_llm_error(exc, llm_cfg)) from exc
    try:
        if rag_engine.is_cacheable_answer(answer):
            semantic_cache.store(
                search_query,
                answer,
                retrieved,
                response_mode=req.response_mode,
                language=language,
                model_key=model_key,
            )
    except Exception:
        pass

    title, assistant_id = _persist_turn(session, req.message, answer, retrieved, db)
    latency_ms = int((time.perf_counter() - t0) * 1000)
    _record_usage(
        db,
        req.message,
        answer,
        user_id=user.id,
        latency_ms=latency_ms,
        cached=False,
        message_id=assistant_id,
        detail={
            "search_query": search_query,
            "response_mode": req.response_mode,
            "language": language,
            "source_count": len(retrieved),
        },
    )

    return schemas.ChatResponse(
        session_id=session.id,
        answer=answer,
        sources=[_verse_to_schema(v) for v in retrieved],
        title=title,
        assistant_message_id=assistant_id,
    )


@app.post("/chat/{chat_id}/stream")
def chat_stream(
    chat_id: str,
    req: schemas.ChatRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    _check_rate_limit(db, user.id)
    t0 = time.perf_counter()
    user_id = user.id

    existing = db.query(models.ChatSession).filter_by(id=chat_id).first()
    if existing and existing.user_id and existing.user_id != user_id:
        raise HTTPException(404, "Chat session not found")
    try:
        llm_cfg = llm.require_ready(_llm_config(user))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    model_key = llm_cfg.cache_key()
    history = (
        [{"role": m.role, "content": m.content} for m in existing.messages]
        if existing
        else []
    )

    search_query = rag_engine.transform_query(
        req.message, history, llm_config=llm_cfg
    )
    language = req.language or "en"
    message = req.message
    attach_memory = req.attach_memory_context
    response_mode = req.response_mode
    temperature = 0.4 if req.temperature is None else req.temperature

    cached = semantic_cache.lookup(
        search_query,
        response_mode=response_mode,
        language=language,
        model_key=model_key,
    )
    if cached:
        retrieved = cached["sources"]
        sources_payload = _sources_for_client(retrieved)
        answer = cached["answer"]
        cache_sim = cached.get("similarity")

        def cached_generator():
            local_db = SessionLocal()
            try:
                if _requests_last_hour(local_db, user_id) >= RATE_LIMIT_PER_HOUR:
                    yield _sse(
                        "error",
                        {
                            "detail": (
                                f"Rate limit reached: {RATE_LIMIT_PER_HOUR} chat "
                                "requests per hour. Please wait before asking again."
                            ),
                            "code": "rate_limit",
                        },
                    )
                    return
                owner = local_db.query(models.User).filter_by(id=user_id).first()
                if not owner:
                    yield _sse("error", {"detail": "Please sign in to continue."})
                    return
                session = _get_or_stage_session(chat_id, local_db, owner)
                yield _sse(
                    "meta",
                    {
                        "session_id": session.id,
                        "sources": sources_payload,
                        "search_query": search_query,
                        "cache_hit": True,
                        "cache_similarity": cache_sim,
                    },
                )
                yield _sse("token", {"content": answer})
                title, assistant_id = _persist_turn(
                    session, message, answer, retrieved, local_db
                )
                latency_ms = int((time.perf_counter() - t0) * 1000)
                _record_usage(
                    local_db,
                    message,
                    answer,
                    user_id=user_id,
                    latency_ms=latency_ms,
                    cached=True,
                    message_id=assistant_id,
                    detail={
                        "search_query": search_query,
                        "cache_similarity": cache_sim,
                        "response_mode": response_mode,
                        "language": language,
                    },
                )
                yield _sse(
                    "done",
                    {
                        "session_id": session.id,
                        "title": title,
                        "answer": answer,
                        "assistant_message_id": assistant_id,
                        "cache_hit": True,
                        "latency_ms": latency_ms,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                local_db.rollback()
                yield _sse("error", {"detail": llm.friendly_llm_error(exc, llm_cfg)})
            finally:
                local_db.close()

        return StreamingResponse(
            cached_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    retrieved = rag_engine.retrieve_verses(
        search_query,
        top_k=3,
        candidate_pool=10 if llm_cfg.provider == "ollama" else 15,
        skip_rerank=False,
    )
    sources_payload = _sources_for_client(retrieved)

    def event_generator():
        answer_parts: list[str] = []
        local_db = SessionLocal()
        try:
            if _requests_last_hour(local_db, user_id) >= RATE_LIMIT_PER_HOUR:
                yield _sse(
                    "error",
                    {
                        "detail": (
                            f"Rate limit reached: {RATE_LIMIT_PER_HOUR} chat "
                            "requests per hour. Please wait before asking again."
                        ),
                        "code": "rate_limit",
                    },
                )
                return
            owner = local_db.query(models.User).filter_by(id=user_id).first()
            if not owner:
                yield _sse("error", {"detail": "Please sign in to continue."})
                return
            session = _get_or_stage_session(chat_id, local_db, owner)
            commit_with_retry(local_db)
            session_id = session.id
        except Exception as exc:  # noqa: BLE001
            local_db.rollback()
            yield _sse("error", {"detail": llm.friendly_llm_error(exc, llm_cfg)})
            return
        finally:
            local_db.close()

        yield _sse(
            "meta",
            {
                "session_id": session_id,
                "sources": sources_payload,
                "search_query": search_query,
                "cache_hit": False,
            },
        )
        try:
            for token in rag_engine.generate_answer_stream(
                user_message=message,
                retrieved_verses=retrieved,
                history=history,
                attach_memory_context=attach_memory,
                response_mode=response_mode,
                temperature=temperature,
                language=language,
                llm_config=llm_cfg,
            ):
                answer_parts.append(token)
                yield _sse("token", {"content": token})
        except Exception as exc:  # noqa: BLE001
            yield _sse("error", {"detail": llm.friendly_llm_error(exc, llm_cfg)})
            return

        streamed = "".join(answer_parts)
        answer = rag_engine.finalize_generated_answer(streamed)
        try:
            if rag_engine.is_cacheable_answer(answer):
                semantic_cache.store(
                    search_query,
                    answer,
                    retrieved,
                    response_mode=response_mode,
                    language=language,
                    model_key=model_key,
                )
        except Exception:
            pass

        local_db = SessionLocal()
        try:
            owner = local_db.query(models.User).filter_by(id=user_id).first()
            if not owner:
                yield _sse("error", {"detail": "Please sign in to continue."})
                return
            session = _get_or_stage_session(chat_id, local_db, owner)
            title, assistant_id = _persist_turn(
                session, message, answer, retrieved, local_db
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
            _record_usage(
                local_db,
                message,
                answer,
                user_id=user_id,
                latency_ms=latency_ms,
                cached=False,
                message_id=assistant_id,
                detail={
                    "search_query": search_query,
                    "response_mode": response_mode,
                    "language": language,
                    "source_count": len(retrieved),
                },
            )
            yield _sse(
                "done",
                {
                    "session_id": session.id,
                    "title": title,
                    "answer": answer,
                    "assistant_message_id": assistant_id,
                    "cache_hit": False,
                    "latency_ms": latency_ms,
                },
            )
        except Exception as exc:  # noqa: BLE001
            local_db.rollback()
            yield _sse("error", {"detail": llm.friendly_llm_error(exc, llm_cfg)})
        finally:
            local_db.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/")
def root():
    return {
        "name": "Bhagavad Gita RAG Guide",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
        "ui": "http://localhost:5173",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
