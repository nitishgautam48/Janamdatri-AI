"""
Live counsellor conversations - the human-in-the-loop layer that sits on
top of the Instant Help chat's existing severity signal (see
`_check_symptom_signal` / `respond()` in `src/dynamic_eval/chat_assistant.py`).

A conversation is created one of two ways:
1. Explicitly - a "Talk to someone" action from the patient's chat widget,
   any time, regardless of severity.
2. Automatically - when the chat's OWN existing danger-sign/self-harm
   detection fires (see `src/api/main.py`'s `/chat` endpoint). This is
   always ADDITIVE: the scripted emergency reply (call 108/102/KIRAN)
   fires unconditionally in that same response either way - a live
   counsellor joining is a bonus a patient may never need to wait on,
   never a gate in front of the existing safety net.

Guests (no account) can start a conversation too: the frontend generates
a random opaque `guest_token` (like the existing share-code pattern) and
sends it on every call instead of `x-user-token`. This is a real,
deliberate change to this app's guest-data promise ("guest data never
touches the server beyond computing one result") - a live transcript
with a human counsellor has to be stored server-side to exist at all.
The Privacy page should say so explicitly before a guest starts one.

Self-registration for the counsellor/doctor role (see src/auth.py) has
no vetting step - there is no guarantee a "counsellor" account is an
actual trained staff member. Treat this whole module as pilot/demo-scale
until that gap is closed.
"""

import json
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

from . import auth

DB_PATH = auth.DB_PATH

STATUS_WAITING = "waiting"
STATUS_CLAIMED = "claimed"
STATUS_CLOSED = "closed"

# Mirrors the app's existing severity vocabulary (Critical/Severe/Moderate/
# Mild/Minimal) used everywhere else - Results.jsx, History, trends.js -
# so a conversation's severity reads the same way any other severity does.
SEVERITY_RANK = {"Critical": 4, "Severe": 3, "Moderate": 2, "Mild": 1, "Minimal": 0}


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = _connect()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            patient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            guest_token TEXT,
            patient_name TEXT NOT NULL,
            lang TEXT NOT NULL DEFAULT 'en',
            severity_level TEXT NOT NULL DEFAULT 'Minimal',
            mri INTEGER,
            reason TEXT NOT NULL,
            reason_source TEXT NOT NULL DEFAULT 'requested',
            status TEXT NOT NULL DEFAULT 'waiting',
            counsellor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at REAL NOT NULL,
            claimed_at REAL,
            closed_at REAL,
            outcome TEXT,
            outcome_note TEXT,
            forwarded INTEGER NOT NULL DEFAULT 0,
            handoff_note TEXT,
            handoff_urgency TEXT,
            doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            advice TEXT,
            advice_at REAL,
            context_json TEXT
        );
        CREATE TABLE IF NOT EXISTS conv_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            sender_kind TEXT NOT NULL,
            sender_id INTEGER,
            text TEXT NOT NULL,
            system_kind TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
        CREATE INDEX IF NOT EXISTS idx_conv_msgs_conv ON conv_messages(conversation_id);
    """)
    conn.commit()
    conn.close()


def _row(r):
    return dict(r) if r else None


def _find_open_conversation(conn, patient_user_id, guest_token):
    if patient_user_id:
        row = conn.execute(
            "SELECT * FROM conversations WHERE patient_user_id = ? AND status != 'closed' "
            "ORDER BY created_at DESC LIMIT 1",
            (patient_user_id,),
        ).fetchone()
    elif guest_token:
        row = conn.execute(
            "SELECT * FROM conversations WHERE guest_token = ? AND status != 'closed' "
            "ORDER BY created_at DESC LIMIT 1",
            (guest_token,),
        ).fetchone()
    else:
        row = None
    return _row(row)


def start_or_escalate(
    *,
    patient_user_id: int = None,
    guest_token: str = None,
    patient_name: str,
    lang: str = "en",
    severity_level: str = "Minimal",
    mri: int = None,
    reason: str,
    reason_source: str = "requested",
    context: dict = None,
    initial_message: str = None,
) -> dict:
    """Creates a new waiting conversation, or - if this patient/guest
    already has one open - raises its severity/reason if the new signal
    is worse, and appends the triggering message, rather than spawning a
    duplicate. Returns the resulting conversation row."""
    if not patient_user_id and not guest_token:
        raise ValueError("Either patient_user_id or guest_token is required.")

    conn = _connect()
    try:
        existing = _find_open_conversation(conn, patient_user_id, guest_token)
        now = time.time()
        if existing:
            conv_id = existing["id"]
            if SEVERITY_RANK.get(severity_level, 0) > SEVERITY_RANK.get(existing["severity_level"], 0):
                conn.execute(
                    "UPDATE conversations SET severity_level = ?, mri = COALESCE(?, mri), reason = ?, "
                    "reason_source = ? WHERE id = ?",
                    (severity_level, mri, reason, reason_source, conv_id),
                )
        else:
            conv_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO conversations
                   (id, patient_user_id, guest_token, patient_name, lang, severity_level, mri,
                    reason, reason_source, status, created_at, context_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    conv_id, patient_user_id, guest_token, patient_name, lang, severity_level, mri,
                    reason, reason_source, STATUS_WAITING, now, json.dumps(context or {}),
                ),
            )
        if initial_message:
            conn.execute(
                "INSERT INTO conv_messages (conversation_id, sender_kind, text, created_at) VALUES (?, 'patient', ?, ?)",
                (conv_id, initial_message, now),
            )
        conn.commit()
        return _row(conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone())
    finally:
        conn.close()


def get_conversation(conv_id: str) -> dict:
    conn = _connect()
    try:
        return _row(conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone())
    finally:
        conn.close()


def get_active_for_patient(patient_user_id: int = None, guest_token: str = None) -> dict:
    conn = _connect()
    try:
        return _find_open_conversation(conn, patient_user_id, guest_token)
    finally:
        conn.close()


def list_messages(conv_id: str) -> list:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM conv_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
            (conv_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_message(conv_id: str, sender_kind: str, text: str, sender_id: int = None, system_kind: str = None):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO conv_messages (conversation_id, sender_kind, sender_id, text, system_kind, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (conv_id, sender_kind, sender_id, text, system_kind, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def list_queue() -> list:
    """Waiting conversations, most severe first, oldest first within the
    same severity - matches the mockup's own sort exactly."""
    conn = _connect()
    try:
        rows = conn.execute("SELECT * FROM conversations WHERE status = ?", (STATUS_WAITING,)).fetchall()
        items = [dict(r) for r in rows]
        items.sort(key=lambda c: (-SEVERITY_RANK.get(c["severity_level"], 0), c["created_at"]))
        return items
    finally:
        conn.close()


