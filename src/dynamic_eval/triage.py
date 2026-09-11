"""
Maternal Triage Synthesis - combines the trained ML vitals classifier with
the rule-based "dynamic evaluation" layer (risk formulation checklist,
danger-sign ladder, expert rules) into one final severity decision.

Worst-signal-wins throughout: the ML model's vitals-driven risk is the
base signal, but a WHO danger sign (rung 4-5) or a Critical-severity
expert rule (severe hemorrhage, obstructed labor) can never be hidden
behind a lower blended average just because vitals alone looked fine -
the ML model has literally no way to see bleeding or fetal movement, so
it must never be allowed to downgrade a real reported symptom.

⚠️ This is an automated screening/prioritization aid, not a diagnosis.
Any Critical/Severe result always means "seek facility care now",
regardless of how confident the underlying score is.
"""

from . import danger_ladder, expert_system, hemoglobin_rules, human_intelligence, psych_eval, risk_formulation, text_analyzer

LEVEL_ORDER = ["Minimal", "Mild", "Moderate", "Severe", "Critical"]
META = {
    "Critical": {"emoji": "🔴", "color": "#d63031", "priority": "emergency"},
    "Severe": {"emoji": "🟠", "color": "#e17055", "priority": "high"},
    "Moderate": {"emoji": "🟡", "color": "#fdcb6e", "priority": "medium"},
    "Mild": {"emoji": "🟢", "color": "#00b894", "priority": "low"},
    "Minimal": {"emoji": "🟢", "color": "#00b894", "priority": "normal"},
}
TIER_FLOOR = {"Critical": 80, "Severe": 60, "Moderate": 40, "Mild": 20, "Minimal": 0}


def _tier_for_mri(mri: float) -> str:
    if mri > 75:
        return "Critical"
    if mri > 50:
        return "Severe"
    if mri > 30:
        return "Moderate"
    if mri > 15:
        return "Mild"
    return "Minimal"


def _mri_from_ml(ml_result: dict) -> float:
    if not ml_result:
        return 0.0
    probs = ml_result["probabilities"]
    return (probs.get("low risk", 0) * 0
            + probs.get("mid risk", 0) * 50
            + probs.get("high risk", 0) * 100)


def _rung_level(rung: int) -> str:
    if rung >= 4:
        return "Critical"
    if rung == 3:
        return "Severe"
    if rung == 2:
        return "Moderate"
    if rung == 1:
        return "Mild"
    return "Minimal"


