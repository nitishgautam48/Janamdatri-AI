# Janamdatri-AI — Maternal Risk Triage

A hybrid maternal-health risk triage system for a health-a-thon submission:
a **trained ML classifier** for vitals-driven risk, combined with a
**rule-based dynamic-evaluation layer** for danger signs the vitals alone
can't capture (bleeding, fetal movement, labor progress, anemia by
hemoglobin, and perinatal mental health) — adapted for the **Indian
context**: bilingual (English/Hindi) detection and UI, India-specific
anemia grading, a trimester-by-trimester **Pregnancy Guide** aligned with
India's RCH programme, and government scheme references (PMSMA, JSY, PMMVY).

⚠️ This is a screening/prioritization aid, not a diagnosis, and not a
substitute for a trained health worker's assessment. Any Critical/Severe
result, or a psychological self-harm flag, means "seek care now." See
[METHODOLOGY.md](METHODOLOGY.md) for the full write-up, validation
approach, and stated limitations.

## Architecture

```
                 ┌─────────────────────────┐
  vitals ──────▶ │  ML classifier (trained)│──┐
 (Age, BP, BS,   │  RandomForest + MAP,     │  │
  Temp, HR)      │  84.7% acc, 5-fold CV    │  │
                 └─────────────────────────┘  │
                                              ▼
  symptom  ───▶ text analyzer (bilingual) ──┐  ┌──────────────┐
  text                                       │  │   Triage     │──▶ severity,
  symptom  ───▶ danger-sign ladder (WHO) ────┼─▶│  Synthesis   │    recommendations
  text                                       │  │ (worst-signal│
  history  ───▶ risk formulation checklist ──┤  │    wins)     │
  + text        (static/dynamic/protective)  │  └──────────────┘
  hemoglobin ─▶ India anemia grading ────────┤         ▲
  EPDS ───────▶ psychological screening ─────┘         │
  responses     (self-harm flag overrides) ────────────┘
```

### 1. ML component — `src/ml/`

Trained on the **UCI Maternal Health Risk Data Set** (1014 records,
Age/SystolicBP/DiastolicBP/BS/BodyTemp/HeartRate → RiskLevel, collected via
an IoT monitoring system across rural Bangladeshi clinics; DOI:
10.24432/C5DP5D), enriched with engineered **Mean Arterial Pressure**,
**pulse pressure**, and hypertension/hyperglycemia/fever/tachycardia
threshold-flag features. Each candidate model (logistic regression, random
forest, gradient boosting, SVM, and a soft-voting ensemble of all four,
each class-weight- or sample-weight-balanced) is tuned with `GridSearchCV`
over its own hyperparameter grid using leakage-free 5-fold cross-validation
(scaler + classifier in one `sklearn.Pipeline`, refit per fold) — model
selection and hyperparameter selection both use the same procedure, not a
guessed default configuration.

**A note on the numbers below**: this dataset has 562 exact-duplicate rows
out of 1014. An earlier version of this pipeline split into train/test
*before* deduping, so a duplicate row's twin could land in training
whenever its copy landed in test — the model could score well on "held
out" rows by memorizing a row it had already seen verbatim. That leakage
inflated the previously-reported test accuracy to ~84%. The numbers below
are post-fix (dedupe before splitting) and reflect genuine generalization:

| Model | Best 5-fold CV macro F1 | Held-out test accuracy | Held-out test macro F1 |
|---|---|---|---|
| Logistic Regression | 0.564 | 0.637 | 0.597 |
| Random Forest | 0.655 | 0.725 | 0.645 |
| Gradient Boosting | 0.648 | 0.692 | 0.618 |
| SVM (RBF) | 0.646 | 0.714 | 0.638 |
| **Voting ensemble (selected)** | **0.661** | **0.714** | **0.625** |

"Mid risk" is the weakest class across every candidate — it sits between
low and high risk in a continuous feature space with real overlap, which
is a property of this specific dataset, not something more grid search or
model variety fixes. Meaningfully closing that gap needs more or better
labeled data.

Retrain with `python -m src.ml.train` (writes `models/risk_classifier.joblib`).
Feature importances and the winning hyperparameters are exposed via
`GET /model/info` for transparency.

This model only knows what the dataset recorded — it has no notion of
bleeding, fetal movement, labor progress, or psychological state. That's
intentional: it's the data-driven core for vitals, not the whole system.

### 2. Dynamic evaluation layer — `src/dynamic_eval/`

Fills in what the ML model can't see:

- **`text_analyzer.py`** — bilingual (English + Hindi) phrase-matching over
  symptom narrative into categories (hemorrhage, hypertensive disorder,
  infection, anemia, fetal distress, obstructed labor, malnutrition)
- **`danger_ladder.py`** — an ordinal, bilingual WHO danger-sign ladder
  (mild swelling → convulsions/shock), reports the *highest* rung matched
- **`risk_formulation.py`** — the core "dynamic evaluation" checklist:
  **static** risk factors (obstetric history) vs. **dynamic** risk factors
  (current) vs. **protective** factors — a graduated risk multiplier
- **`hemoglobin_rules.py`** — India Anemia Mukt Bharat pregnancy anemia
  grading (Normal ≥11, Mild 10–10.9, Moderate 7–9.9, Severe <7 g/dL)
- **`psych_eval.py`** — the Edinburgh Postnatal Depression Scale (EPDS), a
  validated 10-item perinatal mental health screen; a self-harm item
  response escalates independently of the total score
