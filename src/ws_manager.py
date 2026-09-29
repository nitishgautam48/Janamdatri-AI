"""
Lightweight in-process WebSocket pub/sub for the live counsellor pipeline.

This is a push-based INVALIDATION channel, not a duplicate data channel: a
socket receives a small {"type": "..."} event the instant something
changes, and the receiving page re-fetches from the same REST endpoints it
already calls (api.counsellorQueue(), api.liveGet(), etc). That keeps one
source of truth for how a conversation/queue row gets serialized - a WS
payload can never drift out of sync with what the REST response actually
looks like, since there is no separate WS-only serialization to maintain.

The alternative to the previous fixed-interval poll everywhere
(QUEUE_POLL_MS/CONV_POLL_MS/LIVE_POLL_MS) was always "close enough to
live" (see live_chat.py's own docstring) rather than actually live; this
makes updates near-instant while keeping those same intervals around as a
slow backstop poll, in case a socket drops silently or a notify is missed.

In-process only (plain Python sets of connections) - matches this app's
existing single-SQLite-process pilot scale. Scaling to multiple backend
processes would need a shared pub/sub (e.g. Redis) broadcasting across
them instead of this in-memory registry; not needed yet.
"""

from fastapi import WebSocket


class _Hub:
    def __init__(self):
        self.conv_sockets: dict[str, set[WebSocket]] = {}
        self.staff_sockets: set[WebSocket] = set()

    async def conv_connect(self, conv_id: str, ws: WebSocket):
        await ws.accept()
        self.conv_sockets.setdefault(conv_id, set()).add(ws)

    def conv_disconnect(self, conv_id: str, ws: WebSocket):
        conns = self.conv_sockets.get(conv_id)
        if conns:
            conns.discard(ws)
            if not conns:
                self.conv_sockets.pop(conv_id, None)

    async def notify_conv(self, conv_id: str):
        for ws in list(self.conv_sockets.get(conv_id, ())):
            try:
                await ws.send_json({"type": "conv_changed"})
            except Exception:
                pass

    async def staff_connect(self, ws: WebSocket):
        await ws.accept()
        self.staff_sockets.add(ws)

    def staff_disconnect(self, ws: WebSocket):
        self.staff_sockets.discard(ws)

    async def notify_staff(self, event_type: str, **extra):
        for ws in list(self.staff_sockets):
            try:
                await ws.send_json({"type": event_type, **extra})
            except Exception:
                pass


hub = _Hub()
