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

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${window.location.host}/ws/stt`);
  socket.binaryType = "arraybuffer";

  const audioCtx = new AudioContextCtor();
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const inputRate = audioCtx.sampleRate;

  let stopped = false;
  let unavailableFired = false;

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

  // 4404 (see src/api/main.py's STT_WS_NOT_CONFIGURED) means no model is
  // configured server-side at all - fall back for the rest of the
  // session rather than retrying a socket that will only ever refuse the
  // same way. Any other close/error (network blip, proxy hiccup) also
  // falls back, since there's no useful retry to do mid-conversation.
  socket.onclose = () => fireUnavailable();
  socket.onerror = () => fireUnavailable();
  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.final) onFinal?.(msg.text);
      else onPartial?.(msg.text);
    } catch {
      /* ignore a malformed frame */
    }
  };

  processor.onaudioprocess = (e) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const pcm16 = downsampleTo16kMono(e.inputBuffer.getChannelData(0), inputRate);
    if (pcm16.length) socket.send(pcm16.buffer);
  };

  source.connect(processor);
  // A ScriptProcessorNode only fires while connected into the graph's
  // output too (a long-standing Web Audio quirk) - route it to a muted
  // gain node rather than actually playing the mic back to the patient.
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  function stop() {
    if (stopped) return;
    stopped = true;
    cleanupAudio();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send("stop");
      // Give the flushed final result a moment to arrive before closing.
      setTimeout(() => socket.close(), 300);
    } else {
      socket.close();
    }
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