def list_mine(counsellor_id: int) -> list:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM conversations WHERE counsellor_id = ? AND status = ? ORDER BY created_at DESC",
            (counsellor_id, STATUS_CLAIMED),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def count_resolved_today(counsellor_id: int) -> int:
    conn = _connect()
    try:
        since = time.time() - 24 * 3600
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM conversations WHERE counsellor_id = ? AND status = 'closed' AND closed_at >= ?",
            (counsellor_id, since),
        ).fetchone()
        return row["n"] if row else 0
    finally:
        conn.close()


class LiveChatError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def claim(conv_id: str, counsellor_id: int) -> dict:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
        if not row:
            raise LiveChatError("Conversation not found.", 404)
        if row["status"] != STATUS_WAITING:
            raise LiveChatError("This case has already been claimed or closed.", 409)
        now = time.time()
        conn.execute(
            "UPDATE conversations SET status = ?, counsellor_id = ?, claimed_at = ? WHERE id = ?",
            (STATUS_CLAIMED, counsellor_id, now, conv_id),
        )
        conn.execute(
            "INSERT INTO conv_messages (conversation_id, sender_kind, text, system_kind, created_at) "
            "VALUES (?, 'system', '', 'join', ?)",
            (conv_id, now),
        )
        conn.commit()
        return _row(conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone())
    finally:
        conn.close()


