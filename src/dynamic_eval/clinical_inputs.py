"""
Additional clinical inputs the ML classifier was never trained on and the
danger-sign/text layers don't cover on their own: weight (tracked over
time, since a single weight reading alone isn't meaningfully gradable
without a baseline), fetal movement count, and fundal height.

Each is a small, well-established rule of thumb from WHO/RCH antenatal
care practice, not a diagnosis:
  - Sudden rapid weight gain -> a recognized pre-eclampsia/fluid-retention
    sign, so it's blended into the SAME 'hypertensive_disorder' category
    the danger-sign/expert-rule layer already uses (worst-signal-wins,
    same pattern as hemoglobin_rules.py feeding 'anemia').
  - Weight LOSS during pregnancy is its own concern, but doesn't cleanly
    map onto an existing escalation category, so it's surfaced as its own
    informational flag rather than force-fit into one.
  - Reduced/absent fetal movement is blended into 'fetal_distress' the
    same way, since that's exactly the category the danger-sign ladder
    and expert rules already read for this.
  - Fundal height uses the McDonald's-rule approximation (roughly
    gestational-week-in-cm, +/-3cm) - a screening estimate, never a
    substitute for an actual antenatal exam.
  - Urine protein (dipstick: nil/trace/1+/2+/3+) is graded the same way
    as the lab-report text parser in report_analyzer.py already reads
    it, but as a direct structured input rather than only ever reachable
    by uploading a report. Significant proteinuria (2+ or higher) is, on
    its own, a recognized pre-eclampsia sign - it feeds the SAME
    'hypertensive_disorder' category weight_result does, so it can
    activate the same urgent-workup rule on its own, exactly as it
    would clinically.
  - BMI (from weight + height) is a BACKGROUND risk factor, not an acute
    finding - a high or low BMI doesn't mean "go to a facility now" the
    way heavy bleeding does. It's deliberately never blended into a
    category score here; the caller (triage.py) maps its category onto
    the existing risk_formulation.py static-factor multiplier instead,
    same tier as a prior C-section or chronic hypertension.
"""

RAPID_GAIN_THRESHOLD_KG = 2.0  # gain between two checks flagged as rapid
FUNDAL_HEIGHT_TOLERANCE_WEEKS = 3

# WHO BMI categories.
BMI_UNDERWEIGHT = 18.5
BMI_OBESE = 30.0


def assess_weight_change(current_kg: float, previous_kg: float = None) -> dict:
    if previous_kg is None:
        return {"status": "First recorded weight", "flag": None, "hypertensiveScore": 0.0}

    diff = round(current_kg - previous_kg, 1)
    if diff < 0:
        return {
            "status": "Weight loss", "diffKg": diff,
            "flag": "Weight loss during pregnancy can be a concern, especially outside the first trimester - discuss with your provider.",
            "hypertensiveScore": 0.0,
        }
    if diff >= RAPID_GAIN_THRESHOLD_KG:
        return {
            "status": "Rapid weight gain", "diffKg": diff,
            "flag": "A sudden, rapid weight increase can be a sign of fluid retention linked to pre-eclampsia - worth flagging to your provider.",
            "hypertensiveScore": 0.55,
        }
    return {"status": "Tracking normally", "diffKg": diff, "flag": None, "hypertensiveScore": 0.0}


def assess_fetal_movement(count_last_hour: int) -> dict:
    if count_last_hour == 0:
        return {
            "status": "No movement felt",
            "flag": "No fetal movement felt in the last hour - this needs same-day evaluation, not waiting to see if it changes.",
            "fetalDistressScore": 0.9,
        }
    if count_last_hour < 4:
        return {
            "status": "Reduced movement",
            "flag": "Fewer movements than usual - monitor closely over the next hour and seek care if it doesn't pick up.",
            "fetalDistressScore": 0.5,
        }
    return {"status": "Normal", "flag": None, "fetalDistressScore": 0.0}


def assess_fundal_height(height_cm: float, week: int) -> dict:
    expected_low, expected_high = week - FUNDAL_HEIGHT_TOLERANCE_WEEKS, week + FUNDAL_HEIGHT_TOLERANCE_WEEKS
    if height_cm < expected_low:
        return {
            "status": "Smaller than expected", "expectedRange": [expected_low, expected_high],
            "flag": f"Fundal height ({height_cm}cm) is below the expected range for week {week} ({expected_low}-{expected_high}cm) - may need a growth assessment.",
        }
    if height_cm > expected_high:
        return {
            "status": "Larger than expected", "expectedRange": [expected_low, expected_high],
            "flag": f"Fundal height ({height_cm}cm) is above the expected range for week {week} ({expected_low}-{expected_high}cm) - worth discussing (e.g. fluid, growth, multiples).",
        }
    return {"status": "Within expected range", "expectedRange": [expected_low, expected_high], "flag": None}


# Dipstick readings graded so 2+/3+ alone can cross the hypertensive_disorder
# rule's 0.5 activation threshold in expert_system.py - clinically,
# significant proteinuria is itself part of a pre-eclampsia diagnosis, not
# just a supporting detail that only matters alongside a symptom report.
# Capped below expert_system.py's 0.85 Critical cutoff even at 3+/4+ -
# heavy proteinuria BY ITSELF (no hypertension, no symptoms reported) is a
# same-day-facility-visit finding, not a call-an-ambulance one; it only
# becomes Critical in combination with a real danger sign, which the
# danger-sign ladder and expert rules already catch independently.
_URINE_PROTEIN_SCORES = {
    "nil": 0.0, "negative": 0.0, "trace": 0.15,
    "1+": 0.55, "2+": 0.7, "3+": 0.8, "4+": 0.8,
}


def assess_urine_protein(value: str) -> dict:
    key = (value or "").strip().lower()
    score = _URINE_PROTEIN_SCORES.get(key)
    if score is None:
        return {"status": "Unrecognized reading", "reading": value, "flag": None, "hypertensiveScore": 0.0}

    if score >= 0.7:
        flag = f"Significant protein in urine ({value}) is a recognized pre-eclampsia sign - needs prompt BP check and provider review."
    elif score >= 0.5:
        flag = f"Protein in urine ({value}) can be an early pre-eclampsia sign, especially alongside high BP - worth mentioning to your provider soon."
    elif score > 0:
        flag = f"Trace protein ({value}) is usually not concerning on its own, but worth a repeat check at your next visit."
    else:
        flag = None

    return {"status": "Protein detected" if score > 0 else "Nil", "reading": value, "flag": flag, "hypertensiveScore": score}


def assess_bmi(weight_kg: float, height_cm: float) -> dict:
    if not height_cm:
        return None
    bmi = round(weight_kg / ((height_cm / 100) ** 2), 1)
    if bmi < BMI_UNDERWEIGHT:
        category = "Underweight"
        flag = "A below-range BMI going into or during pregnancy is linked to a higher risk of a low-birth-weight baby - worth discussing nutrition with your provider."
    elif bmi >= BMI_OBESE:
        category = "Obese"
        flag = "A higher BMI raises the background risk of gestational diabetes and hypertensive disorders in pregnancy - worth mentioning at your next ANC visit, not an emergency on its own."
    elif bmi >= 25:
        category = "Overweight"
        flag = None
    else:
        category = "Normal"
        flag = None
    return {"bmi": bmi, "category": category, "flag": flag}
