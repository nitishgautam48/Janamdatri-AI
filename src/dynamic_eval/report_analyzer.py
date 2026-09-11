"""
Report Analyzer - pulls a medication schedule and key lab findings out of
an uploaded prescription/lab report's text, using pattern-matching over
known drug names, dosing notation, and common Indian prescription
shorthand (e.g. "1-0-1" for morning-afternoon-night, "OD/BD/TDS/HS/SOS").

⚠️ This is pattern-matching over text, not medical interpretation. It
exists to turn a wall of prescription text into a clear "what to take,
when" reminder and a short list of any flagged values - always follow
what your actual prescriber wrote over this tool's reading of it, and
ask your ANC provider or pharmacist if anything here looks wrong or
you're unsure of a dose.
"""

import re

from . import hemoglobin_rules

# (canonical name, [aliases to search for]) - common medicines prescribed
# during pregnancy in India, generic and common brand names together.
DRUG_KEYWORDS = [
    ("Iron Supplement", ["ferrous sulfate", "ferrous ascorbate", "fefol", "autrin", "fesovit", "iron"]),
    ("Folic Acid", ["folic acid", "folvite"]),
    ("Calcium", ["calcium carbonate", "shelcal", "calcirol", "calcium"]),
    ("Vitamin D3", ["vitamin d3", "vitamin d", "cholecalciferol", "d-rise"]),
    ("Multivitamin", ["multivitamin", "zincovit", "becosules", "pregnacare"]),
    ("Labetalol", ["labetalol"]),
    ("Methyldopa", ["methyldopa", "aldomet"]),
    ("Nifedipine", ["nifedipine", "nicardia"]),
    ("Metformin", ["metformin", "glycomet"]),
    ("Insulin", ["insulin", "mixtard", "human actrapid"]),
    ("Progesterone", ["progesterone", "susten", "duphaston"]),
    ("Low-dose Aspirin", ["aspirin", "ecosprin"]),
    ("Paracetamol", ["paracetamol", "dolo", "crocin", "acetaminophen"]),
    ("Doxylamine/Pyridoxine (nausea)", ["doxylamine", "doxinate"]),
    ("Ondansetron (nausea)", ["ondansetron", "emeset"]),
    ("Amoxicillin", ["amoxicillin"]),
    ("Azithromycin", ["azithromycin"]),
    ("Metronidazole", ["metronidazole", "flagyl"]),
    ("Cephalexin", ["cephalexin"]),
    ("Thyroxine", ["thyroxine", "eltroxin", "thyronorm", "levothyroxine"]),
]

FREQUENCY_TO_TIMES = {
    "od": ["Morning"], "once daily": ["Morning"], "once a day": ["Morning"],
    "bd": ["Morning", "Night"], "bid": ["Morning", "Night"],
    "twice daily": ["Morning", "Night"], "twice a day": ["Morning", "Night"],
    "tds": ["Morning", "Afternoon", "Night"], "tid": ["Morning", "Afternoon", "Night"],
    "thrice daily": ["Morning", "Afternoon", "Night"], "three times a day": ["Morning", "Afternoon", "Night"],
    "qid": ["Morning", "Afternoon", "Evening", "Night"], "four times a day": ["Morning", "Afternoon", "Evening", "Night"],
    "hs": ["Night"], "at bedtime": ["Night"], "at night": ["Night"],
    "sos": ["As needed"], "as needed": ["As needed"], "when required": ["As needed"],
}

DOSE_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s?(mg|mcg|iu|g)\b", re.IGNORECASE)
DASH_FREQUENCY_PATTERN = re.compile(r"\b(\d)\s*-\s*(\d)\s*-\s*(\d)(?:\s*-\s*(\d))?\b")
TIMING_NOTES = ["before food", "after food", "empty stomach", "with food", "with milk"]

# Prescriptions are often comma/semicolon/newline-separated, or run-on
# single-line text where each drug is only separated by a full stop (but
# a decimal dose like "8.5" must NOT be split). Splitting into segments
# FIRST - rather than taking a fixed-length text window after each drug
# match - is what keeps one drug's dose/frequency notation from leaking
# into a neighboring drug's or an unrelated lab value's reading.
SEGMENT_SPLIT_PATTERN = re.compile(r"[\n,;]+|(?<!\d)\.(?!\d)\s*")


def _times_from_dash_pattern(match) -> list:
    groups = [g for g in match.groups() if g is not None]
    labels = ["Morning", "Afternoon", "Evening", "Night"] if len(groups) == 4 else ["Morning", "Afternoon", "Night"]
    return [label for label, value in zip(labels, groups) if value != "0"]


