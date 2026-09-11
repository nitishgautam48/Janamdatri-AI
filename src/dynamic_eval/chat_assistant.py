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

from . import danger_ladder, expert_system, text_analyzer
from .phrase_match import contains_phrase, normalize

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
                    "morning sickness", "nausea", "nauseous", "पोषण", "खाना"],
        "reply": ("Take your iron-folic acid (IFA) tablets as prescribed, eat iron-rich foods (leafy "
                  "greens, jaggery, lentils), and add calcium from the second trimester. Small, frequent "
                  "meals help with nausea. See the Pregnancy Guide tab for trimester-specific tips."),
    },
    {
        "id": "food_safety",
        "phrases": ["eat papaya", "raw papaya", "eat pineapple", "safe to eat", "foods to avoid",
                    "what not to eat", "street food", "raw food", "undercooked", "raw fish", "sushi"],
        "reply": ("Ripe papaya and pineapple in normal amounts are fine - the traditional caution is "
                  "specifically about large amounts of RAW/unripe papaya. Avoid unpasteurized dairy, "
                  "undercooked meat/eggs/fish, and raw seafood (listeria/toxoplasmosis risk); limit "
                  "caffeine, and avoid alcohol completely. When in doubt about a specific food, ask your "
                  "ANC provider rather than relying on general advice."),
    },
    {
        "id": "hydration",
        "phrases": ["how much water", "hydration", "drink water", "dehydration", "dehydrated"],
        "reply": ("Aim for about 2.5-3 litres of water a day, more in hot weather or if you're vomiting - "
                  "dark urine, dizziness, or a dry mouth are signs you need more. Severe vomiting that "
                  "stops you from keeping fluids down needs same-day medical attention, not just more water."),
    },
    {
        "id": "missed_period",
        "phrases": ["missed my period", "missed period", "late period", "think im pregnant",
                    "might be pregnant"],
        "reply": ("A missed period is one of the earliest pregnancy signs - a home urine pregnancy test "
                  "(after your period is a few days late) or a visit to your ASHA/ANM or a clinic can "
                  "confirm it. If it's positive, register for ANC care as early as possible - the first "
                  "trimester matters for screening and starting supplements."),
    },
    {
        "id": "medication_safety",
        "phrases": ["take paracetamol", "is paracetamol safe", "safe medicine", "which medicines are safe",
                    "can i take medicine", "otc medicine", "pain medicine", "ibuprofen", "safe painkiller"],
        "reply": ("Paracetamol (acetaminophen) at the recommended dose is generally considered safe in "
                  "pregnancy, but ibuprofen, aspirin, and most other painkillers are NOT recommended, "
                  "especially later in pregnancy. Always check with your ANC provider or pharmacist before "
                  "taking ANY medicine, including ones that seem harmless - this includes herbal/ayurvedic "
                  "remedies too."),
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
        "phrases": ["feeling sad", "feel sad", "very sad", "so sad", "depressed", "anxious", "cant sleep",
                    "mood", "stress", "im scared", "i am scared", "worried", "overwhelmed", "crying a lot",
                    "not supportive", "no support", "no one to talk to", "alone in this", "उदास"],
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
        "phrases": ["in labor", "in labour", "labour signs", "labor signs", "contractions",
                    "how do i know labor", "water broke", "waters broke", "when will i deliver"],
        "reply": ("Signs labor may be starting: regular, increasingly strong contractions; your water "
                  "breaking; lower back pain with tightening. If contractions are regular and less than "
                  "5-10 minutes apart, or your water breaks, head to your planned facility now - don't wait "
                  "at home to see if it's 'real' labor."),
    },
    {
        "id": "fetal_movement",
        "phrases": ["baby movement", "kick count", "how many kicks", "baby kicking", "fetal movement",
                    "feel the baby move", "when will i feel movement", "when should i feel movement",
                    "baby move"],
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
                    "institutional delivery", "cost of delivery", "how much does delivery cost",
                    "is c section safe", "is cesarean safe", "c-section safe", "c section safe"],
        "reply": ("An institutional delivery (hospital or PHC/FRU with skilled staff and emergency care "
                  "available) is safer than a home birth, especially if any risk factors are present. "
                  "JSY provides cash assistance for institutional delivery - ask your ASHA worker."),
    },
    {
        "id": "blood_pressure",
        "phrases": ["blood pressure", "bp check", "whats normal bp", "what is normal bp", "is my bp high",
                    "bp reading", "hypertension", "high bp", "what is preeclampsia", "what is pre-eclampsia",
                    "what is eclampsia"],
        "reply": ("Normal BP in pregnancy is under 140/90 - readings at or above that (especially with "
                  "headache, blurred vision, or swelling) can mean pre-eclampsia and need same-day checking. "
                  "Get it checked at every ANC visit, and enter a reading in the Assessment tab if you have one."),
    },
    {
        "id": "gestational_diabetes",
        "phrases": ["gestational diabetes", "high blood sugar", "gdm", "sugar test", "glucose test",
                    "diabetes in pregnancy"],
        "reply": ("Gestational diabetes is usually screened with a glucose tolerance test around 24-28 weeks - "
                  "it's common and manageable with diet, activity, and monitoring, and usually resolves after "
                  "delivery. Unmanaged, it raises risks for both you and the baby, so don't skip the test."),
    },
    {
        "id": "leg_swelling_dvt",
        "phrases": ["one leg is swollen", "swollen leg", "leg pain and swelling", "red swollen leg",
                    "calf pain", "leg is red and warm", "one leg more swollen than the other"],
        "reply": ("Swelling in BOTH legs is common in pregnancy, but swelling, redness, warmth, or pain in "
                  "just ONE leg (especially the calf) can be a blood clot (DVT) - this needs same-day medical "
                  "evaluation, not a wait-and-see approach."),
    },
    {
        "id": "itching_cholestasis",
        "phrases": ["itching all over", "severe itching", "itchy skin no rash", "itching hands and feet",
                    "itching at night", "very itchy"],
        "reply": ("Intense itching, especially on the palms/soles and worse at night, with no rash, can be "
                  "obstetric cholestasis - a liver condition that's treatable but needs a blood test (liver "
                  "function/bile acids) to confirm. Mention it to your ANC provider rather than just managing "
                  "the itch."),
    },
    {
        "id": "warning_signs_list",
        "phrases": ["what are the warning signs", "list of danger signs", "what should i watch for",
                    "danger signs list", "warning signs of pregnancy"],
        "reply": ("Go to a facility now for any of: heavy vaginal bleeding, severe headache with blurred "
                  "vision, convulsions/fits, severe abdominal pain, high fever, fast/difficult breathing, "
                  "reduced or no baby movement, or chest pain. See the Pregnancy Guide tab for the full list "
                  "with more detail."),
    },
]

