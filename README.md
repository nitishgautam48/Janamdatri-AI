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
10.24432/C5DP5D), enriched with an engineered **Mean Arterial Pressure**
feature. Model selection uses leakage-free 5-fold cross-validation
(scaler + classifier in one `sklearn.Pipeline`, refit per fold):

| Model | 5-fold CV macro F1 | Held-out test accuracy | Held-out test macro F1 |
|---|---|---|---|
| Logistic Regression | 0.597 ± 0.034 | 0.640 | 0.630 |
| **Random Forest (selected)** | **0.827 ± 0.024** | **0.847** | **0.852** |

Retrain with `python -m src.ml.train` (writes `models/risk_classifier.joblib`).
Feature importances are exposed via `GET /model/info` for transparency.

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
- **`triage.py`** — combines everything with worst-signal-wins escalation:
  a WHO danger sign, a Critical expert rule, or an EPDS self-harm flag can
  each independently push the result to Critical

## API — `src/api/main.py`

```
GET  /health
POST /predict/ml         { Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate }
GET  /model/info          model transparency: features, importances, CV/test metrics
POST /assess               { text?, vitals?, history?, hemoglobin?, epdsResponses? }
GET  /psych-assess/items  the 10 EPDS questions + response options
POST /psych-assess         EPDS scoring alone: { responses: [0-3 x10] }
POST /pregnancy-guide      { lmp? (ISO date), week? } -> trimester guide
GET  /helplines            India helplines + government scheme references
```

`POST /assess` requires at least one of `text`, `vitals`, `hemoglobin`, or
`epdsResponses`. `history` is an optional structured-flags object matching
the factor names in `risk_formulation.py` (e.g. `{"prior_csection": true,
"regular_anc_visits": true}`).

## Frontend — `frontend/`

A single-page app (vanilla HTML/CSS/JS, no build step) served directly by
FastAPI: the assessment form (vitals, bilingual symptom chips, history
checklist, optional hemoglobin), a results view (risk gauge, ML
probability bars, danger-sign ladder, risk-factor tags, anemia/EPDS
cards), a Pregnancy Guide tab, a Mental Health Check (EPDS) tab, a
localStorage assessment history, a Helplines page, a English/Hindi
language toggle, and a text-to-speech "Read Aloud" button for
low-literacy accessibility.

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
