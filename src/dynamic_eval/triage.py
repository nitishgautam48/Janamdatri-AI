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

from . import (clinical_inputs, danger_ladder, expert_system, hemoglobin_rules, human_intelligence,
               pregnancy_guide, psych_eval, risk_formulation, text_analyzer)

LEVEL_ORDER = ["Minimal", "Mild", "Moderate", "Severe", "Critical"]
META = {
    "Critical": {"emoji": "🔴", "color": "#d63031", "priority": "emergency"},
    "Severe": {"emoji": "🟠", "color": "#e17055", "priority": "high"},
    "Moderate": {"emoji": "🟡", "color": "#fdcb6e", "priority": "medium"},
    "Mild": {"emoji": "🟢", "color": "#00b894", "priority": "low"},
    "Minimal": {"emoji": "🟢", "color": "#00b894", "priority": "normal"},
}
TIER_FLOOR = {"Critical": 80, "Severe": 60, "Moderate": 40, "Mild": 20, "Minimal": 0}

# Collapses the 5-level severity scale into the 3 action tiers a patient
# actually needs to act on - "Moderate" and "Severe" are different
# underlying scores, but both mean "don't just wait for your next
# appointment," so both read as "Urgent" here.
ACTION_TIERS = {
    "Critical": {
        "tier": "Emergency", "tierLabel": "🚨 EMERGENCY - immediate medical attention",
        "instruction": (
            "Go to the nearest health facility now, or call for emergency transport - "
            "108 (ambulance) or 102 (pregnancy transport). Do not wait to see if it improves."
        ),
    },
    "Severe": {
        "tier": "Urgent", "tierLabel": "⚠️ URGENT - contact a healthcare professional promptly",
        "instruction": "Contact a healthcare professional or go to a facility today - do not wait for your next scheduled ANC visit.",
    },
    "Moderate": {
        "tier": "Urgent", "tierLabel": "⚠️ URGENT - contact a healthcare professional promptly",
        "instruction": "Contact your ASHA/ANM or healthcare provider soon (within a day or two) so this can be properly checked.",
    },
    "Mild": {
        "tier": "Routine", "tierLabel": "🟢 ROUTINE - continue monitoring",
        "instruction": "Continue monitoring and mention this at your next scheduled ANC visit.",
    },
    "Minimal": {
        "tier": "Routine", "tierLabel": "🟢 ROUTINE - continue monitoring",
        "instruction": "Continue routine ANC visits and self-monitoring - no immediate concern was identified.",
    },
}


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


# Graduated MRI contribution per escalation source, so two DIFFERENT
# triggers that both push the level to (say) "Critical" don't collapse to
# an identical displayed number - rung 5 (an active emergency) and rung 4
# (a WHO danger sign) both mean Critical, but they aren't equally urgent.
RUNG_MRI = {1: 20, 2: 45, 3: 65, 4: 85, 5: 98}


def _psych_mri(psych_result: dict) -> float:
    total_pct = round(psych_result["total"] / psych_result["maxScore"] * 100)
    if psych_result["selfHarmFlagged"]:
        return max(90, total_pct)
    return total_pct


