"""
Maternal Risk Formulation - Structured Risk/Protective Checklist.

The core "dynamic evaluation" pattern: obstetric risk factors are split
three ways, same principle as a clinical risk formulation interview:
 - STATIC risk factors: obstetric HISTORY that doesn't change this
   pregnancy (a prior C-section, a prior stillbirth) - background risk.
 - DYNAMIC risk factors: CURRENT, changeable conditions this pregnancy
   (no antenatal care, malnutrition signs, an unbooked pregnancy) - drive
   immediate risk level.
 - PROTECTIVE factors: reduce risk without erasing it - regular ANC
   attendance, a birth-preparedness plan, family/transport support.

Detection works two ways: phrase-matching over a free-text narrative, OR
direct boolean flags from a structured history form - whichever is
available. A factor counts once it's true either way.
"""

from .phrase_match import contains_phrase, normalize

STATIC_RISK_FACTORS = {
    "prior_csection": ["had a c-section before", "previous c-section", "past cesarean",
                        "delivered by c-section before", "prior caesarean"],
    "prior_preeclampsia": ["had pre-eclampsia before", "preeclampsia in last pregnancy",
                           "high bp in last pregnancy", "toxemia before"],
    "prior_pph": ["bled heavily after last delivery", "postpartum hemorrhage before",
                  "heavy bleeding after my last baby"],
    "prior_stillbirth_or_loss": ["had a stillbirth", "lost a baby before", "previous miscarriage",
                                  "miscarried before", "lost a pregnancy before"],
    "chronic_hypertension": ["history of high blood pressure", "have chronic hypertension",
                             "bp problems before pregnancy", "hypertensive before this pregnancy"],
    "pre_existing_diabetes": ["diabetic before pregnancy", "have diabetes",
                              "history of diabetes", "sugar problem before pregnancy"],
    "grand_multipara": ["this is my fifth pregnancy", "this is my sixth pregnancy",
                        "had many pregnancies before", "many children already"],
    "teenage_or_advanced_age": ["i am under 18", "i am over 35", "very young mother",
                                "older first-time mother"],
}

DYNAMIC_RISK_FACTORS = {
    "no_antenatal_care": ["havent had any checkups", "no anc visits", "never went for checkup",
                          "havent seen a doctor this pregnancy", "no prenatal checkups",
                          "unbooked pregnancy"],
    "malnutrition_signs": ["not eating well", "very thin", "losing weight", "barely eating",
                           "not getting enough food", "malnourished"],
    "anemia_symptoms": ["always tired", "feel weak all the time", "pale skin", "breathless easily"],
    "unregistered_or_late_booking": ["just found out i was pregnant late", "booked very late",
                                     "first checkup was very late"],
    "teen_or_unsupported_pregnancy": ["no one knows i am pregnant", "hiding my pregnancy",
                                      "family does not know", "alone in this pregnancy"],
    "high_risk_symptoms_reported": ["severe headache", "blurred vision", "heavy bleeding",
                                    "baby stopped moving", "convulsions", "convulsion", "had a seizure",
                                    "high fever", "severe abdominal pain"],
}

PROTECTIVE_FACTORS = {
    "regular_anc_visits": ["going for regular checkups", "attend all my anc visits",
                           "never miss a checkup", "anc visits are regular", "monthly checkups"],
    "iron_folic_supplementation": ["taking my iron tablets", "taking folic acid",
                                   "taking my supplements regularly"],
    "institutional_delivery_plan": ["planning to deliver at the hospital",
                                    "plan to deliver at the phc", "registered at a hospital for delivery"],
    "birth_preparedness_plan": ["have a birth plan", "saved money for delivery",
                                "arranged transport for delivery", "birth preparedness plan ready"],
    "family_support": ["my husband supports me", "family is helping me",
                       "my mother-in-law helps me", "supportive family"],
    "asha_or_health_worker_contact": ["asha worker visits me", "in touch with asha didi",
                                      "anm checks on me", "health worker visits regularly"],
}


def _detect_from_text(text: str, factor_defs: dict) -> list:
    return [name for name, phrases in factor_defs.items()
            if any(contains_phrase(text, p) for p in phrases)]


def _merge_with_flags(from_text: list, factor_defs: dict, history: dict) -> list:
    present = set(from_text)
    for factor_name in factor_defs:
        if history.get(factor_name) is True:
            present.add(factor_name)
    return list(present)


def assess(text: str = "", history: dict = None) -> dict:
    history = history or {}
    normalized = normalize(text)

    static_present = _merge_with_flags(
        _detect_from_text(normalized, STATIC_RISK_FACTORS), STATIC_RISK_FACTORS, history)
    dynamic_present = _merge_with_flags(
        _detect_from_text(normalized, DYNAMIC_RISK_FACTORS), DYNAMIC_RISK_FACTORS, history)
    protective_present = _merge_with_flags(
        _detect_from_text(normalized, PROTECTIVE_FACTORS), PROTECTIVE_FACTORS, history)

    weighted_risk = (len(static_present) * 1.0) + (len(dynamic_present) * 1.2)
    raw_multiplier = 1 + min(weighted_risk * 0.15, 0.6)
    protective_offset = len(protective_present) * 0.08
    multiplier = max(raw_multiplier - protective_offset, 1.0)

    return {
        "staticRiskFactors": static_present,
        "dynamicRiskFactors": dynamic_present,
        "protectiveFactors": protective_present,
        "riskFactorCount": len(static_present) + len(dynamic_present),
        "protectiveFactorCount": len(protective_present),
        "multiplier": multiplier,
        "methodology": (
            "Structured obstetric risk/protective factor checklist, detected from free-text "
            "narrative and/or a structured history form - not a substitute for an ANC booking interview."
        ),
    }
