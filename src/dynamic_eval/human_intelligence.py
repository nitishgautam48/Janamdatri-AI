"""
Human Intelligence - cross-signal clinical reasoning layer.

⚠️ Despite the name, this involves no real clinician - it is a
deterministic synthesis layer, same disclosure this codebase's mental-
health predecessor made about its own equivalent module. Two things it
adds beyond expert_system.py's per-category rules:

 1. CROSS-CATEGORY PATTERN DETECTION - some combinations of findings are
    more dangerous together than either alone (e.g. active bleeding is
    more likely to decompensate into hemorrhagic shock in a woman who is
    already anemic; obstructed labor with signs of infection raises
    concern for intrapartum sepsis specifically, not just "two problems").
    A single-category expert rule structurally cannot express this - it
    only ever looks at its own condition list.

 2. MULTI-SOURCE CONFIDENCE - how many independent signal sources agree
    (the trained ML model, the text/symptom analyzer, the danger-sign
    ladder, an activated expert rule, an elevated risk-formulation
    multiplier). A finding several independent sources corroborate is
    more trustworthy than one resting on a single weak signal, and that
    distinction is worth surfacing rather than presenting every result
    with the same implied certainty.
"""

PATTERNS = [
    {
        "id": "preeclampsia_with_fetal_compromise",
        "requires": {"hypertensive_disorder": 0.65, "fetal_distress": 0.4},
        "note": ("Danger signs suggest severe pre-eclampsia WITH signs of fetal compromise - "
                 "this combination needs emergency facility care, not just blood-pressure monitoring."),
    },
    {
        "id": "hemorrhagic_shock_risk",
        "requires": {"hemorrhage": 0.65, "anemia": 0.4},
        "note": ("Active bleeding combined with anemia sharply raises the risk of hemorrhagic shock - "
                 "even bleeding that looks moderate can decompensate quickly in an anemic woman."),
    },
    {
        "id": "septic_obstructed_labor",
        "requires": {"infection": 0.5, "obstructed_labor": 0.4},
        "note": ("Signs of infection combined with prolonged/obstructed labor raise concern for "
                 "intrapartum sepsis - this needs emergency obstetric care, not antibiotics at home."),
    },
    {
        "id": "compounded_hypertensive_hemorrhage",
        "requires": {"hypertensive_disorder": 0.5, "hemorrhage": 0.5},
        "note": ("Hypertensive symptoms alongside bleeding can indicate placental abruption - "
                 "a combination that is more urgent than either finding alone suggests."),
    },
]


def _detect_patterns(scores: dict) -> list:
    matched = []
    for pattern in PATTERNS:
        if all(scores.get(cat, 0.0) >= threshold for cat, threshold in pattern["requires"].items()):
            matched.append({"id": pattern["id"], "note": pattern["note"]})
    return matched


def _assess_confidence(ml_result, text_result, ladder_result, expert_rules, risk_formulation_result,
                        psych_result=None):
    sources = []

    if ml_result:
        top_prob = max(ml_result["probabilities"].values())
        if top_prob >= 0.6:
            sources.append("ml_model")
    if text_result and any(v > 0 for v in text_result["scores"].values()):
        sources.append("symptom_text")
    if ladder_result and ladder_result["rung"] > 0:
        sources.append("danger_ladder")
    if any(r["activated"] for r in expert_rules):
        sources.append("expert_rules")
    if risk_formulation_result and risk_formulation_result["multiplier"] > 1.1:
        sources.append("risk_history")
    if psych_result and (psych_result["selfHarmFlagged"] or psych_result["total"] >= 10):
        sources.append("psychological_screening")

    n = len(sources)
    if n >= 4:
        label = "High corroboration"
    elif n >= 2:
        label = "Moderate corroboration"
    elif n == 1:
        label = "Single-source signal"
    else:
        label = "No corroborating signal"

    return {"score": round(n / 6, 2), "label": label, "sources": sources}


def synthesize(scores: dict, ml_result: dict = None, text_result: dict = None, ladder_result: dict = None,
               expert_rules: list = None, risk_formulation_result: dict = None, psych_result: dict = None) -> dict:
    expert_rules = expert_rules or []
    patterns = _detect_patterns(scores)
    confidence = _assess_confidence(ml_result, text_result, ladder_result, expert_rules,
                                     risk_formulation_result, psych_result)

    impressions = []
    for pattern in patterns:
        impressions.append(pattern["note"])
    if risk_formulation_result and risk_formulation_result["riskFactorCount"] > 0:
        all_factors = risk_formulation_result["staticRiskFactors"] + risk_formulation_result["dynamicRiskFactors"]
        impressions.append(f"Background risk factors present: {', '.join(f.replace('_', ' ') for f in all_factors)}")
    if risk_formulation_result and risk_formulation_result["protectiveFactorCount"] > 0:
        impressions.append(
            f"Protective factors present: {', '.join(f.replace('_', ' ') for f in risk_formulation_result['protectiveFactors'])}"
        )
    if not impressions:
        impressions.append("No cross-category danger pattern identified from the information provided.")

    return {
        "patterns": patterns,
        "confidence": confidence,
        "impressions": impressions,
        "methodology": (
            "Deterministic cross-signal synthesis - not a real clinician's judgment. Detects named "
            "combinations of findings that are more dangerous together than any single category "
            "threshold captures, and reports how many independent sources (ML model, symptom text, "
            "danger ladder, expert rules, risk history, psychological screening) corroborate the result."
        ),
    }
