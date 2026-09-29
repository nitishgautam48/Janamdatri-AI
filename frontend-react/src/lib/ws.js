// Tiny reusable WebSocket client for the backend's push-invalidation
// channel (src/ws_manager.py) - connects, reconnects with backoff on
// drop, and calls onMessage with the parsed {type, ...} event for the
// caller to react to (usually: re-fetch from the same REST endpoint it
// already calls). Never throws: a browser that can't open a WebSocket at
// all, or a network that blocks it, just never calls onOpen - the
// caller's own slow backstop poll keeps the page working either way.
export function connectWs(path, { onMessage, onOpen, onClose } = {}) {
  let closedByCaller = false;
  let ws = null;
  let retryMs = 1000;
  let retryTimer = null;

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
      onClose?.();
      if (!closedByCaller) {
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
      }
    };
    socket.onerror = () => socket.close();
  }
  connect();

  return function disconnect() {
    closedByCaller = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}
