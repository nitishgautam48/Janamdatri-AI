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

from . import danger_ladder, expert_system, risk_formulation, text_analyzer

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


def synthesize(ml_result: dict = None, text: str = "", history: dict = None) -> dict:
    history = history or {}

    text_result = text_analyzer.analyze(text) if text else None
    text_scores = text_result["scores"] if text_result else {}

    risk_formulation_result = risk_formulation.assess(text, history)
    ladder_result = danger_ladder.classify(text)
    expert_rules = expert_system.apply_rules(text_scores)

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

    display_mri = max(adjusted_mri, TIER_FLOOR[level]) if level != original_level else adjusted_mri

    return {
        "mri": display_mri,
        "severity": {"level": level, "escalatedBy": escalated_by, **META[level]},
        "mlPrediction": ml_result,
        "textAnalysis": text_result,
        "dangerLadder": ladder_result,
        "riskFormulation": risk_formulation_result,
        "activeExpertRules": [r for r in expert_rules if r["activated"]],
        "recommendations": _generate_recommendations(level, expert_rules, ladder_result),
        "methodology": (
            "Combines a machine-learning risk classifier trained on the UCI Maternal Health Risk "
            "dataset (vitals only) with a rule-based dynamic-evaluation layer covering symptoms the "
            "dataset never recorded (bleeding, fetal movement, labor progress). Not a diagnosis - a "
            "Critical/Severe result always means seek facility care now."
        ),
    }


def _generate_recommendations(level: str, expert_rules: list, ladder_result: dict) -> list:
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

    if len(recs) == 1:
        recs.append("No danger signs identified from the information provided - keep attending scheduled ANC visits")

    return recs
