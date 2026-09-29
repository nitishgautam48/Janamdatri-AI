"""
Lightweight in-process WebSocket pub/sub for the live counsellor pipeline.

This is mostly a push-based INVALIDATION channel, not a duplicate data
channel: a socket receives a small {"type": "..."} event the instant
something changes, and the receiving page re-fetches from the same REST
endpoints it already calls (api.counsellorQueue(), api.liveGet(), etc).
That keeps one source of truth for how a conversation/queue row gets
serialized - a WS payload can never drift out of sync with what the REST
response actually looks like, since there is no separate WS-only
serialization to maintain. relay_conv_signal() is the one exception: the
voice-call feature's WebRTC signaling (offer/answer/ICE candidates) has
no REST equivalent to fall back on - the payload itself IS the data, not
an invalidation hint.

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
        # Keyed by user id (not a flat set) so a disconnect can tell "this
        # counsellor still has another tab open" apart from "this was
        # their last connection" - see main.py's /ws/staff presence
        # timeout, which only starts the "they're gone" grace period once
        # the LAST connection for a user drops.
        self.staff_sockets_by_user: dict[int, set[WebSocket]] = {}

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

    async def relay_conv_signal(self, conv_id: str, sender: WebSocket, payload: dict):
        """WebRTC call signaling (offer/answer/ICE candidates/hangup) for
        the voice-call feature - unlike notify_conv's fixed invalidation
        ping, this relays an arbitrary payload to the OTHER participant(s)
        in the same conversation room, not back to whoever sent it."""
        for ws in list(self.conv_sockets.get(conv_id, ())):
            if ws is sender:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def staff_connect(self, ws: WebSocket, user_id: int):
        await ws.accept()
        self.staff_sockets_by_user.setdefault(user_id, set()).add(ws)

    def staff_disconnect(self, ws: WebSocket, user_id: int) -> bool:
        """Removes this connection and returns whether the user still has
        at least one other open /ws/staff connection (another tab) after
        that - the caller uses this to decide whether to start a presence
        timeout or not."""
        conns = self.staff_sockets_by_user.get(user_id)
        if conns:
            conns.discard(ws)
            if not conns:
                self.staff_sockets_by_user.pop(user_id, None)
        return bool(self.staff_sockets_by_user.get(user_id))

    async def notify_staff(self, event_type: str, **extra):
        for conns in list(self.staff_sockets_by_user.values()):
            for ws in list(conns):
                try:
                    await ws.send_json({"type": event_type, **extra})
                except Exception:
                    pass


hub = _Hub()