def _build_explanation(level: str, escalated_by: str, ladder_result: dict, expert_rules: list,
                        risk_formulation_result: dict, ml_result: dict,
                        weight_result: dict = None, fetal_movement_result: dict = None,
                        urine_protein_result: dict = None) -> dict:
    """Turns the raw signals synthesize() already computed into a plain-language
    "why did I get this result" block - a patient-facing "High/Medium/Low" label
    on its own doesn't tell anyone what to actually do about it."""
    tier_info = ACTION_TIERS[level]
    why = []

    if escalated_by == "danger_ladder":
        why.append(f"Danger sign detected: \"{ladder_result['matchedPhrase']}\" - {ladder_result['description']}")
    elif escalated_by == "self_harm_risk":
        why.append(
            "Thoughts of self-harm were flagged on the Mental Health Check - this is always treated "
            "as a critical safety signal on its own, regardless of the rest of that score."
        )
    elif escalated_by == "psychological_screening":
        why.append(
            "The Mental Health Check (EPDS) score indicates a symptom burden significant enough to "
            "need a professional evaluation, separate from any physical findings."
        )
    elif escalated_by == "preterm_labor_risk":
        why.append(
            "Labor signs reported before 37 weeks can mean preterm labor - a facility may be able to "
            "slow or safely manage an early delivery, but only if reached in time, so this needs "
            "immediate evaluation rather than waiting to see if it settles."
        )
    elif escalated_by:
        rule = next((r for r in expert_rules if r["id"] == escalated_by), None)
        if rule:
            why.append(f"{rule['name']}: {rule['why']}")

    # Additive, not exclusive - a flagged weight change or reduced fetal
    # movement is worth surfacing regardless of whether it happened to be
    # THE specific signal that crossed an escalation threshold, since
    # worst-signal-wins already blends it into the category score above.
    if weight_result and weight_result.get("flag"):
        why.append(f"Weight check: {weight_result['flag']}")
    if fetal_movement_result and fetal_movement_result.get("flag"):
        why.append(f"Fetal movement check: {fetal_movement_result['flag']}")
    if urine_protein_result and urine_protein_result.get("flag"):
        why.append(f"Urine protein check: {urine_protein_result['flag']}")

    if not why:
        if ml_result:
            why.append(
                f"Based on the vitals provided (age, blood pressure, blood sugar, temperature, "
                f"heart rate), the trained ML model placed this at {ml_result['riskLevel']}."
            )
        else:
            why.append("No danger signs, concerning symptoms, or high-risk vitals were identified from the information provided.")

    warning_signs = []
    if ladder_result["rung"] > 0:
        warning_signs.append(ladder_result["matchedPhrase"])
    for rule in expert_rules:
        if rule["activated"] and rule["name"] not in warning_signs:
            warning_signs.append(rule["name"])
    if escalated_by == "preterm_labor_risk":
        warning_signs.append("Preterm labor signs (before 37 weeks)")

    return {
        "actionTier": tier_info["tier"],
        "actionTierLabel": tier_info["tierLabel"],
        "recommendedNextAction": tier_info["instruction"],
        "whyThisResult": why,
        "majorRiskFactors": list(risk_formulation_result.get("dynamicRiskFactors", [])) +
                            list(risk_formulation_result.get("staticRiskFactors", [])),
        "warningSigns": warning_signs,
        "protectiveFactors": list(risk_formulation_result.get("protectiveFactors", [])),
        "disclaimer": (
            "This is an automated screening/support aid, not a diagnosis. It supports - but never "
            "replaces - assessment by a qualified healthcare professional. Any Emergency or Urgent "
            "result, or anything that feels sudden or severe, always means seek care now regardless "
            "of what this tool says."
        ),
    }


