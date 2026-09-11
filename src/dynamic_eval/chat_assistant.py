"""
Instant Help Chat Assistant - rule-based (no external LLM dependency, so
it works offline and needs no API key), sharing the same danger-sign
detection this app's assessment flow already uses. If a message matches a
WHO danger sign, safety comes first: the bot responds with an emergency
escalation and does not try to be a general FAQ bot for that turn - the
way a trained health-worker helpline would triage a call before chatting.

This is a scripted assistant, not a real conversational AI - it matches
keywords into a fixed set of intents. It exists to get a woman a useful,
instant answer (or an emergency escalation) at 2am when no health worker
is reachable, not to replace one.
"""

from . import danger_ladder, text_analyzer

FAQ_INTENTS = [
    {
        "id": "greeting",
        "phrases": ["hi", "hello", "hey", "namaste", "नमस्ते"],
        "reply": ("Hello! I can help with common pregnancy questions - nutrition, ANC visits, danger "
                  "signs, or where to get help. What would you like to know? If this is an emergency, "
                  "just tell me your symptoms and I'll flag it right away."),
    },
    {
        "id": "anc_schedule",
        "phrases": ["anc visit", "checkup schedule", "when should i go for checkup", "antenatal care",
                    "pmsma", "एएनसी"],
        "reply": ("India's RCH programme recommends at least 4 ANC visits: within 12 weeks, 14-26 weeks, "
                  "28-34 weeks, and 36 weeks to term. PMSMA gives a free ANC checkup on the 9th of every "
                  "month at government facilities. See the Pregnancy Guide tab for your personalized schedule."),
    },
    {
        "id": "nutrition",
        "phrases": ["what should i eat", "diet", "nutrition", "food during pregnancy", "iron tablets",
                    "folic acid", "पोषण"],
        "reply": ("Take your iron-folic acid (IFA) tablets as prescribed, eat iron-rich foods (leafy "
                  "greens, jaggery, lentils), and add calcium from the second trimester. Small, frequent "
                  "meals help with nausea. See the Pregnancy Guide tab for trimester-specific tips."),
    },
    {
        "id": "anemia",
        "phrases": ["anemia", "hemoglobin", "hb level", "feeling weak", "एनीमिया"],
        "reply": ("Anemia is very common in pregnancy in India - about half of pregnant women are affected. "
                  "If you have a recent hemoglobin (Hb) test, enter it in the Assessment tab's Anemia Check "
                  "for India-specific grading. Below 7 g/dL is a severe-anemia emergency - go to a facility."),
    },
    {
        "id": "mental_health",
        "phrases": ["feeling sad", "depressed", "anxious", "cant sleep", "mood", "stress", "उदास"],
        "reply": ("Feeling low, anxious, or overwhelmed during or after pregnancy is common and treatable - "
                  "it's not a personal failing. Try the Mental Health Check (EPDS) tab, or talk to your ANC "
                  "provider. If you ever have thoughts of harming yourself, call KIRAN: 1800-599-0019 (24x7)."),
    },
    {
        "id": "helpline",
        "phrases": ["helpline", "phone number", "emergency number", "ambulance number", "contact"],
        "reply": ("Emergency ambulance: 108. Pregnancy emergency transport: 102. Women's helpline: 181. "
                  "Mental health (KIRAN): 1800-599-0019. See the Helplines tab for the full list."),
    },
]

FALLBACK_REPLY = (
    "I'm not sure I understood that. I can answer questions about ANC visits, nutrition, anemia, "
    "mental health, or helplines - or describe your symptoms and I'll check for danger signs. For "
    "anything urgent, please contact your ASHA/ANM worker or call 108."
)


def _match_faq(normalized_text: str):
    for intent in FAQ_INTENTS:
        if any(phrase in normalized_text for phrase in intent["phrases"]):
            return intent
    return None


def respond(message: str) -> dict:
    text = (message or "").strip()
    normalized = text.lower()

    # Safety first: reuse the same danger-sign detection the assessment
    # flow uses. A matched danger sign always overrides FAQ matching.
    ladder_result = danger_ladder.classify(text)
    text_scores = text_analyzer.analyze(text)["scores"]
    high_category_score = max(text_scores.values()) if text_scores else 0.0

    if ladder_result["rung"] >= 4 or high_category_score >= 0.85:
        return {
            "reply": (
                f"⚠️ What you're describing ({ladder_result['matchedPhrase'] or 'this symptom'}) "
                "sounds like it could be a danger sign. Please go to the nearest health facility now, "
                "or call for emergency transport: 108 (ambulance) or 102 (pregnancy transport). "
                "Don't wait to see if it gets better."
            ),
            "isEmergency": True,
            "dangerLadder": ladder_result,
        }

    intent = _match_faq(normalized)
    if intent:
        return {"reply": intent["reply"], "isEmergency": False, "intent": intent["id"]}

    if high_category_score >= 0.4:
        return {
            "reply": (
                "That sounds like it's worth keeping an eye on. Consider running a full Assessment in "
                "the Assessment tab, or contacting your ASHA/ANM worker if it doesn't improve."
            ),
            "isEmergency": False,
            "intent": "mild_symptom",
        }

    return {"reply": FALLBACK_REPLY, "isEmergency": False, "intent": "fallback"}
