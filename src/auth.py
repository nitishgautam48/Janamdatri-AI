"""
Lightweight account system - SQLite-backed, stdlib-only password hashing
(PBKDF2-HMAC-SHA256, per-user random salt, 200k iterations - no extra
dependency needed for a hackathon-scoped app). Sessions are bearer tokens
stored server-side, sent back by the client as `x-user-token`.

Accounts are entirely optional - see the "Continue as Guest" path in the
frontend. Logging in only adds: a saved profile, and assessments/chat tied
to the account instead of living solely in the browser's localStorage.
"""

import hashlib
import os
import secrets
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"

PBKDF2_ITERATIONS = 200_000


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = _connect()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            password_hash TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at REAL NOT NULL,
            severity_level TEXT NOT NULL,
            mri INTEGER NOT NULL,
            result_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            created_at REAL NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()


def _hash_password(password: str, salt: bytes = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}:{digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, _ = stored.split(":", 1)
    except ValueError:
        return False
    salt = bytes.fromhex(salt_hex)
    return secrets.compare_digest(_hash_password(password, salt), stored)


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def register(email: str, password: str, name: str = None) -> str:
    if not email or "@" not in email:
        raise AuthError("A valid email is required.")
    if not password or len(password) < 6:
        raise AuthError("Password must be at least 6 characters.")

    conn = _connect()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email.lower(),)).fetchone()
        if existing:
            raise AuthError("An account with this email already exists.", status_code=409)

        password_hash = _hash_password(password)
        cursor = conn.execute(
            "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (email.lower(), name, password_hash, time.time()),
        )
        user_id = cursor.lastrowid
        token = secrets.token_hex(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, time.time()),
        )
        conn.commit()
        return token
    finally:
        conn.close()


def login(email: str, password: str) -> str:
    conn = _connect()
    try:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower() if email else "",)).fetchone()
        if not user or not _verify_password(password or "", user["password_hash"]):
            raise AuthError("Invalid email or password.", status_code=401)

        token = secrets.token_hex(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user["id"], time.time()),
        )
        conn.commit()
        return token
    finally:
        conn.close()


def get_user_by_token(token: str) -> dict:
    if not token:
        return None
    conn = _connect()
    try:
        row = conn.execute(
            """SELECT users.id, users.email, users.name, users.created_at
               FROM sessions JOIN users ON sessions.user_id = users.id
               WHERE sessions.token = ?""",
            (token,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def save_assessment(user_id: int, severity_level: str, mri: int, result_json: str):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO assessments (user_id, created_at, severity_level, mri, result_json) VALUES (?, ?, ?, ?, ?)",
            (user_id, time.time(), severity_level, mri, result_json),
        )
        conn.commit()
    finally:
        conn.close()


def get_assessments_for_user(user_id: int, limit: int = 20) -> list:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, created_at, severity_level, mri, result_json FROM assessments "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def save_chat_message(user_id: int, sender: str, message: str):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO chat_messages (user_id, created_at, sender, message) VALUES (?, ?, ?, ?)",
            (user_id, time.time(), sender, message),
        )
        conn.commit()
    finally:
        conn.close()
