"""
Self-hosted LLM chat responses via Ollama (github.com/ollama/ollama) - same
privacy posture as src/stt.py's Vosk integration: the model runs in a
container you control, so a patient's message never leaves infrastructure
you own, unlike calling a hosted API.

This is NOT a replacement for the danger-sign ladder or self-harm ladder in
src/dynamic_eval/chat_assistant.py. Those stay exactly as deterministic as
they always were and are checked FIRST, before this module is ever
consulted - see that module's respond() and its own docstring for why an
LLM is deliberately kept out of "is this person describing a maternal
emergency / a self-harm risk" decisions. What this module DOES replace,
when configured, is everything downstream of that safety gate: the FAQ/
vague-topic/fallback layer that used to be purely scripted keyword matching.

Configured via two env vars, both required:
  OLLAMA_HOST  - e.g. http://localhost:11434, or http://ollama:11434 for
                 the "ollama" service name in docker-compose.yml.
  OLLAMA_MODEL - e.g. "deepseek-r1:7b" (must already be pulled into that
                 Ollama instance - this module doesn't pull models itself).

Degrades the same honest way stt.py does: not configured, or the Ollama
server/model unreachable, raises LlmNotConfigured/LlmError rather than
returning something - the caller (chat_assistant.respond()) catches both
and falls back to its own rule-based reply, so the chat never goes silent
or errors out just because the LLM service is down.

Session notes (2026-10-01): this sandbox's network policy blocks both
ollama.com and registry.ollama.ai (same CONNECT-rejected pattern as the
Hindi Vosk model - see stt.py's own session notes), so a real model can't
be pulled or run from here. This module's HTTP plumbing, response parsing,
<think>-tag stripping, and fallback-on-unreachable behavior ARE verified
here against a local mock server standing in for Ollama's /api/chat shape
(see the test referenced in this session's commit) - actual DeepSeek-R1
response quality needs a real pull-and-run on a machine with network
access and a GPU, same caveat as Hindi STT accuracy.
"""

import json
import os
import re
import urllib.error
import urllib.request

OLLAMA_HOST = os.environ.get("OLLAMA_HOST")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL")

REQUEST_TIMEOUT_SECONDS = 45
# A full call transcript is a lot more tokens to read and respond to than a
# one-line chat message - same model, same connection, just needs longer
# before this code decides "not coming back" rather than the chat's own
# REQUEST_TIMEOUT_SECONDS.
SUMMARY_TIMEOUT_SECONDS = 120

# Deliberately narrow: general pregnancy/postpartum information only, never
# a diagnosis or a prescription, and told to hand anything emergency-shaped
# back to in-person care rather than try to resolve it in chat - a second,
# soft layer of the same caution the deterministic danger-sign/self-harm
# gate already enforces upstream of this module, not a replacement for it
# (a system prompt is guidance an LLM can still drift from, not a
# guarantee - the real guarantee is that gate running first every time).
SYSTEM_PROMPT = (
    "You are Janamdatri's assistant, helping a pregnant or postpartum woman in India with general "
    "questions about pregnancy, nutrition, postpartum recovery, and newborn care. You are NOT a doctor "
    "and must never diagnose, prescribe medication, or claim certainty about a medical condition. Keep "
    "answers short (2-4 sentences), warm, and practical. If the message describes anything that could "
    "be a medical emergency (heavy bleeding, severe pain, convulsions, reduced baby movement, thoughts "
    "of self-harm, etc.), tell them to seek in-person medical care or call 108 immediately rather than "
    "answering in chat. Always end with a reminder to confirm anything important with their ANC provider "
    "or ASHA/ANM worker. Reply ONLY in the same language/script the user wrote in - English, Hindi "
    "(Devanagari), or Hinglish (Hindi in Latin script). Never include any Chinese, or any other "
    "language or script, anywhere in your reply."
)

# For condensing a finished voice-call transcript (src/live_chat.py's
# accumulating call-transcript row) into something a doctor can actually
# read, instead of scrolling a full raw back-and-forth - see ws_live's
# call_transcript_end handling in src/api/main.py for the "Patient:"/
# "Counsellor:" line format this is fed. Summarizing is lower-risk than
# the general chat-reply use case above (it's condensing what was already
# said, not generating new advice), but still told to stick to what's
# actually in the transcript rather than filling gaps.
SUMMARY_SYSTEM_PROMPT = (
    "You are summarizing a transcript of a phone call between a pregnant or postpartum patient and "
    "her counsellor, for a doctor who will read your summary before the full transcript. The "
    "transcript lines are labeled 'Patient:' or 'Counsellor:'. Write a short summary (3-6 sentences or "
    "bullet points) covering: symptoms or concerns the patient described, any measurements/vitals "
    "mentioned, and any advice or next steps the counsellor gave. Only summarize what is actually in "
    "the transcript - never add information, a diagnosis, or advice that isn't there. If the "
    "transcript is too short or unclear to summarize meaningfully, say so plainly instead of guessing."
)


