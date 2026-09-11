"""
ORM models: a ChatSession (one row per "saved chat" in the sidebar) that
owns many ChatMessages (user + assistant turns, plus the retrieved sources
for assistant turns, stored as JSON text).
"""
import uuid
import json
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, Boolean
from sqlalchemy.orm import relationship

from .database import Base


def gen_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, default="")
    password_hash = Column(String, nullable=False)
    llm_provider = Column(String, default="ollama")
    llm_model = Column(String, default="llama3.2")
    llm_api_key = Column(String, nullable=True)
    llm_base_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    auth_sessions = relationship(
        "AuthSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    chats = relationship("ChatSession", back_populates="user")


class AuthSession(Base):
    """Server-side session so logout / idle timeout can revoke access immediately."""

    __tablename__ = "auth_sessions"

    id = Column(String, primary_key=True, default=gen_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    remember = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="auth_sessions")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(String, primary_key=True, default=gen_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, default=gen_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String, default="New Chat")
    bookmarked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="chats")
    messages = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=gen_id)
    session_id = Column(String, ForeignKey("chat_sessions.id"))
    role = Column(String)  # "user" | "assistant"
    content = Column(Text)
    # JSON-encoded list of retrieved verse dicts (only populated for
    # assistant messages so the Right Panel can be rehydrated on chat load)
    sources = Column(Text, default="[]")
    feedback = Column(String, nullable=True)  # "up" | "down" | None
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")

    @property
    def sources_list(self):
        try:
            return json.loads(self.sources or "[]")
        except json.JSONDecodeError:
            return []


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id = Column(String, primary_key=True, default=gen_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    kind = Column(String, default="chat")  # chat
    tokens_est = Column(Integer, default=0)
    latency_ms = Column(Integer, nullable=True)
    cached = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TelemetryEvent(Base):
    """
    Observability log for RAG quality loops (LangSmith/Ragas exportable).
    Stores latency, cache hits, rewritten queries, and feedback linkage.
    """

    __tablename__ = "telemetry_events"

    id = Column(String, primary_key=True, default=gen_id)
    kind = Column(String, default="chat")  # chat | cache_hit | feedback
    message_id = Column(String, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    tokens_est = Column(Integer, default=0)
    cached = Column(Boolean, default=False)
    detail = Column(Text, default="{}")  # JSON blob
    created_at = Column(DateTime, default=datetime.utcnow)
