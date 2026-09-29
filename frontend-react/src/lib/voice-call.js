// Real-time voice call over WebRTC, signaled through the same
// /ws/live/{conv_id} socket already used for chat push-invalidation (see
// src/ws_manager.py's relay_conv_signal, src/api/main.py's
// /ws/live/{conv_id}) - that socket already connects exactly the two
// people a call would be between, so it doubles as the signaling channel
// rather than standing up a separate one.
//
// This is a genuinely different feature from live-stt.js: that turns the
// patient's voice into TEXT in the chat input for them to review before
// sending; this lets the counsellor actually HEAR the patient's voice
// directly (and vice versa), no transcription involved. The two don't
// share a mic stream - each opens its own getUserMedia() when active.
//
// No TURN server - only public STUN (Google's). This establishes a
// direct media path for most home/mobile networks, but can fail behind
// some restrictive/symmetric NATs or corporate firewalls with no direct
// path available; closing that gap needs a TURN relay (e.g. coturn)
// added to ICE_SERVERS, which needs actual server infrastructure this
// app doesn't have. Documented limitation, not silently pretended away.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export function createVoiceCall({ wsSend, onRemoteStream, onStateChange, onIncomingCall }) {
  let pc = null;
  let localStream = null;
  let state = "idle"; // idle | calling | ringing | connected
  let pendingOfferSdp = null;
  let queuedCandidates = [];

  function setState(next) {
    state = next;
    onStateChange?.(next);
  }

  function ensurePeerConnection() {
    if (pc) return pc;
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    conn.onicecandidate = (e) => {
      if (e.candidate) wsSend({ type: "webrtc_signal", kind: "ice", candidate: e.candidate.toJSON() });
    };
    conn.ontrack = (e) => onRemoteStream?.(e.streams[0]);
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === "connected") setState("connected");
      else if (["disconnected", "failed", "closed"].includes(conn.connectionState) && state !== "idle") {
        teardown();
      }
    };
    pc = conn;
    return conn;
  }

  async function getLocalStream() {
    if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return localStream;
  }

  async function flushQueuedCandidates() {
    const queued = queuedCandidates.splice(0);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* a stale/duplicate candidate - harmless to drop */ }
    }
  }

  async function startCall() {
    const conn = ensurePeerConnection();
    const stream = await getLocalStream();
    stream.getTracks().forEach((track) => conn.addTrack(track, stream));
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    wsSend({ type: "webrtc_signal", kind: "offer", sdp: offer.sdp });
    setState("calling");
  }

  async function acceptCall() {
    if (!pendingOfferSdp) return;
    const conn = ensurePeerConnection();
    const stream = await getLocalStream();
    stream.getTracks().forEach((track) => conn.addTrack(track, stream));
    await conn.setRemoteDescription({ type: "offer", sdp: pendingOfferSdp });
    pendingOfferSdp = null;
    await flushQueuedCandidates();
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    wsSend({ type: "webrtc_signal", kind: "answer", sdp: answer.sdp });
    setState("connected");
  }

  function declineCall() {
    wsSend({ type: "webrtc_signal", kind: "hangup" });
    pendingOfferSdp = null;
    setState("idle");
  }

  function hangUp() {
    wsSend({ type: "webrtc_signal", kind: "hangup" });
    teardown();
  }

  function teardown() {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    pc?.close();
    pc = null;
    pendingOfferSdp = null;
    queuedCandidates = [];
    setState("idle");
  }

  async function handleSignal(msg) {
    if (msg.kind === "offer") {
      // A call arriving while already on/starting one - hang up the old
      // one first rather than juggling two peer connections at once.
      if (state !== "idle") teardown();
      pendingOfferSdp = msg.sdp;
      setState("ringing");
      onIncomingCall?.();
      return;
    }
    if (msg.kind === "answer") {
      if (!pc) return;
      await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      await flushQueuedCandidates();
      setState("connected");
      return;
    }
    if (msg.kind === "ice") {
      if (!pc || !pc.remoteDescription) {
        queuedCandidates.push(msg.candidate);
      } else {
        try { await pc.addIceCandidate(msg.candidate); } catch { /* stale/duplicate - harmless */ }
      }
      return;
    }
    if (msg.kind === "hangup") {
      teardown();
      return;
    }
  }

  return { startCall, acceptCall, declineCall, hangUp, handleSignal, getState: () => state };
}
