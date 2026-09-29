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
silently: if no model is configured/found, transcribe() raises
SttNotConfigured with a clear message, the /stt/transcribe endpoint turns
that into a 503, and the frontend falls back to the browser's own
SpeechRecognition - so voice input keeps working either way, it just isn't
self-hosted until a model is actually provisioned.

Provisioning a model (not done by this code - see the constraint below):
  1. pip install vosk  (already in requirements - the library itself has
     no bundled model; models are a separate download)
  2. Download a Hindi model, e.g. vosk-model-small-hi-0.22 (~50 MB) from
     https://alphacephei.com/vosk/models and unzip it somewhere durable.
  3. Set VOSK_MODEL_PATH to that unzipped folder before starting the API.
A larger vosk-model-hi (bigger, more accurate) or an AI4Bharat/IndicWav2Vec
checkpoint (github.com/AI4Bharat/vistaar) can be swapped in the same way -
this module only needs a directory Vosk's Model() class can load.

Note: this repo's own dev sandbox cannot download the model file itself
(its network policy allows PyPI/npm but not alphacephei.com or
huggingface.co), so the actual model was never fetched or accuracy-tested
here. The integration below is real and exercised end-to-end against the
"not configured" path; verifying real transcription accuracy needs to
happen wherever VOSK_MODEL_PATH actually gets set.
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


def transcribe_upload(raw_bytes: bytes) -> str:
    """Converts whatever the browser's MediaRecorder produced (webm/opus,
    ogg, m4a, ...) to the mono 16 kHz PCM WAV Vosk needs, via ffmpeg, then
    transcribes it. Raises SttNotConfigured (no model) or SttError
    (ffmpeg missing/failed, or an unreadable/empty clip)."""
    _load_model()
    if _model is None:
        raise SttNotConfigured(_model_load_error)

    with tempfile.TemporaryDirectory() as tmp:
        src_path = os.path.join(tmp, "input")
        wav_path = os.path.join(tmp, "audio.wav")
        with open(src_path, "wb") as f:
            f.write(raw_bytes)

        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wav_path],
                capture_output=True, timeout=30,
            )
        except FileNotFoundError as exc:
            raise SttError("ffmpeg is not installed on this server - required to convert recorded audio for Vosk.") from exc
        except subprocess.TimeoutExpired as exc:
            raise SttError("Audio conversion timed out.") from exc

        if result.returncode != 0 or not os.path.exists(wav_path):
            raise SttError(f"Could not convert the recorded audio: {result.stderr.decode(errors='replace')[-500:]}")

        return transcribe_wav(wav_path)
