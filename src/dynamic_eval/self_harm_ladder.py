"""
Self-Harm Severity Ladder.

The Columbia-Suicide Severity Rating Scale (C-SSRS) - the standard,
validated instrument clinicians use for suicide-risk screening - is not a
single yes/no flag. It is an ORDINAL ladder: a passive wish to be dead
(its lowest tier) is a real, take-it-seriously signal, but a categorically
less urgent situation than an active plan with intent (its highest tier),
even though a flat keyword scan would treat every one of these phrases as
"the same" self-harm signal. This module applies that same ordinal-ladder
idea already used for physical danger signs (see danger_ladder.py) to
self-harm language specifically - a TEXT-BASED APPROXIMATION of the
C-SSRS's tier structure, not the real interview-administered instrument,
which needs a trained clinician's follow-up questions.

Deliberately NOT used to soften anything: every rung here still reaches
chat_assistant.py's full crisis response (KIRAN number, an immediate
safety check, escalate to 108 if there's any intent to act) - the rung is
carried alongside that response purely as transparency/detail (mirroring
how a Danger-Sign Ladder rung is shown in Detailed Results), never as a
reason to reply with anything less than the maximum response. Reports the
HIGHEST rung whose phrases appear in the text, same as danger_ladder.py.
"""

from .phrase_match import contains_phrase, normalize

RUNG_INFO = {
    1: {"label": "Passive wish to be dead",
        "description": "A passive wish to be dead or not wake up, without active thoughts of doing something to cause it."},
    2: {"label": "Active suicidal thoughts",
        "description": "Active, general thoughts of ending one's life, without a stated method."},
    3: {"label": "Thoughts naming a method or urge to self-harm",
        "description": "Active thoughts of suicide or self-harm with a specific method or urge mentioned."},
    4: {"label": "Active thoughts with some intent",
        "description": "Active suicidal thoughts with some intent to act, without a fully worked-out plan."},
    5: {"label": "Plan, intent, or preparatory behavior",
        "description": "A specific plan and intent to act, or preparatory behavior (giving away belongings, a goodbye message) - the most urgent tier."},
}

# Bilingual (English + representative Devanagari Hindi), same convention as
# danger_ladder.py/text_analyzer.py - a representative, non-exhaustive set,
# not a complete translation of every English phrase. Every phrase that was
# previously in chat_assistant.py's flat CRISIS_PHRASES list is included
# somewhere below (verified by a regression test) - this ladder REPLACES
# that flat list with a strict superset, not a narrower one.
PHRASES_BY_RUNG = {
    1: ["better off dead", "no reason to live", "not worth living", "tired of living",
        "no point in living", "whats the point of living", "what's the point of living",
        "wish i was dead", "wish i were dead", "wish i wasnt alive", "wish i werent alive",
        "जीने का मन नहीं"],
    2: ["suicidal", "suicide", "want to die", "wanna die", "dont want to live", "don't want to live",
        "kill myself", "kill me", "end my life", "end it all", "take my life",
        "dont want to exist", "don't want to exist", "dont want to be here", "don't want to be here",
        "want it all to stop", "want it to be over", "want the pain to end", "want the pain to stop",
        "cant go on", "can't go on", "cant do this anymore", "can't do this anymore",
        "give up on life", "done with life", "done with my life",
        "everyone would be better off without me", "im a burden to everyone", "i'm a burden to everyone",
        "no one would notice if i was gone", "nobody would notice if i disappeared",
        "आत्महत्या", "मरना चाहती हूं", "जीना नहीं चाहती", "मर जाना"],
    3: ["hurt myself", "harm myself", "hurting myself", "cut myself", "overdose", "hang myself",
        "self harm", "self-harm", "urge to self harm", "wanted to hurt myself",
        "खुद को नुकसान"],
    4: ["wont be here much longer", "won't be here much longer", "not gonna make it another day",
        "im not gonna make it", "i'm not gonna make it", "final goodbye", "signing off for good",
        "आत्महत्या कर लूंगा"],
    5: ["have a plan to end my life", "plan to end my life", "giving away my things",
        "giving away my belongings", "saying goodbye to everyone", "wrote a goodbye letter"],
}


def classify(text: str) -> dict:
    """Returns the highest matching rung, or rung 0 if nothing on this
    ladder matched (rung 0 does NOT mean "no risk" - the caller still runs
    its own broader crisis check independently)."""
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
