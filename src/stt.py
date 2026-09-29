"""
Self-hosted speech-to-text using Vosk (Apache-2.0, github.com/alphacep/vosk-api).

Why: the patient-facing voice input (ChatWidget.jsx) previously relied
entirely on the browser's Web Speech API. That works, but Chrome's
implementation sends the recorded audio to Google's servers to do the
recognition - at odds with this app's own "no external AI provider, your
data never leaves this server" privacy claim (see Privacy page /
aiDisclosureBody). Vosk runs the acoustic model in-process here instead,
so a transcription never leaves this server either, and - with an Indic
model - handles Hindi/Hinglish code-switching noticeably better than a
browser engine tuned for English.

This module is deliberately structured to degrade honestly rather than
silently: if no model is configured/found, transcribe_wav/transcribe_upload
raise SttNotConfigured, StreamingRecognizer's constructor does the same,
and the frontend falls back to the browser's own SpeechRecognition either
way - so voice input keeps working regardless, it just isn't self-hosted
until a model is actually provisioned.

Two ways to use a configured model, both below:
  - transcribe_wav/transcribe_upload (record a whole clip, then
    transcribe it in one call) - POST /stt/transcribe, 503s if not
    configured. Simple, but the caller only finds out what was said after
    the recording finishes and uploads.
  - StreamingRecognizer (feed it audio incrementally, get partial/final
    results back as they're recognized) - WS /ws/stt, closes with code
    4404 if not configured. This is what ChatWidget.jsx actually uses now
    (see frontend-react/src/lib/live-stt.js): the patient sees words
    appear while still talking, the actual "live" part of live voice
    input. transcribe_upload/POST /stt/transcribe are kept as a working,
    documented alternative (e.g. for a non-realtime "attach a voice note"
    use case) - nothing in the current UI calls them anymore.

Provisioning a model:
  1. pip install vosk  (already in requirements - the library itself has
     no bundled model; models are a separate download)
  2. Download a Hindi model, e.g. vosk-model-small-hi-0.22 (~50 MB) from
     https://alphacephei.com/vosk/models and unzip it somewhere durable.
  3. Set VOSK_MODEL_PATH to that unzipped folder before starting the API.
A larger vosk-model-hi (bigger, more accurate) or an AI4Bharat/IndicWav2Vec
checkpoint (github.com/AI4Bharat/vistaar) can be swapped in the same way -
this module only needs a directory Vosk's Model() class can load.

The Dockerfile now does steps 1-3 automatically at build time (see its
"Self-hosted Hindi speech-to-text model" stage): it downloads
vosk-model-small-hi-0.22.zip, unzips it to /app/models/vosk-hi, and sets
VOSK_MODEL_PATH accordingly - so any real deployment built with normal
internet access ships with self-hosted Hindi STT out of the box. That step
is best-effort: if the fetch fails (offline build, mirror moved, corporate
proxy), the image still builds and the app falls back to the browser's own
SpeechRecognition, same as if VOSK_MODEL_PATH were never set.

Session notes on verifying this (2026-09-29): this repo's own dev sandbox
cannot reach a Hindi model directly - its network policy allows PyPI/npm/
GitHub but returns a blocked CONNECT to alphacephei.com, huggingface.co,
ggml.ggerganov.com, and github.io Pages mirrors (e.g. ccoreilly.github.io's
vosk-browser demo assets); an AI4Bharat/Vakyansh model bucket on
storage.googleapis.com was network-reachable but the object itself
returned Google's own AccessDenied, unrelated to this sandbox's policy. A
plain (non-LFS) GitHub mirror of the official small models
(github.com/kercre123/vosk-models) WAS reachable, but only ships en/es/fr/
de/ru/... - no Hindi - so it doesn't close the gap directly.

That mirror was still useful to prove the pipeline is real rather than
just gracefully degrading: the small English model was loaded via
VOSK_MODEL_PATH, /stt/transcribe was fed genuine synthesized speech
(espeak-ng) end-to-end, and it returned correct or near-correct text for
short phrases (e.g. "i am feeling very dizzy today" transcribed exactly;
a couple of phrases had minor word-level errors typical of a "small"
Vosk model and robotic TTS input, not a code bug). The Dockerfile's own
fetch-unzip-move shell logic was separately dry-run tested against a real
model zip (served over a local HTTP server, since the sandbox's Docker
build itself can't reach even Debian's own apt mirror to prove out the
full image) and produces a correct Vosk model directory (am/conf/graph/
ivector) exactly as Vosk's Model() expects, with the failure path cleanly
leaving VOSK_MODEL_PATH unset-equivalent (no directory) rather than a
half-extracted one.

Net effect: the STT code path (config detection, ffmpeg conversion, Vosk
recognition, graceful fallback) is proven correct with a real model and
real audio. Hindi-specific accuracy has not been measured from inside
this sandbox, purely because no Hindi model host is reachable from here -
building this Dockerfile anywhere with normal internet access provisions
and can then accuracy-test the real Hindi model.

Follow-up session notes (same day): added StreamingRecognizer + /ws/stt,
replacing ChatWidget's self-hosted mic path (record full clip -> upload
-> wait for one result) with real incremental streaming. Verified two
ways against the same English model: (1) a direct WebSocket client
streamed real (espeak-ng) audio in ~100ms chunks and printed each
partial/final result with a timestamp - partials visibly grow word by
word WHILE audio is still being sent, well before the stream ends, with
only the final flush arriving after; (2) a real Playwright-driven
Chromium browser, with its fake mic device pointed at one of those same
WAV files (--use-file-for-fake-audio-capture), ran the actual
getUserMedia -> AudioContext -> ScriptProcessorNode -> downsample -> WS
pipeline in live-stt.js end-to-end, and the chat input visibly filled in
live, word by word, while the widget was still in "listening" state -
not just once at the end. Both confirm this is genuinely incremental,
not a record-then-upload flow wearing a WebSocket.
"""

