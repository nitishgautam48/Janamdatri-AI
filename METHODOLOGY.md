# Methodology

Janamdatri-AI is a maternal-health risk-triage screening aid built from two
independent layers that are combined with a worst-signal-wins rule, so that
neither layer can hide a danger the other one caught.

## 1. Machine-learning layer (`src/ml/`)

**Data.** UCI Maternal Health Risk Data Set (1014 records; Age, SystolicBP,
DiastolicBP, BS [blood sugar], BodyTemp, HeartRate → RiskLevel), collected via
an IoT risk-monitoring system across rural Bangladeshi clinics (DOI:
10.24432/C5DP5D). South Asian, not India-specific, but the closest publicly
available labeled dataset for this risk profile.

**Feature engineering.** Mean Arterial Pressure (`MAP = DBP + (SBP-DBP)/3`) is
added as a 7th feature. MAP weighs diastolic pressure more heavily than
systolic and is a better single predictor of pre-eclampsia risk than either
raw BP reading alone.

**Model selection and validation.**
- `StandardScaler` + classifier are wrapped in one `sklearn.Pipeline`, so
  cross-validation refits the scaler on each fold's training data only.
  Fitting the scaler on the full dataset before splitting — a common mistake —
  leaks each held-out fold's statistics into training and quietly inflates
  reported scores.
- 5-fold stratified cross-validation on the training split picks the model
  (logistic regression vs. random forest), since a single train/test split's
  score is noisy at ~1000 rows.
- A held-out test split, untouched during CV or model selection, gives the
  final reported accuracy/F1.
- Random forest was selected: 5-fold CV macro F1 = 0.827 ± 0.024, held-out
  test accuracy 84.7%, test macro F1 0.852 — versus logistic regression's
  0.597 ± 0.034 CV / 0.640 test accuracy.
- Feature importances are persisted and exposed via `GET /model/info` for
  transparency, rather than leaving the model a black box. Blood sugar (BS)
  is the single most important feature (~34%), consistent with the
  literature on gestational diabetes as a major driver of pregnancy risk.

**Scope, honestly stated.** The model only knows what the dataset recorded.
It has no notion of bleeding, fetal movement, labor progress, or
psychological state — that's what layer 2 is for.

## 2. Dynamic-evaluation layer (`src/dynamic_eval/`)

A rule-based system covering everything the ML model structurally cannot see:

- **`text_analyzer.py`** — phrase-matching over a free-text symptom
  narrative, bilingual (English + representative Hindi phrasing in the same
  category lists) into physical risk categories (hemorrhage, hypertensive
  disorder, infection, anemia, fetal distress, obstructed labor,
  malnutrition).
- **`danger_ladder.py`** — an ordinal WHO danger-sign ladder (mild swelling →
  convulsions/shock). Reports the *highest* rung matched — a single severe
  phrase can never be diluted by milder language elsewhere in the same text.
- **`risk_formulation.py`** — a structured obstetric risk/protective
  checklist: **static** factors (history: prior C-section, prior
  pre-eclampsia, prior stillbirth), **dynamic** factors (current: no ANC
  visits, malnutrition, unbooked pregnancy), and **protective** factors
  (regular ANC attendance, IFA supplementation, birth-preparedness plan) —
  detected from free text and/or a structured history form. Produces a
  graduated risk multiplier applied to the ML-derived score.
- **`hemoglobin_rules.py`** — India Anemia Mukt Bharat / MoHFW pregnancy
  anemia grading (Normal ≥11, Mild 10–10.9, Moderate 7–9.9, Severe <7 g/dL).
  Hemoglobin is not an ML feature (the training dataset never recorded it),
  so it is scored deterministically and blended into the same 'anemia'
  category the text layer populates — never by retraining the classifier on
  a feature it has no labeled outcome data for.
- **`psych_eval.py`** — the Edinburgh Postnatal Depression Scale (EPDS), a
  validated 10-item screening tool for depression during pregnancy and
  postpartum (Cox, Holden & Sagovsky, 1987), used within India's maternal
  mental health programmes. Item 10 (thoughts of self-harm) is escalated
  independently of the total score: any non-zero response is a critical
  safety signal on its own, the same principle applied to physical danger
  signs.
- **`expert_system.py`** — named clinical rules (pre-eclampsia, postpartum
  hemorrhage, sepsis, fetal distress, obstructed labor, anemia). Severity is
  graded directly off the underlying condition score rather than a
  confidence×weight scheme, because most rules here have only 1–2
  conditions (a continuous score, not a multi-symptom co-occurrence count) —
  confidence×weight would collapse to "met the one condition ⇒ automatically
  Critical" regardless of how far past threshold the reading actually is.
- **`pregnancy_guide.py`** — trimester/week-based ANC visit schedule,
  nutrition guidance, and trimester-specific danger signs aligned with
  India's RCH programme and PMSMA (free ANC checkup on the 9th of every
  month).
- **`triage.py`** — the synthesis point. Combines the ML-derived Maternal
  Risk Index with the risk-formulation multiplier, then escalates via
  worst-signal-wins across the danger ladder, the expert rules, and the
  psychological screening. A WHO danger sign, a Critical-severity expert
  rule, or an EPDS self-harm flag can each independently push the overall
  result to Critical — none of them can be hidden behind a good score from
  the other layers.

## India-context adaptations

- Anemia grading uses India's Anemia Mukt Bharat cutoffs rather than a
  single WHO threshold, since anemia is one of India's most prevalent
  maternal health problems (NFHS-5: roughly half of pregnant Indian women
  anemic).
- Recommendations and the Pregnancy Guide reference PMSMA, JSY, PMMVY, and
  Anemia Mukt Bharat — the actual government schemes an ASHA/ANM worker
  would point a woman toward.
- Helplines use India's real numbers (108 ambulance, 102 pregnancy
  transport, 104 national health, 181 women's helpline, 1098 child
  helpline, 1800-599-0019 KIRAN mental health helpline).
- Bilingual (English/Hindi) phrase detection in the text-analysis and
  danger-ladder layers, and a full Hindi translation of the UI chrome
  (navigation, form labels, symptom chips, disclaimers) — reach depends on
  women being able to actually use the tool in the language they think in,
  not just having it exist.

## Limitations (stated plainly)

- This is a screening/prioritization aid, not a diagnosis, and not a
  substitute for a trained health worker's assessment.
- The ML model's training data is South Asian but not India-specific, and
  was collected via a single IoT monitoring deployment — it will not
  generalize perfectly to every population or measurement device.
- Text-based symptom detection is phrase-matching, not natural-language
  understanding — it will miss phrasing it hasn't seen and can occasionally
  mismatch.
- The Hindi translations (UI and phrase lists) are original translations for
  this project, not officially validated clinical translations — English
  remains authoritative for the EPDS specifically, which has separate,
  officially validated translations in several Indian languages that a real
  deployment should use instead.
- Any Critical/Severe result, or an EPDS self-harm flag, should always be
  treated as "seek care now" regardless of how confident the underlying
  score is.
