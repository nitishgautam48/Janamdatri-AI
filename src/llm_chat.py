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

# Without this, Ollama's own default (5 minutes) unloads the model from
# GPU memory after any 5-minute gap between messages - completely normal
# in a real chat (a patient reads, thinks, types). The NEXT message then
# pays the full cost of reloading a multi-GB model from disk into VRAM
# before generation can even start, which used to blow past
# REQUEST_TIMEOUT_SECONDS and silently fall back to the scripted reply -
# the "first few messages are rule-based, then it starts using DeepSeek"
# pattern. Keeping it loaded for 30 minutes covers realistic gaps in an
# active conversation; sent on every request (not just relying on a
# server-side env default) so this is self-contained here.
OLLAMA_KEEP_ALIVE = "30m"

# Generous enough to tolerate a cold model load (see OLLAMA_KEEP_ALIVE
# above) ON TOP OF actual generation time for a 7B model on modest
# hardware - the old 45s was tuned for warm-model latency only, and a
# cold call routinely exceeded it, triggering a fallback that looked like
# a bug rather than the one-time cost it actually was.
REQUEST_TIMEOUT_SECONDS = 90
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


# For turning an already-computed Assessment result (src/dynamic_eval/
# triage.py's synthesize()) into a warm, personalized explanation in the
# patient's own language - see src/api/main.py's /assess handler for where
# this is called. The risk LEVEL, MRI score, and every finding are 100%
# deterministic rule-based output computed BEFORE this is ever called and
# passed in as fixed facts; this prompt is told explicitly to only explain
# what it's given, in the requested language, never to re-derive, second-
# guess, or add to the clinical content itself - the same "never let an
# LLM make the safety call" principle chat_assistant.py applies, just
# applied to explaining a decision instead of making one.
EXPLAIN_SYSTEM_PROMPT = (
    "You are Janamdatri's assistant, helping a pregnant or postpartum woman in India understand her "
    "own pregnancy risk assessment result. You will be given the result as already-computed facts: a "
    "risk level, a score, and a list of findings/recommendations. Your ONLY job is to explain these "
    "facts warmly and clearly in plain language - you must NOT add any new medical finding, change the "
    "risk level, suggest a different course of action, or claim anything beyond what's given. Write "
    "3-5 short sentences. If the level is Critical or Severe, keep the urgency clear and do not soften "
    "it. Always end by reminding her to follow up with her ANC provider or ASHA/ANM worker. Reply ONLY "
    "in the requested language/script. Never include any Chinese, or any other language or script, "
    "anywhere in your reply."
)

_LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi, written in Devanagari script",
    "hinglish": "Hinglish - Hindi written in Latin/English script, not Devanagari",
}


def _language_instruction(language: str | None) -> str:
    name = _LANGUAGE_NAMES.get(language, _LANGUAGE_NAMES["en"])
    return f"Reply in {name}."


# For explaining an already-extracted report (src/dynamic_eval/
# report_analyzer.py's analyze()) in plain language. Deliberately grounded
# ONLY on that module's own structured output (summary/medications/
# findings), never on the raw OCR'd text directly - report_analyzer.py's
# pattern-matching extraction is the one thing allowed to read the messy
# source text, same reasoning as EXPLAIN_SYSTEM_PROMPT above: an LLM must
# never be the one deciding what a drug name/dose/lab value actually is,
# only explain what the deterministic extractor already found. A
# hallucinated dose is a real harm a hallucinated risk-level explanation
# isn't, so this is intentionally more conservative than
# EXPLAIN_SYSTEM_PROMPT - it's told to flatly refuse to state a specific
# drug/dose itself and point back to the structured list instead.
REPORT_EXPLAIN_SYSTEM_PROMPT = (
    "You are Janamdatri's assistant, helping a pregnant or postpartum woman in India understand a "
    "medical report (prescription or lab report) that has already been analyzed. You will be given the "
    "analysis as already-computed facts: a summary, a list of medications found, and a list of "
    "findings (some flagged as needing attention). Your ONLY job is to explain these facts warmly and "
    "clearly in plain language - you must NOT name a specific drug or dose yourself (refer her to the "
    "medication list already shown instead), add a new finding, or claim anything beyond what's given. "
    "Write 2-4 short sentences. If any finding is flagged, keep that clear and say it's worth asking "
    "her provider about. Always end by reminding her that this reading doesn't replace following what "
    "her actual prescriber wrote. Reply ONLY in the requested language/script. Never include any "
    "Chinese, or any other language or script, anywhere in your reply."
)

