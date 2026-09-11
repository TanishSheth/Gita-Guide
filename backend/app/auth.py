"""
Session-token auth: register/login, remember-me expiry, password reset.

Tokens are opaque (not JWTs) so logout and idle expiry can revoke them
immediately. The client stores the raw token; only a SHA-256 hash is kept
in SQLite.
"""
import hashlib
import os
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Optional, Tuple

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from . import models
from .database import get_db, commit_with_retry

MIN_PASSWORD_LEN = 8
IDLE_TIMEOUT_MINUTES = int(os.getenv("AUTH_IDLE_MINUTES", "15"))
SESSION_HOURS = int(os.getenv("AUTH_SESSION_HOURS", "12"))
REMEMBER_DAYS = int(os.getenv("AUTH_REMEMBER_DAYS", "30"))
RESET_MINUTES = int(os.getenv("AUTH_RESET_MINUTES", "60"))
APP_PUBLIC_URL = os.getenv("APP_PUBLIC_URL", "http://localhost:5173")

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    return os.urandom(32).hex()


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def validate_password(password: str) -> None:
    if not password or len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LEN} characters.",
        )


def session_expiry(remember: bool) -> datetime:
    if remember:
        return datetime.utcnow() + timedelta(days=REMEMBER_DAYS)
    return datetime.utcnow() + timedelta(hours=SESSION_HOURS)


def create_auth_session(
    db: Session, user: models.User, remember: bool
) -> Tuple[str, models.AuthSession]:
    raw = new_token()
    now = datetime.utcnow()
    row = models.AuthSession(
        user_id=user.id,
        token_hash=hash_token(raw),
        remember=bool(remember),
        expires_at=session_expiry(remember),
        last_seen_at=now,
    )
    db.add(row)
    commit_with_retry(db)
    db.refresh(row)
    return raw, row


def get_auth_session(db: Session, token: str) -> Optional[models.AuthSession]:
    if not token:
        return None
    return (
        db.query(models.AuthSession)
        .filter(models.AuthSession.token_hash == hash_token(token))
        .first()
    )


def revoke_auth_session(db: Session, session: models.AuthSession) -> None:
    db.delete(session)
    commit_with_retry(db)


def _unauthorized(detail: str = "Please sign in to continue.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise _unauthorized()

    session = get_auth_session(db, creds.credentials)
    now = datetime.utcnow()
    if not session or session.expires_at <= now:
        if session:
            db.delete(session)
            commit_with_retry(db)
        raise _unauthorized("Session expired. Please sign in again.")

    # Avoid a write on every API call — concurrent chat streams otherwise
    # lock SQLite (especially on OneDrive-synced folders).
    if session.last_seen_at is None or now - session.last_seen_at >= timedelta(
        seconds=45
    ):
        session.last_seen_at = now
        try:
            commit_with_retry(db)
        except OperationalError:
            db.rollback()

    user = db.query(models.User).filter_by(id=session.user_id).first()
    if not user:
        db.delete(session)
        commit_with_retry(db)
        raise _unauthorized()
    return user


def create_password_reset(db: Session, user: models.User) -> str:
    db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.user_id == user.id,
        models.PasswordResetToken.used.is_(False),
    ).delete()
    raw = new_token()
    row = models.PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=datetime.utcnow() + timedelta(minutes=RESET_MINUTES),
        used=False,
    )
    db.add(row)
    commit_with_retry(db)
    return raw


def consume_password_reset(db: Session, raw_token: str) -> models.User:
    if not raw_token:
        raise HTTPException(400, "Reset token is missing.")
    row = (
        db.query(models.PasswordResetToken)
        .filter(models.PasswordResetToken.token_hash == hash_token(raw_token))
        .first()
    )
    if not row or row.used or row.expires_at <= datetime.utcnow():
        raise HTTPException(
            400, "This reset link is invalid or has expired. Request a new one."
        )
    user = db.query(models.User).filter_by(id=row.user_id).first()
    if not user:
        raise HTTPException(400, "This reset link is invalid or has expired.")
    row.used = True
    commit_with_retry(db)
    return user


def reset_url_for_token(raw_token: str) -> str:
    base = APP_PUBLIC_URL.rstrip("/")
    return f"{base}/#/reset?token={raw_token}"


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_FROM"))


def send_reset_email(to_email: str, url: str) -> bool:
    """Send a reset email when SMTP_* env vars are set. Always logs the URL."""
    print(f"[auth] Password reset for {to_email}: {url}")
    if not smtp_configured():
        return False

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    from_addr = os.getenv("SMTP_FROM")
    use_tls = os.getenv("SMTP_TLS", "true").lower() != "false"

    msg = EmailMessage()
    msg["Subject"] = "Reset your Gita Guide password"
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(
        "You asked to reset your Gita Guide password.\n\n"
        f"Open this link (it expires in {RESET_MINUTES} minutes):\n{url}\n\n"
        "If you did not request this, you can ignore this email."
    )

    context = ssl.create_default_context()
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as smtp:
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                if use_tls:
                    smtp.starttls(context=context)
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[auth] Failed to send reset email: {exc}")
        return False