# Vague distress language that isn't specific enough to match a category on
# its own ("I'm in pain", "I don't feel well") - rather than a flat "I
# didn't understand," ask a clarifying question the way a triage nurse
# would, so the person can give the detail that actually determines urgency.
# Grouped by topic (not one generic bucket) so the follow-up question
# actually engages with what the person said, instead of reading like a
# canned response no matter what they typed.
VAGUE_TOPICS = [
    {
        "id": "pain",
        "keywords": ["pain", "hurt", "hurting", "ache", "aching", "cramp", "cramping", "discomfort"],
        "question": (
            "Tell me more about the pain so I can judge how urgent this is: where is it (head, "
            "abdomen, chest, back)? Is it mild, or severe enough that it's hard to ignore? Did it "
            "start suddenly, and is there any bleeding, fever, or reduced baby movement with it? "
            "If it's sudden or severe, treat it as urgent - go to a facility or call 108 now."
        ),
    },
    {
        "id": "energy",
        "keywords": ["tired all the time", "always tired", "no energy", "exhausted",
                     "low energy", "feeling weak", "so weak"],
        "question": (
            "How long has this tiredness/weakness been going on, and does it happen even after "
            "resting? Are you also breathless, dizzy, or looking unusually pale? Ongoing fatigue in "
            "pregnancy is very often anemia (worth a hemoglobin check), but sudden or severe weakness "
            "needs same-day evaluation - don't wait if it's severe."
        ),
    },
    {
        "id": "mood",
        "keywords": ["not myself", "off today", "emotionally", "cant cope", "can't cope"],
        "question": (
            "Do you mean this is more about how you're feeling emotionally, or is something physical "
            "going on too (pain, fever, bleeding)? If it's your mood, the Mental Health Check tab has "
            "a proper screening tool - and if you ever have thoughts of harming yourself, please call "
            "KIRAN right now: 1800-599-0019 (toll-free, 24x7)."
        ),
    },
    {
        "id": "palpitations",
        "keywords": ["heart racing", "heart is racing", "palpitations", "heart pounding", "heart beating fast"],
        "question": (
            "Does this happen at rest or only with activity, and how long does it last? Is it with any "
            "chest pain, breathlessness, dizziness, or fainting? A racing heart alone is often harmless in "
            "pregnancy, but with any of those together, or if it doesn't settle, get checked the same day."
        ),
    },
    {
        "id": "generic_unwell",
        "keywords": ["not feeling well", "dont feel well", "don't feel well", "feel sick",
                     "feeling sick", "unwell", "not well", "something wrong", "not right",
                     "worried about my body"],
        "question": (
            "Can you say a bit more about what's going on? Is it more physical - pain, fever, "
            "bleeding, breathlessness, reduced baby movement - or more about your mood or energy? "
            "And roughly how long has this been going on?"
        ),
    },
]

