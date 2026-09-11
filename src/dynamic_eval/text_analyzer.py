"""
Symptom-narrative text analyzer - the "dynamic evaluation" text layer.

The trained ML classifier (src/ml/) only sees six vitals (Age, BP x2, blood
sugar, temperature, heart rate) - it has no way to know about bleeding,
fetal movement, or labor progress, because the training dataset never
recorded them. This module fills that gap with curated phrase-matching
over a free-text symptom description, the same category set used by
danger_ladder.py and expert_system.py.

Each category has 'moderate' phrases (early/non-specific wording) and
'severe' phrases (an explicit WHO obstetric danger sign) - the higher tier
wins. This is a text-based APPROXIMATION of a symptom history a health
worker would ask about directly, not a diagnosis.
"""

from .phrase_match import contains_phrase, normalize

CATEGORIES = {
    "hypertensive_disorder": {
        "moderate": ["mild headache", "feet are swollen", "swelling in my feet",
                     "hands feel swollen", "a bit dizzy", "occasional headache"],
        "severe": ["severe headache", "blurred vision", "seeing spots",
                   "vision is blurry", "cant see properly", "face is swollen",
                   "swelling in my face", "sudden swelling", "convulsions", "had a fit",
                   "seizure", "lost consciousness", "blacked out"],
    },
    "hemorrhage": {
        "moderate": ["light bleeding", "spotting", "slight bleeding", "little bit of blood"],
        "severe": ["heavy bleeding", "bleeding a lot", "soaked through a pad",
                   "soaking a pad every hour", "blood clots", "bleeding heavily",
                   "feel dizzy and bleeding", "bleeding and weak", "passed out from bleeding"],
    },
    "infection": {
        "moderate": ["mild fever", "feeling feverish", "slight fever", "chills"],
        "severe": ["high fever", "foul smelling discharge", "bad smelling discharge",
                   "discharge smells bad", "too weak to get out of bed", "burning while urinating",
                   "wound is not healing", "pus from the wound", "severe abdominal pain with fever"],
    },
    "anemia": {
        "moderate": ["feel tired all the time", "always tired", "weak and tired", "pale skin"],
        "severe": ["extremely weak", "breathless even resting", "short of breath easily",
                   "heart racing", "fainting spells", "very pale"],
    },
    "fetal_distress": {
        "moderate": ["baby is moving less", "less movement than usual", "fewer kicks today"],
        "severe": ["baby stopped moving", "no movement since yesterday", "cant feel the baby move",
                   "no kicks at all", "baby not moving at all"],
    },
    "obstructed_labor": {
        "moderate": ["labor pains for a long time", "contractions for hours", "long labor"],
        "severe": ["labor for more than a day", "stuck baby", "baby not coming out",
                   "severe abdominal pain during labor", "no progress in labor", "exhausted from labor"],
    },
    "malnutrition": {
        "moderate": ["not eating well", "loss of appetite", "eating very little"],
        "severe": ["barely eating anything", "severe weight loss", "very thin", "malnourished"],
    },
}


def analyze(text: str) -> dict:
    normalized = normalize(text)
    scores = {}
    matched_phrases = {}

    for category, tiers in CATEGORIES.items():
        score = 0.0
        matched = None

        for phrase in tiers["severe"]:
            if contains_phrase(normalized, phrase):
                score, matched = 0.85, phrase
                break

        if score == 0.0:
            for phrase in tiers["moderate"]:
                if contains_phrase(normalized, phrase):
                    score, matched = 0.45, phrase
                    break

        scores[category] = score
        matched_phrases[category] = matched

    return {
        "scores": scores,
        "matchedPhrases": matched_phrases,
        "methodology": (
            "Text-based approximation of a maternal danger-sign symptom history - "
            "not a diagnosis, and never a substitute for an in-person BP/urine/hemoglobin "
            "check or fetal heart rate monitoring."
        ),
    }
