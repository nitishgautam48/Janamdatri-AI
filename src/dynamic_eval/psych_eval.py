"""
Perinatal psychological screening - the Edinburgh Postnatal Depression
Scale (EPDS): Cox, J.L., Holden, J.M., & Sagovsky, R. (1987). "Detection
of postnatal depression: development of the 10-item Edinburgh Postnatal
Depression Scale." British Journal of Psychiatry, 150, 782-786.

Reproduced here per its standard usage terms (attribute authors, title,
and source in any reproduction). A 10-item, validated screening tool for
depression during pregnancy AND postpartum - validated in Hindi and
multiple other Indian languages and used within India's maternal mental
health programmes, which is why physical danger-sign screening alone is
not enough: perinatal depression and anxiety are common, under-recognized,
and treatable.

⚠️ A screening tool, not a diagnosis. A raised score means "refer for a
proper clinical mental health assessment," not "this person has
depression." Item 10 (thoughts of self-harm) is escalated independently
of the total score: ANY non-zero response there is a critical safety
signal on its own, regardless of the rest of the score - the same
never-let-one-dangerous-signal-hide-behind-an-average principle this
project already applies to physical danger signs.

Also scores the validated EPDS-3A anxiety subscale (items 3, 4, and 5 -
Matthey, S. (2008). "Using the Edinburgh Postnatal Depression Scale to
screen for anxiety disorders." Depression and Anxiety, 25(11), 926-931;
cutoff of >=6 further validated in Matthey, S., Fisher, J., & Rowe, H.
(2013), Journal of Affective Disorders, 146(2), 224-230) alongside the
main depression total, since EPDS was designed to screen depression and
can miss a person whose predominant perinatal symptom is anxiety rather
than low mood - the two commonly co-occur but are clinically distinct,
and a tool that only reports the depression total risks telling an
anxious-but-not-depressed person their screen is reassuring when it
shouldn't be.
"""

ITEMS = [
    "I have been able to laugh and see the funny side of things",
    "I have looked forward with enjoyment to things",
    "I have blamed myself unnecessarily when things went wrong",
    "I have been anxious or worried for no good reason",
    "I have felt scared or panicky for no very good reason",
    "Things have been getting on top of me",
    "I have been so unhappy that I have had difficulty sleeping",
    "I have felt sad or miserable",
    "I have been so unhappy that I have been crying",
    "The thought of harming myself has occurred to me",
]

# Each item's 4 response options, already in 0->3 symptom-increasing order.
OPTIONS = [
    ["As much as I always could", "Not quite so much now", "Definitely not so much now", "Not at all"],
    ["As much as I ever did", "Rather less than I used to", "Definitely less than I used to", "Hardly at all"],
    ["No, never", "Not very often", "Yes, some of the time", "Yes, most of the time"],
    ["No, not at all", "Hardly ever", "Yes, sometimes", "Yes, very often"],
    ["No, not at all", "No, not much", "Yes, sometimes", "Yes, quite a lot"],
    ["No, I have been coping as well as ever", "No, most of the time I have coped quite well",
     "Yes, sometimes I haven't been coping as well as usual", "Yes, most of the time I haven't been able to cope at all"],
    ["No, not at all", "Not very often", "Yes, sometimes", "Yes, most of the time"],
    ["No, not at all", "Not very often", "Yes, quite often", "Yes, most of the time"],
    ["No, never", "Only occasionally", "Yes, quite often", "Yes, most of the time"],
    ["Never", "Hardly ever", "Sometimes", "Yes, quite often"],
]

SELF_HARM_ITEM_INDEX = 9  # zero-indexed item 10
# EPDS-3A anxiety subscale: items 3, 4, 5 (zero-indexed 2, 3, 4) - "blamed
# myself unnecessarily," "anxious or worried for no good reason," "scared
# or panicky for no very good reason." Max 9; >=6 is the validated cutoff
# for probable anxiety.
ANXIETY_SUBSCALE_INDICES = [2, 3, 4]
ANXIETY_SUBSCALE_CUTOFF = 6