# After this many back-and-forth exchanges that STILL haven't resolved into
# a real answer, repeating another open-ended question stops being useful -
# a health worker would move to a concrete next step instead of asking the
# same thing a third time, so this bot should too.
MAX_CLARIFYING_ROUNDS = 2

NUDGE_REPLY = (
    "I don't want to keep going back and forth without actually helping. Please open the Assessment "
    "tab and run a full check (it takes about a minute and looks at a lot more than I can in chat), "
    "or contact your ASHA/ANM worker directly so they can properly examine what you're describing. "
    "If anything about this feels sudden, severe, or you're unsure, treat it as urgent and call 108 now."
)

FALLBACK_REPLY = (
    "I'm not sure I understood that. I can answer questions about ANC visits, nutrition, anemia, "
    "mental health, labor signs, vaccinations, or helplines - or describe your symptoms and I'll "
    "check for danger signs. For anything urgent, please contact your ASHA/ANM worker or call 108."
)

# Checked BEFORE anything else, independent of the EPDS tool - someone
# typing this in chat should never be routed into a physical-symptom flow
# or a generic FAQ answer first. Brief crisis-intervention structure
# (validate -> assess immediate safety -> reduce access to means -> connect
# with someone -> give a way to act right now), not just a phone number,
# following the same "ANY self-harm signal overrides everything else"
# principle this project already applies to EPDS item 10.
CRISIS_PHRASES = [
    "kill myself", "kill me", "end my life", "end it all", "want to die", "wanna die",
    "dont want to live", "don't want to live", "no reason to live", "better off dead",
    "harm myself", "hurt myself", "hurting myself", "suicide", "suicidal",
    "खुद को नुकसान", "आत्महत्या", "मरना चाहती हूं", "जीना नहीं चाहती",
]

CRISIS_REPLY = (
    "I'm really glad you told me this - these feelings are taken seriously, and this is not your "
    "fault. Are you safe right now, in this moment? If there's anything nearby you could use to harm "
    "yourself, please try to move away from it, and stay with someone you trust if you can. Please "
    "call KIRAN right now: 1800-599-0019 (toll-free, 24x7, trained counsellors) - if you feel you might "
    "act on these thoughts right now, call 108 or go to the nearest hospital immediately instead of "
    "waiting. The Mental Health Check tab can help you talk through this further too. You don't have "
    "to go through this alone."
)

