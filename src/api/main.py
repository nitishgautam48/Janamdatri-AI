"""
Janamdatri-AI - Maternal Risk Triage API.

Endpoints reflect the layered architecture:
  POST /auth/register, /auth/login  - optional accounts (bearer token via x-user-token)
  GET  /auth/me                      - current user profile
  DELETE /auth/account                - permanently delete the account and all its data
  POST/GET/DELETE /auth/share-code    - generate/read/revoke a provider share code (one active at a time)
  GET  /provider/patient-summary       - public, code-only read-only summary for whoever holds a valid share code
  POST /predict/ml                   - the trained ML classifier alone (vitals -> risk class)
  GET  /model/info                    - model transparency: features, hyperparameters, CV/test metrics
  POST /assess                         - the full hybrid: ML prediction + rule-based dynamic
                                         evaluation (danger-sign ladder, risk-formulation
                                         checklist, expert rules, hemoglobin, EPDS, cross-signal
                                         clinical-reasoning layer) -> triage. Persisted server-side
                                         when called with a valid x-user-token.
  GET  /assessments/mine              - a logged-in user's assessment history
  GET  /psych-assess/items            - the 10 EPDS questions + response options
  POST /psych-assess                  - EPDS scoring alone
  POST /pregnancy-guide               - trimester/week-based ANC schedule and guidance
  POST /postpartum-guide               - days/weeks-postpartum recovery, breastfeeding, PNC schedule, and danger signs
  GET  /nutrition/items                - the personalized nutrition questionnaire
  POST /nutrition-assess               - food-group frequency -> per-nutrient adequacy + food suggestions
  GET  /nutrition-checks/mine          - a logged-in user's nutrition check history
  POST /chat                           - rule-based instant-help assistant
  POST /documents/analyze              - upload/paste a prescription or lab report ->
                                         medication schedule + flagged findings
  GET  /helplines                      - India helplines and scheme references
  POST /gis/nearby-facilities          - real hospitals/clinics/pharmacies near a lat/lon (server-side
                                         proxy to OpenStreetMap Overpass, which browsers can't call directly)
  GET  /gis/geocode                    - free-text place search (server-side proxy to Nominatim)
"""

import json
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src import auth, document_extractor, gis
from src.dynamic_eval import chat_assistant, nutrition_eval, postpartum_guide, pregnancy_guide, psych_eval, report_analyzer, triage
from src.ml.predict import get_classifier

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
# The deployed frontend as of this cutover - a Vite+React rewrite of
# everything under frontend/ (same design, dark Vaadhan-inspired UI,
# calling these same endpoints). frontend/ itself is left in place and
# still mounted at /static below as a fallback, not deleted.
REACT_DIST_DIR = Path(__file__).resolve().parents[2] / "frontend-react" / "dist"

app = FastAPI(
    title="Janamdatri-AI Maternal Risk Triage",
    description=(
        "ML + rule-based hybrid maternal health risk triage, adapted for the Indian context. "
        "Screening/prioritization aid only - not a diagnosis."
    ),
    version="0.3.0",
)

auth.init_db()

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/assets", StaticFiles(directory=REACT_DIST_DIR / "assets"), name="react-assets")


@app.get("/")
def serve_frontend():
    return FileResponse(REACT_DIST_DIR / "index.html")


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
    pregnancyWeek: Optional[int] = Field(
        default=None,
        description="Current gestational week, if known - lets the assessment adjust for trimester (e.g. preterm labor before 37 weeks)",
    )
    weight: Optional[float] = Field(default=None, description="Current weight in kg, if known")
    previousWeight: Optional[float] = Field(
        default=None, description="Weight in kg at the last assessment, if known - lets weight CHANGE be graded, not just a single reading"
    )
    fetalMovementCount: Optional[int] = Field(
        default=None, description="Number of fetal movements felt in the last hour, if checked"
    )
    fundalHeight: Optional[float] = Field(
        default=None, description="Symphysis-fundal height in cm, if measured - graded against gestational week (McDonald's rule) when pregnancyWeek is also provided"
    )


class PsychAssessRequest(BaseModel):
    responses: List[int] = Field(..., min_length=10, max_length=10)


class NutritionAssessRequest(BaseModel):
    responses: dict = Field(..., description="Map of question id -> frequency response (0-3)")
    hemoglobin: Optional[float] = Field(default=None, description="Recent Hb in g/dL, if known, to connect with dietary iron intake")
    pregnancyWeek: Optional[int] = Field(default=None, description="Current gestational week, if known, to prioritize by trimester")


class PregnancyGuideRequest(BaseModel):
    lmp: Optional[str] = Field(None, description="Last menstrual period date, ISO format e.g. 2026-01-15")
    week: Optional[int] = Field(None, description="Current gestational week, if known directly")


class PostpartumGuideRequest(BaseModel):
    deliveryDate: str = Field(..., description="ISO date the baby was delivered, e.g. 2026-01-15")


