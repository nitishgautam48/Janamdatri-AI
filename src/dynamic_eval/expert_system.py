"""
Maternal Expert System - rules for danger signs the ML classifier can't
see (it only knows Age/BP/blood-sugar/temperature/heart-rate; it has no
notion of bleeding, fetal movement, or labor progress).

Severity is graded directly off the underlying condition score rather
than off a confidence*weight scheme: most rules here have only 1-2
conditions (a continuous text-derived score, not a multi-symptom
co-occurrence count), so confidence*weight collapses to "met the one
condition => automatically Critical" the instant it activates at all.
Grading off score magnitude distinguishes "a little spotting" from
"bleeding heavily" instead of treating both as equally urgent.
`threshold` is the activation/Moderate cutoff, 0.65 is Severe, 0.85 is
Critical - same tiering used by the clinical-scale mapping throughout
this project.
"""

RULES = [
    {
        "id": "pph_rule",
        "name": "Postpartum/Antepartum Hemorrhage Risk",
        "conditions": ["hemorrhage", "anemia"],
        "threshold": 0.4,
        "intervention": (
            "Emergency referral - uterotonic administration and IV fluids at nearest facility; "
            "do not wait for bleeding to worsen."
        ),
    },
    {
        "id": "sepsis_rule",
        "name": "Puerperal / Obstetric Sepsis Risk",
        "conditions": ["infection"],
        "threshold": 0.4,
        "intervention": (
            "Facility evaluation for infection - antibiotics and monitoring; "
            "do not manage fever/foul discharge at home."
        ),
    },
    {
        "id": "fetal_distress_rule",
        "name": "Fetal Distress",
        "conditions": ["fetal_distress"],
        "threshold": 0.4,
        "intervention": (
            "Immediate facility visit for fetal heart rate monitoring - "
            "reduced/absent movement needs same-day evaluation."
        ),
    },
    {
        "id": "obstructed_labor_rule",
        "name": "Obstructed / Prolonged Labor Risk",
        "conditions": ["obstructed_labor"],
        "threshold": 0.5,
        "intervention": (
            "Emergency transport to a facility with emergency obstetric care "
            "(possible instrumental delivery/C-section)."
        ),
    },
    {
        "id": "hypertensive_symptom_rule",
        "name": "Pre-eclampsia / Eclampsia Symptom Pattern",
        "conditions": ["hypertensive_disorder"],
        "threshold": 0.5,
        "intervention": (
            "Urgent BP recheck and urine protein test; refer to facility for pre-eclampsia workup. "
            "Emergency transport if convulsions present."
        ),
    },
]


def apply_rules(text_scores: dict) -> list:
    results = []

    for rule in RULES:
        condition_scores = [text_scores[c] for c in rule["conditions"] if c in text_scores]
        met_conditions = sum(1 for c in rule["conditions"]
                              if c in text_scores and text_scores[c] > rule["threshold"])

        measured_conditions = len(condition_scores)
        max_score = max(condition_scores) if condition_scores else 0.0
        confidence = met_conditions / measured_conditions if measured_conditions > 0 else 0.0
        activated = measured_conditions > 0 and max_score > rule["threshold"]

        if max_score >= 0.85:
            severity = "Critical"
        elif max_score >= 0.65:
            severity = "Severe"
        elif activated:
            severity = "Moderate"
        else:
            severity = "Low"

        entry = {
            "id": rule["id"],
            "name": rule["name"],
            "activated": activated,
            "confidence": confidence,
            "maxScore": max_score,
            "measuredConditions": measured_conditions,
            "totalConditions": len(rule["conditions"]),
        }
        if activated:
            entry["severity"] = severity
            entry["intervention"] = rule["intervention"]
        results.append(entry)

    return results
