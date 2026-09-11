"""
Postpartum Care - guidance for the 6 weeks after delivery, aligned with
WHO/India RCH postnatal care (PNC) visit timing. Mirrors pregnancy_guide.py's
structure and tone: general informational content for "what to expect and
when," not personalized medical advice.

Danger signs listed here are the same WHO-recognized postnatal warning
signs a health worker would go through - several (hemorrhage, sepsis,
severe headache/pre-eclampsia, self-harm risk) are exactly what this
project's existing assessment/danger-ladder and EPDS screening already
detect, so a postpartum person can and should still use those tools -
this module doesn't replace them, it adds the recovery/breastfeeding/
follow-up content those tools were never meant to cover.
"""

from datetime import date

PNC_SCHEDULE = [
    {"visit": 1, "windowDays": [0, 2], "window": "Within 48 hours of delivery",
     "checks": ["Check for bleeding, BP, and temperature", "Initiate/support breastfeeding", "Check the newborn"]},
    {"visit": 2, "windowDays": [3, 7], "window": "3-7 days after delivery",
     "checks": ["Check for signs of infection", "Review breastfeeding", "Discuss danger signs to watch for"]},
    {"visit": 3, "windowDays": [8, 42], "window": "By 6 weeks after delivery",
     "checks": ["Full postnatal check-up", "Contraception counseling", "Continue iron-folic acid if you were anemic"]},
]

DANGER_SIGNS = [
    "Heavy vaginal bleeding (soaking more than one pad an hour) or passing large clots",
    "High fever or chills",
    "Foul-smelling vaginal discharge",
    "Severe headache, blurred vision, or sudden swelling - postpartum pre-eclampsia can still happen after delivery",
    "Convulsions/fits",
    "Severe abdominal pain",
    "A red, swollen, painful breast with fever (possible mastitis)",
    "Pain, swelling, or redness in one leg (possible blood clot)",
    "Difficulty breathing or chest pain",
    "Thoughts of harming yourself or your baby, or feeling unable to cope",
]

WEEK_TIPS = {
    "week1": {
        "recovery": [
            "Rest as much as possible - sleep when the baby sleeps",
            "Expect vaginal bleeding (lochia) that gradually lightens - heavy bleeding or large clots need urgent care",
            "Care for any perineal/incision site as your provider advised",
        ],
        "breastfeeding": [
            "Feed on demand, at least 8-12 times in 24 hours",
            "A correct latch reduces pain and helps supply",
            "Colostrum (the first, thick milk) is exactly what the baby needs - it isn't a sign your milk 'hasn't come in'",
        ],
        "mentalHealth": (
            "The first couple of weeks often bring intense emotions ('baby blues') - this is common. If low mood, "
            "anxiety, or feeling overwhelmed lasts beyond two weeks or feels severe, use the Mental Health Check."
        ),
    },
    "week2to6": {
        "recovery": [
            "Bleeding should keep lightening and lessening in amount",
            "Gentle movement is fine; avoid heavy lifting or strenuous exercise until cleared at your 6-week check",
            "Watch any incision site for signs of infection (increasing redness, pain, discharge)",
        ],
        "breastfeeding": [
            "Supply regulates over these weeks - frequent feeding is the main driver",
            "Soreness, engorgement, or a blocked duct are common; a red, hot, painful area WITH fever needs prompt care (possible mastitis)",
        ],
        "mentalHealth": (
            "If sadness, anxiety, or difficulty bonding continues past two weeks, or you have thoughts of harming "
            "yourself or your baby, please use the Mental Health Check and reach out to your provider - postpartum "
            "depression is common and very treatable."
        ),
    },
}


def days_postpartum(delivery_date: date, today: date = None) -> int:
    today = today or date.today()
    return max((today - delivery_date).days, 0)


def _next_visit(days: int) -> dict:
    for visit in PNC_SCHEDULE:
        if days <= visit["windowDays"][1]:
            return visit
    return PNC_SCHEDULE[-1]


def get_postpartum_guide(delivery_date_str: str, today: date = None) -> dict:
    delivery_date = date.fromisoformat(delivery_date_str)
    days = days_postpartum(delivery_date, today)
    tips = WEEK_TIPS["week1"] if days <= 7 else WEEK_TIPS["week2to6"]

    return {
        "deliveryDate": delivery_date.isoformat(),
        "daysPostpartum": days,
        "weeksPostpartum": days // 7,
        "isWithin6Weeks": days <= 42,
        "recovery": tips["recovery"],
        "breastfeeding": tips["breastfeeding"],
        "mentalHealthNote": tips["mentalHealth"],
        "dangerSigns": DANGER_SIGNS,
        "nextVisit": _next_visit(days),
        "pncSchedule": PNC_SCHEDULE,
    }