CITATION = (
    "Edinburgh Postnatal Depression Scale (EPDS) - Cox, J.L., Holden, J.M., & Sagovsky, R. (1987), "
    "British Journal of Psychiatry, 150, 782-786. A validated screening tool, not a diagnosis - "
    "refer for clinical mental health assessment on a raised score or any self-harm item response."
)
ANXIETY_CITATION = (
    "EPDS-3A anxiety subscale (items 3-5) - Matthey, S. (2008), Depression and Anxiety, 25(11), "
    "926-931; cutoff validated in Matthey, Fisher, & Rowe (2013), Journal of Affective Disorders, "
    "146(2), 224-230. A raised score means possible anxiety even when the depression total is low."
)


def score(responses: list) -> dict:
    if len(responses) != 10:
        raise ValueError("EPDS requires exactly 10 responses (0-3 each).")
    for i, r in enumerate(responses):
        if r not in (0, 1, 2, 3):
            raise ValueError(f"Response {i + 1} must be an integer 0-3, got {r!r}.")

    total = sum(responses)
    self_harm_score = responses[SELF_HARM_ITEM_INDEX]
    self_harm_flagged = self_harm_score > 0
    # The item's own 4-point response scale (Never -> Hardly ever ->
    # Sometimes -> Yes, quite often) is already an ordinal severity signal
    # in the validated instrument itself - reported alongside the flag so
    # a raised item isn't just yes/no, without ever changing the flag/
    # severity logic below: ANY non-zero response still escalates to
    # Critical (severity_for), exactly as before. Purely additional
    # transparency, the same role danger_ladder.py's rung plays for
    # physical danger signs.
    self_harm_severity_label = OPTIONS[SELF_HARM_ITEM_INDEX][self_harm_score]

    if self_harm_flagged:
        classification = "Self-harm risk flagged"
    elif total >= 20:
        classification = "High symptom burden"
    elif total >= 13:
        classification = "Probable depression"
    elif total >= 10:
        classification = "Possible depression"
    else:
        classification = "Low probability"

    anxiety_total = sum(responses[i] for i in ANXIETY_SUBSCALE_INDICES)
    anxiety_flagged = anxiety_total >= ANXIETY_SUBSCALE_CUTOFF
    # Reported independently of the depression classification above - a
    # low depression total does NOT mean a low anxiety subscale, and
    # reporting only the total would silently miss someone whose main
    # perinatal symptom is anxiety.
    anxiety_classification = "Probable anxiety" if anxiety_flagged else "Low probability"

    return {
        "total": total,
        "maxScore": 30,
        "classification": classification,
        "selfHarmItemScore": self_harm_score,
        "selfHarmFlagged": self_harm_flagged,
        "selfHarmSeverityLabel": self_harm_severity_label,
        "anxietySubscale": {
            "total": anxiety_total,
            "maxScore": 9,
            "cutoff": ANXIETY_SUBSCALE_CUTOFF,
            "classification": anxiety_classification,
            "flagged": anxiety_flagged,
            "methodology": ANXIETY_CITATION,
        },
        "methodology": CITATION,
    }


def severity_for(psych_result: dict) -> str:
    """Maps an EPDS result onto this project's Minimal..Critical scale."""
    if psych_result["selfHarmFlagged"]:
        return "Critical"
    if psych_result["total"] >= 20:
        return "Severe"
    if psych_result["total"] >= 13:
        return "Moderate"
    if psych_result["total"] >= 10:
        return "Mild"
    # A low depression TOTAL can still hide a flagged anxiety subscale -
    # someone whose main perinatal symptom is anxiety rather than low mood
    # would otherwise land on "Minimal" despite a clinically meaningful
    # anxiety signal, the same kind of average-hides-a-signal gap this
    # project refuses to allow for self-harm or physical danger signs.
    if psych_result.get("anxietySubscale", {}).get("flagged"):
        return "Mild"
    return "Minimal"