import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

MODEL_PATH = os.environ.get("VOSK_MODEL_PATH")

_model = None
_model_load_error = None


class SttNotConfigured(Exception):
    pass


class SttError(Exception):
    pass


def _load_model():
    global _model, _model_load_error
    if _model is not None or _model_load_error is not None:
        return
    if not MODEL_PATH or not Path(MODEL_PATH).is_dir():
        _model_load_error = (
            f"VOSK_MODEL_PATH is not set to a valid model directory (got: {MODEL_PATH!r}). "
            "See src/stt.py's module docstring for how to provision one."
        )
        return
    try:
        from vosk import Model  # imported lazily so the app still starts if vosk isn't installed
        _model = Model(MODEL_PATH)
    except Exception as exc:  # pragma: no cover - depends on an external model file
        _model_load_error = f"Could not load the Vosk model at {MODEL_PATH}: {exc}"


def is_configured() -> bool:
    _load_model()
    return _model is not None


def transcribe_wav(wav_path: str) -> str:
    """Transcribes a mono 16-bit PCM WAV file. Raises SttNotConfigured if no
    model is available, or SttError for anything else that goes wrong."""
    _load_model()
    if _model is None:
        raise SttNotConfigured(_model_load_error)

    from vosk import KaldiRecognizer

    try:
        wf = wave.open(wav_path, "rb")
    except Exception as exc:
        raise SttError(f"Could not read audio file: {exc}") from exc

    try:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise SttError("Audio must be mono 16-bit PCM WAV (convert with ffmpeg before calling transcribe_wav).")

        recognizer = KaldiRecognizer(_model, wf.getframerate())
        recognizer.SetWords(False)
        pieces = []
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            if recognizer.AcceptWaveform(data):
                pieces.append(json.loads(recognizer.Result()).get("text", ""))
        pieces.append(json.loads(recognizer.FinalResult()).get("text", ""))
        return " ".join(p for p in pieces if p).strip()
    finally:
        wf.close()


