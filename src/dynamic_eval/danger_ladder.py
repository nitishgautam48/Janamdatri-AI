"""
Maternal Danger-Sign Ladder.

WHO/India RMNCH+A community-health-worker training defines a fixed set of
pregnancy/postpartum "danger signs" that mean go to a facility NOW: severe
vaginal bleeding, convulsions, severe headache with blurred vision, high
fever with weakness, severe abdominal pain, and fast/difficult breathing.
A woman's own words rarely land neatly on "danger sign present/absent" -
they range from an early, vague symptom to a full emergency description.

This is an ORDINAL ladder rather than a single blended score, because
rung 5 (convulsions, unconsciousness, soaking-a-pad-an-hour bleeding) is a
categorically more urgent situation than rung 1 (mild ankle swelling),
even if a keyword-only scorer might weigh them similarly. Reports the
HIGHEST rung whose phrases appear in the text - never a diagnosis, always
in addition to (never instead of) an actual BP/urine/fetal heart-rate
check by a trained health worker.
"""

from .phrase_match import contains_phrase, normalize

RUNG_INFO = {
    1: {"label": "Mild/early warning",
        "description": "A mild, early symptom - continue monitoring and keep the next ANC visit."},
    2: {"label": "Persistent non-specific concern",
        "description": "A persistent or repeated symptom that warrants contacting the ASHA/ANM or health worker."},
    3: {"label": "Specific concerning symptom",
        "description": "A specific symptom that warrants a facility visit today, not just a phone check-in."},
    4: {"label": "WHO danger sign present",
        "description": "A recognized obstetric danger sign - go to the nearest facility now."},
    5: {"label": "Emergency / life-threatening",
        "description": "A life-threatening emergency sign - call for emergency transport (108/102) immediately."},
}

PHRASES_BY_RUNG = {
    # Bilingual (English + representative Hindi phrasing) - see
    # text_analyzer.py's note on why one mixed list is enough.
    1: ["mild swelling", "feet are a little swollen", "occasional mild headache",
        "slight fatigue", "a bit tired", "mild nausea",
        # Same real-world phrasing gap as text_analyzer.py's hypertensive
        # tier: "pain in my head"/"head hurts" describes the same thing as
        # "headache" but matched no rung at all before this.
        "pain in my head", "pain in the head", "head pain", "head hurts",
        "my head hurts", "head is paining", "head is hurting",
        "हल्की सूजन", "थोड़ी थकान", "सिर में दर्द"],
    2: ["persistent headache", "headache that wont go away", "less movement than usual",
        "fewer kicks today", "mild spotting", "mild fever", "feeling feverish", "slight fever",
        "लगातार सिरदर्द", "हल्का बुखार"],
    3: ["blurred vision", "vision is blurry", "seeing spots", "face is swollen",
        "hands are swollen", "moderate bleeding", "high fever with chills", "high fever",
        "yellow skin", "yellow eyes", "jaundice", "skin turned yellow",
        # Bare/unqualified bleeding (no "mild"/"heavy" qualifier) previously
        # matched no rung at all - only "mild spotting" (rung 2) and
        # explicitly qualified moderate/heavy bleeding did. Any vaginal
        # bleeding in pregnancy of UNKNOWN severity should default to
        # "concerning, needs a facility visit today" rather than silently
        # falling through the ladder as if nothing was said.
        "started bleeding", "im bleeding", "i am bleeding", "bleeding today",
        "धुंधला दिखना", "चेहरे पर सूजन", "तेज़ बुखार"],
    4: ["severe headache", "cant see properly", "severe abdominal pain", "heavy bleeding",
        "bleeding heavily", "soaked through a pad", "soaking a pad every hour",
        "baby stopped moving", "no movement since yesterday", "cant feel the baby move",
        "stopped kicking", "not kicking at all",
        "fast breathing", "difficulty breathing", "trouble breathing", "having trouble breathing",
        "not able to breathe", "not able to breath", "unable to breathe", "unable to breath",
        "cant breathe", "cannot breathe", "breathless", "gasping for air", "gasping",
        "foul smelling discharge", "discharge smells bad", "too weak to get out of bed",
        # Chest pain in pregnancy/postpartum is its own recognized red-flag
        # trigger in obstetric early-warning protocols (a possible sign of
        # pulmonary embolism, a cardiac event, or severe pre-eclampsia) -
        # it was previously invisible here (and to text_analyzer.py) even
        # though "difficulty breathing" right next to it was already rung 4.
        "chest pain", "pain in my chest", "chest tightness", "tightness in my chest",
        "तेज़ सिरदर्द", "तेज़ पेट दर्द", "भारी रक्तस्राव", "बच्चा हिलना बंद हो गया",
        "सांस लेने में तकलीफ़", "सांस नहीं आ रही", "बदबूदार स्राव",
        "सीने में दर्द", "छाती में दर्द"],
    5: ["convulsions", "had a fit", "seizure", "lost consciousness", "blacked out",
        "fainted", "cold and clammy", "labor for more than a day", "stuck baby",
        "baby not coming out", "bleeding and passed out",
        "दौरा पड़ा", "बेहोश हो गई", "एक दिन से ज़्यादा प्रसव पीड़ा", "बच्चा अटक गया"],
}


def classify(text: str) -> dict:
    if not text:
        return {"rung": 0, "rungLabel": None, "description": None, "matchedPhrase": None}

    normalized = normalize(text)

    for rung in (5, 4, 3, 2, 1):
        for phrase in PHRASES_BY_RUNG[rung]:
            if contains_phrase(normalized, phrase):
                return {
                    "rung": rung,
                    "rungLabel": RUNG_INFO[rung]["label"],
                    "description": RUNG_INFO[rung]["description"],
                    "matchedPhrase": phrase,
                }

    return {"rung": 0, "rungLabel": None, "description": None, "matchedPhrase": None}
