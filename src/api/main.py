"""
Janamdatri-AI - Maternal Risk Triage API.

Endpoints reflect the layered architecture:
  POST /predict/ml       - the trained ML classifier alone (vitals -> risk class)
  GET  /model/info        - model transparency: features, feature importances, CV/test metrics
  POST /assess             - the full hybrid: ML prediction + rule-based dynamic
                             evaluation (danger-sign ladder, risk-formulation
                             checklist, expert rules, hemoglobin, EPDS) -> triage
  GET  /psych-assess/items - the 10 EPDS questions + response options
  POST /psych-assess       - EPDS scoring alone
  POST /pregnancy-guide    - trimester/week-based ANC schedule and guidance
  GET  /helplines          - India helplines and scheme references
"""

from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.dynamic_eval import pregnancy_guide, psych_eval, triage
from src.ml.predict import get_classifier

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"

app = FastAPI(
    title="Janamdatri-AI Maternal Risk Triage",
    description=(
        "ML + rule-based hybrid maternal health risk triage, adapted for the Indian context. "
        "Screening/prioritization aid only - not a diagnosis."
    ),
    version="0.2.0",
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
    text: Optional[str] = Field(None, description="Free-text symptom narrative (English or Hindi)")
    vitals: Optional[Vitals] = None
    history: Optional[dict] = Field(
        default=None,
        description="Structured booking-form flags, e.g. {'prior_csection': true, 'regular_anc_visits': true}",
    )
    hemoglobin: Optional[float] = Field(
        default=None, description="Hemoglobin in g/dL, if known - graded per India Anemia Mukt Bharat cutoffs"
    )
    epdsResponses: Optional[List[int]] = Field(
        default=None, description="10 EPDS responses (0-3 each) for perinatal mental health screening"
    )


class PsychAssessRequest(BaseModel):
    responses: List[int] = Field(..., min_length=10, max_length=10)


class PregnancyGuideRequest(BaseModel):
    lmp: Optional[str] = Field(None, description="Last menstrual period date, ISO format e.g. 2026-01-15")
    week: Optional[int] = Field(None, description="Current gestational week, if known directly")


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


@app.get("/model/info")
def model_info():
    try:
        classifier = get_classifier()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"success": True, "data": classifier.info()}


@app.post("/assess")
def assess(req: AssessRequest):
    if not any([req.text, req.vitals, req.hemoglobin is not None, req.epdsResponses]):
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: symptom text, vitals, hemoglobin, or EPDS responses.",
        )

    if req.epdsResponses is not None and len(req.epdsResponses) != 10:
        raise HTTPException(status_code=400, detail="epdsResponses must contain exactly 10 items (0-3 each).")

    ml_result = None
    if req.vitals:
        try:
            classifier = get_classifier()
            ml_result = classifier.predict(req.vitals.model_dump())
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        triage_result = triage.synthesize(
            ml_result=ml_result,
            text=req.text or "",
            history=req.history or {},
            hemoglobin=req.hemoglobin,
            epds_responses=req.epdsResponses,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"success": True, "data": triage_result}


@app.get("/psych-assess/items")
def psych_items():
    return {
        "success": True,
        "data": {
            "items": psych_eval.ITEMS,
            "options": psych_eval.OPTIONS,
            "selfHarmItemIndex": psych_eval.SELF_HARM_ITEM_INDEX,
            "citation": psych_eval.CITATION,
        },
    }


@app.post("/psych-assess")
def psych_assess(req: PsychAssessRequest):
    try:
        result = psych_eval.score(req.responses)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "data": result}


@app.post("/pregnancy-guide")
def pregnancy_guide_endpoint(req: PregnancyGuideRequest):
    if req.lmp:
        try:
            guide = pregnancy_guide.guide_from_lmp(req.lmp)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif req.week is not None:
        guide = pregnancy_guide.get_guide(req.week)
    else:
        raise HTTPException(status_code=400, detail="Provide either 'lmp' (ISO date) or 'week'.")

    return {"success": True, "data": guide}


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
            "mentalHealthHelpline": "1800-599-0019 (KIRAN, toll-free, 24x7)",
            "jananiSurakshaYojana": "JSY - ask your ASHA worker about cash-assistance eligibility for institutional delivery",
            "pmsma": "PMSMA - free ANC checkup on the 9th of every month at government health facilities",
            "pmmvy": "PMMVY - cash incentive for ANC registration, checkups, and institutional delivery of the first living child",
            "nearestFacility": "Ask your ASHA/ANM worker for the nearest 24x7 PHC or FRU (First Referral Unit)",
        },
    }
