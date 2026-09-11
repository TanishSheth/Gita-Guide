"""
SQLAlchemy engine/session setup for the SQLite chat-history store.
"""
import os
import time

from sqlalchemy import create_engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.pool import NullPool

# Chroma/PostHog telemetry crashes on some Windows setups ("capture() takes 1
# positional argument but 3 were given"). Disable before those libs import.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

SQLALCHEMY_DATABASE_URL = "sqlite:///./gita_chat.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    poolclass=NullPool,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def commit_with_retry(db: Session, attempts: int = 8) -> None:
    """Retry SQLite commits when another request briefly holds the file lock."""
    delay = 0.05
    last_exc = None
    for i in range(attempts):
        try:
            db.commit()
            return
        except OperationalError as exc:
            last_exc = exc
            db.rollback()
            if "locked" not in str(exc).lower() or i == attempts - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 1.0)
    if last_exc:
        raise last_exc


def get_db():
    """FastAPI dependency that yields a DB session and closes it after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