class NearbyFacilitiesRequest(BaseModel):
    lat: float
    lon: float


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    contextMessage: Optional[str] = Field(
        default=None,
        description="The prior user message(s), when this reply follows up on the bot's own clarifying question",
    )
    unresolvedRounds: int = Field(
        default=0,
        description="How many consecutive clarifying/fallback replies have already failed to resolve this thread",
    )


def _current_user(x_user_token: Optional[str]) -> Optional[dict]:
    return auth.get_user_by_token(x_user_token) if x_user_token else None


@app.get("/health")
def health():
    return {"status": "ok"}


# ============================================================
#  ACCOUNTS (entirely optional - see "Continue as Guest" in the UI)
# ============================================================

@app.post("/auth/register")
def register(req: RegisterRequest):
    try:
        token = auth.register(req.email, req.password, req.name)
    except auth.AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    user = auth.get_user_by_token(token)
    return {"success": True, "data": {"token": token, "user": user}}


@app.post("/auth/login")
def login(req: LoginRequest):
    try:
        token = auth.login(req.email, req.password)
    except auth.AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    user = auth.get_user_by_token(token)
    return {"success": True, "data": {"token": token, "user": user}}


@app.get("/auth/me")
def me(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")
    return {"success": True, "data": {"user": user}}


@app.delete("/auth/account")
def delete_account(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")
    auth.delete_user(user["id"])
    return {"success": True, "data": {"deleted": True}}


# ============================================================
#  PROVIDER SHARE CODE - lets a logged-in user hand a short code to a
#  health worker/doctor for read-only access to their latest summary,
#  with no separate provider login. Only one code is ever active per
#  user, so generating a new one immediately revokes the old one.
# ============================================================

@app.post("/auth/share-code")
def create_share_code(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")
    code = auth.generate_share_code(user["id"])
    return {"success": True, "data": {"code": code}}


@app.get("/auth/share-code")
def read_share_code(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")
    code = auth.get_active_share_code(user["id"])
    return {"success": True, "data": {"code": code}}


@app.delete("/auth/share-code")
def delete_share_code(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")
    auth.revoke_share_code(user["id"])
    return {"success": True, "data": {"revoked": True}}


@app.get("/provider/patient-summary")
def provider_patient_summary(code: str):
    """Public (no login) by design - the share code itself is the sole
    credential, exactly as the patient handing over a card would work.
    Read-only: this endpoint has no counterpart that writes anything, and
    it only ever returns the ONE patient the code belongs to - there is no
    way to list or browse any other patient from here."""
    user = auth.get_user_by_share_code(code)
    if not user:
        raise HTTPException(status_code=404, detail="Invalid or revoked share code.")

    latest_assessment = None
    assessments = auth.get_assessments_for_user(user["id"], limit=1)
    if assessments:
        row = assessments[0]
        result = json.loads(row["result_json"])
        latest_assessment = {
            "createdAt": row["created_at"],
            "severityLevel": row["severity_level"],
            "mri": row["mri"],
            "vitalsInput": result.get("vitalsInput"),
            "hemoglobinAssessment": result.get("hemoglobinAssessment"),
            "explanation": result.get("clinicalExplanation"),
        }

    latest_nutrition = None
    nutrition_checks = auth.get_nutrition_checks_for_user(user["id"], limit=1)
    if nutrition_checks:
        row = nutrition_checks[0]
        result = json.loads(row["result_json"])
        latest_nutrition = {"createdAt": row["created_at"], "gaps": result.get("gaps", [])}

    return {
        "success": True,
        "data": {
            "patientName": user.get("name") or user["email"].split("@")[0],
            "latestAssessment": latest_assessment,
            "latestNutrition": latest_nutrition,
        },
    }


# ============================================================
#  ML + TRIAGE
# ============================================================

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
def assess(req: AssessRequest, x_user_token: Optional[str] = Header(None)):
    if not any([req.text, req.vitals, req.hemoglobin is not None, req.epdsResponses,
                req.weight is not None, req.fetalMovementCount is not None, req.fundalHeight is not None]):
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: symptom text, vitals, hemoglobin, EPDS responses, weight, fetal movement count, or fundal height.",
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
            pregnancy_week=req.pregnancyWeek,
            weight=req.weight,
            previous_weight=req.previousWeight,
            fetal_movement_count=req.fetalMovementCount,
            fundal_height=req.fundalHeight,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Carried through so a Home-dashboard-style summary can show "BP: Normal /
    # Needs Attention" etc. without re-deriving it from the ML probabilities -
    # the raw vitals the person entered aren't reconstructable from those.
    if req.vitals:
        triage_result["vitalsInput"] = req.vitals.model_dump()
    if req.weight is not None:
        triage_result["weightInput"] = req.weight
    if req.fundalHeight is not None:
        triage_result["fundalHeightInput"] = req.fundalHeight

    user = _current_user(x_user_token)
    if user:
        try:
            auth.save_assessment(
                user["id"], triage_result["severity"]["level"], triage_result["mri"], json.dumps(triage_result)
            )
        except Exception as exc:
            # Persistence failure should never break the response the
            # person is waiting on - log and move on.
            print(f"Could not persist assessment: {exc}")

    return {"success": True, "data": triage_result}


@app.get("/assessments/mine")
def assessments_mine(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")

    rows = auth.get_assessments_for_user(user["id"])
    for row in rows:
        row["result"] = json.loads(row.pop("result_json"))
    return {"success": True, "data": {"assessments": rows}}


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


@app.post("/postpartum-guide")
def postpartum_guide_endpoint(req: PostpartumGuideRequest):
    try:
        guide = postpartum_guide.get_postpartum_guide(req.deliveryDate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="deliveryDate must be an ISO date string, e.g. 2026-01-15") from exc
    return {"success": True, "data": guide}


# ============================================================
#  NUTRITION ANALYSIS
# ============================================================

@app.get("/nutrition/items")
def nutrition_items():
    return {
        "success": True,
        "data": {"questions": nutrition_eval.QUESTIONS, "frequencyOptions": nutrition_eval.FREQUENCY_OPTIONS},
    }


@app.post("/nutrition-assess")
def nutrition_assess(req: NutritionAssessRequest, x_user_token: Optional[str] = Header(None)):
    trimester = pregnancy_guide.trimester_for_week(req.pregnancyWeek) if req.pregnancyWeek is not None else None
    try:
        result = nutrition_eval.score(req.responses, hemoglobin=req.hemoglobin, trimester=trimester)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user = _current_user(x_user_token)
    if user:
        try:
            auth.save_nutrition_check(user["id"], json.dumps(result))
        except Exception as exc:
            print(f"Could not persist nutrition check: {exc}")

    return {"success": True, "data": result}


@app.get("/nutrition-checks/mine")
def nutrition_checks_mine(x_user_token: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")

    rows = auth.get_nutrition_checks_for_user(user["id"])
    for row in rows:
        row["result"] = json.loads(row.pop("result_json"))
    return {"success": True, "data": {"checks": rows}}


# ============================================================
#  INSTANT HELP CHAT
# ============================================================

@app.post("/chat")
def chat(req: ChatRequest, x_user_token: Optional[str] = Header(None)):
    result = chat_assistant.respond(req.message, context_message=req.contextMessage, unresolved_rounds=req.unresolvedRounds)

    user = _current_user(x_user_token)
    if user:
        try:
            auth.save_chat_message(user["id"], "user", req.message)
            auth.save_chat_message(user["id"], "bot", result["reply"])
        except Exception as exc:
            print(f"Could not persist chat message: {exc}")

    return {"success": True, "data": result}


# ============================================================
#  DOCUMENT ANALYSIS (prescriptions / lab reports)
# ============================================================

MAX_DOCUMENT_TEXT_LENGTH = 50_000


@app.post("/documents/analyze")
async def analyze_document(file: UploadFile = File(None), text: str = Form(None)):
    if not file and not text:
        raise HTTPException(status_code=400, detail="Upload a file or paste the report's text.")

    if file:
        content = await file.read()
        try:
            extracted_text = document_extractor.extract_text(file.filename, content)
        except document_extractor.ExtractionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        source_name = file.filename
    else:
        extracted_text = text
        source_name = "pasted text"

    if not extracted_text or not extracted_text.strip():
        raise HTTPException(status_code=400, detail="No text found to analyze.")

    extracted_text = extracted_text[:MAX_DOCUMENT_TEXT_LENGTH]
    result = report_analyzer.analyze(extracted_text)

    return {
        "success": True,
        "data": {
            **result,
            "sourceName": source_name,
            "extractedTextPreview": extracted_text[:2000],
        },
    }


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


# ============================================================
#  NEARBY CARE (GIS) - proxied server-side; see src/gis.py for why
#  Overpass/Nominatim can't be called directly from the browser.
# ============================================================

@app.post("/gis/nearby-facilities")
def nearby_facilities(req: NearbyFacilitiesRequest):
    try:
        facilities = gis.fetch_nearby_facilities(req.lat, req.lon)
    except Exception as exc:
        gis.logger.exception("nearby-facilities lookup failed for (%s, %s)", req.lat, req.lon)
        raise HTTPException(status_code=502, detail="Could not reach the map data service. Please try again.") from exc
    return {"success": True, "data": {"facilities": facilities}}


@app.get("/gis/geocode")
def geocode(q: str):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Enter a place to search for.")
    try:
        place = gis.geocode_place(q.strip())
    except Exception as exc:
        gis.logger.exception("geocode lookup failed for %r", q)
        raise HTTPException(status_code=502, detail="Place search failed. Please try again.") from exc
    if not place:
        raise HTTPException(status_code=404, detail=f'Could not find "{q}". Try a nearby town or district name.')
    return {"success": True, "data": place}


# Client-side routing (React Router) means a hard refresh or a direct link
# to e.g. /assess has no server-side route of its own - without this, that
# 404s instead of loading the SPA shell and letting the router take over.
# Registered LAST so every real API route above still matches first; only
# an unmatched GET path falls through to here.
@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    return FileResponse(REACT_DIST_DIR / "index.html")
