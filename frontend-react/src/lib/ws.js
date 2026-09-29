// Tiny reusable WebSocket client for the backend's push-invalidation
// channel (src/ws_manager.py) - connects, reconnects with backoff on
// drop, and calls onMessage with the parsed {type, ...} event for the
// caller to react to (usually: re-fetch from the same REST endpoint it
// already calls). Never throws: a browser that can't open a WebSocket at
// all, or a network that blocks it, just never calls onOpen - the
// caller's own slow backstop poll keeps the page working either way.
//
// A periodic ping (HEARTBEAT_MS) does two things: keeps the connection
// alive through idle-connection-killing proxies, and - for /ws/staff
// specifically - lets the server detect a zombie connection (laptop
// asleep, network died without a clean close) that would otherwise sit
// "open" from its side forever, with no disconnect event ever firing.
// See src/api/main.py's STAFF_PRESENCE_HEARTBEAT_TIMEOUT. Harmless on
// every other socket - the server side just receives and ignores it.
const HEARTBEAT_MS = 20000;

export function connectWs(path, { onMessage, onOpen, onClose } = {}) {
  let closedByCaller = false;
  let ws = null;
  let retryMs = 1000;
  let retryTimer = null;
  let heartbeatTimer = null;

  function connect() {
    let socket;
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${proto}//${window.location.host}${path}`);
    } catch {
      return; // no WebSocket support at all - caller's polling backstop carries the page
    }
    ws = socket;
    socket.onopen = () => {
      retryMs = 1000;
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, HEARTBEAT_MS);
      onOpen?.();
    };
    socket.onmessage = (e) => {
      try {
        onMessage?.(JSON.parse(e.data));
      } catch {
        /* ignore a malformed frame */
      }
    };
    socket.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      onClose?.();
      if (!closedByCaller) {
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
      }
    };
    socket.onerror = () => socket.close();
  }
  connect();

  function disconnect() {
    closedByCaller = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ws?.close();
  }

  // A function-with-a-method rather than changing the return shape to an
  // object: every existing caller does `const stop = connectWs(...)`
  // then calls `stop()` directly, so keeping disconnect itself callable
  // means none of them need to change. Only the voice-call feature
  // (src/lib/voice-call.js) needs to push messages TO the server over
  // this same socket (WebRTC signaling) - it uses `.send`, everyone else
  // ignores it.
  disconnect.send = (payload) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  return disconnect;
}
