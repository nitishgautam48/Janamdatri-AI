"""
Janamdatri-AI - Maternal Risk Triage API.

Two endpoints reflect the two-layer architecture:
  POST /predict/ml  - the trained ML classifier alone (vitals -> risk class)
  POST /assess       - the full hybrid: ML prediction + rule-based dynamic
                        evaluation (danger-sign ladder, risk-formulation
                        checklist, expert rules) -> final triage decision
"""

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.dynamic_eval import triage
from src.ml.predict import get_classifier

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"

app = FastAPI(
    title="Janamdatri-AI Maternal Risk Triage",
    description=(
        "ML + rule-based hybrid maternal health risk triage. "
        "Screening/prioritization aid only - not a diagnosis."
    ),
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse(FRONTEND_DIR / "index.html")


class Vitals(BaseModel):
    Age: float
    SystolicBP: float
    DiastolicBP: float
    BS: float = Field(..., description="Blood sugar, mmol/L")
    BodyTemp: float = Field(..., description="Body temperature, Fahrenheit")
    HeartRate: float


class AssessRequest(BaseModel):
    text: Optional[str] = Field(None, description="Free-text symptom narrative")
    vitals: Optional[Vitals] = None
    history: Optional[dict] = Field(
        default=None,
        description="Structured booking-form flags, e.g. {'prior_csection': true, 'regular_anc_visits': true}",
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict/ml")
def predict_ml(vitals: Vitals):
    try:
        classifier = get_classifier()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    result = classifier.predict(vitals.model_dump())
    return {"success": True, "data": result}


@app.post("/assess")
def assess(req: AssessRequest):
    if not req.text and not req.vitals:
        raise HTTPException(status_code=400, detail="Provide symptom text and/or vitals to assess.")

    ml_result = None
    if req.vitals:
        try:
            classifier = get_classifier()
            ml_result = classifier.predict(req.vitals.model_dump())
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    triage_result = triage.synthesize(ml_result=ml_result, text=req.text or "", history=req.history or {})
    return {"success": True, "data": triage_result}


@app.get("/helplines")
def helplines():
    return {
        "success": True,
        "data": {
            "emergencyAmbulance": "108",
            "pregnancyEmergencyTransport": "102",
            "nationalHealthHelpline": "104",
            "womenHelpline": "181",
            "childHelpline": "1098",
            "jananiSurakshaYojana": "Ask your ASHA worker about JSY cash-assistance eligibility",
            "nearestFacility": "Ask your ASHA/ANM worker for the nearest 24x7 PHC or FRU (First Referral Unit)",
        },
    }
