"""
Lightweight account system - SQLite-backed, stdlib-only password hashing
(PBKDF2-HMAC-SHA256, per-user random salt, 200k iterations - no extra
dependency needed for a hackathon-scoped app). Sessions are bearer tokens
stored server-side, sent back by the client as `x-user-token`.

Accounts are entirely optional - see the "Continue as Guest" path in the
frontend. Logging in only adds: a saved profile, and assessments/chat tied
to the account instead of living solely in the browser's localStorage.

`role` (patient/counsellor/doctor) gates access to the care-team
workspace (both the counsellor queue and the doctor's forwarded-case
queue are open to either staff role - see `STAFF_ROLES` in
src/api/main.py). Patient self-registration is open to anyone; a
counsellor/doctor signup additionally requires a valid, unused,
role-matching invite code (see create_invite_code / the invite_codes
table) - simplest possible vetting: whoever administers the deployment
mints a code out-of-band (e.g. `python -m scripts.create_invite_code
counsellor`) and hands it to an actual staff member before they can
register. Still no identity verification beyond that - the code proves
"someone the operator trusts gave them this," not who they are - but
it closes the "anyone can self-register as staff and see real patient
conversations" gap that used to exist here.
"""

import hashlib
import os
import secrets
import sqlite3
import time
from pathlib import Path

# Overridable via JANAMDATRI_DATA_DIR so a host with an ephemeral
# filesystem (e.g. Render without a mounted persistent disk) can point
# this at a persistent-disk mount instead - otherwise every redeploy
# wipes accounts, sessions, and share codes, silently invalidating any
# token a browser still has saved even though nothing in the auth code
# itself is wrong.
_data_dir = os.environ.get("JANAMDATRI_DATA_DIR")
DB_PATH = Path(_data_dir) / "app.db" if _data_dir else Path(__file__).resolve().parent.parent / "data" / "app.db"

PBKDF2_ITERATIONS = 200_000


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


VALID_ROLES = ("patient", "counsellor", "doctor")


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = _connect()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            password_hash TEXT NOT NULL,
            created_at REAL NOT NULL,
            role TEXT NOT NULL DEFAULT 'patient',
            on_duty INTEGER NOT NULL DEFAULT 0
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
        CREATE TABLE IF NOT EXISTS nutrition_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at REAL NOT NULL,
            result_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS share_codes (
            code TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at REAL NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS invite_codes (
            code TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            created_at REAL NOT NULL,
            used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            used_at REAL
        );
    """)
    # Migration for a users table created before role/on_duty existed -
    # CREATE TABLE IF NOT EXISTS above is a no-op against an existing
    # table, so an already-deployed database needs these columns added
    # explicitly. SQLite has no "ADD COLUMN IF NOT EXISTS", so this just
    # swallows the "duplicate column" error on a database that already
    # has them.
    for stmt in (
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'patient'",
        "ALTER TABLE users ADD COLUMN on_duty INTEGER NOT NULL DEFAULT 0",
    ):
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
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


# Roles that need an invite code to self-register - see the module
# docstring. Patients stay open (the app's whole point is being reachable
# without a gatekeeper); staff roles reach real patient conversations, so
# they don't.
INVITE_REQUIRED_ROLES = ("counsellor", "doctor")


def create_invite_code(role: str) -> str:
    """Mints a new one-time invite code for the given staff role. Meant
    to be run by whoever administers the deployment (see
    scripts/create_invite_code.py) - there's no in-app admin role or UI
    for this, deliberately: it's a shell command someone with server
    access runs before handing a code to an actual staff member, not a
    feature exposed to any account."""
    if role not in INVITE_REQUIRED_ROLES:
        raise ValueError(f"Invite codes are only for {INVITE_REQUIRED_ROLES}, got {role!r}.")
    code = secrets.token_hex(4).upper()
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO invite_codes (code, role, created_at) VALUES (?, ?, ?)",
            (code, role, time.time()),
        )
        conn.commit()
        return code
    finally:
        conn.close()


def _consume_invite_code(conn, code: str, role: str, user_id: int):
    """Validates and marks a code used, in the same connection/transaction
    as the registration it's gating - so two people racing to redeem the
    same code can't both succeed (SQLite serializes writes on one
    connection; the second UPDATE's rowcount comes back 0 and this
    raises, rolling back that registration attempt's insert too)."""
    row = conn.execute("SELECT * FROM invite_codes WHERE code = ?", ((code or "").strip().upper(),)).fetchone()
    if not row:
        raise AuthError("Invalid invite code.")
    if row["used_by"] is not None:
        raise AuthError("This invite code has already been used.")
    if row["role"] != role:
        raise AuthError(f"This invite code is for a {row['role']} account, not {role}.")
    cursor = conn.execute(
        "UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL",
        (user_id, time.time(), row["code"]),
    )
    if cursor.rowcount == 0:
        raise AuthError("This invite code has already been used.")


def register(email: str, password: str, name: str = None, role: str = "patient", invite_code: str = None) -> str:
    if not email or "@" not in email:
        raise AuthError("A valid email is required.")
    if not password or len(password) < 6:
        raise AuthError("Password must be at least 6 characters.")
    if role not in VALID_ROLES:
        raise AuthError("Invalid role.")
    if role in INVITE_REQUIRED_ROLES and not (invite_code or "").strip():
        raise AuthError(f"A {role} account needs an invite code from your program administrator.")

    conn = _connect()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email.lower(),)).fetchone()
        if existing:
            raise AuthError("An account with this email already exists.", status_code=409)

        password_hash = _hash_password(password)
        cursor = conn.execute(
            "INSERT INTO users (email, name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?)",
            (email.lower(), name, password_hash, time.time(), role),
        )
        user_id = cursor.lastrowid
        if role in INVITE_REQUIRED_ROLES:
            _consume_invite_code(conn, invite_code, role, user_id)
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
            """SELECT users.id, users.email, users.name, users.created_at, users.role, users.on_duty
               FROM sessions JOIN users ON sessions.user_id = users.id
               WHERE sessions.token = ?""",
            (token,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def set_duty(user_id: int, on_duty: bool):
    conn = _connect()
    try:
        conn.execute("UPDATE users SET on_duty = ? WHERE id = ?", (1 if on_duty else 0, user_id))
        conn.commit()
    finally:
        conn.close()


def count_on_duty(roles) -> int:
    """How many staff accounts are currently on duty, across the given
    roles - lets the patient-facing live-chat queue tell "someone will
    get to this" apart from "no one is even watching this queue right
    now", instead of showing the same indefinite "waiting" message
    either way."""
    conn = _connect()
    try:
        placeholders = ",".join("?" for _ in roles)
        row = conn.execute(
            f"SELECT COUNT(*) AS n FROM users WHERE on_duty = 1 AND role IN ({placeholders})",
            tuple(roles),
        ).fetchone()
        return row["n"] if row else 0
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


def save_nutrition_check(user_id: int, result_json: str):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO nutrition_checks (user_id, created_at, result_json) VALUES (?, ?, ?)",
            (user_id, time.time(), result_json),
        )
        conn.commit()
    finally:
        conn.close()