def _extract_medications(text: str) -> list:
    segments = SEGMENT_SPLIT_PATTERN.split(text)
    found = []
    seen_names = set()

    for segment in segments:
        if not segment or not segment.strip():
            continue
        segment_lower = segment.lower()

        for canonical, aliases in DRUG_KEYWORDS:
            if canonical in seen_names:
                continue
            if not any(re.search(r"\b" + re.escape(alias) + r"\b", segment_lower) for alias in aliases):
                continue

            dose_match = DOSE_PATTERN.search(segment)
            dose = f"{dose_match.group(1)}{dose_match.group(2)}" if dose_match else None

            times_of_day = []
            dash_match = DASH_FREQUENCY_PATTERN.search(segment_lower)
            if dash_match:
                times_of_day = _times_from_dash_pattern(dash_match)
            else:
                for freq_text, times in FREQUENCY_TO_TIMES.items():
                    if freq_text in segment_lower:
                        times_of_day = times
                        break

            timing_note = next((note for note in TIMING_NOTES if note in segment_lower), None)

            found.append({
                "name": canonical,
                "dose": dose,
                "timesOfDay": times_of_day or ["Not specified - check with your prescriber"],
                "timingNote": timing_note,
                "matchedText": segment.strip(),
            })
            seen_names.add(canonical)
            break

    return found


def _extract_findings(text: str) -> tuple:
    findings = []
    # Parsed numeric values alongside the display findings, so the frontend
    # can offer "add this to my health record" without re-parsing a
    # formatted display string like "138/88 mmHg" back into numbers itself.
    extracted_vitals = {}

    hb_match = re.search(r"\b(?:hemoglobin|haemoglobin|hb)\b\s*[:\-]?\s*(\d+(?:\.\d+)?)", text, re.IGNORECASE)
    if hb_match:
        value = float(hb_match.group(1))
        graded = hemoglobin_rules.score(value)
        findings.append({
            "label": "Hemoglobin", "value": f"{value} g/dL",
            "flag": graded["grade"] if graded["grade"] != "Normal" else None,
        })
        extracted_vitals["hemoglobin"] = value

    bp_match = re.search(r"\b(?:blood pressure|bp)\b\s*[:\-]?\s*(\d{2,3})\s*/\s*(\d{2,3})", text, re.IGNORECASE)
    if bp_match:
        sbp, dbp = int(bp_match.group(1)), int(bp_match.group(2))
        flag = None
        if sbp >= 160 or dbp >= 110:
            flag = "Severe range - discuss urgently with your provider"
        elif sbp >= 140 or dbp >= 90:
            flag = "Above pregnancy hypertension threshold (140/90)"
        findings.append({"label": "Blood Pressure", "value": f"{sbp}/{dbp} mmHg", "flag": flag})
        extracted_vitals["systolicBP"] = sbp
        extracted_vitals["diastolicBP"] = dbp

    bs_match = re.search(r"\b(?:blood sugar|glucose|fbs|ppbs|rbs)\b\s*[:\-]?\s*(\d+(?:\.\d+)?)", text, re.IGNORECASE)
    if bs_match:
        value = float(bs_match.group(1))
        findings.append({"label": "Blood Sugar", "value": bs_match.group(1), "flag": "Review the unit and range with your provider"})
        extracted_vitals["bloodSugar"] = value

    urine_match = re.search(r"\burine\s*(?:protein|albumin)\b\s*[:\-]?\s*(nil|trace|\++|\d+)", text, re.IGNORECASE)
    if urine_match:
        value = urine_match.group(1)
        flag = "Protein detected - discuss with your provider" if value.lower() not in ("nil", "0") else None
        findings.append({"label": "Urine Protein", "value": value, "flag": flag})

    tsh_match = re.search(r"\btsh\b\s*[:\-]?\s*(\d+(?:\.\d+)?)", text, re.IGNORECASE)
    if tsh_match:
        findings.append({"label": "TSH", "value": tsh_match.group(1), "flag": "Review the reference range with your provider"})

    return findings, extracted_vitals


def analyze(text: str) -> dict:
    medications = _extract_medications(text)
    findings, extracted_vitals = _extract_findings(text)

    schedule_by_time = {"Morning": [], "Afternoon": [], "Evening": [], "Night": [], "As needed": []}
    for med in medications:
        for time_slot in med["timesOfDay"]:
            if time_slot in schedule_by_time:
                schedule_by_time[time_slot].append(med["name"] + (f" ({med['dose']})" if med["dose"] else ""))

    flagged_findings = [f for f in findings if f["flag"]]

    summary_parts = []
    if medications:
        summary_parts.append(f"Found {len(medications)} medication(s) mentioned in this report.")
    else:
        summary_parts.append("No specific medications were recognized in this report.")
    if flagged_findings:
        summary_parts.append(f"{len(flagged_findings)} value(s) may need attention - see Key Findings below.")
    elif findings:
        summary_parts.append("The values found in this report don't show an obvious red flag, but always confirm with your provider.")

    return {
        "summary": " ".join(summary_parts),
        "medications": medications,
        "scheduleByTime": {k: v for k, v in schedule_by_time.items() if v},
        "findings": findings,
        "extractedVitals": extracted_vitals,
        "methodology": (
            "Pattern-matching over the extracted text for known drug names, dosing notation, and lab "
            "value formats - not medical interpretation. Always follow what your prescriber actually "
            "wrote over this tool's reading of it, and confirm with your ANC provider or pharmacist if "
            "anything here looks wrong or unclear."
        ),
    }