def release_claimed_by(counsellor_id: int) -> list:
    """Going off duty releases whatever this counsellor still has claimed,
    back into the waiting queue for someone else to pick up - the
    counterpart to cancel() for the case where a real person WAS
    connected but has now stepped away. Without this, a patient mid-
    conversation with a counsellor who logs off is simply never told and
    sits there indefinitely (the same "waiting" bug that on-duty-count
    fixed for a request that was never claimed, but for the claimed
    case). Returns the ids of whatever got released, so the caller can
    push a WS update to each one."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id FROM conversations WHERE counsellor_id = ? AND status = ?",
            (counsellor_id, STATUS_CLAIMED),
        ).fetchall()
        conv_ids = [r["id"] for r in rows]
        if conv_ids:
            now = time.time()
            placeholders = ",".join("?" for _ in conv_ids)
            conn.execute(
                f"UPDATE conversations SET status = ?, counsellor_id = NULL, claimed_at = NULL "
                f"WHERE id IN ({placeholders})",
                (STATUS_WAITING, *conv_ids),
            )
            conn.executemany(
                "INSERT INTO conv_messages (conversation_id, sender_kind, text, system_kind, created_at) "
                "VALUES (?, 'system', '', 'unclaim', ?)",
                [(cid, now) for cid in conv_ids],
            )
            conn.commit()
        return conv_ids
    finally:
        conn.close()


def cancel(conv_id: str) -> dict:
    """The patient backing out of an unclaimed request - the counterpart
    to `resolve()`, but reachable by the patient themselves (not a
    counsellor) and only while still `waiting`: once a counsellor has
    claimed it, leaving a live conversation goes through the counsellor's
    own resolve/handoff flow instead, since a real person is now on the
    other end and just vanishing on them isn't the same situation."""
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
        if not row:
            raise LiveChatError("Conversation not found.", 404)
        if row["status"] != STATUS_WAITING:
            raise LiveChatError("This request has already been claimed or closed.", 409)
        now = time.time()
        conn.execute(
            "UPDATE conversations SET status = ?, closed_at = ?, outcome = ? WHERE id = ?",
            (STATUS_CLOSED, now, "cancelled_by_patient", conv_id),
        )
        conn.commit()
        return _row(conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone())
    finally:
        conn.close()


def _require_owner(conn, conv_id, counsellor_id):
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not row:
        raise LiveChatError("Conversation not found.", 404)
    if row["counsellor_id"] != counsellor_id:
        raise LiveChatError("This case belongs to a different counsellor.", 403)
    return row


def counsellor_send(conv_id: str, counsellor_id: int, text: str):
    conn = _connect()
    try:
        _require_owner(conn, conv_id, counsellor_id)
        conn.execute(
            "INSERT INTO conv_messages (conversation_id, sender_kind, sender_id, text, created_at) "
            "VALUES (?, 'counsellor', ?, ?, ?)",
            (conv_id, counsellor_id, text, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def resolve(conv_id: str, counsellor_id: int, outcome: str, note: str = ""):
    conn = _connect()
    try:
        _require_owner(conn, conv_id, counsellor_id)
        now = time.time()
        conn.execute(
            "UPDATE conversations SET status = ?, closed_at = ?, outcome = ?, outcome_note = ? WHERE id = ?",
            (STATUS_CLOSED, now, outcome, note, conv_id),
        )
        conn.execute(
            "INSERT INTO conv_messages (conversation_id, sender_kind, text, system_kind, created_at) "
            "VALUES (?, 'system', ?, 'leave', ?)",
            (conv_id, outcome, now),
        )
        conn.commit()
    finally:
        conn.close()


def handoff_to_doctor(conv_id: str, counsellor_id: int, note: str, urgency: str):
    conn = _connect()
    try:
        row = _require_owner(conn, conv_id, counsellor_id)
        if row["forwarded"]:
            raise LiveChatError("Already forwarded to a doctor.", 409)
        now = time.time()
        conn.execute(
            "UPDATE conversations SET forwarded = 1, handoff_note = ?, handoff_urgency = ? WHERE id = ?",
            (note, urgency, conv_id),
        )
        conn.execute(
            "INSERT INTO conv_messages (conversation_id, sender_kind, text, system_kind, created_at) "
            "VALUES (?, 'system', '', 'fwd', ?)",
            (conv_id, now),
        )
        conn.commit()
    finally:
        conn.close()


def list_doctor_queue(reviewed: bool = False) -> list:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM conversations WHERE forwarded = 1 AND advice IS " + ("NOT NULL" if reviewed else "NULL") +
            " ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def submit_doctor_advice(conv_id: str, doctor_id: int, advice: str):
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
        if not row or not row["forwarded"]:
            raise LiveChatError("This case hasn't been forwarded to a doctor.", 404)
        now = time.time()
        conn.execute(
            "UPDATE conversations SET advice = ?, advice_at = ?, doctor_id = ? WHERE id = ?",
            (advice, now, doctor_id, conv_id),
        )
        conn.execute(
            "INSERT INTO conv_messages (conversation_id, sender_kind, sender_id, text, system_kind, created_at) "
            "VALUES (?, 'doctor', ?, ?, 'doc', ?)",
            (conv_id, doctor_id, advice, now),
        )
        conn.commit()
    finally:
        conn.close()


def generate_guest_token() -> str:
    return secrets.token_hex(16)