# Asked ALONGSIDE the "go now" directive, never instead of it - the
# directive always comes first and doesn't wait on an answer. This is
# what a health worker triaging a call actually does: give the urgent
# instruction immediately, then keep asking questions while the person
# is on the way, because the answers change what the FACILITY needs to
# be ready for (and, since this is carried as context into the next
# turn - see danger_sign_followup in the intent set below - a reply that
# adds real detail, like "and I can't breathe", gets re-analyzed and can
# surface an even more specific finding next turn).
# Keyed by keyword found IN the matched danger-ladder phrase, checked in
# order, first match wins.
_DANGER_FOLLOWUP_BY_KEYWORD = [
    (["chest pain", "chest tightness", "pain in my chest", "tightness in my chest",
      "breath", "breathless", "gasping", "सीने में दर्द", "छाती में दर्द", "सांस"],
     "While you're on your way - did this start suddenly, and is it with any breathlessness, dizziness, "
     "or swelling/pain in one leg? Tell the facility this as soon as you arrive."),
    (["bleeding", "soaked", "pad", "रक्तस्राव"],
     "While you're on your way - roughly how much bleeding (soaking through in under an hour is heavy), "
     "and are there clots or do you feel dizzy/faint? Tell the facility this as soon as you arrive."),
    (["headache", "see properly", "सिरदर्द"],
     "While you're on your way - do you also have blurred vision, swelling in your face/hands, or has "
     "your BP been high in this pregnancy? Tell the facility this as soon as you arrive."),
    (["baby", "movement", "कदम", "हिलना"],
     "While you're on your way - when did you last feel the baby move, and do you have any bleeding or "
     "pain along with it? Tell the facility this as soon as you arrive."),
    (["abdominal pain", "पेट दर्द"],
     "While you're on your way - is the pain constant or coming and going, and is there any bleeding or "
     "fever with it? Tell the facility this as soon as you arrive."),
    (["discharge", "weak to get out of bed", "स्राव"],
     "While you're on your way - do you also have a fever, and how long has this been going on? Tell "
     "the facility this as soon as you arrive."),
]

# Rung 5 (convulsions, unconsciousness, a stuck baby, labor over a day) is
# genuinely no time for questions, and the person typing may not even be
# the patient - act now, ask nothing.
_NO_FOLLOWUP_RUNG = 5


def _danger_sign_followup(matched_phrase: str, rung: int) -> str:
    if rung >= _NO_FOLLOWUP_RUNG:
        return None
    for keywords, question in _DANGER_FOLLOWUP_BY_KEYWORD:
        if any(kw in matched_phrase for kw in keywords):
            return question
    return (
        "While you're on your way - how long has this been going on, and is there any bleeding, fever, "
        "or reduced baby movement with it? Tell the facility this as soon as you arrive."
    )

# A friendly label for each text_analyzer.py category, and a fallback note
# for the one category (malnutrition) with no matching expert_system.py
# rule to borrow "why" text from.
CATEGORY_LABELS = {
    "hemorrhage": "bleeding", "hypertensive_disorder": "blood pressure/pre-eclampsia symptoms",
    "infection": "possible infection", "anemia": "anemia/fatigue", "fetal_distress": "baby's movement",
    "obstructed_labor": "labor progress", "malnutrition": "nutrition/appetite",
}
CATEGORY_FALLBACK_NOTES = {
    "malnutrition": "Not eating well for more than a day or two can affect both you and the baby.",
}


def _match_faq(normalized_text: str):
    # Word-boundary matching, not a bare substring check - "hi" as a plain
    # `in` check matches inside "th-IS", "wh-ICH", "th-INK"... a short
    # greeting/FAQ phrase is exactly the kind of string that collides with
    # ordinary words, and it was silently hijacking unrelated messages
    # ("I missed my period THIS month" -> "greeting", "I THINK I am in
    # labor" -> "greeting") into the wrong intent.
    for intent in FAQ_INTENTS:
        if any(contains_phrase(normalized_text, phrase) for phrase in intent["phrases"]):
            return intent
    return None


def _match_topic(normalized_text: str):
    for topic in VAGUE_TOPICS:
        if any(contains_phrase(normalized_text, kw) for kw in topic["keywords"]):
            return topic
    return None


def _match_crisis(normalized_text: str) -> bool:
    return any(contains_phrase(normalized_text, phrase) for phrase in CRISIS_PHRASES)


