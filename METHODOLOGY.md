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

**Feature engineering.** Mean Arterial Pressure (`MAP = DBP + (SBP-DBP)/3`)
and Pulse Pressure (`SBP-DBP`) are added as continuous features, plus four
binary threshold flags mirroring a health worker's own clinical checklist:
hypertension (≥140/90), hyperglycemia (BS ≥7.8 mmol/L), fever (≥100.4°F),
and tachycardia (heart rate ≥100 bpm). On a dataset this small, handing a
tree/linear model a pre-computed clinical threshold is a standard way to
bake in domain knowledge a much larger dataset would otherwise be needed to
learn from raw values alone.

**Data-quality fix: deduplication before splitting.** This dataset has 562
exact-duplicate rows (same vitals AND same label) out of 1014, and an
earlier version of this pipeline split into train/test *before* removing
them. That let a duplicate row's twin land in training whenever its copy
landed in test, so the model could score well on "held-out" rows by
memorizing a row it had already seen verbatim rather than by generalizing —
textbook leakage. It inflated the previously-reported test accuracy to
~84%; the real generalization accuracy, measured honestly by deduping
first, is materially lower (see below). This is very likely the reason
predictions have felt less reliable in practice than an 84%-accuracy label
implied — the number itself, not the model behind it, was the bug.

**Model selection and validation.**
- `StandardScaler` + classifier are wrapped in one `sklearn.Pipeline`, so
  cross-validation refits the scaler on each fold's training data only.
  Fitting the scaler on the full dataset before splitting — a common mistake —
  leaks each held-out fold's statistics into training and quietly inflates
  reported scores.
- Each candidate (logistic regression, random forest, extra trees, gradient
  boosting, SVM, k-nearest-neighbours, and a soft-voting ensemble of all
  six) is tuned with `GridSearchCV` over its own hyperparameter grid,
  using REPEATED stratified cross-validation (5 folds x 3 independent
  repeats, 15 fits per grid point) on the training split only. This is not
  a single guessed hyperparameter set - model selection and hyperparameter
  selection both use the grid search's own cross-validated score, so
  neither decision rests on a lucky default, and the ensemble is compared
  against the individual candidates by that same score rather than a
  different yardstick. Repeating the split three times (rather than
  running 5-fold once) is itself an evaluation-methodology improvement: on
  ~450 rows, a single fold assignment's boundaries can swing a candidate's
  score by a few points on their own, which can flip which model looks
  best; averaging over three independent splits is a more reliable
  estimate of genuine generalization.
- Every candidate is class-weight-balanced (or, for GradientBoostingClassifier,
  which has no `class_weight` param, sample-weight-balanced at fit time) -
  "mid risk" is both the minority class and the hardest to separate here,
  and an unweighted fit tends to sacrifice it for the easier classes.
- A held-out test split, untouched during grid search or model selection,
  gives the final reported metrics - now not just accuracy/macro-F1 but
  also balanced accuracy (average per-class recall, so a model can't
  inflate its score by defaulting to the majority class), macro one-vs-rest
  ROC-AUC (how well-separated the predicted probabilities are, independent
  of the decision threshold), and the full confusion matrix (which shows
  *which way* mid-risk gets confused, not just that it's the weak class -
  clinically relevant, since a mid-risk case mistaken for low risk is a
  worse miss than one mistaken for high risk). All of these are persisted
  in the model bundle and exposed via `GET /model/info`, not just printed
  at training time.
- A tuned gradient boosting model was selected: best CV macro F1 = 0.656
  (std 0.038, over 5-fold x 3-repeat CV), held-out test accuracy 69.2%,
  test macro F1 0.618, balanced accuracy 0.624, macro ROC-AUC (OvR) 0.793 -
  narrowly ahead of a tuned random forest (CV macro F1 0.647) and extra
  trees (CV macro F1 0.626) on cross-validated score, though both of those
  candidates' single held-out test split happened to score higher on raw
  accuracy (72.5% each) - the same reminder as before: on ~450 rows,
  test-set numbers carry real sampling noise, which is exactly why the
  more stable repeated cross-validated score - not the test score - is
  what decides the winner.
- Feature importances and the winning hyperparameters are persisted and
  exposed via `GET /model/info` for transparency, rather than leaving the
  model a black box (omitted for the ensemble, which has no single
  importance vector). Blood sugar (BS) remains the single most important
  individual feature among the tree-based candidates, consistent with the
  literature on gestational diabetes as a major driver of pregnancy risk.

