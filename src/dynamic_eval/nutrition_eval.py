"""
Personalized Nutrition Analysis for pregnancy - a structured food-group
frequency questionnaire (deliberately NOT a calorie/macro food diary; this
project has no food-composition database, and building one accurately is
out of scope for a rule-based screening aid). It asks how often a set of
known nutrient-dense food groups are eaten - the same thing an ANC
counselor would actually ask - and scores dietary adequacy per nutrient
against trimester-aware targets loosely based on ICMR-NIN Dietary
Guidelines for pregnant women in India, with specific, affordable,
commonly-available Indian food suggestions to close each gap.

⚠️ An approximation to start a conversation with an ANC provider or
nutritionist - not a lab-based nutrient assay, and not a diagnosis.
"""

FREQUENCY_OPTIONS = ["Never", "Rarely (1-2 days/week)", "Sometimes (3-4 days/week)", "Regularly (5-7 days/week)"]

QUESTIONS = [
    {"id": "leafy_greens", "text": "Green leafy vegetables (palak, methi, sarson, amaranth)"},
    {"id": "dairy", "text": "Milk, curd, or paneer"},
    {"id": "nonveg_or_eggs", "text": "Eggs, chicken, fish, or meat"},
    {"id": "legumes", "text": "Dals, lentils, beans, or chickpeas"},
    {"id": "fruits", "text": "Fruits (citrus, banana, papaya, guava, etc.)"},
    {"id": "whole_grains", "text": "Whole grains or millets (ragi, bajra, jowar, whole wheat)"},
    {"id": "nuts_seeds", "text": "Nuts or seeds (groundnut, til/sesame, almonds)"},
    {"id": "iodized_salt", "text": "Iodized salt for cooking at home"},
    {"id": "ifa_tablets", "text": "Your prescribed iron-folic acid (IFA) tablet"},
    {"id": "calcium_supplement", "text": "A calcium supplement, if your provider prescribed one"},
    {"id": "sun_exposure", "text": "10-15 minutes of sunlight on your arms/face"},
]
QUESTION_IDS = [q["id"] for q in QUESTIONS]

# Each nutrient is a weighted read of a subset of the questions above - an
# APPROXIMATION of dietary adequacy from food-group frequency, same spirit
# as text_analyzer.py's phrase-based symptom scoring: not a measurement,
# a structured, transparent proxy that's honest about what it is.
NUTRIENT_WEIGHTS = {
    "Iron": {"leafy_greens": 0.30, "legumes": 0.20, "nonveg_or_eggs": 0.20, "whole_grains": 0.10, "ifa_tablets": 0.20},
    "Protein": {"dairy": 0.25, "legumes": 0.30, "nonveg_or_eggs": 0.30, "nuts_seeds": 0.15},
    "Folate": {"leafy_greens": 0.35, "legumes": 0.20, "fruits": 0.20, "ifa_tablets": 0.25},
    "Calcium": {"dairy": 0.45, "leafy_greens": 0.15, "nuts_seeds": 0.15, "calcium_supplement": 0.25},
    "Vitamin B12": {"dairy": 0.35, "nonveg_or_eggs": 0.50, "ifa_tablets": 0.15},
    "Vitamin D": {"sun_exposure": 0.60, "nonveg_or_eggs": 0.20, "dairy": 0.20},
    "Iodine": {"iodized_salt": 0.70, "dairy": 0.15, "nonveg_or_eggs": 0.15},
}