def _mild_symptom_reply(text_scores: dict) -> str:
    # Names the ACTUAL category and reuses the same clinical "why" the
    # Assessment tab would give (via expert_system's rules), instead of
    # one flat "worth keeping an eye on" sentence no matter what was
    # described - that genericness was the core of the "vague chat" gap.
    category = max(text_scores, key=text_scores.get)
    label = CATEGORY_LABELS.get(category, category.replace("_", " "))

    activated_rules = [r for r in expert_system.apply_rules(text_scores) if r.get("activated")]
    # Prefer a rule scoped to ONLY this category (e.g. severe_anemia_rule
    # for "anemia") over a multi-condition rule that also happens to read
    # this category (e.g. pph_rule, which activates from anemia alone but
    # whose "why" text is written about active bleeding) - a rule whose
    # text is actually about the category that scored highest, not just
    # any rule that happens to share it.
    why = next(
        (r["why"] for r in activated_rules if RULES_BY_CATEGORY.get(r["id"]) == [category]),
        next((r["why"] for r in activated_rules if category in RULES_BY_CATEGORY.get(r["id"], [])), None),
    )
    if not why:
        why = CATEGORY_FALLBACK_NOTES.get(category, f"This sounds related to {label}.")

    return (
        f"{why} It's worth having this properly checked - run a full Assessment in the Assessment "
        f"tab (it looks at a lot more than I can in chat), or contact your ASHA/ANM worker if it "
        f"doesn't improve. If it gets suddenly worse, treat it as urgent."
    )


# Maps each expert_system rule id to the categories it reads, so
# _mild_symptom_reply can find the rule that actually explains the
# category that scored highest, instead of guessing from the rule list.
RULES_BY_CATEGORY = {
    "pph_rule": ["hemorrhage", "anemia"],
    "sepsis_rule": ["infection"],
    "fetal_distress_rule": ["fetal_distress"],
    "obstructed_labor_rule": ["obstructed_labor"],
    "hypertensive_symptom_rule": ["hypertensive_disorder"],
    "severe_anemia_rule": ["anemia"],
}


def respond(message: str, context_message: str = None, unresolved_rounds: int = 0) -> dict:
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
    normalized = normalize(analysis_text)

    # Psychological safety comes first, before ANY physical-symptom check
    # or FAQ matching - the same never-let-a-critical-signal-hide-behind-
    # something-else rule this project applies to EPDS item 10.
    if _match_crisis(normalized):
        return {"reply": CRISIS_REPLY, "isEmergency": True, "intent": "crisis_self_harm"}

    # Safety first: reuse the same danger-sign detection the assessment
    # flow uses. A matched danger sign always overrides FAQ matching.
    ladder_result = danger_ladder.classify(analysis_text)
    text_scores = text_analyzer.analyze(analysis_text)["scores"]
    high_category_score = max(text_scores.values()) if text_scores else 0.0

    if ladder_result["rung"] >= 4 or high_category_score >= 0.85:
        matched_phrase = ladder_result["matchedPhrase"] or "this symptom"
        base_reply = (
            f"⚠️ What you're describing ({matched_phrase}) sounds like it could be a danger sign. "
            "Please go to the nearest health facility now, or call for emergency transport: 108 "
            "(ambulance) or 102 (pregnancy transport). Don't wait to see if it gets better."
        )
        followup = _danger_sign_followup(matched_phrase, ladder_result["rung"])
        return {
            "reply": f"{base_reply} {followup}" if followup else base_reply,
            "isEmergency": True,
            "dangerLadder": ladder_result,
            # Carried back as contextMessage on the next turn (see the
            # frontend's UNRESOLVED_CHAT_INTENTS/UNRESOLVED_INTENTS) only
            # when there IS a follow-up question actually asking for more -
            # rung 5 (seizure, unconscious, stuck baby...) asks nothing, so
            # there's nothing for a reply to attach context to.
            "intent": "danger_sign_followup" if followup else "danger_sign",
        }

    intent = _match_faq(normalized)
    if intent:
        return {"reply": intent["reply"], "isEmergency": False, "intent": intent["id"]}

    if high_category_score >= 0.4:
        return {"reply": _mild_symptom_reply(text_scores), "isEmergency": False, "intent": "mild_symptom"}

    # Neither a danger sign, an FAQ topic, nor a scored symptom matched -
    # this is genuinely vague or unrecognized. Ask a targeted follow-up (at
    # most MAX_CLARIFYING_ROUNDS times) rather than either a flat "I don't
    # understand" or an endless loop of open-ended questions that never
    # actually gets the person help.
    if unresolved_rounds >= MAX_CLARIFYING_ROUNDS:
        return {"reply": NUDGE_REPLY, "isEmergency": False, "intent": "nudge_to_assessment"}

    topic = _match_topic(normalized)
    if topic:
        return {"reply": topic["question"], "isEmergency": False, "intent": "clarify_symptom", "topic": topic["id"]}

    return {"reply": FALLBACK_REPLY, "isEmergency": False, "intent": "fallback"}
