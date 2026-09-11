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
"""

RAPID_GAIN_THRESHOLD_KG = 2.0  # gain between two checks flagged as rapid
FUNDAL_HEIGHT_TOLERANCE_WEEKS = 3


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