def delete_user(user_id: int):
    """Deletes the account and every assessment/chat message/nutrition
    check tied to it. Sessions/assessments/nutrition_checks cascade via
    their own ON DELETE CASCADE foreign key, but chat_messages.user_id
    was never declared as one (it's nullable for anonymous-safe schema
    reasons), so it needs an explicit delete here too."""
    conn = _connect()
    try:
        conn.execute("DELETE FROM chat_messages WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


def get_nutrition_checks_for_user(user_id: int, limit: int = 20) -> list:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, created_at, result_json FROM nutrition_checks "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# Excludes visually-ambiguous characters (0/O, 1/I/L) since this code is
# meant to be read off one screen and typed into another by hand.
_SHARE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate_code() -> str:
    return "".join(secrets.choice(_SHARE_CODE_ALPHABET) for _ in range(8))


def generate_share_code(user_id: int) -> str:
    """Creates a fresh share code for the user, revoking any code they
    already had - only one code is ever active per user at a time, so
    "generate" and "regenerate" are the same operation, and a provider
    holding an old code loses access the moment a new one is made."""
    conn = _connect()
    try:
        conn.execute("UPDATE share_codes SET revoked = 1 WHERE user_id = ? AND revoked = 0", (user_id,))
        code = _generate_code()
        conn.execute(
            "INSERT INTO share_codes (code, user_id, created_at, revoked) VALUES (?, ?, ?, 0)",
            (code, user_id, time.time()),
        )
        conn.commit()
        return code
    finally:
        conn.close()


def get_active_share_code(user_id: int) -> str:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT code FROM share_codes WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        return row["code"] if row else None
    finally:
        conn.close()


def revoke_share_code(user_id: int):
    conn = _connect()
    try:
        conn.execute("UPDATE share_codes SET revoked = 1 WHERE user_id = ? AND revoked = 0", (user_id,))
        conn.commit()
    finally:
        conn.close()


def get_user_by_share_code(code: str) -> dict:
    if not code:
        return None
    conn = _connect()
    try:
        row = conn.execute(
            """SELECT users.id, users.email, users.name
               FROM share_codes JOIN users ON share_codes.user_id = users.id
               WHERE share_codes.code = ? AND share_codes.revoked = 0""",
            (code.strip().upper(),),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
