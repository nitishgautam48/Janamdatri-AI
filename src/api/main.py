"""
Janamdatri-AI - Maternal Risk Triage API.

Endpoints reflect the layered architecture:
  POST /auth/register, /auth/login  - optional accounts (bearer token via x-user-token).
                                        counsellor/doctor registration additionally needs a valid
                                        inviteCode (see src/auth.py, scripts/create_invite_code.py)
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
  POST /live/start, GET /live/mine, GET/POST /live/{id}(/messages), POST /live/{id}/cancel
                                        - patient side of live counsellor chat (x-user-token or x-guest-id).
                                        cancel only works while still 'waiting' - the patient's way back to
                                        the assistant if no one claims the request (see live_chat.py)
  POST /live/{id}/voice-note, DELETE .../voice-note/{noteId}, GET .../voice-note/{noteId}
                                        - voice notes: record, preview (hear it back + see/edit the
                                        transcript), then either send it as a message (POST .../messages
                                        with voiceNoteId) or discard it. The audio itself is kept, not just
                                        the transcript - see stt.save_and_transcribe.
  POST /counsellor/duty, GET /counsellor/queue|mine, POST /counsellor/{id}/claim|messages|resolve|handoff
                                        - counsellor workspace
  GET  /doctor/queue, GET/POST /doctor/{id}(/advice)
                                        - doctor's forwarded-case queue
                                        (both sections open to any counsellor-or-doctor account -
                                        see STAFF_ROLES / _require_staff)
  WS   /ws/live/{id}, /ws/staff        - push invalidation for the above instead of fixed-interval
                                        polling (see src/ws_manager.py); each frontend poll loop also
                                        keeps a slow backstop interval in case a socket drops silently.
                                        /ws/live/{id} also carries WebRTC call signaling and, once a
                                        call connects, each side's own streaming transcript of what
                                        THEY said (message_kind='call') - see the endpoint's docstring
  POST /stt/transcribe                 - self-hosted speech-to-text (see src/stt.py), record-then-
                                        upload path: 503s (frontend falls back to the browser's own
                                        SpeechRecognition) until a model is actually provisioned
  WS   /ws/stt                          - self-hosted streaming speech-to-text: partial/final
                                        transcripts pushed back while the patient is still talking,
                                        instead of only after a full clip uploads. Closes with code
                                        4404 if no model is configured, so the frontend falls back
                                        the same way /stt/transcribe's 503 does.
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src import auth, document_extractor, gis, live_chat, stt
from src.dynamic_eval import chat_assistant, nutrition_eval, postpartum_guide, pregnancy_guide, psych_eval, report_analyzer, triage
from src.ml.predict import get_classifier
from src.ws_manager import hub

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
live_chat.init_db()

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
    urineProtein: Optional[str] = Field(
        default=None, description="Urine dipstick protein reading, if tested: nil, trace, 1+, 2+, or 3+"
    )
    heightCm: Optional[float] = Field(default=None, description="Height in cm, if known - combined with weight for BMI")
    previousPregnancies: Optional[int] = Field(
        default=None, description="Number of PRIOR pregnancies, not counting this one - used to flag grand multiparity (5th+ pregnancy)"
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
    role: str = Field(default="patient", description="patient, counsellor, or doctor - see auth.py for the caveat on self-serve role signup")
    inviteCode: Optional[str] = Field(default=None, description="required for counsellor/doctor - see auth.INVITE_REQUIRED_ROLES")


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
    guestId: Optional[str] = Field(
        default=None,
        description="Opaque per-browser id for a guest (no account) - lets a danger-sign escalation reach the "
        "counsellor queue without requiring login, the same way a guest's assessment works everywhere else.",
    )
    lang: Optional[str] = Field(default="en", description="Patient's current UI language (en/hi/hinglish), shown to the counsellor")


class LiveStartRequest(BaseModel):
    reason: Optional[str] = None
    guestId: Optional[str] = None
    lang: Optional[str] = "en"


class LiveMessageRequest(BaseModel):
    # No min_length: a voice note whose transcription failed/wasn't
    # configured still needs to send with empty text (the audio is the
    # message) - the "must have text or a voice note" check lives in the
    # endpoint itself, where both fields are visible together.
    text: str = ""
    guestId: Optional[str] = None
    voiceNoteId: Optional[str] = Field(default=None, description="From POST /live/{id}/voice-note - attaches that staged recording to this message")


class LiveCancelRequest(BaseModel):
    guestId: Optional[str] = None


class DutyRequest(BaseModel):
    onDuty: bool


class ResolveRequest(BaseModel):
    outcome: str = Field(..., description="care | chat | emer | doc")
    note: Optional[str] = ""


class HandoffRequest(BaseModel):
    note: str = Field(..., min_length=1)
    urgency: str = Field(default="today", description="hour | today | routine")


class DoctorAdviceRequest(BaseModel):
    advice: str = Field(..., min_length=1)


def _current_user(x_user_token: Optional[str]) -> Optional[dict]:
    return auth.get_user_by_token(x_user_token) if x_user_token else None


STAFF_ROLES = ("counsellor", "doctor")


def _require_staff(x_user_token: Optional[str]) -> dict:
    """Either staff role can reach both the counsellor workspace and the
    doctor queue - the care-team shell lets one logged-in staff account
    move between every section (queue, conversations, forwarded cases,
    caregiver view) rather than gating each section to its own role."""
    user = _current_user(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in or session expired.")
    if user["role"] not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="This action requires a counsellor or doctor account.")
    return user


@app.get("/health")
def health():
    return {"status": "ok"}


# ============================================================
#  ACCOUNTS (entirely optional - see "Continue as Guest" in the UI)
# ============================================================

@app.post("/auth/register")
def register(req: RegisterRequest):
    try:
        token = auth.register(req.email, req.password, req.name, req.role, invite_code=req.inviteCode)
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
                req.weight is not None, req.fetalMovementCount is not None, req.fundalHeight is not None,
                req.urineProtein]):
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: symptom text, vitals, hemoglobin, EPDS responses, weight, "
                   "fetal movement count, fundal height, or urine protein.",
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
            urine_protein=req.urineProtein,
            height_cm=req.heightCm,
            previous_pregnancies=req.previousPregnancies,
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
    if req.heightCm is not None:
        triage_result["heightInput"] = req.heightCm
    if req.pregnancyWeek is not None:
        triage_result["pregnancyWeekInput"] = req.pregnancyWeek

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
async def chat(req: ChatRequest, x_user_token: Optional[str] = Header(None)):
    result = chat_assistant.respond(req.message, context_message=req.contextMessage, unresolved_rounds=req.unresolvedRounds)

    user = _current_user(x_user_token)
    if user:
        try:
            auth.save_chat_message(user["id"], "user", req.message)
            auth.save_chat_message(user["id"], "bot", result["reply"])
        except Exception as exc:
            print(f"Could not persist chat message: {exc}")

    # Additive live-counsellor escalation: the scripted reply above always
    # fires regardless of any of this - a human joining the conversation is
    # a bonus the patient never waits on, never a gate in front of 108/102/
    # KIRAN. Only a real danger signal (or an explicit self-harm flag)
    # auto-creates a case in the counsellor queue; a merely moderate signal
    # just offers the option (offerHuman) rather than forcing it.
    severity = reason = reason_source = None
    if result.get("intent") == "crisis_self_harm":
        severity, reason, reason_source = "Critical", "Self-harm flag in chat", "self_harm"
    elif result.get("isEmergency") and result.get("dangerLadder"):
        rung = result["dangerLadder"].get("rung", 0)
        severity = "Critical" if rung >= 5 else "Severe"
        phrase = result["dangerLadder"].get("matchedPhrase") or "a danger sign"
        reason, reason_source = f"Danger sign: {phrase}", "danger_sign"
    elif result.get("intent") in ("mild_symptom", "mild_symptom_followup"):
        result["offerHuman"] = True

    if severity and (user or req.guestId):
        try:
            patient_name = (user["name"] or user["email"].split("@")[0]) if user else "Guest"
            conv = live_chat.start_or_escalate(
                patient_user_id=user["id"] if user else None,
                guest_token=None if user else req.guestId,
                patient_name=patient_name,
                lang=req.lang or "en",
                severity_level=severity,
                reason=reason,
                reason_source=reason_source,
                initial_message=req.message,
            )
            result["escalatedToLive"] = True
            result["liveConversationId"] = conv["id"]
            await hub.notify_staff("queue_changed")
        except Exception as exc:
            # Escalating to the live queue must never break the scripted
            # reply the person is already waiting on.
            print(f"Could not escalate to live queue: {exc}")

    return {"success": True, "data": result}


# ============================================================
#  LIVE COUNSELLOR CHAT
#
#  A human-in-the-loop layer on top of the chat above (see
#  src/live_chat.py for the full design rationale). Patient-side
#  endpoints identify the caller by x-user-token OR x-guest-id (a
#  per-browser opaque token the frontend generates for guests, mirroring
#  how every other guest feature in this app already scopes itself
#  client-side - except a live transcript has to live server-side to
#  exist at all, which is a real, deliberate change to this app's
#  guest-privacy promise; see the Privacy page).
# ============================================================


def _identify_patient(x_user_token: Optional[str], x_guest_id: Optional[str]):
    user = _current_user(x_user_token)
    if user:
        return user, None
    if x_guest_id:
        return None, x_guest_id
    raise HTTPException(status_code=400, detail="Log in, continue as guest, or resend with a guest id.")


def _patient_code(conv: dict) -> str:
    """A short, stable per-patient reference the care team can read
    aloud/type - JD-#### for a real account, or the conversation's own
    id for a guest (who has no persistent identity to derive one from)."""
    if conv.get("patient_user_id"):
        return f"JD-{1000 + conv['patient_user_id']}"
    return conv["id"][:8].upper()


def _conv_clinical_context(conv: dict) -> dict:
    """Latest vitals, warning signs, and an MRI trend for the context
    rail - only available for a patient with an account, since guest
    assessments are never persisted server-side (see the Privacy page).
    A guest conversation gets empty/None here, and the frontend shows a
    plain "no data" state rather than a fabricated number."""
    result = {"age": None, "vitals": None, "warning_signs": [], "mri_trend": []}
    if not conv.get("patient_user_id"):
        return result

    assessments = auth.get_assessments_for_user(conv["patient_user_id"], limit=6)
    result["mri_trend"] = [
        {"mri": a["mri"], "severity_level": a["severity_level"], "created_at": a["created_at"]}
        for a in reversed(assessments)
    ]
    if not assessments:
        return result

    latest = json.loads(assessments[0]["result_json"])
    vitals_input = latest.get("vitalsInput")
    hb = (latest.get("hemoglobinAssessment") or {}).get("hemoglobin")
    week = latest.get("pregnancyWeekInput")
    if vitals_input or hb is not None or week is not None:
        # Same cutoffs already used elsewhere in the app (hemoglobin_rules.py's
        # Normal >=11 g/dL; "BP above 140/90" is this app's own hypertension-in-
        # pregnancy language, see triage.py's rule text) - flagged so the
        # context rail can highlight a concerning reading the way the rest of
        # the app already does, not a new clinical threshold.
        bp_flag = vitals_input and (vitals_input["SystolicBP"] >= 140 or vitals_input["DiastolicBP"] >= 90)
        pulse_flag = vitals_input and (vitals_input["HeartRate"] >= 100 or vitals_input["HeartRate"] < 60)
        hb_flag = hb is not None and hb < 11
        result["vitals"] = {
            "bp": f"{vitals_input['SystolicBP']:.0f}/{vitals_input['DiastolicBP']:.0f}" if vitals_input else None,
            "bpFlag": bool(bp_flag),
            "pulse": vitals_input["HeartRate"] if vitals_input else None,
            "pulseFlag": bool(pulse_flag),
            "hb": hb,
            "hbFlag": hb_flag,
            "week": week,
        }
    if vitals_input:
        result["age"] = vitals_input.get("Age")
    result["warning_signs"] = latest.get("warningSigns", [])
    return result


def _serialize_conv(conv: dict, messages: list = None) -> dict:
    out = dict(conv)
    out.pop("context_json", None)
    if messages is not None:
        out["messages"] = messages
    out["patient_code"] = _patient_code(conv)
    out.update(_conv_clinical_context(conv))
    return out


def _check_conv_access(conv: dict, user: Optional[dict], guest_id: Optional[str]):
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    owns = (user and conv["patient_user_id"] == user["id"]) or (guest_id and conv["guest_token"] == guest_id)
    if not owns:
        raise HTTPException(status_code=403, detail="This conversation belongs to someone else.")


def _serialize_conv_for_patient(conv: dict, messages: list) -> dict:
    """Same as _serialize_conv, plus how many staff are on duty right
    now - the patient-facing widget uses this to tell "someone's on duty,
    just hasn't claimed this yet" apart from "no one is watching this
    queue at all", which the conversation's own status can't say on its
    own (both look identical: status == 'waiting')."""
    out = _serialize_conv(conv, messages)
    out["counsellors_on_duty"] = auth.count_on_duty(STAFF_ROLES)
    return out


@app.post("/live/start")
async def live_start(req: LiveStartRequest, x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    user, guest_id = _identify_patient(x_user_token, req.guestId or x_guest_id)
    patient_name = (user["name"] or user["email"].split("@")[0]) if user else "Guest"
    conv = live_chat.start_or_escalate(
        patient_user_id=user["id"] if user else None,
        guest_token=guest_id,
        patient_name=patient_name,
        lang=req.lang or "en",
        severity_level="Minimal",
        reason=req.reason or "Asked to talk to a person",
        reason_source="requested",
    )
    await hub.notify_staff("queue_changed")
    return {"success": True, "data": _serialize_conv_for_patient(conv, live_chat.list_messages(conv["id"]))}


@app.get("/live/mine")
def live_mine(x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    conv = live_chat.get_active_for_patient(patient_user_id=user["id"] if user else None, guest_token=None if user else x_guest_id)
    if not conv:
        return {"success": True, "data": None}
    return {"success": True, "data": _serialize_conv_for_patient(conv, live_chat.list_messages(conv["id"]))}


@app.get("/live/{conv_id}")
def live_get(conv_id: str, x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    _check_conv_access(conv, user, x_guest_id)
    return {"success": True, "data": _serialize_conv_for_patient(conv, live_chat.list_messages(conv_id))}


@app.post("/live/{conv_id}/cancel")
async def live_cancel(conv_id: str, req: LiveCancelRequest, x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    """Lets the patient back out of the counsellor queue themselves while
    still waiting, instead of being stuck in live mode indefinitely with
    no way back to the assistant if no one claims the request (see the
    module docstring's point about this being a real gap otherwise)."""
    user = _current_user(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    _check_conv_access(conv, user, req.guestId or x_guest_id)
    try:
        conv = live_chat.cancel(conv_id)
    except live_chat.LiveChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    await hub.notify_staff("queue_changed")
    return {"success": True, "data": _serialize_conv(conv, live_chat.list_messages(conv_id))}


@app.post("/live/{conv_id}/messages")
async def live_send(conv_id: str, req: LiveMessageRequest, x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    _check_conv_access(conv, user, req.guestId or x_guest_id)
    if conv["status"] == live_chat.STATUS_CLOSED:
        raise HTTPException(status_code=409, detail="This conversation has ended.")
    if not req.text.strip() and not req.voiceNoteId:
        raise HTTPException(status_code=400, detail="Message can't be empty.")
    if req.voiceNoteId:
        if not live_chat.voice_note_path(conv_id, req.voiceNoteId).is_file():
            raise HTTPException(status_code=404, detail="This voice note wasn't found - it may have already been sent or discarded.")
        live_chat.add_message(conv_id, "patient", req.text, message_kind="voice", audio_note_id=req.voiceNoteId)
    else:
        live_chat.add_message(conv_id, "patient", req.text)
    # A message sent before anyone has claimed yet - the same "don't wait
    # for the chat" reminder the scripted bot itself would give.
    if conv["status"] == live_chat.STATUS_WAITING:
        live_chat.add_message(
            conv_id, "bot",
            "Thank you. If you're bleeding heavily or feel faint, call 108 now - don't wait for the chat.\n"
            "खून ज़्यादा हो या चक्कर आए तो अभी 108 पर कॉल करें।",
        )
    await hub.notify_conv(conv_id)
    return {"success": True, "data": {"sent": True}}


@app.post("/live/{conv_id}/voice-note")
async def live_voice_note_upload(conv_id: str, file: UploadFile = File(...), x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    """Records+transcribes a voice note, staging it (saved to disk, not
    yet a message) so the patient can preview - hear it back, see/edit
    the transcript - before it actually sends. POST /live/{id}/messages
    with the returned noteId turns this into a real message; DELETE
    .../voice-note/{noteId} discards it if they change their mind."""
    user = _current_user(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    _check_conv_access(conv, user, x_guest_id)
    if conv["status"] == live_chat.STATUS_CLOSED:
        raise HTTPException(status_code=409, detail="This conversation has ended.")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio upload.")
    note_id = uuid.uuid4().hex
    dest = live_chat.voice_note_path(conv_id, note_id)
    try:
        text, transcribed = stt.save_and_transcribe(raw, str(dest))
    except stt.SttError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"success": True, "data": {
        "noteId": note_id, "text": text, "transcribed": transcribed,
        "audioUrl": f"/live/{conv_id}/voice-note/{note_id}",
    }}


@app.delete("/live/{conv_id}/voice-note/{note_id}")
async def live_voice_note_discard(conv_id: str, note_id: str, x_user_token: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)):
    user = _current_user(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    _check_conv_access(conv, user, x_guest_id)
    live_chat.discard_voice_note(conv_id, note_id)
    return {"success": True, "data": {"discarded": True}}


@app.get("/live/{conv_id}/voice-note/{note_id}")
def live_voice_note_get(conv_id: str, note_id: str):
    """No auth beyond knowing conv_id + note_id (both server-generated,
    high-entropy ids) - the same "the id itself is the capability" model
    /ws/live/{conv_id} already uses. A real per-request auth check isn't
    workable here anyway: a plain <audio src="..."> tag is what plays
    this back, and a browser won't attach an x-user-token header to
    that request."""
    conv = live_chat.get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    path = live_chat.voice_note_path(conv_id, note_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Voice note not found.")
    return FileResponse(str(path), media_type="audio/wav")


@app.post("/counsellor/duty")
async def counsellor_duty(req: DutyRequest, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    auth.set_duty(user["id"], req.onDuty)
    if not req.onDuty:
        # Going off duty releases whatever this counsellor still has
        # claimed, back to the waiting queue - otherwise a patient
        # mid-conversation is simply abandoned with no signal at all
        # (see live_chat.release_claimed_by). Explicit duty-off only;
        # a crashed tab/lost connection without toggling off first isn't
        # caught by this - that needs presence/heartbeat detection this
        # app doesn't have yet.
        released = live_chat.release_claimed_by(user["id"])
        for conv_id in released:
            await hub.notify_conv(conv_id)
        if released:
            await hub.notify_staff("queue_changed")
    return {"success": True, "data": {"onDuty": req.onDuty}}


@app.get("/counsellor/queue")
def counsellor_queue(x_user_token: Optional[str] = Header(None)):
    _require_staff(x_user_token)
    return {"success": True, "data": {"queue": [_serialize_conv(c) for c in live_chat.list_queue()]}}


@app.get("/counsellor/mine")
def counsellor_mine(x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    mine = live_chat.list_mine(user["id"])
    return {
        "success": True,
        "data": {
            "conversations": [_serialize_conv(c) for c in mine],
            "resolvedToday": live_chat.count_resolved_today(user["id"]),
        },
    }


@app.get("/counsellor/{conv_id}")
def counsellor_conversation(conv_id: str, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    if conv["status"] != live_chat.STATUS_WAITING and conv["counsellor_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This case belongs to a different counsellor.")
    return {"success": True, "data": _serialize_conv(conv, live_chat.list_messages(conv_id))}


@app.post("/counsellor/{conv_id}/claim")
async def counsellor_claim(conv_id: str, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    try:
        conv = live_chat.claim(conv_id, user["id"])
    except live_chat.LiveChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await hub.notify_staff("queue_changed")
    await hub.notify_conv(conv_id)
    return {"success": True, "data": _serialize_conv(conv, live_chat.list_messages(conv_id))}


@app.post("/counsellor/{conv_id}/messages")
async def counsellor_send(conv_id: str, req: LiveMessageRequest, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    try:
        live_chat.counsellor_send(conv_id, user["id"], req.text)
    except live_chat.LiveChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await hub.notify_conv(conv_id)
    return {"success": True, "data": {"sent": True}}


@app.post("/counsellor/{conv_id}/resolve")
async def counsellor_resolve(conv_id: str, req: ResolveRequest, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    try:
        live_chat.resolve(conv_id, user["id"], req.outcome, req.note or "")
    except live_chat.LiveChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await hub.notify_staff("queue_changed")
    await hub.notify_conv(conv_id)
    return {"success": True, "data": {"resolved": True}}


@app.post("/counsellor/{conv_id}/handoff")
async def counsellor_handoff(conv_id: str, req: HandoffRequest, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    try:
        live_chat.handoff_to_doctor(conv_id, user["id"], req.note, req.urgency)
    except live_chat.LiveChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await hub.notify_staff("doc_changed")
    await hub.notify_conv(conv_id)
    return {"success": True, "data": {"forwarded": True}}


def _transcript_preview(conv_id: str) -> dict:
    """Message count + last 3 non-system lines, for the forwarded-case
    card's preview column - a doctor deciding what to open next without
    opening the full transcript for every case."""
    messages = [m for m in live_chat.list_messages(conv_id) if m["sender_kind"] != "system"]
    return {
        "message_count": len(messages),
        "preview": [{"sender_kind": m["sender_kind"], "text": m["text"].split("\n")[0]} for m in messages[-3:]],
    }


@app.get("/doctor/queue")
def doctor_queue(reviewed: bool = False, x_user_token: Optional[str] = Header(None)):
    _require_staff(x_user_token)
    cases = []
    for c in live_chat.list_doctor_queue(reviewed):
        row = _serialize_conv(c)
        row.update(_transcript_preview(c["id"]))
        cases.append(row)
    return {"success": True, "data": {"cases": cases}}


@app.get("/doctor/{conv_id}")
def doctor_conversation(conv_id: str, x_user_token: Optional[str] = Header(None)):
    _require_staff(x_user_token)
    conv = live_chat.get_conversation(conv_id)
    if not conv or not conv["forwarded"]:
        raise HTTPException(status_code=404, detail="This case hasn't been forwarded to a doctor.")
    return {"success": True, "data": _serialize_conv(conv, live_chat.list_messages(conv_id))}


@app.post("/doctor/{conv_id}/advice")
async def doctor_advice(conv_id: str, req: DoctorAdviceRequest, x_user_token: Optional[str] = Header(None)):
    user = _require_staff(x_user_token)
    try:
        live_chat.submit_doctor_advice(conv_id, user["id"], req.advice)
    except live_chat.LiveChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await hub.notify_staff("doc_changed")
    await hub.notify_conv(conv_id)
    return {"success": True, "data": {"submitted": True}}


# ============================================================
#  REAL-TIME (WebSocket push, replacing the fixed-interval polling the
#  frontend used everywhere above - see src/ws_manager.py). A socket only
#  ever receives a small {"type": ...} invalidation event; the page then
#  re-fetches from the same REST endpoints above, so there is exactly one
#  place that knows how to serialize a conversation/queue row.
# ============================================================


@app.websocket("/ws/live/{conv_id}")
async def ws_live(websocket: WebSocket, conv_id: str, token: Optional[str] = None):
    """Patient (or a counsellor/doctor viewing that same conversation) -
    no auth needed beyond already knowing the conversation id, matching
    the REST /live/{conv_id} endpoints' own guest-friendly access model
    (the id itself is the capability, same as a share code elsewhere in
    this app). `token` is optional and only used to attribute
    call-transcript segments correctly (see below) - everything else
    this socket does works identically with or without it.

    Also carries the voice-call feature's WebRTC signaling: a received
    frame is normally just a heartbeat ping (see lib/ws.js) with nothing
    to do, but a {"type": "webrtc_signal", ...} frame gets relayed
    verbatim to the OTHER participant in this same conversation (see
    hub.relay_conv_signal) - this socket already connects exactly the two
    people a call would be between, so it doubles as the signaling
    channel rather than standing up a separate one.

    A {"type": "call_transcript_segment", "text": ...} frame (Phase 2 -
    transcribing the call itself, not just signaling it) is different:
    it gets PERSISTED as a real conv_messages row (message_kind='call'),
    not just relayed, since it needs to survive reload and be visible to
    a doctor later. Who it's attributed to is resolved here server-side
    from `token` matching this conversation's actual assigned counsellor
    - not from a client-supplied field - since unlike everything else on
    this "id is the capability" socket, fabricated content here would
    read as an authoritative clinical transcript rather than just noise."""
    await hub.conv_connect(conv_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "webrtc_signal":
                await hub.relay_conv_signal(conv_id, websocket, msg)
            elif msg.get("type") == "call_transcript_segment":
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                staff_user = _current_user(token) if token else None
                conv_row = live_chat.get_conversation(conv_id)
                is_assigned_counsellor = (
                    conv_row and staff_user and staff_user["role"] in STAFF_ROLES
                    and conv_row["counsellor_id"] == staff_user["id"]
                )
                if is_assigned_counsellor:
                    live_chat.add_message(conv_id, "counsellor", text, sender_id=staff_user["id"], message_kind="call")
                else:
                    live_chat.add_message(conv_id, "patient", text, message_kind="call")
                await hub.notify_conv(conv_id)
    except WebSocketDisconnect:
        pass
    finally:
        hub.conv_disconnect(conv_id, websocket)


# How long a /ws/staff connection can go without a heartbeat ping (the
# frontend sends one every ~20s - see lib/ws.js) before it's treated as
# dead. Catches the case a clean disconnect never does: a laptop asleep,
# a network that died without a TCP close - the socket looks "open" from
# this server's side forever otherwise, and release_staff_presence()
# below would never run.
STAFF_PRESENCE_HEARTBEAT_TIMEOUT = 60

# Once a counsellor/doctor has no open /ws/staff connection at all
# (whether from a clean disconnect or the heartbeat timeout above), this
# long to reconnect - a page refresh, a brief network drop - before
# they're actually treated as gone. Mirrors the explicit-duty-off
# recovery (release_claimed_by) for the case nobody explicitly toggled
# anything off.
STAFF_PRESENCE_GRACE_SECONDS = 45

_staff_presence_timeout_tasks: dict[int, asyncio.Task] = {}


async def _release_staff_presence(user_id: int):
    try:
        await asyncio.sleep(STAFF_PRESENCE_GRACE_SECONDS)
    except asyncio.CancelledError:
        return  # reconnected before the grace period elapsed - nothing to do
    _staff_presence_timeout_tasks.pop(user_id, None)
    auth.set_duty(user_id, False)
    released = live_chat.release_claimed_by(user_id)
    for conv_id in released:
        await hub.notify_conv(conv_id)
    if released:
        await hub.notify_staff("queue_changed")


@app.websocket("/ws/staff")
async def ws_staff(websocket: WebSocket, token: Optional[str] = None):
    """Counsellor/doctor shell - one socket per open StaffWorkspace tab,
    covering the queue, forwarded-cases, and duty-change events. A
    browser WebSocket can't set a custom header, so the session token
    travels as a query param here instead of x-user-token.

    Also the presence/heartbeat detector for going off duty implicitly
    (crash, closed laptop, dead network) rather than only via the
    explicit "Off duty" toggle - see STAFF_PRESENCE_* above and
    _release_staff_presence."""
    user = _current_user(token)
    if not user or user["role"] not in STAFF_ROLES:
        await websocket.close(code=4401)
        return
    user_id = user["id"]
    pending = _staff_presence_timeout_tasks.pop(user_id, None)
    if pending:
        pending.cancel()
    await hub.staff_connect(websocket, user_id)
    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=STAFF_PRESENCE_HEARTBEAT_TIMEOUT)
            except asyncio.TimeoutError:
                try:
                    await websocket.close()
                except Exception:
                    pass
                break
    except WebSocketDisconnect:
        pass
    finally:
        still_connected = hub.staff_disconnect(websocket, user_id)
        if not still_connected:
            _staff_presence_timeout_tasks[user_id] = asyncio.create_task(_release_staff_presence(user_id))


# ============================================================
#  SPEECH-TO-TEXT (self-hosted, see src/stt.py)
# ============================================================


@app.get("/stt/status")
def stt_status():
    """Checked once when the chat widget mounts, so it can pick
    self-hosted-vs-browser speech recognition up front instead of
    recording audio, uploading it, and only THEN discovering no model is
    configured - which would otherwise mean silently re-listening for the
    same thing a second time with no way to tell the person why."""
    return {"success": True, "data": {"configured": stt.is_configured()}}


@app.post("/stt/transcribe")
async def stt_transcribe(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio upload.")
    try:
        text = stt.transcribe_upload(raw)
    except stt.SttNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except stt.SttError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"success": True, "data": {"text": text}}


# 4404 (not a registered WebSocket close code, in the app-defined 4000-4999
# range) - lets the frontend tell "no model configured, fall back to the
# browser recognizer" apart from an ordinary disconnect, without needing a
# JSON message round-trip first just to say so.
STT_WS_NOT_CONFIGURED = 4404


@app.websocket("/ws/stt")
async def ws_stt(websocket: WebSocket):
    """Real-time streaming transcription: the browser sends raw mono
    16-bit PCM @ 16kHz audio frames (binary) as the patient speaks, and
    gets partial/final transcripts back as they're recognized - the
    live-captions experience /stt/transcribe's record-then-upload can't
    give, since that endpoint only returns anything after the whole clip
    is captured and uploaded. See stt.StreamingRecognizer and
    frontend-react/src/lib/live-stt.js.

    No auth: this socket only ever holds a few seconds of in-flight audio
    that's discarded the moment it's transcribed (nothing is written to
    disk or a database here), the same trust level as the browser's own
    on-device SpeechRecognition it's standing in for."""
    await websocket.accept()
    try:
        recognizer = stt.StreamingRecognizer()
    except stt.SttNotConfigured:
        await websocket.close(code=STT_WS_NOT_CONFIGURED, reason="No self-hosted STT model configured.")
        return

    try:
        while True:
            frame = await websocket.receive()
            if frame["type"] == "websocket.disconnect":
                break
            data = frame.get("bytes")
            if data:
                # KaldiRecognizer.AcceptWaveform is a blocking, CPU-bound
                # call - run it off the event loop (asyncio.to_thread)
                # rather than inline, so one patient's live transcription
                # doesn't stall every other request this single-process
                # server is handling (other API calls, other WS
                # connections) for however long that chunk takes to score.
                result = await asyncio.to_thread(recognizer.feed, data)
                if result["text"]:
                    await websocket.send_json(result)
            elif frame.get("text") == "stop":
                final_text = await asyncio.to_thread(recognizer.finish)
                if final_text:
                    await websocket.send_json({"final": True, "text": final_text})
                break
    except WebSocketDisconnect:
        pass


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
