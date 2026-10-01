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
import urllib.error
import urllib.request

OLLAMA_HOST = os.environ.get("OLLAMA_HOST")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL")

REQUEST_TIMEOUT_SECONDS = 45

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
    "or ASHA/ANM worker. Reply in the same language/script the user wrote in (English, Hindi, or "
    "Hinglish)."
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


def respond(message: str, history: list[dict] | None = None) -> str:
    """history is [{"role": "user"|"assistant", "content": str}, ...] from
    earlier turns in the SAME exchange, oldest first - optional, omit for a
    single-turn reply. Raises LlmNotConfigured if OLLAMA_HOST/OLLAMA_MODEL
    aren't both set, or LlmError if the server can't be reached, times out,
    or returns something this code doesn't recognize."""
    if not is_configured():
        raise LlmNotConfigured(
            "OLLAMA_HOST and/or OLLAMA_MODEL are not set - see src/llm_chat.py's module docstring."
        )

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": message})

    payload = json.dumps({"model": OLLAMA_MODEL, "messages": messages, "stream": False}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST.rstrip('/')}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise LlmError(f"Could not reach Ollama at {OLLAMA_HOST}: {exc}") from exc
    except TimeoutError as exc:
        raise LlmError(f"Ollama at {OLLAMA_HOST} timed out after {REQUEST_TIMEOUT_SECONDS}s: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise LlmError(f"Ollama returned an unreadable response: {exc}") from exc

    try:
        text = body["message"]["content"]
    except (KeyError, TypeError) as exc:
        raise LlmError(f"Unexpected Ollama response shape: {body!r}") from exc

    text = _strip_think_tags(text)
    if not text:
        raise LlmError("Ollama returned an empty response after stripping <think> tags.")
    return text