class LlmNotConfigured(Exception):
    pass


class LlmError(Exception):
    pass


def is_configured() -> bool:
    return bool(OLLAMA_HOST and OLLAMA_MODEL)


# DeepSeek-R1 (and other Ollama-served "reasoning" models) prefix their
# answer with raw chain-of-thought wrapped in <think>...</think> - internal
# scratch work a patient should never see rendered as the bot's reply.
def _strip_think_tags(text: str) -> str:
    while "<think>" in text and "</think>" in text:
        start = text.index("<think>")
        end = text.index("</think>") + len("</think>")
        text = text[:start] + text[end:]
    return text.strip()


# DeepSeek-R1's distilled models (distilled from a Qwen base, trained on a
# Chinese-heavy corpus) occasionally leak Chinese characters into an
# otherwise English/Hindi/Hinglish reply, regardless of what SYSTEM_PROMPT
# asks for - a known quirk of this model family, not something prompting
# alone reliably prevents. Rather than ever show a patient a reply that's
# half Hindi half Mandarin, treat it the same as any other bad response:
# raise LlmError so the caller falls back to the rule-based reply instead.
# Matches CJK Unified Ideographs (the common Chinese character block) and
# its Extension A block - deliberately narrow to actual Chinese script, not
# e.g. Devanagari or Latin-script punctuation.
_CJK_RE = re.compile(r"[一-鿿㐀-䶿]")


def _contains_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text))


def _call_ollama(messages: list[dict], timeout_seconds: int) -> str:
    """Shared HTTP plumbing for respond() and summarize_call_transcript() -
    both just assemble a different messages list and want the same
    request/parse/<think>-stripping/error-wrapping around it. Raises
    LlmNotConfigured/LlmError exactly as respond() documents."""
    if not is_configured():
        raise LlmNotConfigured(
            "OLLAMA_HOST and/or OLLAMA_MODEL are not set - see src/llm_chat.py's module docstring."
        )

    payload = json.dumps({"model": OLLAMA_MODEL, "messages": messages, "stream": False}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST.rstrip('/')}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise LlmError(f"Could not reach Ollama at {OLLAMA_HOST}: {exc}") from exc
    except TimeoutError as exc:
        raise LlmError(f"Ollama at {OLLAMA_HOST} timed out after {timeout_seconds}s: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise LlmError(f"Ollama returned an unreadable response: {exc}") from exc

    try:
        text = body["message"]["content"]
    except (KeyError, TypeError) as exc:
        raise LlmError(f"Unexpected Ollama response shape: {body!r}") from exc

    text = _strip_think_tags(text)
    if not text:
        raise LlmError("Ollama returned an empty response after stripping <think> tags.")
    if _contains_cjk(text):
        raise LlmError(f"Ollama response contained unexpected Chinese characters: {text!r}")
    return text


def respond(message: str, history: list[dict] | None = None) -> str:
    """history is [{"role": "user"|"assistant", "content": str}, ...] from
    earlier turns in the SAME exchange, oldest first - optional, omit for a
    single-turn reply. Raises LlmNotConfigured if OLLAMA_HOST/OLLAMA_MODEL
    aren't both set, or LlmError if the server can't be reached, times out,
    or returns something this code doesn't recognize."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": message})
    return _call_ollama(messages, REQUEST_TIMEOUT_SECONDS)


def summarize_call_transcript(raw_text: str) -> str:
    """raw_text is the accumulated "Patient: ...\\nCounsellor: ..." lines
    from one call (see src/live_chat.py's append_call_segment). Same
    LlmNotConfigured/LlmError contract as respond() - the caller
    (ws_live's call_transcript_end handling) leaves call_summary unset on
    either, so a doctor without Ollama configured just sees the raw
    transcript with no summary section, not an error."""
    messages = [
        {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
        {"role": "user", "content": raw_text},
    ]
    return _call_ollama(messages, SUMMARY_TIMEOUT_SECONDS)