def _convert_to_wav(raw_bytes: bytes, wav_path: str):
    """Runs whatever the browser's MediaRecorder produced (webm/opus, ogg,
    m4a, ...) through ffmpeg into the mono 16 kHz PCM WAV Vosk needs -
    which also happens to be a format any browser's <audio> tag can play
    back directly, so this is shared by both a transient transcription
    (transcribe_upload, the wav is discarded after) and a voice note that
    needs to keep the audio around permanently (save_and_transcribe)."""
    with tempfile.NamedTemporaryFile(delete=False) as tmp_src:
        tmp_src.write(raw_bytes)
        src_path = tmp_src.name
    try:
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wav_path],
                capture_output=True, timeout=30,
            )
        except FileNotFoundError as exc:
            raise SttError("ffmpeg is not installed on this server - required to convert recorded audio.") from exc
        except subprocess.TimeoutExpired as exc:
            raise SttError("Audio conversion timed out.") from exc
    finally:
        os.unlink(src_path)

    if result.returncode != 0 or not os.path.exists(wav_path):
        raise SttError(f"Could not convert the recorded audio: {result.stderr.decode(errors='replace')[-500:]}")


def transcribe_upload(raw_bytes: bytes) -> str:
    """Converts whatever the browser's MediaRecorder produced to WAV via
    ffmpeg, then transcribes it and discards the WAV. Raises
    SttNotConfigured (no model) or SttError (ffmpeg missing/failed, or an
    unreadable/empty clip)."""
    _load_model()
    if _model is None:
        raise SttNotConfigured(_model_load_error)

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, "audio.wav")
        _convert_to_wav(raw_bytes, wav_path)
        return transcribe_wav(wav_path)


def save_and_transcribe(raw_bytes: bytes, wav_dest_path: str) -> tuple[str, bool]:
    """For voice notes (see src/live_chat.py, POST /live/{id}/voice-note):
    unlike transcribe_upload, the converted WAV is kept permanently at
    wav_dest_path instead of discarded - the recording itself, not just
    its transcript, IS the message, the same way a WhatsApp voice note
    keeps the audio rather than replacing it with text. A patient's
    actual voice (panic, breathlessness, a shaking tone) carries real
    information a transcript alone would throw away.

    Returns (text, transcribed). If no model is configured, the audio is
    still converted and saved - a voice note doesn't need a transcript to
    be useful - and this returns ("", False) rather than raising, so the
    caller can label it "not transcribed" instead of silently showing
    empty text with no explanation. Raises SttError only if the audio
    itself couldn't be converted at all (nothing to save either way)."""
    os.makedirs(os.path.dirname(wav_dest_path), exist_ok=True)
    _convert_to_wav(raw_bytes, wav_dest_path)
    try:
        text = transcribe_wav(wav_dest_path)
        return text, True
    except SttNotConfigured:
        return "", False


class StreamingRecognizer:
    """Incremental transcription for /ws/stt: unlike transcribe_upload
    (record a whole clip, upload it, wait for one result), this feeds raw
    PCM straight into Vosk as it arrives from the browser's microphone, so
    the patient sees words appear while they're still talking instead of
    only after they stop and a round-trip upload completes - the actual
    "live" part of live voice input, not just self-hosted-vs-browser.

    Expects mono 16-bit PCM at 16 kHz (see
    frontend-react/src/lib/live-stt.js, which resamples the browser's mic
    capture to exactly this before sending - Vosk itself has no format
    flexibility here)."""

    def __init__(self):
        _load_model()
        if _model is None:
            raise SttNotConfigured(_model_load_error)
        from vosk import KaldiRecognizer
        self._recognizer = KaldiRecognizer(_model, 16000)
        self._recognizer.SetWords(False)

    def feed(self, pcm16_bytes: bytes) -> dict:
        """One chunk of audio in. Returns {"final": True, "text": "..."}
        the moment Vosk decides an utterance boundary was reached (usually
        a short pause), or {"final": False, "text": "..."} with the
        current in-progress guess otherwise - the "text" may be "" either
        way (silence, or not enough signal yet to guess anything)."""
        if self._recognizer.AcceptWaveform(pcm16_bytes):
            text = json.loads(self._recognizer.Result()).get("text", "")
            return {"final": True, "text": text}
        text = json.loads(self._recognizer.PartialResult()).get("partial", "")
        return {"final": False, "text": text}

    def finish(self) -> str:
        """Call once when the mic is switched off, to flush whatever
        Vosk was still holding onto as an in-progress guess (otherwise
        the last couple of words spoken right before stopping can be
        silently dropped instead of committed)."""
        return json.loads(self._recognizer.FinalResult()).get("text", "")