def synthesize(ml_result: dict = None, text: str = "", history: dict = None,
                hemoglobin: float = None, epds_responses: list = None, pregnancy_week: int = None,
                weight: float = None, previous_weight: float = None, fetal_movement_count: int = None,
                fundal_height: float = None, urine_protein: str = None, height_cm: float = None,
                previous_pregnancies: int = None) -> dict:
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

    # Same worst-signal-wins pattern for the other clinical inputs the ML
    # model and text layer can't see on their own - see clinical_inputs.py
    # for why each one maps onto the category it does (or, for weight
    # loss and fundal height, why it deliberately does NOT auto-escalate
    # and is only ever shown informationally).
    weight_result = None
    if weight is not None:
        weight_result = clinical_inputs.assess_weight_change(weight, previous_weight)
        text_scores["hypertensive_disorder"] = max(text_scores.get("hypertensive_disorder", 0.0), weight_result["hypertensiveScore"])

    fetal_movement_result = None
    if fetal_movement_count is not None:
        fetal_movement_result = clinical_inputs.assess_fetal_movement(fetal_movement_count)
        text_scores["fetal_distress"] = max(text_scores.get("fetal_distress", 0.0), fetal_movement_result["fetalDistressScore"])

    fundal_height_result = None
    if fundal_height is not None and pregnancy_week is not None:
        fundal_height_result = clinical_inputs.assess_fundal_height(fundal_height, pregnancy_week)

    urine_protein_result = None
    if urine_protein:
        urine_protein_result = clinical_inputs.assess_urine_protein(urine_protein)
        text_scores["hypertensive_disorder"] = max(
            text_scores.get("hypertensive_disorder", 0.0), urine_protein_result["hypertensiveScore"]
        )

    bmi_result = None
    if weight is not None and height_cm is not None:
        bmi_result = clinical_inputs.assess_bmi(weight, height_cm)

    # Background risk factors that never escalate a symptom score on their
    # own (unlike urine protein/weight/fetal movement above) - they only
    # ever shift risk_formulation's multiplier, same tier as a prior
    # C-section or chronic hypertension. Layered onto a COPY of the caller's
    # history dict so a structured Wizard input and a phrase typed in free
    # text both reach the exact same risk_formulation.py factor keys.
    derived_history = dict(history)
    if previous_pregnancies is not None and previous_pregnancies >= 4:
        derived_history["grand_multipara"] = True
    if bmi_result and bmi_result["category"] == "Obese":
        derived_history["pre_pregnancy_obesity"] = True
    elif bmi_result and bmi_result["category"] == "Underweight":
        derived_history["underweight_bmi"] = True
    # multiple_gestation itself needs no derivation - it's a plain boolean
    # flag identical in shape to every other Wizard history checkbox
    # (no_antenatal_care, prior_csection, ...), so it already reaches
    # risk_formulation.py through the ordinary history dict above.

    risk_formulation_result = risk_formulation.assess(text, derived_history)
    ladder_result = danger_ladder.classify(text)
    expert_rules = expert_system.apply_rules(text_scores)

    psych_result = None
    if epds_responses is not None:
        psych_result = psych_eval.score(epds_responses)

    base_mri = _mri_from_ml(ml_result)
    adjusted_mri = min(round(base_mri * risk_formulation_result["multiplier"]), 100)

    level = _tier_for_mri(adjusted_mri)
    escalated_by = None
    escalation_mri = 0.0

    if ladder_result["rung"] > 0:
        rung_level = _rung_level(ladder_result["rung"])
        if LEVEL_ORDER.index(rung_level) > LEVEL_ORDER.index(level):
            level = rung_level
            escalated_by = "danger_ladder"
            escalation_mri = RUNG_MRI[ladder_result["rung"]]

    worst_rule = None
    for rule in expert_rules:
        if not rule["activated"]:
            continue
        if worst_rule is None or LEVEL_ORDER.index(rule["severity"]) > LEVEL_ORDER.index(worst_rule["severity"]):
            worst_rule = rule
    if worst_rule and LEVEL_ORDER.index(worst_rule["severity"]) > LEVEL_ORDER.index(level):
        level = worst_rule["severity"]
        escalated_by = worst_rule["id"]
        escalation_mri = round(worst_rule["maxScore"] * 100)

    # Gestational age changes what a symptom means - labor signs that are
    # completely normal at term are a preterm-labor EMERGENCY before 37
    # weeks (a facility may still be able to slow or safely manage an early
    # delivery, but only if reached in time), which the ML model and the
    # rule-based checks above have no way to know without the week.
    preterm_labor_alert = False
    if pregnancy_week is not None and pregnancy_week < 37 and text_scores.get("obstructed_labor", 0.0) > 0.4:
        preterm_labor_alert = True
        obstructed_score = text_scores["obstructed_labor"]
        preterm_level = "Critical" if obstructed_score >= 0.65 else "Severe"
        if LEVEL_ORDER.index(preterm_level) > LEVEL_ORDER.index(level):
            level = preterm_level
            escalated_by = "preterm_labor_risk"
            escalation_mri = round(obstructed_score * 100)

    # Psychological screening escalates the SAME overall severity scale -
    # a self-harm-flagged EPDS result is exactly as urgent as a physical
    # danger sign, and must never be hidden behind a good physical result.
    if psych_result:
        psych_level = psych_eval.severity_for(psych_result)
        if LEVEL_ORDER.index(psych_level) > LEVEL_ORDER.index(level):
            level = psych_level
            escalated_by = "self_harm_risk" if psych_result["selfHarmFlagged"] else "psychological_screening"
            escalation_mri = _psych_mri(psych_result)

    # Never just snap to the tier's floor - that flattens every escalation
    # within a level to one identical number. Take the strongest of what
    # the ML+multiplier line actually computed and whatever specific
    # signal caused the escalation (bounded below by the tier floor so the
    # displayed number is always at least consistent with its own level).
    display_mri = max(adjusted_mri, escalation_mri, TIER_FLOOR[level])

    clinical_impression = human_intelligence.synthesize(
        text_scores, ml_result, text_result, ladder_result, expert_rules, risk_formulation_result, psych_result
    )
    explanation = _build_explanation(level, escalated_by, ladder_result, expert_rules, risk_formulation_result,
                                      ml_result, weight_result, fetal_movement_result, urine_protein_result)

    gestational_context = None
    if pregnancy_week is not None:
        gestational_context = pregnancy_guide.get_guide(pregnancy_week)
        gestational_context["pretermLaborAlert"] = preterm_labor_alert

    return {
        "mri": display_mri,
        "severity": {"level": level, "escalatedBy": escalated_by, **META[level]},
        "clinicalExplanation": explanation,
        "gestationalContext": gestational_context,
        "mlPrediction": ml_result,
        "textAnalysis": text_result,
        "hemoglobinAssessment": hb_result,
        "weightAssessment": weight_result,
        "fetalMovementAssessment": fetal_movement_result,
        "fundalHeightAssessment": fundal_height_result,
        "urineProteinAssessment": urine_protein_result,
        "bmiAssessment": bmi_result,
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

        # Independent of the depression classification above - a LOW
        # depression total can still sit alongside a flagged anxiety
        # subscale (EPDS-3A), and that would otherwise never get its own
        # recommendation line.
        if psych_result.get("anxietySubscale", {}).get("flagged") and not psych_result["selfHarmFlagged"]:
            recs.append(
                "Your responses suggest possible anxiety (EPDS-3A subscale) even though your overall "
                "mood score is lower - mention this to your ANC provider or try the Mental Health Check "
                "again if it continues"
            )

    if clinical_impression:
        for pattern in clinical_impression["patterns"]:
            recs.append(f"⚠️ Pattern detected: {pattern['note']}")

    if len(recs) == 1:
        recs.append("No danger signs identified from the information provided - keep attending scheduled ANC visits")

    return recs