**Scope, honestly stated.** The model only knows what the dataset recorded.
It has no notion of bleeding, fetal movement, labor progress, or
psychological state — that's what layer 2 is for. And after deduping, only
452 rows remain; "mid risk" stays the weakest class across every candidate
because it sits between low and high risk in a continuous feature space
with real overlap - a property of this specific dataset, not something
more grid search or model variety can fix. Meaningfully closing that gap
needs more or better labeled data, not more tuning of what's already here.

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
- **`human_intelligence.py`** — cross-signal clinical reasoning. Two things
  a per-category rule structurally cannot express: (1) CROSS-CATEGORY
  PATTERNS - some combinations are more dangerous together than either
  finding alone: hypertensive symptoms + fetal distress resembles severe
  pre-eclampsia with fetal compromise; hemorrhage + anemia raises
  hemorrhagic-shock risk; infection + obstructed labor raises concern for
  intrapartum sepsis; hypertensive symptoms + hemorrhage can indicate
  placental abruption; malnutrition + anemia compounds nutritional risk;
  infection + fetal distress can indicate the infection is affecting the
  baby; obstructed labor + hemorrhage raises concern for uterine rupture;
  and a raised EPDS score alongside any significant physical finding gets
  its own pattern, since untreated depression/anxiety can delay someone
  from seeking care for a physical symptom and a frightening physical
  symptom can worsen mental health in turn. (2) MULTI-SOURCE CONFIDENCE -
  how many independent signals (ML model, symptom text, danger ladder, an
  activated expert rule, an elevated risk-history multiplier, psychological
  screening) corroborate a result, surfaced as a confidence label rather
  than presenting every finding with the same implied certainty.
- **`chat_assistant.py`** — the Instant Help chat's rule-based intent
  matcher (11 FAQ intents: ANC schedule, nutrition, anemia, mental health,
  helplines, labor signs, fetal movement, vaccination, delivery location,
  greetings, thanks). Deliberately reuses `danger_ladder`/`text_analyzer`
  rather than its own separate keyword list: a symptom typed into chat
  gets exactly the same emergency detection as one entered in the
  assessment form, and safety-checking always runs before FAQ matching.
  Vague distress language that doesn't match a specific category ("I'm in
  pain", "I don't feel well") gets a clarifying follow-up question - the
  same thing a triage nurse would ask - instead of a dead-end "I didn't
  understand," which is what "training" a rule-based bot further actually
  means: widening phrase coverage and improving the fallback, not
  pretending it's a language model.
- **`triage.py`** — the synthesis point. Combines the ML-derived Maternal
  Risk Index with the risk-formulation multiplier, then escalates via
  worst-signal-wins across the danger ladder, the expert rules, and the
  psychological screening. A WHO danger sign, a Critical-severity expert
  rule, or an EPDS self-harm flag can each independently push the overall
  result to Critical — none of them can be hidden behind a good score from
  the other layers.

## Report analysis (`src/document_extractor.py`, `src/dynamic_eval/report_analyzer.py`)

Upload (.pdf/.txt) or paste a prescription/lab report's text and get: a
medication schedule grouped by time of day, and any recognized lab values
with abnormal ones flagged (hemoglobin via the same India anemia grading
used elsewhere, blood pressure against the pregnancy hypertension
threshold, blood sugar/TSH/urine protein reported for the person to
review with their provider).

Medication extraction works by first SPLITTING the text into segments
(newline/comma/semicolon/sentence boundaries, careful not to split
decimal doses like "8.5") and only then searching each segment
independently for a known drug name, a dose (`\d+(mg|mcg|iu|g)`), and a
frequency - including common Indian prescription shorthand like "1-0-1"
(morning-afternoon-night) and OD/BD/TDS/QID/HS/SOS. Segmenting first,
rather than taking a fixed-length text window after each drug match, is
what keeps one drug's dosing notation from leaking into a neighboring
drug's reading on comma-separated or run-on single-line prescriptions -
a real bug caught by testing against exactly that input shape.

Scanned/photographed reports (an image, or a PDF that's just a scanned
image with no text layer) have no extractable text without OCR, which
needs a system-level engine this deployment doesn't install. Rather than
silently returning nothing, extraction fails with a clear message telling
the person to paste the text by hand instead - honest about the
limitation rather than pretending to support image uploads.

## Accounts (`src/auth.py`)

Optional SQLite-backed accounts: PBKDF2-HMAC-SHA256 password hashing
(stdlib `hashlib`, per-user random salt, 200k iterations - no extra
dependency needed) and bearer-token sessions. Logging in ties assessment
history and chat messages to the account server-side; "Continue as Guest"
skips all of this and keeps everything in the browser's localStorage
instead. Neither path is required by the other - the triage engine itself
has no idea whether a request came from a logged-in account or a guest.

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
- The Instant Help chat is a scripted keyword-intent matcher, not a real
  conversational AI - it exists to give an instant answer or emergency
  escalation when no health worker is reachable, not to replace one. It
  will fall back to a generic response for anything outside its fixed
  intent list.
- Accounts are intentionally minimal for a hackathon prototype: no email
  verification, password reset, or rate limiting on login attempts. Fine
  for a demo; a real deployment handling real health data needs all three,
  plus encryption at rest for the SQLite database.
- Report analysis is pattern-matching against a curated drug-name list and
  common Indian prescription shorthand, not medical interpretation. A drug
  not in `DRUG_KEYWORDS`, or dosing notation it doesn't recognize, won't
  be extracted - always follow the actual prescription over this tool's
  reading of it. Scanned/photographed reports aren't supported (no OCR) -
  paste the text directly instead.
