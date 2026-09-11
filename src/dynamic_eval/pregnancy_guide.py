"""
Pregnancy guidance - trimester/week-based ANC visit schedule, nutrition
guidance, and trimester-specific danger signs, aligned with India's
Reproductive & Child Health (RCH) programme ANC schedule and the
Pradhan Mantri Surakshit Matritva Abhiyan (PMSMA) free monthly ANC day
(9th of every month, from the 2nd trimester).

This is general informational/educational content for "what to expect
and when," not personalized medical advice - always follow what an
actual ANC provider prescribes for a specific pregnancy over this guide.
"""

from datetime import date, timedelta

DUE_DATE_OFFSET_DAYS = 280  # Naegele's rule: LMP + 280 days

ANC_SCHEDULE = [
    {"visit": 1, "windowWeeks": [0, 12], "window": "Within 12 weeks (as soon as pregnancy is confirmed)",
     "checks": ["Register the pregnancy", "Blood pressure, weight, hemoglobin", "Blood group, HIV/syphilis/hepatitis screening", "Start iron-folic acid (IFA) tablets"]},
    {"visit": 2, "windowWeeks": [14, 26], "window": "14-26 weeks",
     "checks": ["BP and weight check", "Fetal heart sounds", "Tetanus/Td vaccination", "Continue IFA + start calcium"]},
    {"visit": 3, "windowWeeks": [28, 34], "window": "28-34 weeks",
     "checks": ["BP and weight check", "Fundal height, fetal movement count", "Repeat hemoglobin test", "Second Td dose if due"]},
    {"visit": 4, "windowWeeks": [36, 40], "window": "36 weeks to term",
     "checks": ["BP and weight check", "Fetal position check", "Finalize birth-preparedness plan", "Review danger signs"]},
]

TRIMESTER_TIPS = {
    1: {
        "nutrition": ["Start iron-folic acid (IFA) tablets as prescribed", "Small, frequent meals if experiencing nausea", "Avoid raw/undercooked food and unpasteurized dairy"],
        "dangerSigns": ["Severe vomiting, unable to keep any food or water down", "Heavy bleeding or severe cramping", "Fever with chills"],
        "note": "First trimester - register for ANC now if you haven't already. Free checkups are available on PMSMA day (9th of every month) at government facilities.",
    },
    2: {
        "nutrition": ["Continue IFA and start calcium supplementation", "Increase iron-rich foods (leafy greens, jaggery, lentils)", "Stay well hydrated"],
        "dangerSigns": ["Severe headache or blurred vision", "Swelling of the face or hands", "Reduced or no fetal movement once movement has normally started", "High fever"],
        "note": "Second trimester - fetal movements are typically first felt around now. Get the Td/TT vaccination on schedule.",
    },
    3: {
        "nutrition": ["Continue IFA and calcium", "Smaller, more frequent meals as space reduces", "Rest with feet elevated if swelling occurs"],
        "dangerSigns": ["Severe abdominal pain", "Heavy bleeding", "Convulsions or fits", "Absent fetal movement", "Fluid leaking (possible waters breaking)", "Contractions before 37 weeks"],
        "note": "Third trimester - finalize your birth-preparedness plan: which facility, how you'll get there, who goes with you, money and documents ready.",
    },
}

INDIA_SCHEMES = {
    "PMSMA": "Pradhan Mantri Surakshit Matritva Abhiyan - free ANC checkup on the 9th of every month at government health facilities, from the 2nd trimester.",
    "JSY": "Janani Suraksha Yojana - cash assistance for institutional delivery. Ask your ASHA worker about eligibility.",
    "PMMVY": "Pradhan Mantri Matru Vandana Yojana - cash incentive in installments for ANC registration, checkups, and institutional delivery of the first living child.",
    "AnemiaMuktBharat": "National programme for iron-folic acid supplementation and anemia screening/treatment during pregnancy.",
}


def current_week_from_lmp(lmp: date, today: date = None) -> int:
    today = today or date.today()
    return max((today - lmp).days // 7, 0)


def trimester_for_week(week: int) -> int:
    if week <= 13:
        return 1
    if week <= 27:
        return 2
    return 3


def _next_visit(week: int) -> dict:
    for visit in ANC_SCHEDULE:
        if week <= visit["windowWeeks"][1]:
            return visit
    return ANC_SCHEDULE[-1]


def get_guide(week: int) -> dict:
    week = min(max(week, 0), 42)
    trimester = trimester_for_week(week)
    tips = TRIMESTER_TIPS[trimester]

    return {
        "week": week,
        "trimester": trimester,
        "weeksUntilDue": max(40 - week, 0),
        "nutrition": tips["nutrition"],
        "dangerSigns": tips["dangerSigns"],
        "note": tips["note"],
        "nextAncVisit": _next_visit(week),
        "ancSchedule": ANC_SCHEDULE,
        "schemes": INDIA_SCHEMES,
    }


def guide_from_lmp(lmp_str: str, today: date = None) -> dict:
    try:
        lmp = date.fromisoformat(lmp_str)
    except ValueError as exc:
        raise ValueError("lmp must be an ISO date string, e.g. 2026-01-15") from exc

    week = current_week_from_lmp(lmp, today)
    guide = get_guide(week)
    guide["lmp"] = lmp.isoformat()
    guide["estimatedDueDate"] = (lmp + timedelta(days=DUE_DATE_OFFSET_DAYS)).isoformat()
    return guide