FOOD_SUGGESTIONS = {
    "Iron": ["Palak/methi/sarson saag", "Jaggery (gur) instead of sugar", "Ragi or bajra rotis", "Dates (khajur)",
              "Rajma, chana, or other lentils", "Eggs or lean meat if non-vegetarian",
              "Pair iron-rich food with lemon, amla, or guava (vitamin C) to absorb it better"],
    "Protein": ["Dal, rajma, or chana daily", "Paneer or curd", "Eggs, chicken, or fish if non-vegetarian",
                "Peanuts, til (sesame), or soybean"],
    "Folate": ["Green leafy vegetables daily", "Citrus fruits and banana", "Sprouted moong or lentils",
               "Your prescribed IFA tablet - don't skip it"],
    "Calcium": ["Milk, curd, or paneer daily", "Ragi (very high in calcium)", "Til (sesame seeds)",
                "Your calcium supplement if prescribed, taken a few hours apart from your iron tablet"],
    "Vitamin B12": ["Milk, curd, paneer, or eggs daily", "Fish or meat if non-vegetarian",
                    "If strictly vegetarian, ask your provider about a B12 supplement - plant foods have very little B12"],
    "Vitamin D": ["10-15 minutes of morning or evening sunlight on your arms/face", "Eggs or fatty fish if non-vegetarian",
                  "Fortified milk, if available in your area"],
    "Iodine": ["Always cook with iodized salt", "Milk and dairy", "Eggs or fish if non-vegetarian"],
}

# Which nutrients matter most in which trimester - folate/B12 for early
# neural-tube development, iron/calcium ramping up as the baby grows.
TRIMESTER_EMPHASIS = {1: ["Folate", "Vitamin B12"], 2: ["Iron", "Calcium"], 3: ["Iron", "Calcium", "Protein"]}


def score(responses: dict, hemoglobin: float = None, trimester: int = None) -> dict:
    missing = [qid for qid in QUESTION_IDS if qid not in responses]
    if missing:
        raise ValueError(f"Missing responses for: {', '.join(missing)}")
    for qid, val in responses.items():
        if val not in (0, 1, 2, 3):
            raise ValueError(f"Response for '{qid}' must be an integer 0-3, got {val!r}.")

    nutrients = {}
    for nutrient, weights in NUTRIENT_WEIGHTS.items():
        raw = sum(responses[qid] * w for qid, w in weights.items())
        max_raw = sum(3 * w for w in weights.values())
        pct = round((raw / max_raw) * 100) if max_raw else 0
        if pct < 40:
            status = "Low"
        elif pct < 70:
            status = "Borderline"
        else:
            status = "Adequate"
        nutrients[nutrient] = {"percent": pct, "status": status, "suggestions": FOOD_SUGGESTIONS[nutrient]}

    gaps = [n for n, v in nutrients.items() if v["status"] in ("Low", "Borderline")]
    priority_nutrients = TRIMESTER_EMPHASIS.get(trimester, []) if trimester else []

    # Connects the dietary read to a clinical finding, rather than treating
    # nutrition and clinical data as two unrelated tabs - a low Hb reading
    # AND a low dietary iron score are worth flagging together, since the
    # fix (diet + iron therapy) is the same either way, and the connection
    # itself is useful information the patient wouldn't otherwise see.
    connected_insights = []
    if hemoglobin is not None and hemoglobin < 11 and nutrients["Iron"]["status"] != "Adequate":
        connected_insights.append(
            f"Your hemoglobin ({hemoglobin} g/dL) is below normal, and your dietary iron intake looks "
            f"{nutrients['Iron']['status'].lower()} too - the anemia may be diet-related in addition to "
            "needing iron therapy, so both matter here."
        )
    if responses.get("ifa_tablets", 3) <= 1 and (nutrients["Iron"]["status"] != "Adequate" or nutrients["Folate"]["status"] != "Adequate"):
        connected_insights.append(
            "Skipping the IFA tablet is likely pulling down both your iron and folate adequacy - "
            "it's the single biggest lever here if diet alone hasn't been enough."
        )

    return {
        "nutrients": nutrients,
        "gaps": gaps,
        "priorityNutrients": priority_nutrients,
        "connectedInsights": connected_insights,
        "methodology": (
            "A structured food-group frequency questionnaire (not a calorie/macro food diary) scored "
            "against trimester-aware targets loosely based on ICMR-NIN Dietary Guidelines for pregnant "
            "women in India. An approximation to guide the conversation with your ANC provider or a "
            "nutritionist - not a substitute for a dietician's assessment or a blood test."
        ),
    }