- **`expert_system.py`** — rules for pre-eclampsia, hemorrhage, sepsis,
  fetal distress, obstructed labor, and anemia
- **`pregnancy_guide.py`** — trimester/week ANC schedule, nutrition tips,
  and danger signs aligned with India's RCH programme + PMSMA
- **`human_intelligence.py`** — cross-signal clinical reasoning: detects
  named combinations of findings that are more dangerous together than
  any single-category rule can express (e.g. hypertensive symptoms +
  fetal distress → "resembles severe pre-eclampsia with fetal compromise";
  hemorrhage + anemia → "hemorrhagic shock risk"), and reports how many
  independent sources (ML model, symptom text, danger ladder, expert
  rules, risk history, psychological screening) corroborate the result
- **`chat_assistant.py`** — the Instant Help chat's rule-based brain:
  answers common questions (ANC schedule, nutrition, anemia, mental
  health, helplines) and reuses the same danger-sign detection as the
  assessment flow, so a symptom typed into chat gets the same emergency
  escalation as one entered in the assessment form
- **`triage.py`** — combines everything with worst-signal-wins escalation:
  a WHO danger sign, a Critical expert rule, or an EPDS self-harm flag can
  each independently push the result to Critical

### 3. Accounts — `src/auth.py`

Optional SQLite-backed accounts (stdlib-only PBKDF2-HMAC-SHA256 password
hashing, bearer-token sessions) - signing up/in ties assessment history
and chat to the account instead of the browser's localStorage. Entirely
optional: "Continue as Guest" skips all of this and keeps everything
device-local.

## API — `src/api/main.py`

```
POST /auth/register, /auth/login   optional accounts (bearer token via x-user-token)
GET  /auth/me                       current user profile
GET  /health
POST /predict/ml                    { Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate }
GET  /model/info                     model transparency: features, hyperparameters, CV/test metrics
POST /assess                          { text?, vitals?, history?, hemoglobin?, epdsResponses? }
GET  /assessments/mine               a logged-in user's server-side assessment history
GET  /psych-assess/items             the 10 EPDS questions + response options
POST /psych-assess                    EPDS scoring alone: { responses: [0-3 x10] }
POST /pregnancy-guide                 { lmp? (ISO date), week? } -> trimester guide
POST /chat                            { message } -> rule-based instant-help assistant
POST /documents/analyze               upload (.pdf/.txt) or paste report text ->
                                      medication schedule + flagged findings
GET  /helplines                       India helplines + government scheme references
```

`POST /assess` requires at least one of `text`, `vitals`, `hemoglobin`, or
`epdsResponses`. `history` is an optional structured-flags object matching
the factor names in `risk_formulation.py` (e.g. `{"prior_csection": true,
"regular_anc_visits": true}`). Passing `x-user-token` persists the result
server-side for that account. `POST /documents/analyze` takes multipart
form data with either a `file` field or a `text` field (or both).

## Frontend — `frontend/`

A single-page app (vanilla HTML/CSS/JS, no build step) served directly by
FastAPI:

- A **welcome screen** (Log In / Sign Up / Continue as Guest) on first
  visit — never re-shown to a returning guest or logged-in user
- A **4-step assessment wizard** (Vitals → Symptoms → History → Review)
  with a progress bar and a review summary before submission, instead of
  one long scrolling form — vitals fields start empty with example
  placeholders, never pre-filled with values that could be submitted
  unnoticed
- A **results view**: risk gauge (animated count-up), ML probability
  bars, danger-sign ladder, risk-factor tags, anemia/EPDS cards, and a
  **Clinical Impression** card (cross-signal patterns + corroboration
  confidence from `human_intelligence.py`)
- A **Pregnancy Guide** tab, a **Mental Health Check (EPDS)** tab, a
  **My Reports** tab (upload or paste a prescription/lab report for a
  medication schedule + flagged findings), an assessment **History** tab
  (server-backed when logged in, localStorage otherwise), and a
  **Helplines** page
- A floating **Instant Help chat** widget on every page, with real-time
  emergency detection and a graceful clarifying-question fallback for
  vague symptom language ("I'm in pain") instead of a dead-end response
- A full **English/Hindi** language toggle, bilingual symptom chips, and
  a text-to-speech **Read Aloud** button for low-literacy accessibility

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# (optional — a trained model is already committed under models/)
python -m src.ml.train

uvicorn src.api.main:app --reload
```

Then:

```bash
curl -X POST http://localhost:8000/assess \
  -H "Content-Type: application/json" \
  -d '{"text": "I had a fit and I am bleeding heavily, soaked through a pad"}'
```

Open http://localhost:8000/ for the UI.

## Run with Docker

```bash
docker build -t janamdatri-ai .
docker run -p 8000:8000 janamdatri-ai
```

Then open http://localhost:8000/. The committed model under `models/` ships
in the image, so no training step is needed to try it.

## Dataset citation

Ahmed, M., Kashem, M.A. (2020). *Maternal Health Risk* [Dataset]. UCI
Machine Learning Repository. https://doi.org/10.24432/C5DP5D

Cox, J.L., Holden, J.M., & Sagovsky, R. (1987). Detection of postnatal
depression: development of the 10-item Edinburgh Postnatal Depression
Scale. *British Journal of Psychiatry*, 150, 782-786.
