(() => {
  const GAUGE_ARC_LENGTH = 283;
  const HISTORY_KEY = "janamdatri_history";
  const EPDS_KEY = "janamdatri_last_epds";
  const GUIDE_KEY = "janamdatri_last_guide";
  const NUTRITION_KEY = "janamdatri_last_nutrition";
  const REPORT_VITALS_LOG_KEY = "janamdatri_report_vitals_log";
  const EMERGENCY_BANNER_DISMISSED_KEY = "janamdatri_emergency_banner_dismissed_for";
  const LANG_KEY = "janamdatri_lang";
  const MAX_HISTORY = 20;

  // Chat conversation memory: accumulates while the bot's replies keep
  // failing to resolve (clarifying question or fallback), so a multi-turn
  // back-and-forth still has the full thread to analyze, not just the
  // single most recent message. Resets the moment a reply actually
  // resolves (emergency, FAQ answer, mild-symptom note, or the "go use
  // the Assessment tab" nudge) - see the chat form submit handler below.
  let pendingClarificationContext = null;
  let unresolvedChatRounds = 0;
  const UNRESOLVED_CHAT_INTENTS = new Set(["clarify_symptom", "fallback"]);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ==================================================================
  // Auth (optional accounts) + welcome overlay
  // ==================================================================

  const TOKEN_KEY = "janamdatri_token";
  const USER_KEY = "janamdatri_user";
  const GUEST_KEY = "janamdatri_guest";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function authHeaders() {
    const token = getToken();
    return token ? { "x-user-token": token } : {};
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.removeItem(GUEST_KEY);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getSavedUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  }

  // Every piece of per-person data (assessment history, saved EPDS score,
  // chat log) MUST be keyed to who's actually logged in - otherwise two
  // different accounts sharing a browser see each other's data the moment
  // the second one logs in, which is exactly the kind of leak a health app
  // can't have. Guest mode has no identity, so all guests on one device
  // intentionally share one 'guest' bucket (consistent with "guest mode
  // keeps everything on this device"); a logged-in user's data is scoped
  // to their own account id and nothing else can read it.
  function currentScopeId() {
    const user = getSavedUser();
    return user ? "user_" + user.id : "guest";
  }

  function scopedKey(baseKey) {
    return baseKey + "::" + currentScopeId();
  }

  // Called on every identity change (login, signup, guest, logout). Scoped
  // storage keys alone aren't enough - anything already rendered into the
  // DOM from the PREVIOUS identity (an open chat log, a shown EPDS result)
  // has to be cleared too, or it stays visible until a full page reload
  // even though the next read would correctly come from the new scope.
  function resetPerUserUIState() {
    const chatMessagesEl = document.getElementById("chat-messages");
    if (chatMessagesEl) chatMessagesEl.innerHTML = "";
    const epdsResultCard = document.getElementById("epds-result-card");
    if (epdsResultCard) epdsResultCard.hidden = true;
    const epdsForm = document.getElementById("epds-form");
    if (epdsForm) epdsForm.querySelectorAll('input[type="radio"]:checked').forEach((el) => { el.checked = false; });
    const nutritionResultCard = document.getElementById("nutrition-result-card");
    if (nutritionResultCard) nutritionResultCard.hidden = true;
    const nutritionForm = document.getElementById("nutrition-form");
    if (nutritionForm) nutritionForm.querySelectorAll('input[type="radio"]:checked').forEach((el) => { el.checked = false; });
    syncEpdsIncludeVisibility();
    pendingClarificationContext = null;
    unresolvedChatRounds = 0;
    $("#v-week").value = "";
    prefillPregnancyWeek();
    renderHome();
    checkGlobalEmergencyBanner();
  }

  function prefillPregnancyWeek() {
    const guide = loadLastGuide();
    if (guide && guide.week != null && !$("#v-week").value) {
      $("#v-week").value = guide.week;
    }
  }

  function syncUserArea() {
    const user = getSavedUser();
    const area = $("#user-area");
    const deleteAccountBtn = $("#privacy-delete-account-btn");
    if (user && getToken()) {
      area.hidden = false;
      $("#user-name-display").textContent = "Hi, " + (user.name || user.email.split("@")[0]);
      if (deleteAccountBtn) deleteAccountBtn.hidden = false;
    } else {
      area.hidden = true;
      if (deleteAccountBtn) deleteAccountBtn.hidden = true;
    }
  }

  function showWelcomeOverlay(show) {
    $("#welcome-overlay").hidden = !show;
  }

  // Show the overlay unless the person already has a session or
  // previously chose to continue as a guest - never nag a returning user.
  if (!getToken() && !localStorage.getItem(GUEST_KEY)) {
    showWelcomeOverlay(true);
  } else {
    showWelcomeOverlay(false);
  }
  syncUserArea();

  $$('.welcome-tab').forEach((tab) => {
    tab.addEventListener("click", () => {
      $$('.welcome-tab').forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $("#login-form").hidden = tab.dataset.authTab !== "login";
      $("#signup-form").hidden = tab.dataset.authTab !== "signup";
    });
  });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#login-error");
    errorEl.hidden = true;
    try {
      const res = await fetch("/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail || "Login failed.");
      setSession(payload.data.token, payload.data.user);
      syncUserArea();
      resetPerUserUIState();
      showWelcomeOverlay(false);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#signup-error");
    errorEl.hidden = true;
    try {
      const res = await fetch("/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: $("#signup-email").value, password: $("#signup-password").value, name: $("#signup-name").value || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail || "Sign up failed.");
      setSession(payload.data.token, payload.data.user);
      syncUserArea();
      resetPerUserUIState();
      showWelcomeOverlay(false);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  $("#guest-btn").addEventListener("click", () => {
    localStorage.setItem(GUEST_KEY, "true");
    resetPerUserUIState();
    showWelcomeOverlay(false);
  });

  $("#logout-btn").addEventListener("click", () => {
    clearSession();
    syncUserArea();
    resetPerUserUIState();
    showWelcomeOverlay(true);
  });

  // ==================================================================
  // i18n
  // ==================================================================

  const TRANSLATIONS = {
    en: {
      tagline: "Maternal Risk Triage",
      "nav.home": "Home", "nav.assess": "Assessment", "nav.guide": "Pregnancy", "nav.nutrition": "Nutrition",
      "nav.psych": "Mental Wellness", "nav.history": "History", "nav.reports": "Reports", "nav.profile": "Profile", "nav.help": "Helplines",
      "profile.title": "My Pregnancy Profile",
      "profile.sub": "Enter this once - it personalizes your Home dashboard, Assessment, Nutrition targets, ANC checklist, and Pregnancy Guide, so you don't have to re-enter your week everywhere.",
      "profile.previousLabel": "Is this a previous pregnancy?", "profile.previousYes": "Yes", "profile.previousNo": "No / first pregnancy",
      "profile.conditionsLabel": "Existing medical conditions (optional)",
      "profile.conditionsPlaceholder": "e.g. thyroid, diabetes, hypertension - leave blank if none",
      "profile.saveBtn": "Save My Profile", "profile.summaryTitle": "Current Profile",
      "profile.vaccinationLabel": "Td/TT Vaccination", "profile.vaccineDose1": "Dose 1 given", "profile.vaccineDose2": "Dose 2 given",
      "home.weekNotSet": "Set your pregnancy week",
      "home.snapshotTitle": "Health Snapshot", "home.nutritionTitle": "Nutrition", "home.viewNutrition": "View Nutrition Analysis →",
      "home.todaysCare": "Today's Care", "home.thisWeek": "This Week", "home.urgentAlerts": "Urgent Alerts",
      "home.quickActions": "Quick Actions",
      "home.actionAssess": "Run Assessment", "home.actionGuide": "Pregnancy Guide",
      "home.actionNutrition": "Nutrition Analysis",
      "home.actionPsych": "Mental Health Check", "home.actionReports": "My Reports",
      "home.actionChat": "Instant Help Chat", "home.actionHelp": "Helplines", "home.actionProfile": "My Pregnancy Profile",
      "home.tipLabel": "Tip of the day",
      "nutrition.title": "Nutrition Analysis",
      "nutrition.sub": "Tell me how often you eat these food groups, and I'll check your intake against pregnancy nutrient needs (iron, protein, folate, calcium, B12, vitamin D, iodine) and suggest specific, affordable Indian foods to close any gaps. Not a lab test - a starting point for the conversation with your ANC provider or a nutritionist.",
      "nutrition.analyze": "Analyze My Diet", "nutrition.result": "Your Nutrient Adequacy",
      "home.greetingMorning": "Good morning", "home.greetingAfternoon": "Good afternoon", "home.greetingEvening": "Good evening",
      emergencyBtn: "🚨 Call 108",
      "a11y.title": "Display Settings", "a11y.largeText": "Larger text",
      "a11y.highContrast": "High contrast", "a11y.largeTouch": "Larger touch targets", "a11y.close": "Close",
      disclaimer: "⚠️ Screening aid only — not a diagnosis. <strong>Critical</strong> or <strong>Severe</strong> always means seek facility care now.",
      "section.vitals": "1 · Vitals", includeVitals: "Include vitals",
      "field.age": "Age (years)", "field.sbp": "Systolic BP", "field.dbp": "Diastolic BP",
      "field.bs": "Blood Sugar (mmol/L)", "field.temp": "Body Temp (°F)", "field.hr": "Heart Rate (bpm)",
      "section.anemia": "1b · Anemia Check",
      "anemia.sub": "If you have a recent hemoglobin (Hb) test result, enter it here for India-specific anemia grading.",
      "field.hb": "Hemoglobin (g/dL)",
      "section.gestation": "1c · Pregnancy Stage",
      "gestation.sub": "If you know your current week, this lets the assessment factor in trimester-specific risks (like preterm labor) and show week-appropriate warning signs.",
      "field.week": "Current gestational week",
      "section.clinicalInputs": "1d · Additional Checks",
      "clinicalInputs.sub": "The trained ML model and symptom check don't cover these on their own - each is a well-established antenatal screening check, not a diagnosis.",
      "field.weight": "Current weight (kg)", "field.fetalMovement": "Fetal movements felt in the last hour",
      "field.fundalHeight": "Fundal height (cm), if measured",
      "section.symptoms": "2 · Symptoms",
      "symptoms.sub": "Tap any that apply — they'll be added to the description below, or type your own.",
      "symptoms.placeholder": "Describe how you're feeling in your own words…",
      "section.history": "3 · History", "history.sub": "Optional — helps weigh background risk factors.",
      "history.past": "Past pregnancy history",
      "hist.csection": "Prior C-section", "hist.preeclampsia": "Prior pre-eclampsia",
      "hist.pph": "Prior postpartum hemorrhage", "hist.stillbirth": "Prior stillbirth/loss",
      "hist.hypertension": "Chronic hypertension", "hist.diabetes": "Pre-existing diabetes",
      "history.current": "Current pregnancy care",
      "hist.anc": "Regular pregnancy check-ups (ANC)", "hist.ifa": "Taking iron/folic supplements",
      "hist.institutional": "Planning institutional delivery", "hist.birthplan": "Has a birth preparedness plan",
      "hist.family": "Supportive family", "hist.noanc": "No pregnancy check-ups so far (ANC)",
      includeEpds: "Include my saved Mental Health Check (EPDS) score in this assessment",
      runAssessment: "Run Assessment",
      riskGauge: "Risk Gauge", mlPrediction: "AI Risk Estimate", dangerLadder: "Warning Sign Check",
      riskFactors: "Risk Factors", static: "Static", dynamic: "Dynamic", protective: "Protective",
      anemiaGrading: "Anemia Grading (India)", psychEval: "Emotional Well-being Screening (EPDS)",
      weightCheck: "Weight Check", fetalMovementCheck: "Fetal Movement Check", fundalHeightCheck: "Fundal Height Check",
      activeRules: "Concerns Identified", recommendations: "Recommendations", clinicalImpression: "Health Assessment",
      newAssessment: "New Assessment", readAloud: "Read Aloud", printReport: "Print Report",
      "wizard.vitals": "Vitals", "wizard.symptoms": "Symptoms", "wizard.history": "History", "wizard.review": "Review",
      "wizard.back": "← Back", "wizard.nextSymptoms": "Next: Symptoms →", "wizard.nextHistory": "Next: History →",
      "wizard.nextReview": "Next: Review →", "wizard.reviewHeading": "4 · Review",
      "wizard.reviewSub": "Check what you're about to submit, then run the assessment.",
      "guide.title": "Pregnancy Guide",
      "guide.sub": "Week-by-week pregnancy check-up (ANC) schedule, nutrition tips, and danger signs — aligned with India's RCH programme.",
      "guide.byLmp": "By last menstrual period (LMP)", "guide.byWeek": "By current week",
      "guide.lmpLabel": "Last menstrual period date", "guide.weekLabel": "Current gestational week",
      "guide.getGuide": "Get My Guide", "guide.ancSchedule": "Pregnancy Check-up Schedule (ANC)",
      "guide.schemes": "Government Schemes",
      "psych.title": "Mental Health Check",
      "psych.sub": "The Edinburgh Postnatal Depression Scale (EPDS) — a validated 10-question screening tool for how you've felt over the past 7 days, used during pregnancy and after birth. This is a screening aid, not a diagnosis.",
      "psych.score": "Score My Mood", "psych.result": "Your Result",
      "trends.title": "Health Trends", "trends.sub": "How your key numbers and risk level have changed across your assessments.",
      "history.title": "Assessment History", clear: "Clear",
      "history.stored": "Stored only in this browser (not sent anywhere).",
      "reports.title": "My Reports",
      "reports.sub": "Upload a prescription or lab report (PDF/TXT), or paste its text, and get a clear medication schedule (what to take, when) and a summary of any values worth discussing with your provider.",
      "reports.uploadLabel": "Upload file (.pdf or .txt)", "reports.pasteLabel": "Paste the report's text",
      "reports.pastePlaceholder": "e.g. Tab. Folic Acid 5mg OD morning, Hemoglobin: 9.2 g/dl…",
      "reports.analyze": "Analyze Report", "reports.summary": "Summary", "reports.schedule": "Medication Schedule",
      "reports.findings": "Key Findings", "reports.preview": "Extracted Text (preview)",
      "reports.confirmTitle": "Add These Values to My Health Record?",
      "reports.confirmSub": "These will show up in your Health Trends alongside your assessments. Nothing is added until you confirm.",
      "reports.confirmBtn": "✓ Add to My Health Record", "reports.confirmSuccess": "Added to your Health Trends.",
      "help.title": "Helplines", "help.ambulance": "Emergency Ambulance",
      "help.transport": "Pregnancy Emergency Transport", "help.national": "National Health Helpline",
      "help.women": "Women's Helpline", "help.child": "Child Helpline",
      "help.mental": "Mental Health Helpline (1800-599-0019)", "help.schemes": "Government Schemes",
      footer: "Automated screening/prioritization aid combining an ML classifier trained on the UCI Maternal Health Risk dataset with a rule-based danger-sign evaluation layer covering physical AND psychological (EPDS) risk. Not a diagnosis.",
      "privacy.footerLink": "🔒 Privacy & Consent Centre",
      "privacy.title": "Privacy & Consent Centre",
      "privacy.intro": "What Janamdatri AI collects, why, who can see it, and how to export or delete it.",
      "privacy.whatTitle": "What data is collected",
      "privacy.what1": "Assessment inputs you enter: vitals, symptom text, hemoglobin, and history flags",
      "privacy.what2": "Your Mental Health Check (EPDS) responses and score",
      "privacy.what3": "Your Nutrition Analysis questionnaire responses and results",
      "privacy.what4": "Messages you send to the Instant Help chat",
      "privacy.what5": "Text from any report/prescription you upload or paste (only while being analyzed - see below)",
      "privacy.what6": "Your name and email, only if you create an account",
      "privacy.whyTitle": "Why it's collected",
      "privacy.why1": "Solely to compute your risk screening, nutrition, and mental-health results, and - if you choose to create an account - to show your own history and trends back to you across visits. Nothing here is used for advertising, and nothing is sold or shared with third parties.",
      "privacy.whoTitle": "Who can access it",
      "privacy.who1": "Guest mode: your inputs are sent to our server only to compute a result, then the result is saved ONLY in your own browser (localStorage) - we do not keep guest data in our database at all.",
      "privacy.who2": "A logged-in account: your assessments, chat messages, and nutrition checks ARE stored in our database, tied to your account, so you can see them across visits/devices. Only your own account (via your login session) can retrieve them - there is no admin dashboard or third party that can browse other users' data in this application.",
      "privacy.who3": "A report you upload/paste is analyzed and the result is returned to you - the original file/text is not separately stored server-side beyond what's needed to process that one request.",
      "privacy.aiTitle": "AI use disclosure",
      "privacy.ai1": "Risk scoring uses a machine-learning classifier trained on the public UCI Maternal Health Risk dataset, combined with rule-based logic (danger-sign phrase matching, expert rules) - all of it runs on this application's own server. No external AI provider or third-party LLM API is called, and none of your data is sent anywhere outside this application to generate a result.",
      "privacy.controlsTitle": "Your controls",
      "privacy.controlsSub": "These act on the data for however you're currently using the app (guest or your logged-in account).",
      "privacy.exportBtn": "⬇ Export My Data (JSON)", "privacy.clearLocalBtn": "🗑 Clear My Local Data",
      "privacy.deleteAccountBtn": "⚠ Delete My Account & All Data",
    },
    hi: {
      tagline: "मातृ जोखिम मूल्यांकन",
      "nav.home": "होम", "nav.assess": "मूल्यांकन", "nav.guide": "गर्भावस्था", "nav.nutrition": "पोषण",
      "nav.psych": "मानसिक स्वास्थ्य", "nav.history": "इतिहास", "nav.reports": "रिपोर्ट", "nav.profile": "प्रोफ़ाइल", "nav.help": "हेल्पलाइन",
      "profile.title": "मेरी गर्भावस्था प्रोफ़ाइल",
      "profile.sub": "इसे एक बार दर्ज करें - यह आपके होम डैशबोर्ड, मूल्यांकन, पोषण लक्ष्यों, एएनसी चेकलिस्ट, और गर्भावस्था गाइड को व्यक्तिगत बनाता है, ताकि आपको हर जगह अपना सप्ताह फिर से दर्ज न करना पड़े।",
      "profile.previousLabel": "क्या यह पिछली गर्भावस्था है?", "profile.previousYes": "हां", "profile.previousNo": "नहीं / पहली गर्भावस्था",
      "profile.conditionsLabel": "मौजूदा चिकित्सा स्थितियां (वैकल्पिक)",
      "profile.conditionsPlaceholder": "उदा. थायरॉइड, मधुमेह, उच्च रक्तचाप - यदि कोई नहीं है तो खाली छोड़ें",
      "profile.saveBtn": "मेरी प्रोफ़ाइल सहेजें", "profile.summaryTitle": "वर्तमान प्रोफ़ाइल",
      "profile.vaccinationLabel": "Td/TT टीकाकरण", "profile.vaccineDose1": "पहली डोज़ दी गई", "profile.vaccineDose2": "दूसरी डोज़ दी गई",
      "home.weekNotSet": "अपना गर्भावस्था सप्ताह सेट करें",
      "home.snapshotTitle": "स्वास्थ्य स्नैपशॉट", "home.nutritionTitle": "पोषण", "home.viewNutrition": "पोषण विश्लेषण देखें →",
      "home.todaysCare": "आज की देखभाल", "home.thisWeek": "इस सप्ताह", "home.urgentAlerts": "आपातकालीन चेतावनी",
      "home.quickActions": "त्वरित कार्य",
      "home.actionAssess": "मूल्यांकन करें", "home.actionGuide": "गर्भावस्था गाइड",
      "home.actionNutrition": "पोषण विश्लेषण",
      "home.actionPsych": "मानसिक स्वास्थ्य जांच", "home.actionReports": "मेरी रिपोर्ट",
      "home.actionChat": "तुरंत सहायता चैट", "home.actionHelp": "हेल्पलाइन", "home.actionProfile": "मेरी गर्भावस्था प्रोफ़ाइल",
      "home.tipLabel": "आज की सलाह",
      "nutrition.title": "पोषण विश्लेषण",
      "nutrition.sub": "बताएं कि आप ये खाद्य समूह कितनी बार खाती हैं, और मैं गर्भावस्था के पोषक तत्वों (आयरन, प्रोटीन, फोलेट, कैल्शियम, B12, विटामिन D, आयोडीन) से आपके सेवन की तुलना करूंगी और कमी को पूरा करने के लिए किफायती भारतीय भोजन सुझाऊंगी। यह लैब टेस्ट नहीं है - अपने ANC प्रदाता या न्यूट्रिशनिस्ट से बातचीत शुरू करने का एक तरीका है।",
      "nutrition.analyze": "मेरे आहार का विश्लेषण करें", "nutrition.result": "आपकी पोषक तत्व पर्याप्तता",
      "home.greetingMorning": "सुप्रभात", "home.greetingAfternoon": "नमस्ते", "home.greetingEvening": "शुभ संध्या",
      emergencyBtn: "🚨 108 पर कॉल करें",
      "a11y.title": "डिस्प्ले सेटिंग्स", "a11y.largeText": "बड़ा टेक्स्ट",
      "a11y.highContrast": "हाई कॉन्ट्रास्ट", "a11y.largeTouch": "बड़े टच टारगेट", "a11y.close": "बंद करें",
      disclaimer: "⚠️ यह केवल एक जांच सहायता है — निदान नहीं। <strong>गंभीर</strong> या <strong>अति गंभीर</strong> परिणाम का मतलब है तुरंत अस्पताल जाएं।",
      "section.vitals": "1 · महत्वपूर्ण संकेत", includeVitals: "Vitals शामिल करें",
      "field.age": "आयु (वर्ष)", "field.sbp": "सिस्टोलिक बीपी", "field.dbp": "डायस्टोलिक बीपी",
      "field.bs": "ब्लड शुगर (mmol/L)", "field.temp": "शरीर का तापमान (°F)", "field.hr": "हृदय गति (bpm)",
      "section.anemia": "1b · एनीमिया जांच",
      "anemia.sub": "यदि आपके पास हाल की हीमोग्लोबिन (Hb) रिपोर्ट है, तो भारत-विशिष्ट एनीमिया ग्रेडिंग के लिए यहां दर्ज करें।",
      "field.hb": "हीमोग्लोबिन (g/dL)",
      "section.gestation": "1c · गर्भावस्था चरण",
      "gestation.sub": "यदि आप अपना वर्तमान सप्ताह जानती हैं, तो मूल्यांकन ट्राइमेस्टर-विशिष्ट जोखिम (जैसे समय-पूर्व प्रसव) को ध्यान में रख सकता है और सप्ताह-उचित चेतावनी संकेत दिखा सकता है।",
      "field.week": "वर्तमान गर्भावधि सप्ताह",
      "section.clinicalInputs": "1d · अतिरिक्त जांच",
      "clinicalInputs.sub": "प्रशिक्षित एआई मॉडल और लक्षण जांच इन्हें अपने आप कवर नहीं करते - हर एक एक स्थापित प्रसवपूर्व जांच है, निदान नहीं।",
      "field.weight": "वर्तमान वज़न (kg)", "field.fetalMovement": "पिछले एक घंटे में महसूस की गई हलचल",
      "field.fundalHeight": "फंडल हाइट (cm), यदि मापी गई हो",
      "section.symptoms": "2 · लक्षण",
      "symptoms.sub": "जो लागू हो उसे टैप करें — यह नीचे विवरण में जुड़ जाएगा, या अपने शब्दों में लिखें।",
      "symptoms.placeholder": "आप कैसा महसूस कर रही हैं, अपने शब्दों में बताएं…",
      "section.history": "3 · इतिहास", "history.sub": "वैकल्पिक — पृष्ठभूमि जोखिम कारकों का आकलन करने में मदद करता है।",
      "history.past": "पिछली गर्भावस्था का इतिहास",
      "hist.csection": "पहले सिजेरियन हुआ था", "hist.preeclampsia": "पहले प्री-एक्लेम्पसिया हुआ था",
      "hist.pph": "पहले प्रसवोत्तर रक्तस्राव हुआ था", "hist.stillbirth": "पहले मृत जन्म/गर्भपात हुआ था",
      "hist.hypertension": "पुराना उच्च रक्तचाप", "hist.diabetes": "पहले से मधुमेह",
      "history.current": "वर्तमान गर्भावस्था देखभाल",
      "hist.anc": "नियमित गर्भावस्था जांच (एएनसी)", "hist.ifa": "आयरन/फोलिक सप्लीमेंट ले रही हूं",
      "hist.institutional": "संस्थागत प्रसव की योजना", "hist.birthplan": "प्रसव-तैयारी योजना है",
      "hist.family": "सहायक परिवार", "hist.noanc": "अभी तक कोई गर्भावस्था जांच (एएनसी) नहीं",
      includeEpds: "मेरा सहेजा गया मानसिक स्वास्थ्य (EPDS) स्कोर इस मूल्यांकन में शामिल करें",
      runAssessment: "मूल्यांकन करें",
      riskGauge: "जोखिम गेज", mlPrediction: "एआई जोखिम अनुमान", dangerLadder: "चेतावनी संकेत जांच",
      riskFactors: "जोखिम कारक", static: "स्थिर", dynamic: "गतिशील", protective: "सुरक्षात्मक",
      anemiaGrading: "एनीमिया ग्रेडिंग (भारत)", psychEval: "भावनात्मक स्वास्थ्य जांच (EPDS)",
      weightCheck: "वज़न जांच", fetalMovementCheck: "भ्रूण हलचल जांच", fundalHeightCheck: "फंडल हाइट जांच",
      activeRules: "पाई गई चिंताएं", recommendations: "सिफारिशें", clinicalImpression: "स्वास्थ्य आकलन",
      newAssessment: "नया मूल्यांकन", readAloud: "ज़ोर से पढ़ें", printReport: "रिपोर्ट प्रिंट करें",
      "wizard.vitals": "वाइटल्स", "wizard.symptoms": "लक्षण", "wizard.history": "इतिहास", "wizard.review": "समीक्षा",
      "wizard.back": "← पीछे", "wizard.nextSymptoms": "अगला: लक्षण →", "wizard.nextHistory": "अगला: इतिहास →",
      "wizard.nextReview": "अगला: समीक्षा →", "wizard.reviewHeading": "4 · समीक्षा",
      "wizard.reviewSub": "जमा करने से पहले अपनी जानकारी जांच लें।",
      "guide.title": "गर्भावस्था गाइड",
      "guide.sub": "साप्ताहिक गर्भावस्था जांच (एएनसी) कार्यक्रम, पोषण सुझाव, और खतरे के संकेत — भारत के RCH कार्यक्रम के अनुसार।",
      "guide.byLmp": "अंतिम मासिक धर्म तिथि (LMP) से", "guide.byWeek": "वर्तमान सप्ताह से",
      "guide.lmpLabel": "अंतिम मासिक धर्म तिथि", "guide.weekLabel": "वर्तमान गर्भावधि सप्ताह",
      "guide.getGuide": "मेरी गाइड प्राप्त करें", "guide.ancSchedule": "गर्भावस्था जांच कार्यक्रम (एएनसी)",
      "guide.schemes": "सरकारी योजनाएं",
      "psych.title": "मानसिक स्वास्थ्य जांच",
      "psych.sub": "एडिनबर्ग प्रसवोत्तर अवसाद स्केल (EPDS) — पिछले 7 दिनों में आप कैसा महसूस कर रही हैं, इसके लिए एक मान्य 10-प्रश्न जांच उपकरण। यह एक जांच सहायता है, निदान नहीं।",
      "psych.score": "मेरा मूड स्कोर करें", "psych.result": "आपका परिणाम",
      "trends.title": "स्वास्थ्य रुझान", "trends.sub": "आपके मूल्यांकनों में आपके प्रमुख आंकड़े और जोखिम स्तर कैसे बदले हैं।",
      "history.title": "मूल्यांकन इतिहास", clear: "साफ़ करें",
      "history.stored": "केवल इस ब्राउज़र में संग्रहीत (कहीं भेजा नहीं जाता)।",
      "reports.title": "मेरी रिपोर्ट",
      "reports.sub": "प्रिस्क्रिप्शन या लैब रिपोर्ट (PDF/TXT) अपलोड करें, या उसका टेक्स्ट पेस्ट करें, और दवा का शेड्यूल (क्या लेना है, कब लेना है) पाएं।",
      "reports.uploadLabel": "फ़ाइल अपलोड करें (.pdf या .txt)", "reports.pasteLabel": "रिपोर्ट का टेक्स्ट पेस्ट करें",
      "reports.pastePlaceholder": "उदा. Tab. Folic Acid 5mg OD morning, Hemoglobin: 9.2 g/dl…",
      "reports.analyze": "रिपोर्ट का विश्लेषण करें", "reports.summary": "सारांश", "reports.schedule": "दवा शेड्यूल",
      "reports.findings": "मुख्य निष्कर्ष", "reports.preview": "निकाला गया टेक्स्ट (पूर्वावलोकन)",
      "reports.confirmTitle": "ये मान मेरे स्वास्थ्य रिकॉर्ड में जोड़ें?",
      "reports.confirmSub": "ये आपके स्वास्थ्य रुझानों में आपके मूल्यांकनों के साथ दिखेंगे। पुष्टि करने तक कुछ भी नहीं जोड़ा जाएगा।",
      "reports.confirmBtn": "✓ मेरे स्वास्थ्य रिकॉर्ड में जोड़ें", "reports.confirmSuccess": "आपके स्वास्थ्य रुझानों में जोड़ दिया गया।",
      "help.title": "हेल्पलाइन", "help.ambulance": "आपातकालीन एम्बुलेंस",
      "help.transport": "गर्भावस्था आपातकालीन परिवहन", "help.national": "राष्ट्रीय स्वास्थ्य हेल्पलाइन",
      "help.women": "महिला हेल्पलाइन", "help.child": "चाइल्ड हेल्पलाइन",
      "help.mental": "मानसिक स्वास्थ्य हेल्पलाइन (1800-599-0019)", "help.schemes": "सरकारी योजनाएं",
      footer: "यूसीआई मातृ स्वास्थ्य जोखिम डेटासेट पर प्रशिक्षित एआई मॉडल और शारीरिक व मानसिक (EPDS) जोखिम को कवर करने वाली नियम-आधारित प्रणाली का संयोजन। यह निदान नहीं है।",
      "privacy.footerLink": "🔒 प्राइवेसी और सहमति केंद्र",
      "privacy.title": "प्राइवेसी और सहमति केंद्र",
      "privacy.intro": "Janamdatri AI क्या एकत्र करता है, क्यों, कौन देख सकता है, और इसे कैसे एक्सपोर्ट या डिलीट करें।",
      "privacy.whatTitle": "कौन सा डेटा एकत्र किया जाता है",
      "privacy.what1": "आपके द्वारा दर्ज मूल्यांकन इनपुट: वाइटल्स, लक्षण टेक्स्ट, हीमोग्लोबिन, और इतिहास फ्लैग",
      "privacy.what2": "आपकी मानसिक स्वास्थ्य जांच (EPDS) प्रतिक्रियाएं और स्कोर",
      "privacy.what3": "आपके पोषण विश्लेषण प्रश्नावली की प्रतिक्रियाएं और परिणाम",
      "privacy.what4": "आपके द्वारा तुरंत सहायता चैट में भेजे गए संदेश",
      "privacy.what5": "आपके द्वारा अपलोड/पेस्ट की गई रिपोर्ट/प्रिस्क्रिप्शन का टेक्स्ट (केवल विश्लेषण के दौरान - नीचे देखें)",
      "privacy.what6": "आपका नाम और ईमेल, केवल यदि आप खाता बनाती हैं",
      "privacy.whyTitle": "यह क्यों एकत्र किया जाता है",
      "privacy.why1": "केवल आपके जोखिम मूल्यांकन, पोषण, और मानसिक स्वास्थ्य परिणामों की गणना के लिए, और यदि आप खाता बनाती हैं, तो आपका अपना इतिहास और रुझान आपको वापस दिखाने के लिए। इसका उपयोग विज्ञापन के लिए नहीं किया जाता, और कुछ भी किसी तीसरे पक्ष को नहीं बेचा या साझा किया जाता।",
      "privacy.whoTitle": "इसे कौन देख सकता है",
      "privacy.who1": "गेस्ट मोड: आपका इनपुट केवल परिणाम की गणना के लिए हमारे सर्वर पर भेजा जाता है, फिर परिणाम केवल आपके अपने ब्राउज़र (localStorage) में सहेजा जाता है - हम गेस्ट डेटा को अपने डेटाबेस में बिल्कुल नहीं रखते।",
      "privacy.who2": "लॉग-इन खाता: आपके मूल्यांकन, चैट संदेश, और पोषण जांच हमारे डेटाबेस में आपके खाते से जुड़े रहते हैं, ताकि आप उन्हें विभिन्न विज़िट/डिवाइस में देख सकें। केवल आपका अपना खाता (आपके लॉगिन सेशन के माध्यम से) उन्हें प्राप्त कर सकता है - इस एप्लिकेशन में कोई एडमिन डैशबोर्ड या तीसरा पक्ष नहीं है जो अन्य उपयोगकर्ताओं का डेटा देख सके।",
      "privacy.who3": "आपके द्वारा अपलोड/पेस्ट की गई रिपोर्ट का विश्लेषण किया जाता है और परिणाम आपको वापस दिया जाता है - मूल फ़ाइल/टेक्स्ट को उस एक रिक्वेस्ट को प्रोसेस करने के अलावा सर्वर पर अलग से संग्रहीत नहीं किया जाता।",
      "privacy.aiTitle": "एआई उपयोग प्रकटीकरण",
      "privacy.ai1": "जोखिम स्कोरिंग सार्वजनिक UCI मातृ स्वास्थ्य जोखिम डेटासेट पर प्रशिक्षित एक मशीन-लर्निंग मॉडल का उपयोग करती है, नियम-आधारित लॉजिक (खतरे के संकेत वाक्यांश मिलान, विशेषज्ञ नियम) के साथ मिलाकर - यह सब इस एप्लिकेशन के अपने सर्वर पर चलता है। कोई बाहरी एआई प्रदाता या तीसरे पक्ष का LLM API कॉल नहीं किया जाता, और परिणाम बनाने के लिए आपका कोई भी डेटा इस एप्लिकेशन के बाहर कहीं नहीं भेजा जाता।",
      "privacy.controlsTitle": "आपके नियंत्रण",
      "privacy.controlsSub": "ये आपके वर्तमान उपयोग (गेस्ट या आपका लॉग-इन खाता) के डेटा पर कार्य करते हैं।",
      "privacy.exportBtn": "⬇ मेरा डेटा एक्सपोर्ट करें (JSON)", "privacy.clearLocalBtn": "🗑 मेरा लोकल डेटा साफ़ करें",
      "privacy.deleteAccountBtn": "⚠ मेरा खाता और सभी डेटा हटाएं",
    },
  };

  let currentLang = localStorage.getItem(LANG_KEY) || "en";

  function applyTranslations() {
    const dict = TRANSLATIONS[currentLang];
    $$("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (dict[key] !== undefined) el.innerHTML = dict[key];
    });
    $$("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (dict[key] !== undefined) el.placeholder = dict[key];
    });
    $$(".chip").forEach((chip) => {
      const label = currentLang === "hi" ? chip.dataset.labelHi : chip.dataset.labelEn;
      if (label) chip.textContent = label;
    });
    $("#lang-toggle").textContent = currentLang === "hi" ? "English" : "हिंदी";
    document.documentElement.lang = currentLang;
  }

  $("#lang-toggle").addEventListener("click", () => {
    currentLang = currentLang === "hi" ? "en" : "hi";
    localStorage.setItem(LANG_KEY, currentLang);
    applyTranslations();
    renderHome();
  });

  applyTranslations();

  // ==================================================================
  // Accessibility settings - a device/browser preference, not per-
  // account data, so this is intentionally the one UI setting stored
  // UNSCOPED (not run through scopedKey()) - it should stay the same
  // regardless of which account is logged in on this device.
  // ==================================================================

  const A11Y_SETTINGS_KEY = "janamdatri_a11y_settings";

  function loadA11ySettings() {
    try { return JSON.parse(localStorage.getItem(A11Y_SETTINGS_KEY)) || {}; } catch { return {}; }
  }

  function applyA11ySettings(settings) {
    document.documentElement.classList.toggle("a11y-large-text", !!settings.largeText);
    document.documentElement.classList.toggle("a11y-high-contrast", !!settings.highContrast);
    document.documentElement.classList.toggle("a11y-large-touch", !!settings.largeTouch);
    $("#a11y-large-text").checked = !!settings.largeText;
    $("#a11y-high-contrast").checked = !!settings.highContrast;
    $("#a11y-large-touch").checked = !!settings.largeTouch;
  }

  function saveA11ySettings(settings) {
    try { localStorage.setItem(A11Y_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* non-fatal */ }
  }

  applyA11ySettings(loadA11ySettings());

  $("#a11y-toggle-btn").addEventListener("click", () => {
    $("#a11y-panel").hidden = !$("#a11y-panel").hidden;
  });
  $("#a11y-close-btn").addEventListener("click", () => { $("#a11y-panel").hidden = true; });

  [["a11y-large-text", "largeText"], ["a11y-high-contrast", "highContrast"], ["a11y-large-touch", "largeTouch"]]
    .forEach(([elId, settingKey]) => {
      $("#" + elId).addEventListener("change", () => {
        const settings = loadA11ySettings();
        settings[settingKey] = $("#" + elId).checked;
        saveA11ySettings(settings);
        applyA11ySettings(settings);
      });
    });

  // ==================================================================
  // Navigation
  // ==================================================================

  function showView(id) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === id));
    $$(".navlink").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === id));
  }

  $$(".navlink").forEach((btn) => btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "history-view") renderHistory();
    if (btn.dataset.view === "home-view") renderHome();
    if (btn.dataset.view === "assess-view") prefillPregnancyWeek();
    if (btn.dataset.view === "profile-view") prefillProfileForm();
  }));

  // ==================================================================
  // Home Dashboard
  // ==================================================================

  const TIPS = {
    en: [
      "Take your iron/folic acid tablet at the same time every day — it's easier to remember with a meal.",
      "Drink plenty of water and eat fibre-rich foods to help with pregnancy constipation.",
      "Kick counts matter — get to know your baby's usual movement pattern so you notice if it changes.",
      "Rest on your left side when lying down — it improves blood flow to the baby.",
      "Never skip an ANC visit, even if you're feeling fine — many risks show no symptoms early on.",
      "Keep your maternal health (MCP) card and any lab reports together and easy to find.",
      "It's normal to have mixed emotions during pregnancy — the Mental Health Check is here whenever you need it.",
    ],
    hi: [
      "हर दिन एक ही समय पर आयरन/फोलिक एसिड टैबलेट लें — भोजन के साथ याद रखना आसान होता है।",
      "पर्याप्त पानी पिएं और फाइबर युक्त भोजन खाएं ताकि गर्भावस्था में कब्ज़ की समस्या न हो।",
      "बच्चे की हलचल पर ध्यान दें — सामान्य पैटर्न जानना जरूरी है ताकि बदलाव तुरंत पता चल सके।",
      "लेटते समय बाईं करवट लेटें — इससे बच्चे तक रक्त प्रवाह बेहतर होता है।",
      "कभी भी एएनसी जांच न छोड़ें, भले ही आप ठीक महसूस कर रही हों — कई जोखिमों के शुरुआती लक्षण नहीं दिखते।",
      "अपना मातृ स्वास्थ्य (MCP) कार्ड और लैब रिपोर्ट एक साथ और आसानी से मिल सकें ऐसी जगह रखें।",
      "गर्भावस्था के दौरान मिश्रित भावनाएं होना सामान्य है — जब भी जरूरत हो, मानसिक स्वास्थ्य जांच यहां उपलब्ध है।",
    ],
  };

  function dayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }

  function saveLastGuide(guide) {
    // Stores the FULL guide (trimester, note, nutrition tips, danger signs,
    // next ANC visit) - not just the week - so the Home dashboard's "This
    // Week" section can render real content without an extra round trip.
    try { localStorage.setItem(scopedKey(GUIDE_KEY), JSON.stringify({ ...guide, savedAt: new Date().toISOString() })); } catch { /* non-fatal */ }
  }

  function loadLastGuide() {
    try { return JSON.parse(localStorage.getItem(scopedKey(GUIDE_KEY))); } catch { return null; }
  }

  // Collapses the 5-level clinical severity scale into the simple
  // green/yellow/red read a "command centre" home screen needs at a
  // glance - the full explanation still lives on the assessment result.
  function riskPillInfo(level) {
    if (level === "Critical" || level === "Severe") return { cls: "risk-high", label: "🔴 HIGH" };
    if (level === "Moderate") return { cls: "risk-moderate", label: "🟡 MODERATE" };
    if (level === "Mild" || level === "Minimal") return { cls: "risk-low", label: "🟢 LOW" };
    return { cls: "", label: "—" };
  }

  function vitalStatusPill(value, isNormal) {
    return `<span class="snapshot-status ${isNormal ? "status-normal" : "status-attention"}">${isNormal ? "Normal" : "Needs Attention"}</span>`;
  }

  function renderHealthSnapshot(history) {
    const container = $("#home-snapshot");
    const latestWithVitals = history.find((h) => h.result && h.result.vitalsInput);
    const latestWithHb = history.find((h) => h.result && h.result.hemoglobinAssessment);

    if (!latestWithVitals && !latestWithHb) {
      container.innerHTML = `<p class="snapshot-empty">No vitals recorded yet - run an Assessment to see your snapshot here.</p>`;
      return;
    }

    const tiles = [];
    if (latestWithVitals) {
      const v = latestWithVitals.result.vitalsInput;
      const bpNormal = v.SystolicBP < 140 && v.DiastolicBP < 90;
      tiles.push(`<div class="snapshot-tile"><div class="snapshot-label">Blood Pressure</div><div class="snapshot-value">${v.SystolicBP}/${v.DiastolicBP} mmHg</div>${vitalStatusPill(null, bpNormal)}</div>`);
      const bsNormal = v.BS <= 7.8;
      tiles.push(`<div class="snapshot-tile"><div class="snapshot-label">Blood Sugar</div><div class="snapshot-value">${v.BS} mmol/L</div>${vitalStatusPill(null, bsNormal)}</div>`);
      const hrNormal = v.HeartRate >= 60 && v.HeartRate <= 100;
      tiles.push(`<div class="snapshot-tile"><div class="snapshot-label">Heart Rate</div><div class="snapshot-value">${v.HeartRate} bpm</div>${vitalStatusPill(null, hrNormal)}</div>`);
    }
    if (latestWithHb) {
      const hb = latestWithHb.result.hemoglobinAssessment;
      tiles.push(`<div class="snapshot-tile"><div class="snapshot-label">Hemoglobin</div><div class="snapshot-value">${hb.hemoglobin} g/dL</div>${vitalStatusPill(null, hb.grade === "Normal")}</div>`);
    }
    container.innerHTML = tiles.join("");
  }

  function renderNutritionMiniBars() {
    const saved = loadSavedNutrition();
    const barsEl = $("#home-nutrition-bars");
    const gapsTextEl = $("#home-nutrition-gaps-text");
    if (!saved) {
      barsEl.innerHTML = "";
      gapsTextEl.textContent = "No nutrition check yet - tap above to get started.";
      return;
    }
    const shown = ["Iron", "Protein", "Calcium", "Folate"];
    barsEl.innerHTML = shown.map((name) => {
      const n = saved.result.nutrients[name];
      return `<div class="mini-bar-row">
        <span class="mini-bar-label">${name}</span>
        <span class="mini-bar-track"><span class="mini-bar-fill" style="width:${n.percent}%;background:${NUTRIENT_STATUS_COLOR[n.status]}"></span></span>
        <span>${n.status}</span>
      </div>`;
    }).join("");
    const gapCount = saved.result.gaps.length;
    gapsTextEl.textContent = gapCount
      ? `${gapCount} possible nutritional gap${gapCount > 1 ? "s" : ""} found`
      : "All tracked nutrients look adequate.";
  }

  // Today's Care: two daily habits that reset each day, plus a couple of
  // longer-lived reminders that stay checked until the person unchecks
  // them (an ANC visit or a weekly warning-signs review isn't a "daily"
  // task) - and one auto-derived item that just reflects real state
  // (has a nutrition check actually been done) rather than being another
  // manual box to tick.
  const TODAY_CARE_KEY = "janamdatri_today_care";
  const DAILY_RESET_TASK_IDS = new Set(["supplement", "hydration"]);

  function todayDateStr() { return new Date().toISOString().slice(0, 10); }

  function loadTodayCareState() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(scopedKey(TODAY_CARE_KEY))); } catch { raw = null; }
    if (!raw) return { date: todayDateStr(), checked: {} };
    if (raw.date !== todayDateStr()) {
      const kept = {};
      Object.keys(raw.checked || {}).forEach((id) => { if (!DAILY_RESET_TASK_IDS.has(id)) kept[id] = raw.checked[id]; });
      return { date: todayDateStr(), checked: kept };
    }
    return raw;
  }

  function saveTodayCareState(state) {
    try { localStorage.setItem(scopedKey(TODAY_CARE_KEY), JSON.stringify(state)); } catch { /* non-fatal */ }
  }

  // Builds a checklist that actually changes with pregnancy stage and with
  // the person's own last result, instead of a fixed generic list: each
  // check due at the upcoming ANC visit becomes its own line item (not one
  // bundled "ANC follow-up"), a flagged nutrition gap names the specific
  // nutrients instead of a generic reminder, and an escalated last
  // assessment or a raised Mental Health Check score adds a targeted
  // follow-up task that a fixed list could never know to add.
  function buildTodayCareTasks(history) {
    const guide = loadLastGuide();
    const nutrition = loadSavedNutrition();
    const latest = history && history[0];

    const tasks = [
      { id: "supplement", text: "Take your prescribed iron-folic acid supplement", manual: true },
      { id: "hydration", text: "Stay hydrated through the day", manual: true },
    ];

    if (nutrition && nutrition.result.gaps.length) {
      tasks.push({ id: "nutrition_gaps", text: `Address nutrition gaps: ${nutrition.result.gaps.join(", ")}`, manual: true });
    } else {
      tasks.push({ id: "nutrition_check", text: "Complete your nutrition check", manual: false, done: !!nutrition });
    }

    if (guide && guide.nextAncVisit) {
      guide.nextAncVisit.checks.forEach((check, i) => {
        tasks.push({ id: `anc_${guide.nextAncVisit.visit}_${i}`, text: `${check} (Visit ${guide.nextAncVisit.visit}, ${guide.nextAncVisit.window})`, manual: true });
      });
    }

    // Td/TT dose 1 is typically due once the second trimester starts; dose
    // 2 a few weeks after that - only nudge once it's actually relevant to
    // the recorded week, not for someone who hasn't set a week at all.
    const profileExtra = loadProfileExtra();
    if (guide && guide.week >= 14 && !(profileExtra && profileExtra.vaccineDose1)) {
      tasks.push({ id: "vaccine_dose1_due", text: "Td/TT vaccine dose 1 due", manual: false, done: false });
    } else if (guide && guide.week >= 18 && profileExtra && profileExtra.vaccineDose1 && !profileExtra.vaccineDose2) {
      tasks.push({ id: "vaccine_dose2_due", text: "Td/TT vaccine dose 2 due", manual: false, done: false });
    }

    if (latest && latest.result && latest.result.severity) {
      const sev = latest.result.severity;
      if (sev.level === "Critical" || sev.level === "Severe") {
        const reason = sev.escalatedBy ? sev.escalatedBy.replace(/_/g, " ") : sev.level.toLowerCase();
        tasks.push({ id: "followup_escalation", text: `Follow up with your provider on your last result (${reason})`, manual: true });
      }
    }
    const psychResult = latest && latest.result && latest.result.psychologicalEvaluation;
    if (psychResult && psychResult.classification !== "Low probability") {
      tasks.push({ id: "followup_mental_health", text: "Follow up on your Mental Health Check result", manual: true });
    }

    // A real follow-up loop, not a one-time score: this resolves itself
    // the moment the person actually retakes the check (which resets
    // savedAt), rather than needing to be manually dismissed.
    const savedEpds = loadSavedEpds();
    if (epdsFollowUpDue(savedEpds)) {
      tasks.push({
        id: "epds_followup_due",
        text: `Time for a Mental Health Check follow-up (last check: ${savedEpds.result.classification}, ${epdsDaysSince(savedEpds)} days ago)`,
        manual: false, done: false,
      });
    }

    tasks.push({ id: "warning_signs_review", text: "Review this week's warning signs", manual: true });
    return tasks;
  }

  function renderTodayCare(history) {
    const state = loadTodayCareState();
    const tasks = buildTodayCareTasks(history);
    const container = $("#home-today-care");
    container.innerHTML = tasks.map((t) => {
      const checked = t.manual ? !!state.checked[t.id] : !!t.done;
      return `<div class="today-care-item ${checked ? "checked" : ""}" data-task-id="${t.id}" data-manual="${t.manual}">
        <input type="checkbox" ${checked ? "checked" : ""} ${t.manual ? "" : "disabled"} />
        <span>${t.text}</span>
      </div>`;
    }).join("");

    container.querySelectorAll(".today-care-item[data-manual='true']").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.taskId;
        const s = loadTodayCareState();
        s.checked[id] = !s.checked[id];
        s.date = todayDateStr();
        saveTodayCareState(s);
        renderTodayCare(history);
      });
    });
  }

  // Shared by the Home dashboard's compact "This Week" card and the
  // Pregnancy Guide's fuller timeline view - same real trimester content
  // (pregnancy_guide.py), just rendered into different containers with
  // distinct element ids (idPrefix) so both can exist in the DOM at once.
  function renderThisWeekInto(containerSelector, idPrefix, guide) {
    const container = $(containerSelector);
    if (!guide) {
      container.innerHTML = `<p class="footnote">Set your pregnancy week to see week-specific guidance here.</p>`;
      return;
    }
    const sections = [
      { id: "mother", label: "Mother's Health", detail: `<p>${guide.note}</p>` },
      { id: "nutrition", label: "Nutrition Tips", detail: `<ul>${guide.nutrition.map((n) => `<li>${n}</li>`).join("")}</ul>` },
      { id: "tests", label: "Tests & Checkups", detail: `<ul>${guide.nextAncVisit.checks.map((c) => `<li>${c}</li>`).join("")}</ul>` },
      { id: "warning", label: "Warning Signs", detail: `<ul>${guide.dangerSigns.map((d) => `<li>${d}</li>`).join("")}</ul>` },
    ];
    container.innerHTML = sections.map((s) => `
      <button type="button" class="this-week-item" data-target="${idPrefix}-detail-${s.id}"><span>${s.label}</span><span>→</span></button>
      <div class="this-week-detail" id="${idPrefix}-detail-${s.id}">${s.detail}</div>`).join("");
    container.querySelectorAll(".this-week-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(btn.dataset.target).classList.toggle("open");
      });
    });
  }

  function renderThisWeek() {
    renderThisWeekInto("#home-this-week", "home-week", loadLastGuide());
  }

  function renderHomeAlerts(history) {
    const card = $("#home-alerts-card");
    const content = $("#home-alerts-content");
    const latest = history[0];
    const isDanger = latest && (latest.severityLevel === "Critical" || latest.severityLevel === "Severe");
    const selfHarm = latest && latest.result && latest.result.psychologicalEvaluation && latest.result.psychologicalEvaluation.selfHarmFlagged;

    if (isDanger || selfHarm) {
      card.classList.add("has-alert");
      content.innerHTML = `
        <div class="home-alert-danger">🚨 Your last assessment (${latest.severityLevel}) flagged something that needs prompt attention.</div>
        <div class="action-grid" style="margin-top:10px;">
          <a class="action-card" href="tel:108"><span class="action-icon">🚨</span><span>Call 108</span></a>
          <button type="button" class="action-card" data-goto-view="help-view"><span class="action-icon">📞</span><span>View Helplines</span></button>
        </div>`;
    } else {
      card.classList.remove("has-alert");
      content.innerHTML = `
        <p class="home-alert-ok">✓ No current emergency signs</p>
        <button type="button" class="link-btn" data-goto-view="guide-view">View Warning Signs →</button>`;
    }
    content.querySelectorAll("[data-goto-view]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.gotoView));
    });
  }

  // A danger sign shouldn't only be visible on the Home tab - this banner
  // is sticky under the top bar on EVERY view for as long as the most
  // recent result is unresolved (Critical/Severe, or a self-harm flag).
  // Dismissing hides it for THIS specific result (tracked by its
  // timestamp); a session-only choice, not a persistent one, so a fresh
  // page load still shows it if nothing has actually changed.
  async function checkGlobalEmergencyBanner() {
    const banner = $("#global-emergency-banner");
    const serverHistory = await loadServerHistory();
    const history = serverHistory !== null ? serverHistory : loadHistory();
    const latest = history[0];
    const isDanger = latest && (latest.severityLevel === "Critical" || latest.severityLevel === "Severe");
    const assessSelfHarm = !!(latest && latest.result && latest.result.psychologicalEvaluation && latest.result.psychologicalEvaluation.selfHarmFlagged);

    // The standalone Mental Health Check (psych-view) never creates an
    // assessment-history entry, so a self-harm flag from THAT flow has to
    // be checked separately - otherwise a real safety signal from the
    // most common entry point to EPDS would never trigger this banner.
    const savedEpds = loadSavedEpds();
    const standaloneSelfHarm = !!(savedEpds && savedEpds.result && savedEpds.result.selfHarmFlagged);
    const selfHarm = assessSelfHarm || standaloneSelfHarm;

    if (!isDanger && !selfHarm) {
      banner.hidden = true;
      return;
    }

    const dismissKey = `${latest ? latest.timestamp : ""}|${savedEpds ? savedEpds.savedAt : ""}`;
    let dismissedFor = null;
    try { dismissedFor = sessionStorage.getItem(scopedKey(EMERGENCY_BANNER_DISMISSED_KEY)); } catch { /* non-fatal */ }
    if (dismissedFor === dismissKey) {
      banner.hidden = true;
      return;
    }

    banner.hidden = false;
    banner.dataset.dismissKey = dismissKey;
    $("#global-emergency-text").textContent = selfHarm
      ? "🚨 A Mental Health Check flagged thoughts of self-harm - please reach out to someone you trust or KIRAN (1800-599-0019) now."
      : `🚨 Your last assessment (${latest.severityLevel}) flagged something that needs prompt attention.`;
  }

  $("#global-emergency-dismiss").addEventListener("click", () => {
    const banner = $("#global-emergency-banner");
    try { sessionStorage.setItem(scopedKey(EMERGENCY_BANNER_DISMISSED_KEY), banner.dataset.dismissKey || ""); } catch { /* non-fatal */ }
    banner.hidden = true;
  });

  $("#global-emergency-view-btn").addEventListener("click", () => {
    showView("history-view");
    renderHistory();
  });

  async function renderHome() {
    const user = getSavedUser();
    const hour = new Date().getHours();
    const greetingKey = hour < 12 ? "home.greetingMorning" : hour < 17 ? "home.greetingAfternoon" : "home.greetingEvening";
    const name = user ? (user.name || user.email.split("@")[0]) : "";
    $("#home-greeting").textContent = TRANSLATIONS[currentLang][greetingKey] + (name ? ", " + name : "") + " 👋";

    const lastGuide = loadLastGuide();
    const weekBadge = $("#home-week-badge");
    const trimesterLabel = $("#home-trimester-label");
    const progressTrack = $("#home-progress-track");
    if (lastGuide) {
      weekBadge.textContent = `${lastGuide.week} WEEKS PREGNANT`;
      trimesterLabel.textContent = ["", "1st", "2nd", "3rd"][lastGuide.trimester] + " Trimester";
      progressTrack.hidden = false;
      $("#home-progress-fill").style.width = `${Math.min((lastGuide.week / 40) * 100, 100)}%`;
    } else {
      weekBadge.textContent = "Set your pregnancy week";
      trimesterLabel.textContent = "";
      progressTrack.hidden = true;
    }

    const serverHistory = await loadServerHistory();
    const history = serverHistory !== null ? serverHistory : loadHistory();
    const riskPill = $("#home-risk-pill");
    if (history.length) {
      const info = riskPillInfo(history[0].severityLevel);
      riskPill.textContent = info.label;
      riskPill.className = "home-risk-pill " + info.cls;
    } else {
      riskPill.textContent = "No data yet";
      riskPill.className = "home-risk-pill";
    }

    renderHealthSnapshot(history);
    renderNutritionMiniBars();
    renderTodayCare(history);
    renderThisWeek();
    renderHomeAlerts(history);

    const tips = TIPS[currentLang] || TIPS.en;
    $("#home-tip-text").textContent = tips[dayOfYear() % tips.length];
  }

  $$("[data-goto-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.gotoView);
      if (btn.dataset.gotoView === "history-view") renderHistory();
      if (btn.dataset.gotoView === "psych-view" && !$("#epds-form").children.length) renderEpdsForm();
      if (btn.dataset.gotoView === "nutrition-view" && !$("#nutrition-form").children.length) renderNutritionForm();
      if (btn.dataset.gotoView === "assess-view") prefillPregnancyWeek();
      if (btn.dataset.gotoView === "profile-view") prefillProfileForm();
    });
  });

  $("#home-chat-action").addEventListener("click", () => chatFab.click());

  renderHome();
  checkGlobalEmergencyBanner();

  // ==================================================================
  // Vitals enable toggle
  // ==================================================================

  const vitalsEnable = $("#vitals-enable");
  const vitalsGrid = $("#vitals-grid");

  function syncVitalsEnabled() {
    const enabled = vitalsEnable.checked;
    vitalsGrid.style.opacity = enabled ? "1" : "0.45";
    $$("#vitals-grid input").forEach((inp) => (inp.disabled = !enabled));
  }
  vitalsEnable.addEventListener("change", syncVitalsEnabled);
  syncVitalsEnabled();

  // ==================================================================
  // Voice input - Web Speech API, feature-detected. No backend change:
  // this only fills a text field the same way typing would, so every
  // existing danger-sign/chat pathway reads it identically either way.
  // ==================================================================

  function attachVoiceInput(buttonEl, targetEl, onResult) {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      buttonEl.disabled = true;
      buttonEl.title = currentLang === "hi" ? "इस ब्राउज़र में वॉइस इनपुट समर्थित नहीं है।" : "Voice input isn't supported in this browser.";
      return;
    }

    let recognition = null;
    let listening = false;

    function stopListening() {
      listening = false;
      buttonEl.classList.remove("listening");
      buttonEl.textContent = "🎤";
    }

    buttonEl.addEventListener("click", () => {
      if (listening) {
        if (recognition) recognition.stop();
        return;
      }
      recognition = new SpeechRecognitionCtor();
      recognition.lang = currentLang === "hi" ? "hi-IN" : "en-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        listening = true;
        buttonEl.classList.add("listening");
        buttonEl.textContent = "🔴";
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (onResult) onResult(transcript);
        else {
          const current = targetEl.value.trim();
          targetEl.value = current ? current.replace(/\.?\s*$/, ". ") + transcript : transcript;
        }
      };
      recognition.onerror = stopListening;
      recognition.onend = stopListening;
      recognition.start();
    });
  }

  attachVoiceInput($("#symptom-mic-btn"), $("#symptom-text"));

  // ==================================================================
  // Symptom chips (bilingual)
  // ==================================================================

  const symptomText = $("#symptom-text");

  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const phrase = currentLang === "hi" ? chip.dataset.phraseHi : chip.dataset.phraseEn;
      const current = symptomText.value;
      const already = current.includes(phrase);

      if (already) {
        symptomText.value = current.replace(phrase, "").replace(/\.\s*\./g, ".").trim();
        chip.classList.remove("selected");
      } else {
        symptomText.value = current ? current.trim().replace(/\.?$/, ". ") + phrase : phrase;
        chip.classList.add("selected");
      }
    });
  });

  // ==================================================================
  // Main assessment form submit
  // ==================================================================

  const form = $("#assess-form");
  const submitBtn = $("#submit-btn");
  const errorMsg = $("#form-error");

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.querySelector(".spinner").hidden = !loading;
    submitBtn.querySelector(".btn-label").textContent = loading
      ? (currentLang === "hi" ? "आकलन हो रहा है…" : "Assessing…")
      : TRANSLATIONS[currentLang].runAssessment;
  }

  function collectHistoryFlags() {
    const flags = {};
    $$("[data-flag]").forEach((el) => {
      if (el.checked) flags[el.dataset.flag] = true;
    });
    return flags;
  }

  function collectVitals() {
    if (!vitalsEnable.checked) return null;
    if ($$("#vitals-grid input").some((inp) => inp.value.trim() === "")) return null;
    return {
      Age: Number($("#v-age").value),
      SystolicBP: Number($("#v-sbp").value),
      DiastolicBP: Number($("#v-dbp").value),
      BS: Number($("#v-bs").value),
      BodyTemp: Number($("#v-temp").value),
      HeartRate: Number($("#v-hr").value),
    };
  }

  function syncEpdsIncludeVisibility() {
    const saved = loadSavedEpds();
    $("#epds-include-section").hidden = !saved;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.hidden = true;

    const vitalsErr = vitalsValidationError();
    if (vitalsErr) {
      errorMsg.textContent = vitalsErr;
      errorMsg.hidden = false;
      goToWizardStep(1);
      return;
    }

    const text = symptomText.value.trim();
    const vitals = collectVitals();
    const history = collectHistoryFlags();
    const hbVal = $("#v-hb").value;
    const hemoglobin = hbVal ? Number(hbVal) : null;
    const weekVal = $("#v-week").value;
    const pregnancyWeek = weekVal ? Number(weekVal) : null;
    const weightVal = $("#v-weight").value;
    const weight = weightVal ? Number(weightVal) : null;
    const previousWeight = weight != null ? lastKnownWeight() : null;
    const fetalMovementVal = $("#v-fetal-movement").value;
    const fetalMovementCount = fetalMovementVal ? Number(fetalMovementVal) : null;
    const fundalHeightVal = $("#v-fundal-height").value;
    const fundalHeight = fundalHeightVal ? Number(fundalHeightVal) : null;

    const savedEpds = loadSavedEpds();
    const includeEpds = savedEpds && $("#include-epds").checked;
    const epdsResponses = includeEpds ? savedEpds.responses : null;

    if (!text && !vitals && hemoglobin === null && !epdsResponses && weight === null && fetalMovementCount === null && fundalHeight === null) {
      errorMsg.textContent = currentLang === "hi"
        ? "मूल्यांकन चलाने से पहले Vitals, लक्षण, हीमोग्लोबिन, वज़न, हलचल, फंडल हाइट या EPDS में से कुछ दर्ज करें।"
        : "Provide vitals, symptoms, hemoglobin, weight, fetal movement, fundal height, or an EPDS score before running an assessment.";
      errorMsg.hidden = false;
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          text: text || null, vitals, history, hemoglobin, epdsResponses, pregnancyWeek,
          weight, previousWeight, fetalMovementCount, fundalHeight,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail || "Assessment failed.");
      renderResult(payload.data);
      saveToHistory(payload.data);
      checkGlobalEmergencyBanner();
      $("#results").hidden = false;
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      errorMsg.textContent = err.message || "Something went wrong. Is the API running?";
      errorMsg.hidden = false;
    } finally {
      setLoading(false);
    }
  });

  // ==================================================================
  // Result rendering
  // ==================================================================

  const SEVERITY_COLOR = {
    Critical: "#c23b2e", Severe: "#d9713f", Moderate: "#c98a1a", Mild: "#2f8f5f", Minimal: "#2f8f5f",
  };

  let lastResult = null;

  function animateGaugeValue(target) {
    const el = $("#gauge-value");
    const start = 0;
    const duration = 600;
    const startTime = performance.now();
    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      el.textContent = Math.round(start + (target - start) * progress);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderResult(data) {
    lastResult = data;
    const { severity, mri, mlPrediction, dangerLadder, riskFormulation, activeExpertRules,
      recommendations, hemoglobinAssessment, psychologicalEvaluation, clinicalImpression,
      clinicalExplanation, gestationalContext, weightAssessment, fetalMovementAssessment, fundalHeightAssessment } = data;

    $("#referral-summary-card").hidden = true;

    const banner = $("#severity-banner");
    banner.className = "severity-banner level-" + severity.level.toLowerCase();
    $("#severity-emoji").textContent = severity.emoji;
    $("#severity-level").textContent = severity.level;
    $("#severity-sub").textContent =
      `Maternal Risk Index: ${mri}` + (severity.escalatedBy ? ` · escalated by: ${severity.escalatedBy.replace(/_/g, " ")}` : "");

    if (clinicalExplanation) {
      const tierPill = $("#action-tier-pill");
      tierPill.textContent = clinicalExplanation.actionTierLabel;
      tierPill.className = "action-tier-pill tier-" + clinicalExplanation.actionTier.toLowerCase();
      $("#action-instruction").textContent = clinicalExplanation.recommendedNextAction;

      const ctaRow = $("#explain-cta-row");
      if (clinicalExplanation.actionTier === "Emergency") {
        ctaRow.innerHTML = `
          <a class="cta-btn cta-emergency" href="tel:108">🚨 Call 108</a>
          <a class="cta-btn cta-emergency" href="tel:102">🚑 Call 102</a>
          <button type="button" class="cta-btn cta-secondary" data-goto-view="help-view">View Emergency Info →</button>
          <button type="button" class="cta-btn cta-secondary" id="explain-referral-btn">📋 Generate Referral Summary</button>`;
      } else if (clinicalExplanation.actionTier === "Urgent") {
        ctaRow.innerHTML = `
          <button type="button" class="cta-btn cta-urgent" data-goto-view="help-view">📞 Find a Healthcare Professional →</button>
          <button type="button" class="cta-btn cta-secondary" id="explain-referral-btn">📋 Generate Referral Summary</button>`;
      } else {
        ctaRow.innerHTML = "";
      }
      ctaRow.querySelectorAll("[data-goto-view]").forEach((btn) => {
        btn.addEventListener("click", () => showView(btn.dataset.gotoView));
      });
      const referralBtn = $("#explain-referral-btn");
      if (referralBtn) referralBtn.addEventListener("click", () => renderReferralSummary(data));

      $("#explain-why").innerHTML = clinicalExplanation.whyThisResult.map((w) => `<li>${w}</li>`).join("");
      const warningGroup = $("#explain-warning-group");
      if (clinicalExplanation.warningSigns.length) {
        warningGroup.hidden = false;
        $("#explain-warning-signs").innerHTML = clinicalExplanation.warningSigns
          .map((w) => `<span class="tag dynamic-tag">${w.replace(/_/g, " ")}</span>`).join("");
      } else {
        warningGroup.hidden = true;
      }
      $("#explain-disclaimer").textContent = clinicalExplanation.disclaimer;
    }

    const gestationCard = $("#gestation-card");
    if (gestationalContext) {
      gestationCard.hidden = false;
      const g = gestationalContext;
      $("#gestation-content").innerHTML = `
        <div class="epds-total-display"><span class="big">${g.week}</span><span>weeks · Trimester ${g.trimester}</span></div>
        ${g.pretermLaborAlert ? `<div class="self-harm-alert">⚠️ Labor signs were reported before 37 weeks - this needs immediate facility evaluation, not waiting to see if it settles.</div>` : ""}
        <p>${g.note}</p>
        <p><strong>Watch for at this stage:</strong></p>
        <ul class="recs-list danger">${g.dangerSigns.map((d) => `<li>${d}</li>`).join("")}</ul>
        <p class="footnote">Next ANC visit: Visit ${g.nextAncVisit.visit} (${g.nextAncVisit.window})</p>`;
    } else {
      gestationCard.hidden = true;
    }

    const frac = Math.max(0, Math.min(mri, 100)) / 100;
    const fill = $("#gauge-fill");
    fill.style.stroke = SEVERITY_COLOR[severity.level] || "#2f8f5f";
    fill.style.strokeDasharray = `${frac * GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`;
    animateGaugeValue(mri);

    const mlBars = $("#ml-bars");
    mlBars.innerHTML = "";
    if (mlPrediction) {
      $("#ml-model-name").textContent = mlPrediction.modelName.replace(/_/g, " ");
      const order = [["low risk", "#2f8f5f"], ["mid risk", "#c98a1a"], ["high risk", "#c23b2e"]];
      order.forEach(([label, color]) => {
        const pct = Math.round((mlPrediction.probabilities[label] || 0) * 100);
        const row = document.createElement("div");
        row.className = "ml-bar-row";
        row.innerHTML = `
          <span class="ml-bar-label">${label.replace(" risk", "")}</span>
          <span class="ml-bar-track"><span class="ml-bar-fill" style="width:${pct}%;background:${color}"></span></span>
          <span class="ml-bar-pct">${pct}%</span>`;
        mlBars.appendChild(row);
      });
      $("#ml-footnote").textContent =
        `Trained model — test accuracy ${(mlPrediction.modelTestAccuracy * 100).toFixed(1)}%, ` +
        `5-fold CV F1 ${mlPrediction.modelCvMacroF1Mean != null ? mlPrediction.modelCvMacroF1Mean.toFixed(2) : mlPrediction.modelTestMacroF1.toFixed(2)}`;
    } else {
      $("#ml-model-name").textContent = "not used";
      mlBars.innerHTML = `<p class="footnote">No vitals were provided — ML prediction skipped.</p>`;
      $("#ml-footnote").textContent = "";
    }

    const ladder = $("#ladder");
    ladder.innerHTML = "";
    for (let r = 1; r <= 5; r++) {
      const div = document.createElement("div");
      div.className = "rung rung-" + r + (dangerLadder.rung === r ? " active" : "");
      div.innerHTML = `<span>Rung ${r}</span><span>${r === dangerLadder.rung ? dangerLadder.rungLabel : ""}</span>`;
      ladder.appendChild(div);
    }
    $("#ladder-desc").textContent = dangerLadder.rung > 0
      ? `${dangerLadder.description} (matched: "${dangerLadder.matchedPhrase}")`
      : "No danger-sign phrase matched in the symptom text.";

    $("#rf-multiplier").textContent = `×${riskFormulation.multiplier.toFixed(2)}`;
    fillTags("#tags-static", riskFormulation.staticRiskFactors, "static-tag");
    fillTags("#tags-dynamic", riskFormulation.dynamicRiskFactors, "dynamic-tag");
    fillTags("#tags-protective", riskFormulation.protectiveFactors, "protective-tag");

    // Hemoglobin / anemia card
    const hbCard = $("#hb-card");
    if (hemoglobinAssessment) {
      hbCard.hidden = false;
      $("#hb-content").innerHTML = `
        <div class="epds-total-display"><span class="big">${hemoglobinAssessment.hemoglobin}</span><span>g/dL</span></div>
        <p><strong>${hemoglobinAssessment.grade}</strong></p>
        <p class="footnote">${hemoglobinAssessment.methodology}</p>
        ${hemoglobinAssessment.grade !== "Normal" ? `<button type="button" class="cta-btn cta-secondary" data-goto-view="nutrition-view">🥗 View Nutrition Guidance →</button>` : ""}`;
      $("#hb-content").querySelectorAll("[data-goto-view]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.gotoView)));
    } else {
      hbCard.hidden = true;
    }

    // Psychological evaluation card
    const psychCard = $("#psych-card");
    if (psychologicalEvaluation) {
      psychCard.hidden = false;
      const p = psychologicalEvaluation;
      $("#psych-content").innerHTML = `
        <div class="epds-total-display"><span class="big">${p.total}</span><span>/ ${p.maxScore}</span></div>
        <p><strong>${p.classification}</strong></p>
        ${p.selfHarmFlagged ? `<div class="self-harm-alert">🚨 Self-harm item flagged — please reach out now.<br><a class="cta-btn cta-emergency" style="margin-top:8px;" href="tel:1800-599-0019">📞 Call KIRAN: 1800-599-0019</a></div>` : ""}
        ${!p.selfHarmFlagged && EPDS_SUPPORTIVE_INFO[p.classification] ? `<p class="epds-supportive-note">💛 ${EPDS_SUPPORTIVE_INFO[p.classification]}</p>` : ""}`;
    } else {
      psychCard.hidden = true;
    }

    const weightCard = $("#weight-card");
    if (weightAssessment) {
      weightCard.hidden = false;
      $("#weight-content").innerHTML = `
        <p><strong>${weightAssessment.status}</strong>${weightAssessment.diffKg != null ? ` (${weightAssessment.diffKg > 0 ? "+" : ""}${weightAssessment.diffKg} kg since last check)` : ""}</p>
        ${weightAssessment.flag ? `<p class="footnote">${weightAssessment.flag}</p>` : ""}`;
    } else {
      weightCard.hidden = true;
    }

    const fetalMovementCard = $("#fetal-movement-card");
    if (fetalMovementAssessment) {
      fetalMovementCard.hidden = false;
      $("#fetal-movement-content").innerHTML = `
        <p><strong>${fetalMovementAssessment.status}</strong></p>
        ${fetalMovementAssessment.flag ? `<p class="footnote">${fetalMovementAssessment.flag}</p>` : ""}`;
    } else {
      fetalMovementCard.hidden = true;
    }

    const fundalHeightCard = $("#fundal-height-card");
    if (fundalHeightAssessment) {
      fundalHeightCard.hidden = false;
      $("#fundal-height-content").innerHTML = `
        <p><strong>${fundalHeightAssessment.status}</strong> (expected ${fundalHeightAssessment.expectedRange[0]}-${fundalHeightAssessment.expectedRange[1]}cm)</p>
        ${fundalHeightAssessment.flag ? `<p class="footnote">${fundalHeightAssessment.flag}</p>` : ""}`;
    } else {
      fundalHeightCard.hidden = true;
    }

    if (clinicalImpression) {
      $("#ci-confidence").textContent = clinicalImpression.confidence.label;
      $("#ci-impressions").innerHTML = clinicalImpression.impressions.map((i) => `<li>${i}</li>`).join("");
    }

    const rulesList = $("#rules-list");
    rulesList.innerHTML = "";
    activeExpertRules.forEach((rule) => {
      const card = document.createElement("div");
      card.className = "rule-card";
      card.innerHTML = `
        <div class="rule-card-head">
          <strong>${rule.name}</strong>
          <span class="sev-pill ${rule.severity}">${rule.severity}</span>
        </div>
        <p>${rule.intervention}</p>`;
      rulesList.appendChild(card);
    });

    const recsList = $("#recs-list");
    recsList.innerHTML = "";
    recommendations.forEach((rec) => {
      const li = document.createElement("li");
      li.textContent = rec;
      recsList.appendChild(li);
    });
  }

  function fillTags(selector, items, className) {
    const el = $(selector);
    el.innerHTML = "";
    if (!items || items.length === 0) {
      el.innerHTML = `<span class="tag empty">None identified</span>`;
      return;
    }
    items.forEach((item) => {
      const span = document.createElement("span");
      span.className = "tag " + className;
      span.textContent = item.replace(/_/g, " ");
      el.appendChild(span);
    });
  }

  // Compiles what a provider would actually want to see about THIS result
  // into one plain-text document - everything here comes from the
  // person's own inputs (this page's DOM, the result object, the pregnancy
  // profile, the confirmed report-vitals log), nothing fabricated.
  function buildReferralSummaryText(data) {
    const guide = loadLastGuide();
    const extra = loadProfileExtra();
    const lines = [];
    lines.push("JANAMDATRI AI - REFERRAL SUMMARY");
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");

    lines.push("PREGNANCY");
    lines.push(guide ? `Week ${guide.week} (Trimester ${guide.trimester})${guide.estimatedDueDate ? `, EDD ${guide.estimatedDueDate}` : ""}` : "Pregnancy week not recorded.");
    if (extra) {
      lines.push(extra.previousPregnancy === "yes" ? "Previous pregnancy: Yes" : "Previous pregnancy: No / first pregnancy");
      if (extra.conditions) lines.push(`Existing conditions: ${extra.conditions}`);
    }
    lines.push("");

    lines.push("RISK ASSESSMENT RESULT");
    lines.push(`${data.severity.level} (Maternal Risk Index: ${data.mri})`);
    if (data.severity.escalatedBy) lines.push(`Escalated by: ${data.severity.escalatedBy.replace(/_/g, " ")}`);
    if (data.clinicalExplanation) {
      lines.push(`Recommended action: ${data.clinicalExplanation.recommendedNextAction}`);
      lines.push("Why:");
      data.clinicalExplanation.whyThisResult.forEach((w) => lines.push(`  - ${w}`));
    }
    lines.push("");

    const symptomTextValue = symptomText.value.trim();
    lines.push("SYMPTOMS REPORTED");
    lines.push(symptomTextValue || "None entered for this assessment.");
    lines.push("");

    if (data.vitalsInput) {
      const v = data.vitalsInput;
      lines.push("VITALS");
      lines.push(`Age ${v.Age}, BP ${v.SystolicBP}/${v.DiastolicBP} mmHg, Blood Sugar ${v.BS} mmol/L, Temp ${v.BodyTemp}°F, Heart Rate ${v.HeartRate} bpm`);
      lines.push("");
    }

    if (data.hemoglobinAssessment) {
      lines.push("HEMOGLOBIN");
      lines.push(`${data.hemoglobinAssessment.hemoglobin} g/dL - ${data.hemoglobinAssessment.grade}`);
      lines.push("");
    }

    if (data.riskFormulation) {
      lines.push("RISK FACTORS");
      lines.push(`Static: ${(data.riskFormulation.staticRiskFactors || []).map((f) => f.replace(/_/g, " ")).join(", ") || "None"}`);
      lines.push(`Dynamic: ${(data.riskFormulation.dynamicRiskFactors || []).map((f) => f.replace(/_/g, " ")).join(", ") || "None"}`);
      lines.push(`Protective: ${(data.riskFormulation.protectiveFactors || []).map((f) => f.replace(/_/g, " ")).join(", ") || "None"}`);
      lines.push("");
    }

    if (data.clinicalExplanation && data.clinicalExplanation.warningSigns.length) {
      lines.push("WARNING SIGNS");
      data.clinicalExplanation.warningSigns.forEach((w) => lines.push(`  - ${w.replace(/_/g, " ")}`));
      lines.push("");
    }

    const reportLog = loadReportVitalsLog();
    if (reportLog.length) {
      lines.push("RECENT UPLOADED REPORT VALUES");
      reportLog.slice(-5).forEach((r) => {
        const parts = [];
        if (r.hemoglobin != null) parts.push(`Hb ${r.hemoglobin} g/dL`);
        if (r.systolicBP != null) parts.push(`BP ${r.systolicBP}/${r.diastolicBP} mmHg`);
        if (r.bloodSugar != null) parts.push(`Blood Sugar ${r.bloodSugar} mmol/L`);
        lines.push(`  ${new Date(r.timestamp).toLocaleDateString()}: ${parts.join(", ")}`);
      });
      lines.push("");
    }

    if (data.recommendations && data.recommendations.length) {
      lines.push("RECOMMENDATIONS");
      data.recommendations.forEach((r) => lines.push(`  - ${r}`));
      lines.push("");
    }

    lines.push("---");
    lines.push("This is an automated screening/support aid, not a diagnosis. Please discuss all of this with a qualified healthcare professional.");
    return lines.join("\n");
  }

  function renderReferralSummary(data) {
    const summaryText = buildReferralSummaryText(data);
    $("#referral-summary-card").hidden = false;
    $("#referral-summary-text").textContent = summaryText;
    $("#referral-summary-card").scrollIntoView({ behavior: "smooth", block: "start" });

    $("#referral-download-btn").onclick = () => {
      const blob = new Blob([summaryText], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `janamdatri-referral-summary-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  }

  $("#new-assessment-btn").addEventListener("click", () => {
    $("#results").hidden = true;
    $$(".chip.selected").forEach((c) => c.classList.remove("selected"));
    symptomText.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("#print-btn").addEventListener("click", () => window.print());

  $("#read-aloud-btn").addEventListener("click", () => {
    if (!lastResult || !("speechSynthesis" in window)) return;
    const { severity, recommendations } = lastResult;
    const text = `${severity.level}. ` + recommendations.slice(0, 3).join(". ");
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = currentLang === "hi" ? "hi-IN" : "en-IN";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  });

  // ==================================================================
  // History (localStorage)
  // ==================================================================

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(scopedKey(HISTORY_KEY))) || []; } catch { return []; }
  }

  function saveToHistory(result) {
    try {
      const history = loadHistory();
      history.unshift({ timestamp: new Date().toISOString(), severityLevel: result.severity.level, mri: result.mri, result });
      localStorage.setItem(scopedKey(HISTORY_KEY), JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch { /* localStorage unavailable - non-fatal */ }
  }

  async function loadServerHistory() {
    if (!getToken()) return null;
    try {
      const res = await fetch("/assessments/mine", { headers: authHeaders() });
      if (!res.ok) return null;
      const payload = await res.json();
      return payload.data.assessments.map((a) => ({
        timestamp: new Date(a.created_at * 1000).toISOString(),
        severityLevel: a.severity_level,
        mri: a.mri,
        result: a.result,
      }));
    } catch {
      return null;
    }
  }

  // ==================================================================
  // Health Trends - lightweight hand-rolled SVG sparklines over the
  // existing assessment history (no charting library, no backend change:
  // the raw vitals were already added to each assessment result last
  // round specifically so a trend view like this could read them back).
  // ==================================================================

  function svgSparkline(values, color) {
    const w = 240, h = 56, pad = 6;
    const indexed = values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
    if (indexed.length < 2) return "";
    const nums = indexed.map((p) => p.v);
    const min = Math.min(...nums), max = Math.max(...nums);
    const range = max - min || 1;
    const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    const xy = (v, i) => [pad + i * stepX, h - pad - ((v - min) / range) * (h - pad * 2)];

    let path = "";
    let started = false;
    values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const [x, y] = xy(v, i);
      path += (started ? " L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
      started = true;
    });
    const dots = indexed.map(({ v, i }) => {
      const [x, y] = xy(v, i);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}" />`;
    }).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="trend-sparkline">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />${dots}</svg>`;
  }

  function firstLastValid(values) {
    const valid = values.filter((v) => v != null);
    if (valid.length < 2) return null;
    return { first: valid[0], last: valid[valid.length - 1] };
  }

  function trendTile(label, values, color, unit) {
    const fl = firstLastValid(values);
    const spark = svgSparkline(values, color);
    if (!fl || !spark) return "";
    const diff = fl.last - fl.first;
    const arrow = diff > 0.05 ? "↑" : diff < -0.05 ? "↓" : "→";
    return `<div class="trend-tile">
      <div class="trend-tile-head"><span>${label}</span><span class="trend-arrow">${arrow}</span></div>
      ${spark}
      <div class="trend-tile-value">${fl.first}${unit} → ${fl.last}${unit}</div>
    </div>`;
  }

  function buildTrendSummary(series, chronological) {
    const notes = [];
    const hbFl = firstLastValid(series.hb);
    if (hbFl && Math.abs(hbFl.last - hbFl.first) >= 0.3) {
      notes.push(hbFl.last > hbFl.first
        ? `Your hemoglobin has improved across your recent checks (${hbFl.first} → ${hbFl.last} g/dL).`
        : `Your hemoglobin has been declining across your recent checks (${hbFl.first} → ${hbFl.last} g/dL) - worth mentioning at your next visit.`);
    }
    const sbpFl = firstLastValid(series.sbp);
    if (sbpFl && Math.abs(sbpFl.last - sbpFl.first) >= 5) {
      notes.push(sbpFl.last > sbpFl.first
        ? `Your blood pressure has been trending up (${sbpFl.first} → ${sbpFl.last} mmHg systolic) - worth watching closely.`
        : `Your blood pressure has improved (${sbpFl.first} → ${sbpFl.last} mmHg systolic).`);
    }
    const weightFl = firstLastValid(series.weight);
    if (weightFl && weightFl.last < weightFl.first) {
      notes.push(`Your weight has decreased across your recent checks (${weightFl.first} → ${weightFl.last} kg) - worth mentioning at your next visit.`);
    } else if (weightFl && weightFl.last - weightFl.first >= 2) {
      notes.push(`Your weight has risen quickly across your recent checks (${weightFl.first} → ${weightFl.last} kg) - worth watching for fluid retention.`);
    }
    if (chronological.length >= 2) {
      const prev = chronological[chronological.length - 2];
      const latest = chronological[chronological.length - 1];
      if (prev.severityLevel !== latest.severityLevel) {
        const order = ["Minimal", "Mild", "Moderate", "Severe", "Critical"];
        const increased = order.indexOf(latest.severityLevel) > order.indexOf(prev.severityLevel);
        const escalatedBy = latest.result && latest.result.severity && latest.result.severity.escalatedBy;
        const reason = escalatedBy ? ` because of ${escalatedBy.replace(/_/g, " ")}` : "";
        notes.push(`Your risk level ${increased ? "increased" : "decreased"} from ${prev.severityLevel} to ${latest.severityLevel}${reason}.`);
      }
    }
    if (!notes.length) return `<p class="footnote">No major changes detected across your recent assessments.</p>`;
    return `<div class="trend-summary">${notes.map((n) => `<p>📈 ${n}</p>`).join("")}</div>`;
  }

  function loadReportVitalsLog() {
    try { return JSON.parse(localStorage.getItem(scopedKey(REPORT_VITALS_LOG_KEY))) || []; } catch { return []; }
  }

  function addReportVitalsToHealthRecord(vitals) {
    const log = loadReportVitalsLog();
    log.push({ timestamp: new Date().toISOString(), source: "report", ...vitals });
    try { localStorage.setItem(scopedKey(REPORT_VITALS_LOG_KEY), JSON.stringify(log.slice(-50))); } catch { /* non-fatal */ }
  }

  function renderHealthTrends(history) {
    const container = $("#health-trends-content");
    const reportLog = loadReportVitalsLog();
    if (history.length < 2 && reportLog.length < 2) {
      container.innerHTML = `<p class="footnote">Not enough data yet - run at least 2 assessments (or confirm values from an uploaded report in My Reports) to see trends here.</p>`;
      return;
    }

    // Merge real assessments with confirmed report values into one
    // chronological point list per metric - a report has no triage result,
    // so it only ever contributes to the vitals/Hb series, never to the
    // risk-score trend or the risk-level-change note below.
    const chronological = [...history].reverse();
    const assessPoints = chronological.map((h) => ({
      t: new Date(h.timestamp).getTime(),
      mri: h.mri,
      sbp: h.result && h.result.vitalsInput ? h.result.vitalsInput.SystolicBP : null,
      bs: h.result && h.result.vitalsInput ? h.result.vitalsInput.BS : null,
      hb: h.result && h.result.hemoglobinAssessment ? h.result.hemoglobinAssessment.hemoglobin : null,
      weight: h.result && h.result.weightInput != null ? h.result.weightInput : null,
    }));
    const reportPoints = reportLog.map((r) => ({
      t: new Date(r.timestamp).getTime(),
      mri: null,
      sbp: r.systolicBP != null ? r.systolicBP : null,
      bs: r.bloodSugar != null ? r.bloodSugar : null,
      hb: r.hemoglobin != null ? r.hemoglobin : null,
      weight: null,
    }));
    const merged = [...assessPoints, ...reportPoints].sort((a, b) => a.t - b.t);

    const series = {
      mri: merged.map((p) => p.mri),
      sbp: merged.map((p) => p.sbp),
      bs: merged.map((p) => p.bs),
      hb: merged.map((p) => p.hb),
      weight: merged.map((p) => p.weight),
    };

    const tiles = [
      trendTile("Risk Score (MRI)", series.mri, "#a83a5c", ""),
      trendTile("Systolic BP", series.sbp, "#c23b2e", " mmHg"),
      trendTile("Blood Sugar", series.bs, "#c98a1a", " mmol/L"),
      trendTile("Hemoglobin", series.hb, "#2f8f5f", " g/dL"),
      trendTile("Weight", series.weight, "#7a5300", " kg"),
    ].filter(Boolean);

    if (!tiles.length) {
      container.innerHTML = `<p class="footnote">Not enough repeated vitals/hemoglobin data yet to chart a trend - the risk trend needs at least 2 assessments with vitals or hemoglobin entered.</p>`;
      return;
    }

    container.innerHTML = `<div class="trend-grid">${tiles.join("")}</div>` + buildTrendSummary(series, chronological);
  }

  async function renderHistory() {
    const container = $("#history-list");
    const serverHistory = await loadServerHistory();
    const history = serverHistory !== null ? serverHistory : loadHistory();
    container.innerHTML = "";
    renderHealthTrends(history);

    if (history.length === 0) {
      container.innerHTML = `<p class="history-empty">No assessments yet.</p>`;
      return;
    }

    history.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "history-row";
      const date = new Date(entry.timestamp);
      row.innerHTML = `
        <div><strong>${entry.severityLevel}</strong><div class="history-row-meta">${date.toLocaleString()}</div></div>
        <div class="history-row-meta">MRI ${entry.mri}</div>`;
      row.addEventListener("click", () => {
        renderResult(entry.result);
        showView("assess-view");
        $("#results").hidden = false;
        $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      container.appendChild(row);
    });
  }

  $("#clear-history-btn").addEventListener("click", () => {
    localStorage.removeItem(scopedKey(HISTORY_KEY));
    renderHistory();
  });

  // ==================================================================
  // Pregnancy Guide
  // ==================================================================

  $$('input[name="guide-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = $('input[name="guide-mode"]:checked').value;
      $("#guide-lmp-field").hidden = mode !== "lmp";
      $("#guide-week-field").hidden = mode !== "week";
    });
  });

  $("#guide-submit-btn").addEventListener("click", async () => {
    const mode = $('input[name="guide-mode"]:checked').value;
    const body = mode === "lmp" ? { lmp: $("#guide-lmp").value } : { week: Number($("#guide-week").value) };
    if (mode === "lmp" && !body.lmp) return;

    try {
      const res = await fetch("/pregnancy-guide", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail);
      renderGuide(payload.data);
      saveLastGuide(payload.data);
    } catch (err) {
      alert(err.message || "Could not load pregnancy guide.");
    }
  });

  function renderGuide(guide) {
    $("#guide-results").hidden = false;
    $("#guide-week-badge").textContent = `Week ${guide.week}`;
    $("#guide-trimester").textContent = `Trimester ${guide.trimester}`;
    $("#guide-due").textContent = guide.estimatedDueDate
      ? `Estimated due date: ${guide.estimatedDueDate} · ${guide.weeksUntilDue} weeks to go`
      : `${guide.weeksUntilDue} weeks to go`;
    $("#guide-progress-fill").style.width = `${Math.min((guide.week / 40) * 100, 100)}%`;

    renderThisWeekInto("#guide-this-week", "guide-week", guide);

    $("#guide-anc-schedule").innerHTML = guide.ancSchedule.map((visit) => `
      <div class="anc-visit ${visit.visit === guide.nextAncVisit.visit ? "next" : ""}">
        <div class="anc-visit-head"><span>Visit ${visit.visit} — ${visit.window}</span>${visit.visit === guide.nextAncVisit.visit ? "<span>Next up</span>" : ""}</div>
        <ul>${visit.checks.map((c) => `<li>${c}</li>`).join("")}</ul>
      </div>`).join("");

    $("#guide-schemes").innerHTML = Object.entries(guide.schemes).map(([name, desc]) => `
      <div class="scheme-tile"><strong>${name}</strong><span>${desc}</span></div>`).join("");
  }

  // ==================================================================
  // My Pregnancy Profile - the ONE place LMP/week, previous-pregnancy,
  // and existing conditions are entered, instead of asking for the week
  // again in the Assessment wizard, Nutrition, and the Guide separately.
  // The week/trimester/EDD piece reuses the exact same /pregnancy-guide
  // call and saveLastGuide() every other module already reads from -
  // this page is a friendlier front door onto that same data, not a
  // second source of truth.
  // ==================================================================

  const PREGNANCY_PROFILE_EXTRA_KEY = "janamdatri_pregnancy_profile_extra";

  function saveProfileExtra(extra) {
    try { localStorage.setItem(scopedKey(PREGNANCY_PROFILE_EXTRA_KEY), JSON.stringify({ ...extra, updatedAt: new Date().toISOString() })); } catch { /* non-fatal */ }
  }

  function loadProfileExtra() {
    try { return JSON.parse(localStorage.getItem(scopedKey(PREGNANCY_PROFILE_EXTRA_KEY))); } catch { return null; }
  }

  $$('input[name="profile-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = $('input[name="profile-mode"]:checked').value;
      $("#profile-lmp-field").hidden = mode !== "lmp";
      $("#profile-week-field").hidden = mode !== "week";
    });
  });

  function renderProfileSummary() {
    const guide = loadLastGuide();
    const extra = loadProfileExtra();
    const card = $("#profile-summary-card");
    if (!guide) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    $("#profile-summary-content").innerHTML = `
      <div class="epds-total-display"><span class="big">${guide.week}</span><span>weeks · Trimester ${guide.trimester}</span></div>
      ${guide.estimatedDueDate ? `<p class="footnote">Estimated due date: ${guide.estimatedDueDate}</p>` : ""}
      <p>${extra && extra.previousPregnancy === "yes" ? "Previous pregnancy: Yes" : "Previous pregnancy: No / first pregnancy"}</p>
      ${extra && extra.conditions ? `<p>Existing conditions: ${extra.conditions}</p>` : ""}
      <p>Td/TT: ${extra && extra.vaccineDose1 ? "Dose 1 ✓" : "Dose 1 pending"}${extra && extra.vaccineDose2 ? ", Dose 2 ✓" : ", Dose 2 pending"}</p>`;
  }

  function prefillProfileForm() {
    const guide = loadLastGuide();
    const extra = loadProfileExtra();
    if (guide && guide.lmp) {
      $("#profile-lmp").value = guide.lmp;
      $('input[name="profile-mode"][value="lmp"]').checked = true;
      $("#profile-lmp-field").hidden = false;
      $("#profile-week-field").hidden = true;
    } else if (guide) {
      $("#profile-week").value = guide.week;
      $('input[name="profile-mode"][value="week"]').checked = true;
      $("#profile-lmp-field").hidden = true;
      $("#profile-week-field").hidden = false;
    }
    if (extra) {
      if (extra.previousPregnancy === "yes") $('input[name="profile-previous"][value="yes"]').checked = true;
      $("#profile-conditions").value = extra.conditions || "";
      $("#profile-vaccine-dose1").checked = !!extra.vaccineDose1;
      $("#profile-vaccine-dose2").checked = !!extra.vaccineDose2;
    }
    renderProfileSummary();
  }

  $("#profile-save-btn").addEventListener("click", async () => {
    const noteEl = $("#profile-save-note");
    const mode = $('input[name="profile-mode"]:checked').value;
    const body = mode === "lmp" ? { lmp: $("#profile-lmp").value } : { week: Number($("#profile-week").value) };
    if (mode === "lmp" && !body.lmp) {
      noteEl.textContent = currentLang === "hi" ? "कृपया अपनी अंतिम मासिक धर्म तिथि दर्ज करें।" : "Please enter your last menstrual period date.";
      return;
    }

    try {
      const res = await fetch("/pregnancy-guide", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail);
      saveLastGuide(payload.data);

      const previousPregnancy = $('input[name="profile-previous"]:checked').value;
      const conditions = $("#profile-conditions").value.trim();
      const vaccineDose1 = $("#profile-vaccine-dose1").checked;
      const vaccineDose2 = $("#profile-vaccine-dose2").checked;
      saveProfileExtra({ previousPregnancy, conditions, vaccineDose1, vaccineDose2 });

      noteEl.textContent = currentLang === "hi"
        ? `प्रोफ़ाइल सहेजी गई - सप्ताह ${payload.data.week} के लिए व्यक्तिगत बनाई गई।`
        : `Profile saved - your Home dashboard, Assessment, and Nutrition are now personalized to week ${payload.data.week}.`;
      renderProfileSummary();
      renderHome();
    } catch (err) {
      noteEl.textContent = err.message || "Could not save your profile.";
    }
  });

  // ==================================================================
  // Nutrition Analysis
  // ==================================================================

  let nutritionItemsCache = null;

  async function loadNutritionItems() {
    if (nutritionItemsCache) return nutritionItemsCache;
    const res = await fetch("/nutrition/items");
    const payload = await res.json();
    nutritionItemsCache = payload.data;
    return nutritionItemsCache;
  }

  async function renderNutritionForm() {
    const { questions, frequencyOptions } = await loadNutritionItems();
    const container = $("#nutrition-form");
    container.innerHTML = questions.map((q, i) => `
      <div class="epds-question">
        <div class="epds-question-text">${i + 1}. ${q.text}</div>
        <div class="epds-options">
          ${frequencyOptions.map((opt, val) => `
            <label class="epds-option">
              <input type="radio" name="nutrition-${q.id}" value="${val}" />
              <span>${opt}</span>
            </label>`).join("")}
        </div>
      </div>`).join("");
  }

  $$('.navlink[data-view="nutrition-view"]').forEach((btn) => {
    btn.addEventListener("click", () => { if (!$("#nutrition-form").children.length) renderNutritionForm(); });
  });

  // Reads the most recent hemoglobin on record (from assessment history) so
  // the nutrition check can connect a clinical finding (low Hb) with a
  // dietary one (low iron intake) automatically, instead of asking the
  // person to re-enter it - see nutrition_eval.py's connectedInsights.
  function lastKnownHemoglobin() {
    const history = loadHistory();
    for (const entry of history) {
      const hb = entry.result && entry.result.hemoglobinAssessment;
      if (hb) return hb.hemoglobin;
    }
    return null;
  }

  // A single weight reading isn't gradable on its own (see
  // clinical_inputs.py) - grading a CHANGE needs the last recorded
  // weight, which the backend has no way to know unless the client
  // sends it back.
  function lastKnownWeight() {
    const history = loadHistory();
    for (const entry of history) {
      if (entry.result && entry.result.weightInput != null) return entry.result.weightInput;
    }
    return null;
  }

  $("#nutrition-submit-btn").addEventListener("click", async () => {
    const errorEl = $("#nutrition-error");
    const btn = $("#nutrition-submit-btn");
    errorEl.hidden = true;

    const { questions } = await loadNutritionItems();
    const responses = {};
    for (const q of questions) {
      const checked = document.querySelector(`input[name="nutrition-${q.id}"]:checked`);
      if (!checked) {
        errorEl.textContent = currentLang === "hi" ? "कृपया सभी प्रश्नों के उत्तर दें।" : "Please answer all the questions.";
        errorEl.hidden = false;
        return;
      }
      responses[q.id] = Number(checked.value);
    }

    const lastGuide = loadLastGuide();
    const pregnancyWeek = lastGuide ? lastGuide.week : null;
    const hemoglobin = lastKnownHemoglobin();

    btn.disabled = true;
    btn.querySelector(".spinner").hidden = false;
    try {
      const res = await fetch("/nutrition-assess", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ responses, hemoglobin, pregnancyWeek }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail || "Could not analyze diet.");
      renderNutritionResult(payload.data);
      saveNutritionResult(payload.data);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector(".spinner").hidden = true;
    }
  });

  const NUTRIENT_STATUS_COLOR = { Adequate: "#2f8f5f", Borderline: "#c98a1a", Low: "#c23b2e" };

  function renderNutritionResult(data) {
    $("#nutrition-result-card").hidden = false;

    let insightsHtml = "";
    if (data.priorityNutrients && data.priorityNutrients.length) {
      insightsHtml += `<p class="footnote">Priority for this trimester: ${data.priorityNutrients.join(", ")}</p>`;
    }
    if (data.connectedInsights && data.connectedInsights.length) {
      insightsHtml += data.connectedInsights
        .map((i) => `<div class="nutrition-connected-alert">🔗 ${i}</div>`).join("");
    }
    $("#nutrition-insights").innerHTML = insightsHtml;

    $("#nutrition-nutrients").innerHTML = Object.entries(data.nutrients).map(([name, v]) => `
      <div class="nutrient-card">
        <div class="nutrient-head">
          <strong>${name}</strong>
          <span class="sev-pill" style="background:${NUTRIENT_STATUS_COLOR[v.status]}">${v.status}</span>
        </div>
        <div class="nutrient-bar-track"><div class="nutrient-bar-fill" style="width:${v.percent}%;background:${NUTRIENT_STATUS_COLOR[v.status]}"></div></div>
        ${v.status !== "Adequate" ? `<ul class="recs-list">${v.suggestions.slice(0, 4).map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}
      </div>`).join("");

    $("#nutrition-result-card").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function saveNutritionResult(result) {
    try { localStorage.setItem(scopedKey(NUTRITION_KEY), JSON.stringify({ result, savedAt: new Date().toISOString() })); } catch { /* non-fatal */ }
  }

  function loadSavedNutrition() {
    try { return JSON.parse(localStorage.getItem(scopedKey(NUTRITION_KEY))); } catch { return null; }
  }

  // ==================================================================
  // Mental Health Check (EPDS)
  // ==================================================================

  let epdsItemsCache = null;

  async function loadEpdsItems() {
    if (epdsItemsCache) return epdsItemsCache;
    const res = await fetch("/psych-assess/items");
    const payload = await res.json();
    epdsItemsCache = payload.data;
    return epdsItemsCache;
  }

  async function renderEpdsForm() {
    const { items, options } = await loadEpdsItems();
    const container = $("#epds-form");
    container.innerHTML = items.map((item, i) => `
      <div class="epds-question">
        <div class="epds-question-text">${i + 1}. ${item}</div>
        <div class="epds-options">
          ${options[i].map((opt, val) => `
            <label class="epds-option">
              <input type="radio" name="epds-q${i}" value="${val}" />
              <span>${opt}</span>
            </label>`).join("")}
        </div>
      </div>`).join("");
  }

  $$('.navlink[data-view="psych-view"]').forEach((btn) => {
    btn.addEventListener("click", () => { if (!$("#epds-form").children.length) renderEpdsForm(); });
  });

  $("#epds-submit-btn").addEventListener("click", async () => {
    const responses = [];
    for (let i = 0; i < 10; i++) {
      const checked = document.querySelector(`input[name="epds-q${i}"]:checked`);
      if (!checked) {
        alert(currentLang === "hi" ? "कृपया सभी 10 प्रश्नों के उत्तर दें।" : "Please answer all 10 questions.");
        return;
      }
      responses.push(Number(checked.value));
    }

    try {
      const res = await fetch("/psych-assess", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responses }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail);
      renderEpdsResult(payload.data);
      saveEpds(responses, payload.data);
      syncEpdsIncludeVisibility();
      checkGlobalEmergencyBanner();
    } catch (err) {
      alert(err.message || "Could not score EPDS.");
    }
  });

  // EPDS as a one-time score tells someone a number and stops there. This
  // adds the two things a real screening loop needs: a plain-language
  // supportive note tailored to the result (not just the clinical
  // classification), and a genuine follow-up - re-checking after 2 weeks
  // resolves itself the moment they actually retake the check, since that
  // resets the "time since last check" the reminder is based on.
  const EPDS_SUPPORTIVE_INFO = {
    "Low probability": "Your responses don't suggest significant depression or anxiety symptoms right now. Mood can shift during pregnancy and after birth, so it's worth checking in again in a couple of weeks, especially if anything changes.",
    "Possible depression": "Your responses suggest some symptoms worth paying attention to. This is common during and after pregnancy, and it doesn't mean anything is wrong with you as a mother. Consider mentioning how you've been feeling at your next ANC visit.",
    "Probable depression": "Your responses suggest a symptom pattern consistent with depression. This is common, treatable, and not a personal failing - please talk to your ANC provider or a counselor soon rather than waiting to see if it passes.",
    "High symptom burden": "Your responses suggest a significant symptom burden right now. Please talk to your ANC provider or a counselor soon - support that actually helps is available, and reaching out is the fastest way to feel better.",
  };
  const EPDS_FOLLOWUP_DAYS = 14;

  function epdsDaysSince(savedEpds) {
    if (!savedEpds) return null;
    return Math.floor((Date.now() - new Date(savedEpds.savedAt).getTime()) / 86400000);
  }

  function epdsFollowUpDue(savedEpds) {
    if (!savedEpds || savedEpds.result.classification === "Low probability") return false;
    const days = epdsDaysSince(savedEpds);
    return days != null && days >= EPDS_FOLLOWUP_DAYS;
  }

  function renderEpdsResult(result) {
    $("#epds-result-card").hidden = false;
    const supportiveNote = EPDS_SUPPORTIVE_INFO[result.classification];
    $("#epds-result-content").innerHTML = `
      <div class="epds-total-display"><span class="big">${result.total}</span><span>/ ${result.maxScore}</span></div>
      <p><strong>${result.classification}</strong></p>
      ${result.selfHarmFlagged ? `<div class="self-harm-alert">🚨 You indicated thoughts of self-harm have occurred to you. Please talk to someone you trust right now.<br><a class="cta-btn cta-emergency" style="margin-top:8px;" href="tel:1800-599-0019">📞 Call KIRAN: 1800-599-0019 (toll-free, 24x7)</a></div>` : ""}
      ${supportiveNote ? `<p class="epds-supportive-note">💛 ${supportiveNote}</p>` : ""}
      ${!result.selfHarmFlagged && result.classification !== "Low probability" ? `<p class="footnote">We'll suggest a follow-up check in about 2 weeks - feelings during pregnancy can change, and it helps to keep checking in.</p>` : ""}
      <p class="footnote">${result.methodology}</p>`;
    $("#epds-result-card").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function saveEpds(responses, result) {
    try {
      localStorage.setItem(scopedKey(EPDS_KEY), JSON.stringify({ responses, result, savedAt: new Date().toISOString() }));
    } catch { /* non-fatal */ }
  }

  function loadSavedEpds() {
    try { return JSON.parse(localStorage.getItem(scopedKey(EPDS_KEY))); } catch { return null; }
  }

  syncEpdsIncludeVisibility();
  prefillPregnancyWeek();

  // ==================================================================
  // Helplines page - government schemes reference
  // ==================================================================

  const STATIC_SCHEMES = {
    PMSMA: "Pradhan Mantri Surakshit Matritva Abhiyan - free ANC checkup on the 9th of every month at government health facilities, from the 2nd trimester.",
    JSY: "Janani Suraksha Yojana - cash assistance for institutional delivery. Ask your ASHA worker about eligibility.",
    PMMVY: "Pradhan Mantri Matru Vandana Yojana - cash incentive in installments for ANC registration, checkups, and institutional delivery of the first living child.",
    AnemiaMuktBharat: "National programme for iron-folic acid supplementation and anemia screening/treatment during pregnancy.",
  };
  $("#help-schemes").innerHTML = Object.entries(STATIC_SCHEMES).map(([name, desc]) => `
    <div class="scheme-tile"><strong>${name}</strong><span>${desc}</span></div>`).join("");

  // ==================================================================
  // Assessment wizard (step navigation + review summary)
  // ==================================================================

  function goToWizardStep(step) {
    $$(".wizard-step").forEach((el) => { el.hidden = el.dataset.step !== String(step); });
    $$(".wizard-step-dot").forEach((dot) => {
      const dotStep = Number(dot.dataset.stepDot);
      dot.classList.toggle("active", dotStep === step);
      dot.classList.toggle("done", dotStep < step);
    });
    if (step === 4) renderReviewSummary();
    $("#assess-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function vitalsValidationError() {
    if (!vitalsEnable.checked) return null;
    const incomplete = $$("#vitals-grid input").some((inp) => inp.value.trim() === "");
    if (incomplete) {
      return currentLang === "hi"
        ? "कृपया सभी Vitals भरें, या ऊपर 'Vitals शामिल करें' को अनचेक करें।"
        : "Please fill in all vitals fields, or uncheck 'Include vitals' above.";
    }
    return null;
  }

  $$(".wizard-next-btn, .wizard-back-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("wizard-next-btn") && btn.closest(".wizard-step").dataset.step === "1") {
        const err = vitalsValidationError();
        if (err) {
          errorMsg.textContent = err;
          errorMsg.hidden = false;
          return;
        }
      }
      errorMsg.hidden = true;
      goToWizardStep(Number(btn.dataset.goto));
    });
  });

  function renderReviewSummary() {
    const rows = [];
    if (vitalsEnable.checked) {
      rows.push(["Vitals", `Age ${$("#v-age").value}, BP ${$("#v-sbp").value}/${$("#v-dbp").value}, BS ${$("#v-bs").value}, Temp ${$("#v-temp").value}°F, HR ${$("#v-hr").value}`]);
    } else {
      rows.push(["Vitals", "Not included"]);
    }
    if ($("#v-hb").value) rows.push(["Hemoglobin", `${$("#v-hb").value} g/dL`]);
    if ($("#v-week").value) rows.push(["Pregnancy week", `Week ${$("#v-week").value}`]);
    if ($("#v-weight").value) rows.push(["Weight", `${$("#v-weight").value} kg`]);
    if ($("#v-fetal-movement").value) rows.push(["Fetal movements (last hour)", $("#v-fetal-movement").value]);
    if ($("#v-fundal-height").value) rows.push(["Fundal height", `${$("#v-fundal-height").value} cm`]);
    rows.push(["Symptoms", symptomText.value.trim() || "None described"]);
    const flags = Object.keys(collectHistoryFlags());
    rows.push(["History factors", flags.length ? flags.map((f) => f.replace(/_/g, " ")).join(", ") : "None selected"]);
    const savedEpds = loadSavedEpds();
    if (savedEpds) rows.push(["Mental Health Check", `EPDS ${savedEpds.result.total}/30 saved`]);

    $("#review-summary").innerHTML = rows.map(([label, value]) => `
      <div class="review-row"><span class="review-label">${label}</span><span class="review-value">${value}</span></div>`).join("");
  }

  // Reset to step 1 whenever a fresh assessment starts.
  $("#new-assessment-btn").addEventListener("click", () => goToWizardStep(1));

  // ==================================================================
  // Instant Help Chat widget
  // ==================================================================

  const CHAT_HISTORY_KEY = "janamdatri_chat";
  const chatFab = $("#chat-fab");
  const chatPanel = $("#chat-panel");
  const chatBackdrop = $("#chat-backdrop");
  const chatMessages = $("#chat-messages");

  attachVoiceInput($("#chat-mic-btn"), $("#chat-input"), (transcript) => { $("#chat-input").value = transcript; });

  function closeChat() {
    chatPanel.hidden = true;
    chatBackdrop.hidden = true;
    chatFab.hidden = false;
  }

  function loadChatHistory() {
    try { return JSON.parse(localStorage.getItem(scopedKey(CHAT_HISTORY_KEY))) || []; } catch { return []; }
  }

  function saveChatHistory(messages) {
    try { localStorage.setItem(scopedKey(CHAT_HISTORY_KEY), JSON.stringify(messages.slice(-40))); } catch { /* non-fatal */ }
  }

  function appendChatMessage(sender, text, isEmergency = false) {
    const div = document.createElement("div");
    div.className = "chat-msg " + sender + (isEmergency ? " emergency" : "");
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  function renderChatHistory() {
    chatMessages.innerHTML = "";
    const history = loadChatHistory();
    if (history.length === 0) {
      appendChatMessage("bot", "Hi! Ask me about ANC visits, nutrition, anemia, mental health, or describe a symptom and I'll check for danger signs.");
      return;
    }
    history.forEach((m) => appendChatMessage(m.sender, m.text, m.isEmergency));
  }

  chatFab.addEventListener("click", () => {
    chatPanel.hidden = false;
    chatBackdrop.hidden = false;
    chatFab.hidden = true;
    if (!chatMessages.children.length) renderChatHistory();
    $("#chat-input").focus();
  });

  $("#chat-close-btn").addEventListener("click", closeChat);
  chatBackdrop.addEventListener("click", closeChat);

  $("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";

    const history = loadChatHistory();
    history.push({ sender: "user", text: message });
    appendChatMessage("user", message);

    const typingEl = appendChatMessage("bot typing", "…thinking…");
    const contextMessage = pendingClarificationContext;
    const unresolvedRounds = unresolvedChatRounds;

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message, contextMessage, unresolvedRounds }),
      });
      const payload = await res.json();
      typingEl.remove();
      if (!res.ok) throw new Error(payload.detail || "Chat failed.");
      appendChatMessage("bot", payload.data.reply, payload.data.isEmergency);
      history.push({ sender: "bot", text: payload.data.reply, isEmergency: payload.data.isEmergency });
      saveChatHistory(history);
      if (UNRESOLVED_CHAT_INTENTS.has(payload.data.intent)) {
        pendingClarificationContext = pendingClarificationContext
          ? pendingClarificationContext + ". " + message
          : message;
        unresolvedChatRounds += 1;
      } else {
        pendingClarificationContext = null;
        unresolvedChatRounds = 0;
      }
    } catch (err) {
      typingEl.remove();
      appendChatMessage("bot", "Sorry, I couldn't reach the help service. Please check your connection or call 108 if this is urgent.");
    }
  });

  // ==================================================================
  // My Reports - document/prescription analysis
  // ==================================================================

  const TIME_ORDER = ["Morning", "Afternoon", "Evening", "Night", "As needed"];

  $("#report-analyze-btn").addEventListener("click", async () => {
    const fileInput = $("#report-file");
    const pastedText = $("#report-text").value.trim();
    const errorEl = $("#report-error");
    const btn = $("#report-analyze-btn");
    errorEl.hidden = true;

    const file = fileInput.files[0];
    if (!file && !pastedText) {
      errorEl.textContent = "Upload a file or paste the report's text first.";
      errorEl.hidden = false;
      return;
    }

    const formData = new FormData();
    if (file) formData.append("file", file);
    if (pastedText) formData.append("text", pastedText);

    btn.disabled = true;
    btn.querySelector(".spinner").hidden = false;
    try {
      const res = await fetch("/documents/analyze", { method: "POST", body: formData });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail || "Could not analyze this report.");
      renderReportResult(payload.data);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector(".spinner").hidden = true;
    }
  });

  function renderReportResult(data) {
    $("#report-results").hidden = false;
    $("#report-summary-text").textContent = data.summary;

    const scheduleEl = $("#report-schedule");
    const times = Object.keys(data.scheduleByTime || {});
    if (times.length === 0) {
      scheduleEl.innerHTML = `<p class="schedule-empty">No medication schedule could be determined from this report.</p>`;
    } else {
      scheduleEl.innerHTML = TIME_ORDER.filter((t) => data.scheduleByTime[t]).map((time) => `
        <div class="schedule-tile">
          <h4>${time}</h4>
          <ul>${data.scheduleByTime[time].map((m) => `<li>${m}</li>`).join("")}</ul>
        </div>`).join("");
    }

    const snapshotEl = $("#report-snapshot");
    const discussNoteEl = $("#report-discuss-note");
    if (!data.findings || data.findings.length === 0) {
      snapshotEl.innerHTML = "";
      discussNoteEl.textContent = "";
    } else {
      snapshotEl.innerHTML = data.findings.map((f) => `
        <div class="snapshot-tile">
          <div class="snapshot-label">${f.label}</div>
          <div class="snapshot-value">${f.value}</div>
          ${vitalStatusPill(null, !f.flag)}
        </div>`).join("");
      const flaggedCount = data.findings.filter((f) => f.flag).length;
      discussNoteEl.textContent = flaggedCount
        ? `${flaggedCount} item${flaggedCount > 1 ? "s" : ""} to discuss with your provider - see details below.`
        : "Nothing here shows an obvious flag, but always confirm with your provider.";
    }

    const findingsEl = $("#report-findings");
    if (!data.findings || data.findings.length === 0) {
      findingsEl.innerHTML = `<p class="schedule-empty">No lab values were recognized in this report.</p>`;
    } else {
      findingsEl.innerHTML = data.findings.map((f) => `
        <div class="rule-card">
          <div class="rule-card-head"><strong>${f.label}: ${f.value}</strong>${f.flag ? '<span class="sev-pill Moderate">Review</span>' : ""}</div>
          ${f.flag ? `<p>${f.flag}</p>` : ""}
        </div>`).join("");
    }

    const confirmCard = $("#report-confirm-card");
    const extractedVitals = data.extractedVitals || {};
    const confirmLabels = [];
    if (extractedVitals.hemoglobin != null) confirmLabels.push(`Hemoglobin: ${extractedVitals.hemoglobin} g/dL`);
    if (extractedVitals.systolicBP != null) confirmLabels.push(`Blood Pressure: ${extractedVitals.systolicBP}/${extractedVitals.diastolicBP} mmHg`);
    if (extractedVitals.bloodSugar != null) confirmLabels.push(`Blood Sugar: ${extractedVitals.bloodSugar} mmol/L`);

    if (confirmLabels.length) {
      confirmCard.hidden = false;
      $("#report-confirm-list").innerHTML = `<ul class="recs-list">${confirmLabels.map((l) => `<li>${l}</li>`).join("")}</ul>`;
      $("#report-confirm-success").hidden = true;
      const btn = $("#report-confirm-btn");
      btn.disabled = false;
      btn.onclick = () => {
        addReportVitalsToHealthRecord(extractedVitals);
        btn.disabled = true;
        $("#report-confirm-success").hidden = false;
      };
    } else {
      confirmCard.hidden = true;
    }

    $("#report-preview").textContent = data.extractedTextPreview || "";
    $("#report-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ==================================================================
  // Privacy & Consent Centre
  // ==================================================================

  const SCOPED_STORAGE_KEYS = [
    { key: HISTORY_KEY, label: "assessmentHistory" },
    { key: EPDS_KEY, label: "mentalHealthCheck" },
    { key: GUIDE_KEY, label: "pregnancyGuide" },
    { key: NUTRITION_KEY, label: "nutritionCheck" },
    { key: REPORT_VITALS_LOG_KEY, label: "reportVitalsLog" },
    { key: TODAY_CARE_KEY, label: "todayCareChecklist" },
    { key: CHAT_HISTORY_KEY, label: "chatHistory" },
  ];

  function collectLocalExportData() {
    const data = {};
    SCOPED_STORAGE_KEYS.forEach(({ key, label }) => {
      try {
        const raw = localStorage.getItem(scopedKey(key));
        if (raw) data[label] = JSON.parse(raw);
      } catch { /* skip this key */ }
    });
    return data;
  }

  function clearScopedLocalData() {
    SCOPED_STORAGE_KEYS.forEach(({ key }) => {
      try { localStorage.removeItem(scopedKey(key)); } catch { /* non-fatal */ }
    });
  }

  $("#footer-privacy-link").addEventListener("click", () => showView("privacy-view"));

  $("#privacy-export-btn").addEventListener("click", async () => {
    const noteEl = $("#privacy-controls-note");
    noteEl.textContent = "Preparing your export…";
    const exportPayload = { exportedAt: new Date().toISOString(), local: collectLocalExportData() };

    if (getToken()) {
      try {
        const [assessRes, nutritionRes] = await Promise.all([
          fetch("/assessments/mine", { headers: authHeaders() }),
          fetch("/nutrition-checks/mine", { headers: authHeaders() }),
        ]);
        if (assessRes.ok) exportPayload.serverAssessments = (await assessRes.json()).data.assessments;
        if (nutritionRes.ok) exportPayload.serverNutritionChecks = (await nutritionRes.json()).data.checks;
      } catch { /* export whatever we have locally even if the server calls fail */ }
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `janamdatri-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    noteEl.textContent = "Export downloaded.";
  });

  $("#privacy-clear-local-btn").addEventListener("click", () => {
    const msg = currentLang === "hi"
      ? "यह इस डिवाइस पर आपका मूल्यांकन इतिहास, पोषण जांच, चैट, और चेकलिस्ट डेटा मिटा देगा। जारी रखें?"
      : "This will erase your local assessment history, nutrition checks, chat, and checklist data on this device (your account itself, if you have one, is not deleted). Continue?";
    if (!window.confirm(msg)) return;
    clearScopedLocalData();
    resetPerUserUIState();
    $("#privacy-controls-note").textContent = "Local data cleared on this device.";
  });

  $("#privacy-delete-account-btn").addEventListener("click", async () => {
    const msg = "This will PERMANENTLY delete your account and everything tied to it on our server - assessments, chat messages, nutrition checks. This cannot be undone. Continue?";
    if (!window.confirm(msg)) return;
    const noteEl = $("#privacy-controls-note");
    try {
      const res = await fetch("/auth/account", { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Could not delete your account. Please try again.");
      clearScopedLocalData();
      clearSession();
      syncUserArea();
      resetPerUserUIState();
      noteEl.textContent = "";
      showWelcomeOverlay(true);
    } catch (err) {
      noteEl.textContent = err.message;
    }
  });
})();
