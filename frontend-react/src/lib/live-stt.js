// Real-time streaming speech-to-text over /ws/stt (self-hosted Vosk, see
// src/stt.py's StreamingRecognizer). Captures the mic via Web Audio,
// downsamples to the mono 16-bit PCM @ 16kHz Vosk needs, and streams it
// to the backend continuously - the patient sees words appear while
// they're still talking, instead of ChatWidget's older approach of
// recording a whole clip and only finding out what was said after
// uploading it and waiting for one round trip.
//
// Uses a ScriptProcessorNode rather than an AudioWorklet - deprecated,
// but still universally supported and avoids shipping a second JS module
// file just to downsample audio; revisit if that ever actually breaks.

// Matches src/api/main.py's STT_WS_NOT_CONFIGURED - a close with this
// code means no model is loaded server-side at all, so retrying would
// only ever fail the same way again.
const STT_WS_NOT_CONFIGURED = 4404;

// A transient drop (network blip, proxy hiccup) gets this many reconnect
// attempts, with a short backoff, before giving up on self-hosted
// streaming for the rest of this listening session - a still-active mic
// session shouldn't be abandoned over one bad moment, but it also
// shouldn't retry forever while the patient sits there mid-sentence.
const RECONNECT_DELAYS_MS = [300, 800];

// Conservative RMS floor for "this chunk is silence, not just quiet
// speech" - picked low deliberately so a soft-spoken patient or a noisy
// room never gets mistaken for silence and dropped; it only catches
// genuinely dead air (nobody talking, background room tone). Only every
// 4th confirmed-silent chunk actually gets sent.
const SILENCE_RMS_THRESHOLD = 0.01;
const KEEPALIVE_EVERY = 4;

function isSilent(float32) {
  let sumSquares = 0;
  for (let i = 0; i < float32.length; i++) sumSquares += float32[i] * float32[i];
  return Math.sqrt(sumSquares / float32.length) < SILENCE_RMS_THRESHOLD;
}

export async function startLiveStt({ onPartial, onFinal, onUnavailable } = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor || !navigator.mediaDevices?.getUserMedia) {
    onUnavailable?.();
    return { stop() {} };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    onUnavailable?.();
    return { stop() {} };
  }

  const audioCtx = new AudioContextCtor();
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const inputRate = audioCtx.sampleRate;

  let stopped = false;
  let unavailableFired = false;
  let socket = null;
  let reconnectCount = 0;
  // Resolves stop()'s returned promise once the server's flushed final
  // transcript has actually arrived (or it's clear none is coming) - see
  // stop() below for why this needs to be awaitable at all.
  let flushResolve = null;

  function cleanupAudio() {
    try { processor.disconnect(); } catch { /* already disconnected */ }
    try { source.disconnect(); } catch { /* already disconnected */ }
    try { audioCtx.close(); } catch { /* already closed */ }
    stream.getTracks().forEach((track) => track.stop());
  }

  function fireUnavailable() {
    if (unavailableFired || stopped) return;
    unavailableFired = true;
    cleanupAudio();
    onUnavailable?.();
  }

  function openSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/stt`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { reconnectCount = 0; };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.final) {
          onFinal?.(msg.text);
          flushResolve?.(); // the awaited flush stop() promised has now actually happened
        } else {
          onPartial?.(msg.text);
        }
      } catch {
        /* ignore a malformed frame */
      }
    };
    ws.onclose = (e) => {
      if (stopped) {
        // Server closes without ever sending a final frame when there was
        // nothing left to flush (see src/api/main.py's /ws/stt) - that's
        // still "the flush is done", just with nothing in it.
        flushResolve?.();
        return;
      }
      if (e.code === STT_WS_NOT_CONFIGURED) {
        fireUnavailable();
        return;
      }
      if (reconnectCount < RECONNECT_DELAYS_MS.length) {
        const delay = RECONNECT_DELAYS_MS[reconnectCount];
        reconnectCount += 1;
        setTimeout(() => {
          if (!stopped) socket = openSocket();
        }, delay);
      } else {
        fireUnavailable();
      }
    };
    ws.onerror = () => ws.close();
    return ws;
  }

  socket = openSocket();

  let silentStreak = 0;

  processor.onaudioprocess = (e) => {
    // No socket, or one that's mid-reconnect - drop this chunk rather
    // than buffering it. A reconnect discards Vosk's in-progress
    // utterance state server-side anyway (a fresh KaldiRecognizer), so
    // there's nothing meaningful to replay it into once the new socket
    // opens; the patient just keeps talking and partials resume.
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const float32 = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleTo16kMono(float32, inputRate);
    if (!pcm16.length) return;

    // Raw PCM16 @ 16kHz is ~1.9MB/minute, sent continuously - real for a
    // patient on a poor connection, and this app otherwise goes out of
    // its way for low-bandwidth use. Actual speech is always sent at full
    // fidelity (accuracy matters more than saving bytes there); only
    // confirmed silence gets thinned, to one chunk in KEEPALIVE_EVERY,
    // which cuts most of the bandwidth a normal pause-filled conversation
    // spends on dead air while still feeding the recognizer enough silent
    // frames to reach its own end-of-utterance detection.
    if (isSilent(float32)) {
      silentStreak += 1;
      if (silentStreak % KEEPALIVE_EVERY !== 0) return;
    } else {
      silentStreak = 0;
    }
    socket.send(pcm16.buffer);
  };

  source.connect(processor);
  // A ScriptProcessorNode only fires while connected into the graph's
  // output too (a long-standing Web Audio quirk) - route it to a muted
  // gain node rather than actually playing the mic back to the patient.
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  // Returns a promise that resolves once the server's flushed final
  // transcript (if any) has actually arrived - a caller that needs to
  // know THIS side's transcription is truly done (not just "the stop
  // signal was sent") has to await it, rather than treating stop() as
  // fire-and-forget. Concretely: src/api/main.py's ws_live only closes
  // off a call's shared transcript row once {"type": "call_transcript_
  // end"} arrives, so sending that before the trailing segment has
  // actually landed opens a NEW row for it instead of including it in
  // the one just closed - awaiting this is what prevents that race.
  function stop() {
    if (stopped) return Promise.resolve();
    stopped = true;
    cleanupAudio();
    if (socket && socket.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        flushResolve = resolve;
        socket.send("stop");
        // Safety net in case the server never responds (dropped
        // connection mid-flush, etc.) - never wait forever.
        setTimeout(resolve, 1500);
      });
    }
    socket?.close();
    return Promise.resolve();
  }

  return { stop };
}

function downsampleTo16kMono(float32, inputRate) {
  const targetRate = 16000;
  const samples = inputRate === targetRate ? float32 : resample(float32, inputRate, targetRate);
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function resample(float32, inputRate, targetRate) {
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    out[i] = float32[Math.floor(i * ratio)];
  }
  return out;
}