def synthesize(ml_result: dict = None, text: str = "", history: dict = None,
                hemoglobin: float = None, epds_responses: list = None) -> dict:
    history = history or {}

    text_result = text_analyzer.analyze(text) if text else None
    text_scores = dict(text_result["scores"]) if text_result else {}

    # Hemoglobin is an optional, separate deterministic input (the ML
    # model was never trained on it - see hemoglobin_rules.py) blended
    # into the same 'anemia' category via worst-signal-wins, same as
    # every other physical signal in this pipeline.
    hb_result = None
    if hemoglobin is not None:
        hb_result = hemoglobin_rules.score(hemoglobin)
        text_scores["anemia"] = max(text_scores.get("anemia", 0.0), hb_result["score"])

    risk_formulation_result = risk_formulation.assess(text, history)
    ladder_result = danger_ladder.classify(text)
    expert_rules = expert_system.apply_rules(text_scores)

    psych_result = None
    if epds_responses is not None:
        psych_result = psych_eval.score(epds_responses)

    base_mri = _mri_from_ml(ml_result)
    adjusted_mri = min(round(base_mri * risk_formulation_result["multiplier"]), 100)

    level = _tier_for_mri(adjusted_mri)
    original_level = level
    escalated_by = None

    if ladder_result["rung"] > 0:
        rung_level = _rung_level(ladder_result["rung"])
        if LEVEL_ORDER.index(rung_level) > LEVEL_ORDER.index(level):
            level = rung_level
            escalated_by = "danger_ladder"

    worst_rule = None
    for rule in expert_rules:
        if not rule["activated"]:
            continue
        if worst_rule is None or LEVEL_ORDER.index(rule["severity"]) > LEVEL_ORDER.index(worst_rule["severity"]):
            worst_rule = rule
    if worst_rule and LEVEL_ORDER.index(worst_rule["severity"]) > LEVEL_ORDER.index(level):
        level = worst_rule["severity"]
        escalated_by = worst_rule["id"]

    # Psychological screening escalates the SAME overall severity scale -
    # a self-harm-flagged EPDS result is exactly as urgent as a physical
    # danger sign, and must never be hidden behind a good physical result.
    if psych_result:
        psych_level = psych_eval.severity_for(psych_result)
        if LEVEL_ORDER.index(psych_level) > LEVEL_ORDER.index(level):
            level = psych_level
            escalated_by = "self_harm_risk" if psych_result["selfHarmFlagged"] else "psychological_screening"

    display_mri = max(adjusted_mri, TIER_FLOOR[level]) if level != original_level else adjusted_mri

    clinical_impression = human_intelligence.synthesize(
        text_scores, ml_result, text_result, ladder_result, expert_rules, risk_formulation_result, psych_result
    )

    return {
        "mri": display_mri,
        "severity": {"level": level, "escalatedBy": escalated_by, **META[level]},
        "mlPrediction": ml_result,
        "textAnalysis": text_result,
        "hemoglobinAssessment": hb_result,
        "dangerLadder": ladder_result,
        "riskFormulation": risk_formulation_result,
        "activeExpertRules": [r for r in expert_rules if r["activated"]],
        "psychologicalEvaluation": psych_result,
        "clinicalImpression": clinical_impression,
        "recommendations": _generate_recommendations(
            level, expert_rules, ladder_result, psych_result, clinical_impression
        ),
        "methodology": (
            "Combines a machine-learning risk classifier trained on the UCI Maternal Health Risk "
            "dataset (vitals only) with a rule-based dynamic-evaluation layer covering symptoms the "
            "dataset never recorded (bleeding, fetal movement, labor progress, anemia by hemoglobin, "
            "perinatal mental health via EPDS). Not a diagnosis - a Critical/Severe result always "
            "means seek facility (or, for a self-harm flag, mental health) care now."
        ),
    }


def _generate_recommendations(level: str, expert_rules: list, ladder_result: dict, psych_result: dict = None,
                               clinical_impression: dict = None) -> list:
    recs = []

    if level == "Critical":
        recs.append("🚨 EMERGENCY: Go to the nearest facility now or call for emergency transport (108/102)")
    elif level == "Severe":
        recs.append("⚠️ Go to a health facility today - do not wait for the next scheduled ANC visit")
    elif level == "Moderate":
        recs.append("Contact your ASHA/ANM or health worker soon and arrange a facility check")
    else:
        recs.append("Continue routine ANC visits and monitor for any new or worsening symptoms")

    for rule in expert_rules:
        if rule["activated"]:
            recs.append(f"{rule['name']}: {rule['intervention']}")

    if ladder_result["rung"] >= 4:
        recs.append(
            f"Danger sign identified: {ladder_result['rungLabel']} - "
            "this is one of the WHO recognized emergency signs in pregnancy"
        )

    if psych_result:
        if psych_result["selfHarmFlagged"]:
            recs.append(
                "🚨 Thoughts of self-harm were reported - please talk to someone you trust right now "
                "and contact the KIRAN mental health helpline: 1800-599-0019 (toll-free, 24x7)"
            )
        elif psych_result["classification"] in ("Probable depression", "High symptom burden"):
            recs.append(
                "Perinatal mental health screening suggests further evaluation - talk to your ANC "
                "provider or a counselor about how you've been feeling"
            )
        elif psych_result["classification"] == "Possible depression":
            recs.append("Consider mentioning your mood or anxiety to your ANC provider at the next visit")

    if clinical_impression:
        for pattern in clinical_impression["patterns"]:
            recs.append(f"⚠️ Pattern detected: {pattern['note']}")

    if len(recs) == 1:
        recs.append("No danger signs identified from the information provided - keep attending scheduled ANC visits")

    return recs
