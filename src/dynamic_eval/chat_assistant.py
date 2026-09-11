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
is reachable, not to replace one. "Training" it means widening its
phrase coverage and adding a graceful clarifying-question fallback for
vague distress language ("I'm in pain", "I don't feel well") that isn't
specific enough to match a category on its own - asking a follow-up
question is far more useful than a flat "I didn't understand that."
"""

from . import danger_ladder, text_analyzer

FAQ_INTENTS = [
    {
        "id": "greeting",
        "phrases": ["hi", "hello", "hey", "namaste", "नमस्ते", "good morning", "good evening"],
        "reply": ("Hello! I can help with common pregnancy questions - nutrition, ANC visits, danger "
                  "signs, labor, vaccinations, or where to get help. What would you like to know? If "
                  "this is an emergency, just tell me your symptoms and I'll flag it right away."),
    },
    {
        "id": "thanks",
        "phrases": ["thank you", "thanks", "thank u", "shukriya", "धन्यवाद"],
        "reply": "You're welcome! Take care of yourself, and reach out anytime you have a question or concern.",
    },
    {
        "id": "anc_schedule",
        "phrases": ["anc visit", "checkup schedule", "when should i go for checkup", "antenatal care",
                    "pmsma", "next checkup", "how many checkups", "एएनसी"],
        "reply": ("India's RCH programme recommends at least 4 ANC visits: within 12 weeks, 14-26 weeks, "
                  "28-34 weeks, and 36 weeks to term. PMSMA gives a free ANC checkup on the 9th of every "
                  "month at government facilities. See the Pregnancy Guide tab for your personalized schedule."),
    },
    {
        "id": "nutrition",
        "phrases": ["what should i eat", "what to eat", "diet", "nutrition", "food during pregnancy",
                    "iron tablets", "folic acid", "eating habits", "hungry all the time", "vomiting",
                    "morning sickness", "nausea", "पोषण", "खाना"],
        "reply": ("Take your iron-folic acid (IFA) tablets as prescribed, eat iron-rich foods (leafy "
                  "greens, jaggery, lentils), and add calcium from the second trimester. Small, frequent "
                  "meals help with nausea. See the Pregnancy Guide tab for trimester-specific tips."),
    },
    {
        "id": "anemia",
        "phrases": ["anemia", "hemoglobin", "hb level", "feeling weak", "always tired", "एनीमिया"],
        "reply": ("Anemia is very common in pregnancy in India - about half of pregnant women are affected. "
                  "If you have a recent hemoglobin (Hb) test, enter it in the Assessment tab's Anemia Check "
                  "for India-specific grading. Below 7 g/dL is a severe-anemia emergency - go to a facility."),
    },
    {
        "id": "mental_health",
        "phrases": ["feeling sad", "depressed", "anxious", "cant sleep", "mood", "stress", "im scared",
                    "i am scared", "worried", "overwhelmed", "crying a lot", "उदास"],
        "reply": ("Feeling low, anxious, or overwhelmed during or after pregnancy is common and treatable - "
                  "it's not a personal failing. Try the Mental Health Check (EPDS) tab, or talk to your ANC "
                  "provider. If you ever have thoughts of harming yourself, call KIRAN: 1800-599-0019 (24x7)."),
    },
    {
        "id": "helpline",
        "phrases": ["helpline", "phone number", "emergency number", "ambulance number", "contact",
                    "call ambulance", "who do i call"],
        "reply": ("Emergency ambulance: 108. Pregnancy emergency transport: 102. Women's helpline: 181. "
                  "Mental health (KIRAN): 1800-599-0019. See the Helplines tab for the full list."),
    },
    {
        "id": "labor_signs",
        "phrases": ["am i in labor", "labour signs", "labor signs", "contractions", "how do i know labor",
                    "water broke", "waters broke", "when will i deliver"],
        "reply": ("Signs labor may be starting: regular, increasingly strong contractions; your water "
                  "breaking; lower back pain with tightening. If contractions are regular and less than "
                  "5-10 minutes apart, or your water breaks, head to your planned facility now - don't wait "
                  "at home to see if it's 'real' labor."),
    },
    {
        "id": "fetal_movement",
        "phrases": ["baby movement", "kick count", "how many kicks", "baby kicking", "fetal movement"],
        "reply": ("From about the second trimester, you should feel regular movement every day. A noticeable "
                  "drop in movement, or none at all in a few hours where the baby is usually active, is a "
                  "reason to go get checked the same day - don't wait until the next scheduled visit."),
    },
    {
        "id": "vaccination",
        "phrases": ["vaccine", "vaccination", "tt injection", "tetanus shot", "td injection", "immunization"],
        "reply": ("The Td (tetanus-diphtheria) vaccine is usually given in two doses during pregnancy, "
                  "starting in the second trimester - your ANC provider will schedule these at your visits. "
                  "See the Pregnancy Guide tab for the full ANC schedule."),
    },
    {
        "id": "delivery_place",
        "phrases": ["where should i deliver", "hospital delivery", "home birth", "which hospital",
                    "institutional delivery"],
        "reply": ("An institutional delivery (hospital or PHC/FRU with skilled staff and emergency care "
                  "available) is safer than a home birth, especially if any risk factors are present. "
                  "JSY provides cash assistance for institutional delivery - ask your ASHA worker."),
    },
]

# Vague distress language that isn't specific enough to match a category on
# its own ("I'm in pain", "I don't feel well") - rather than a flat "I
# didn't understand," ask a clarifying question the way a triage nurse
# would, so the person can give the detail that actually determines urgency.
VAGUE_SYMPTOM_WORDS = [
    "pain", "hurt", "hurting", "ache", "aching", "discomfort", "not feeling well",
    "dont feel well", "don't feel well", "feel sick", "feeling sick", "unwell", "not well",
    "something wrong", "not right", "worried about my body",
]

CLARIFYING_REPLY = (
    "I'm sorry you're feeling that way. Can you tell me more so I can help properly? "
    "For example: where is it (head, abdomen, chest, back)? How severe is it (mild, "
    "moderate, severe)? Did it start suddenly? Is there any bleeding, fever, or reduced "
    "baby movement along with it? If it's sudden, severe, or you're bleeding, please "
    "treat it as urgent - go to a facility or call 108 now rather than waiting to describe it further."
)

FALLBACK_REPLY = (
    "I'm not sure I understood that. I can answer questions about ANC visits, nutrition, anemia, "
    "mental health, labor signs, vaccinations, or helplines - or describe your symptoms and I'll "
    "check for danger signs. For anything urgent, please contact your ASHA/ANM worker or call 108."
)


def _match_faq(normalized_text: str):
    for intent in FAQ_INTENTS:
        if any(phrase in normalized_text for phrase in intent["phrases"]):
            return intent
    return None


def _matches_vague_symptom(normalized_text: str) -> bool:
    return any(word in normalized_text for word in VAGUE_SYMPTOM_WORDS)


def respond(message: str, context_message: str = None) -> dict:
    text = (message or "").strip()

    # One-turn memory: when the PREVIOUS bot reply was a clarifying
    # question ("tell me more"), the caller passes that original message
    # back as context_message. A short follow-up like "yes it started
    # bleeding" has almost no signal analyzed alone - combined with what
    # prompted the question in the first place, danger-sign detection has
    # something real to work with. Only the immediately preceding turn is
    # carried, not an unbounded conversation history, which keeps this a
    # deliberate one-step "tell me more" exchange rather than open-ended
    # state the caller has to manage.
    analysis_text = f"{context_message}. {text}" if context_message else text
    normalized = analysis_text.lower()

    # Safety first: reuse the same danger-sign detection the assessment
    # flow uses. A matched danger sign always overrides FAQ matching.
    ladder_result = danger_ladder.classify(analysis_text)
    text_scores = text_analyzer.analyze(analysis_text)["scores"]
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

    if _matches_vague_symptom(normalized):
        return {"reply": CLARIFYING_REPLY, "isEmergency": False, "intent": "clarify_symptom"}

    return {"reply": FALLBACK_REPLY, "isEmergency": False, "intent": "fallback"}