# For reflecting on an already-scored EPDS result (src/dynamic_eval/
# psych_eval.py's score()) - the validated depression/anxiety screening
# instrument's scoring algorithm itself is NEVER touched by this, same
# principle as EXPLAIN_SYSTEM_PROMPT. The one critical difference: when
# selfHarmFlagged is true, item 10 (thoughts of self-harm) has already
# been raised regardless of the total score - the SAME maximum-urgency
# signal chat_assistant.py's CRISIS_REPLY treats as overriding everything
# else. This prompt is told explicitly never to write a softer reflection
# than that in the self-harm-flagged case, and to always include the
# KIRAN helpline there - it must not be the one deciding whether this is
# urgent (the deterministic selfHarmFlagged flag already decided that),
# only how to phrase acknowledging it.
EPDS_REFLECT_SYSTEM_PROMPT = (
    "You are Janamdatri's assistant, helping a pregnant or postpartum woman in India understand her "
    "own EPDS (Edinburgh Postnatal Depression Scale) screening result. You will be given the result as "
    "already-computed facts: a classification, score, and whether a self-harm item was flagged. Your "
    "ONLY job is to reflect on these facts warmly and supportively in plain language - you must NOT "
    "add a new finding, change the classification, or claim anything beyond what's given. Write 3-5 "
    "short sentences. This is a SCREENING result, not a diagnosis - never say she 'has depression', "
    "only that the screening suggests following up. If selfHarmFlagged is true, this is a serious "
    "safety signal: be direct and caring, validate that these feelings are taken seriously, and ALWAYS "
    "include the KIRAN helpline (1800-599-0019, toll-free, 24x7) in your reply - do not write a soft or "
    "minimizing reflection in this case. Otherwise, always end by encouraging her to talk to her ANC "
    "provider or a counsellor about how she's been feeling. Reply ONLY in the requested language/"
    "script. Never include any Chinese, or any other language or script, anywhere in your reply."
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

    payload = json.dumps({
        "model": OLLAMA_MODEL, "messages": messages, "stream": False, "keep_alive": OLLAMA_KEEP_ALIVE,
    }).encode("utf-8")
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


def explain_assessment(triage_result: dict, language: str = "en") -> str:
    """triage_result is the dict src/dynamic_eval/triage.py's synthesize()
    returns (same dict the API serializes as-is) - this reads only its
    already-computed fields (severity level/MRI, the deterministic
    clinicalExplanation, and recommendations) and asks the LLM to restate
    them warmly in the requested language, never to recompute or add to
    them. Same LlmNotConfigured/LlmError contract as respond(): the caller
    (POST /assess in src/api/main.py) leaves the result's llmExplanation
    field unset on either, so the existing static clinicalExplanation/
    recommendations text (already shown in the UI) is all that's lost,
    not the assessment itself."""
    severity = triage_result.get("severity", {})
    exp = triage_result.get("clinicalExplanation") or {}
    recommendations = triage_result.get("recommendations") or []

    facts_lines = [
        f"Risk level: {severity.get('level')}",
        f"Risk score (MRI): {triage_result.get('mri')}/100",
    ]
    if exp.get("recommendedNextAction"):
        facts_lines.append(f"Recommended next action: {exp['recommendedNextAction']}")
    if exp.get("whyThisResult"):
        facts_lines.append("Findings: " + "; ".join(exp["whyThisResult"]))
    if recommendations:
        facts_lines.append("Recommendations: " + "; ".join(recommendations))
    facts = "\n".join(facts_lines)

    messages = [
        {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
        {"role": "user", "content": f"{_language_instruction(language)}\n\n{facts}"},
    ]
    return _call_ollama(messages, REQUEST_TIMEOUT_SECONDS)


def explain_report(report_result: dict, language: str = "en") -> str:
    """report_result is the dict src/dynamic_eval/report_analyzer.py's
    analyze() returns - reads only its own structured output (summary/
    medications/findings), NEVER the raw OCR'd text directly (see
    REPORT_EXPLAIN_SYSTEM_PROMPT's docstring for why: the pattern-matching
    extractor is the only thing allowed to read messy source text and
    decide what a drug/dose/lab value is). Same LlmNotConfigured/LlmError
    contract as respond() - the caller (POST /documents/analyze) leaves
    llmExplanation unset on either, so the existing summary/medications/
    findings fields already shown in the UI are unaffected."""
    medications = report_result.get("medications") or []
    findings = report_result.get("findings") or []

    facts_lines = [f"Summary: {report_result.get('summary', '')}"]
    if medications:
        med_names = [m.get("name", "") for m in medications if m.get("name")]
        facts_lines.append(f"Medications found ({len(medications)}): " + "; ".join(med_names))
    flagged = [f for f in findings if f.get("flag")]
    if flagged:
        flagged_text = "; ".join(f"{f.get('label', '')} ({f.get('value', '')}): {f.get('flag', '')}" for f in flagged)
        facts_lines.append(f"Flagged findings needing attention: {flagged_text}")
    facts = "\n".join(facts_lines)

    messages = [
        {"role": "system", "content": REPORT_EXPLAIN_SYSTEM_PROMPT},
        {"role": "user", "content": f"{_language_instruction(language)}\n\n{facts}"},
    ]
    return _call_ollama(messages, REQUEST_TIMEOUT_SECONDS)


def reflect_on_epds(psych_result: dict, language: str = "en") -> str:
    """psych_result is the dict src/dynamic_eval/psych_eval.py's score()
    returns - reads only its own already-computed fields (classification,
    total, selfHarmFlagged, anxiety subscale). The validated EPDS scoring
    algorithm itself runs entirely before this and is never touched by
    it. See EPDS_REFLECT_SYSTEM_PROMPT's docstring for why selfHarmFlagged
    gets special handling - that flag, not this function, is what decides
    urgency. Same LlmNotConfigured/LlmError contract as respond() - the
    caller (POST /psych-assess) leaves llmReflection unset on either, so
    the existing classification/score already shown in the UI (and any
    self-harm escalation UI driven directly by selfHarmFlagged, not by
    this text) is unaffected."""
    anxiety = psych_result.get("anxietySubscale") or {}

    facts_lines = [
        f"Classification: {psych_result.get('classification')}",
        f"Total score: {psych_result.get('total')}/{psych_result.get('maxScore', 30)}",
        f"Self-harm item flagged: {psych_result.get('selfHarmFlagged')}",
    ]
    if anxiety.get("flagged"):
        facts_lines.append(f"Anxiety subscale also flagged: {anxiety.get('classification')}")
    facts = "\n".join(facts_lines)

    messages = [
        {"role": "system", "content": EPDS_REFLECT_SYSTEM_PROMPT},
        {"role": "user", "content": f"{_language_instruction(language)}\n\n{facts}"},
    ]
    return _call_ollama(messages, REQUEST_TIMEOUT_SECONDS)
