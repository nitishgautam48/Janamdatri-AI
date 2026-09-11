# Janamdatri-AI — Maternal Risk Triage

A hybrid maternal-health risk triage system for a health-a-thon submission:
a **trained ML classifier** for vitals-driven risk, combined with a
**rule-based dynamic-evaluation layer** for danger signs the vitals alone
can't capture (bleeding, fetal movement, labor progress).

⚠️ This is a screening/prioritization aid, not a diagnosis, and not a
substitute for a trained health worker's assessment. Any Critical/Severe
result means "seek facility care now."

## Architecture

```
                 ┌─────────────────────────┐
  vitals ──────▶ │  ML classifier (trained)│──┐
 (Age, BP,       │  RandomForest, 84.7% acc │  │
  BS, Temp,      └─────────────────────────┘  │
  HeartRate)                                  ▼
                                        ┌──────────────┐
  symptom  ───▶ text analyzer ──┐       │   Triage     │──▶ severity,
  text            (phrase       ├──────▶│  Synthesis   │    recommendations
                  matching)     │       │ (worst-signal│
                                 │       │    wins)     │
  symptom  ───▶ danger-sign     │       └──────────────┘
  text          ladder (WHO)    │              ▲
                                 │              │
  history  ───▶ risk formulation┘──────────────┘
  + text        checklist (static/
                dynamic/protective)
```

### 1. ML component — `src/ml/`

Trained on the **UCI Maternal Health Risk Data Set** (1014 records,
Age/SystolicBP/DiastolicBP/BS/BodyTemp/HeartRate → RiskLevel, collected via
an IoT monitoring system across rural Bangladeshi clinics; DOI:
10.24432/C5DP5D). A RandomForestClassifier was selected over logistic
regression after a held-out test split:

| Model | Accuracy | Macro F1 |
|---|---|---|
| Logistic Regression | 0.640 | 0.630 |
| **Random Forest (selected)** | **0.847** | **0.852** |

Retrain with `python -m src.ml.train` (writes `models/risk_classifier.joblib`).

This model only knows what the dataset recorded — it has no notion of
bleeding, fetal movement, or labor progress. That's intentional: it's the
data-driven core for vitals, not the whole system.

### 2. Dynamic evaluation layer — `src/dynamic_eval/`

Fills in what the ML model can't see, from a free-text symptom narrative
and/or a structured history form:

- **`text_analyzer.py`** — phrase-matching over symptom narrative into
  categories (hemorrhage, infection, fetal distress, obstructed labor, etc.)
- **`danger_ladder.py`** — an ordinal WHO danger-sign ladder (mild swelling
  → convulsions/shock), reports the *highest* rung matched, never averaged
  down by milder language elsewhere in the text
- **`risk_formulation.py`** — the core "dynamic evaluation" checklist:
  **static** risk factors (obstetric history: prior C-section, prior
  pre-eclampsia, prior stillbirth) vs. **dynamic** risk factors (current:
  no ANC visits, malnutrition, unbooked pregnancy) vs. **protective**
  factors (regular ANC attendance, iron/folic supplementation, birth
  preparedness) — produces a graduated risk multiplier
- **`expert_system.py`** — rules for hemorrhage, sepsis, fetal distress,
  obstructed labor, and a symptom-based pre-eclampsia pattern
- **`triage.py`** — combines the ML prediction with all of the above using
  worst-signal-wins escalation: a WHO danger sign or a Critical-severity
  rule can never be hidden behind a good vitals reading

## API — `src/api/main.py`

```
GET  /health
POST /predict/ml   { Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate }
POST /assess        { text?, vitals?, history? }
GET  /helplines
```

`POST /assess` accepts either `text`, `vitals`, or both — at least one is
required. `history` is an optional structured-flags object matching the
factor names in `risk_formulation.py` (e.g. `{"prior_csection": true,
"regular_anc_visits": true}`).

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
