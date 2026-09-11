(() => {
  const GAUGE_ARC_LENGTH = 283;
  const HISTORY_KEY = "janamdatri_history";
  const EPDS_KEY = "janamdatri_last_epds";
  const GUIDE_KEY = "janamdatri_last_guide";
  const NUTRITION_KEY = "janamdatri_last_nutrition";
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
    if (user && getToken()) {
      area.hidden = false;
      $("#user-name-display").textContent = "Hi, " + (user.name || user.email.split("@")[0]);
    } else {
      area.hidden = true;
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
      "nav.home": "Home", "nav.assess": "Assessment", "nav.guide": "Pregnancy Guide", "nav.nutrition": "Nutrition",
      "nav.psych": "Mental Health", "nav.history": "History", "nav.reports": "My Reports", "nav.help": "Helplines",
      "home.weekNotSet": "Set your pregnancy week",
      "home.snapshotTitle": "Health Snapshot", "home.nutritionTitle": "Nutrition", "home.viewNutrition": "View Nutrition Analysis →",
      "home.todaysCare": "Today's Care", "home.thisWeek": "This Week", "home.urgentAlerts": "Urgent Alerts",
      "home.quickActions": "Quick Actions",
      "home.actionAssess": "Run Assessment", "home.actionGuide": "Pregnancy Guide",
      "home.actionNutrition": "Nutrition Analysis",
      "home.actionPsych": "Mental Health Check", "home.actionReports": "My Reports",
      "home.actionChat": "Instant Help Chat", "home.actionHelp": "Helplines",
      "home.tipLabel": "Tip of the day",
      "nutrition.title": "Nutrition Analysis",
      "nutrition.sub": "Tell me how often you eat these food groups, and I'll check your intake against pregnancy nutrient needs (iron, protein, folate, calcium, B12, vitamin D, iodine) and suggest specific, affordable Indian foods to close any gaps. Not a lab test - a starting point for the conversation with your ANC provider or a nutritionist.",
      "nutrition.analyze": "Analyze My Diet", "nutrition.result": "Your Nutrient Adequacy",
      "home.greetingMorning": "Good morning", "home.greetingAfternoon": "Good afternoon", "home.greetingEvening": "Good evening",
      emergencyBtn: "🚨 Call 108",
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
      "section.symptoms": "2 · Symptoms",
      "symptoms.sub": "Tap any that apply — they'll be added to the description below, or type your own.",
      "symptoms.placeholder": "Describe how you're feeling in your own words…",
      "section.history": "3 · History", "history.sub": "Optional — helps weigh background risk factors.",
      "history.past": "Past pregnancy history",
      "hist.csection": "Prior C-section", "hist.preeclampsia": "Prior pre-eclampsia",
      "hist.pph": "Prior postpartum hemorrhage", "hist.stillbirth": "Prior stillbirth/loss",
      "hist.hypertension": "Chronic hypertension", "hist.diabetes": "Pre-existing diabetes",
      "history.current": "Current pregnancy care",
      "hist.anc": "Regular ANC visits", "hist.ifa": "Taking iron/folic supplements",
      "hist.institutional": "Planning institutional delivery", "hist.birthplan": "Has a birth preparedness plan",
      "hist.family": "Supportive family", "hist.noanc": "No ANC visits so far",
      includeEpds: "Include my saved Mental Health Check (EPDS) score in this assessment",
      runAssessment: "Run Assessment",
      riskGauge: "Risk Gauge", mlPrediction: "ML Prediction", dangerLadder: "Danger-Sign Ladder",
      riskFactors: "Risk Factors", static: "Static", dynamic: "Dynamic", protective: "Protective",
      anemiaGrading: "Anemia Grading (India)", psychEval: "Psychological Evaluation (EPDS)",
      activeRules: "Active Expert Rules", recommendations: "Recommendations",
      newAssessment: "New Assessment", readAloud: "Read Aloud", printReport: "Print Report",
      "wizard.vitals": "Vitals", "wizard.symptoms": "Symptoms", "wizard.history": "History", "wizard.review": "Review",
      "wizard.back": "← Back", "wizard.nextSymptoms": "Next: Symptoms →", "wizard.nextHistory": "Next: History →",
      "wizard.nextReview": "Next: Review →", "wizard.reviewHeading": "4 · Review",
      "wizard.reviewSub": "Check what you're about to submit, then run the assessment.",
      "guide.title": "Pregnancy Guide",
      "guide.sub": "Week-by-week ANC visit schedule, nutrition tips, and danger signs — aligned with India's RCH programme.",
      "guide.byLmp": "By last menstrual period (LMP)", "guide.byWeek": "By current week",
      "guide.lmpLabel": "Last menstrual period date", "guide.weekLabel": "Current gestational week",
      "guide.getGuide": "Get My Guide", "guide.nutrition": "Nutrition Tips",
      "guide.dangerSigns": "Watch For (Danger Signs)", "guide.ancSchedule": "ANC Visit Schedule",
      "guide.schemes": "Government Schemes",
      "psych.title": "Mental Health Check",
      "psych.sub": "The Edinburgh Postnatal Depression Scale (EPDS) — a validated 10-question screening tool for how you've felt over the past 7 days, used during pregnancy and after birth. This is a screening aid, not a diagnosis.",
      "psych.score": "Score My Mood", "psych.result": "Your Result",
      "history.title": "Assessment History", clear: "Clear",
      "history.stored": "Stored only in this browser (not sent anywhere).",
      "reports.title": "My Reports",
      "reports.sub": "Upload a prescription or lab report (PDF/TXT), or paste its text, and get a clear medication schedule (what to take, when) and a summary of any values worth discussing with your provider.",
      "reports.uploadLabel": "Upload file (.pdf or .txt)", "reports.pasteLabel": "Paste the report's text",
      "reports.pastePlaceholder": "e.g. Tab. Folic Acid 5mg OD morning, Hemoglobin: 9.2 g/dl…",
      "reports.analyze": "Analyze Report", "reports.summary": "Summary", "reports.schedule": "Medication Schedule",
      "reports.findings": "Key Findings", "reports.preview": "Extracted Text (preview)",
      "help.title": "Helplines", "help.ambulance": "Emergency Ambulance",
      "help.transport": "Pregnancy Emergency Transport", "help.national": "National Health Helpline",
      "help.women": "Women's Helpline", "help.child": "Child Helpline",
      "help.mental": "Mental Health Helpline (1800-599-0019)", "help.schemes": "Government Schemes",
      footer: "Automated screening/prioritization aid combining an ML classifier trained on the UCI Maternal Health Risk dataset with a rule-based danger-sign evaluation layer covering physical AND psychological (EPDS) risk. Not a diagnosis.",
    },
    hi: {
      tagline: "मातृ जोखिम मूल्यांकन",
      "nav.home": "होम", "nav.assess": "मूल्यांकन", "nav.guide": "गर्भावस्था गाइड", "nav.nutrition": "पोषण",
      "nav.psych": "मानसिक स्वास्थ्य", "nav.history": "इतिहास", "nav.reports": "मेरी रिपोर्ट", "nav.help": "हेल्पलाइन",
      "home.weekNotSet": "अपना गर्भावस्था सप्ताह सेट करें",
      "home.snapshotTitle": "स्वास्थ्य स्नैपशॉट", "home.nutritionTitle": "पोषण", "home.viewNutrition": "पोषण विश्लेषण देखें →",
      "home.todaysCare": "आज की देखभाल", "home.thisWeek": "इस सप्ताह", "home.urgentAlerts": "आपातकालीन चेतावनी",
      "home.quickActions": "त्वरित कार्य",
      "home.actionAssess": "मूल्यांकन करें", "home.actionGuide": "गर्भावस्था गाइड",
      "home.actionNutrition": "पोषण विश्लेषण",
      "home.actionPsych": "मानसिक स्वास्थ्य जांच", "home.actionReports": "मेरी रिपोर्ट",
      "home.actionChat": "तुरंत सहायता चैट", "home.actionHelp": "हेल्पलाइन",
      "home.tipLabel": "आज की सलाह",
      "nutrition.title": "पोषण विश्लेषण",
      "nutrition.sub": "बताएं कि आप ये खाद्य समूह कितनी बार खाती हैं, और मैं गर्भावस्था के पोषक तत्वों (आयरन, प्रोटीन, फोलेट, कैल्शियम, B12, विटामिन D, आयोडीन) से आपके सेवन की तुलना करूंगी और कमी को पूरा करने के लिए किफायती भारतीय भोजन सुझाऊंगी। यह लैब टेस्ट नहीं है - अपने ANC प्रदाता या न्यूट्रिशनिस्ट से बातचीत शुरू करने का एक तरीका है।",
      "nutrition.analyze": "मेरे आहार का विश्लेषण करें", "nutrition.result": "आपकी पोषक तत्व पर्याप्तता",
      "home.greetingMorning": "सुप्रभात", "home.greetingAfternoon": "नमस्ते", "home.greetingEvening": "शुभ संध्या",
      emergencyBtn: "🚨 108 पर कॉल करें",
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
      "section.symptoms": "2 · लक्षण",
      "symptoms.sub": "जो लागू हो उसे टैप करें — यह नीचे विवरण में जुड़ जाएगा, या अपने शब्दों में लिखें।",
      "symptoms.placeholder": "आप कैसा महसूस कर रही हैं, अपने शब्दों में बताएं…",
      "section.history": "3 · इतिहास", "history.sub": "वैकल्पिक — पृष्ठभूमि जोखिम कारकों का आकलन करने में मदद करता है।",
      "history.past": "पिछली गर्भावस्था का इतिहास",
      "hist.csection": "पहले सिजेरियन हुआ था", "hist.preeclampsia": "पहले प्री-एक्लेम्पसिया हुआ था",
      "hist.pph": "पहले प्रसवोत्तर रक्तस्राव हुआ था", "hist.stillbirth": "पहले मृत जन्म/गर्भपात हुआ था",
      "hist.hypertension": "पुराना उच्च रक्तचाप", "hist.diabetes": "पहले से मधुमेह",
      "history.current": "वर्तमान गर्भावस्था देखभाल",
      "hist.anc": "नियमित एएनसी जांच", "hist.ifa": "आयरन/फोलिक सप्लीमेंट ले रही हूं",
      "hist.institutional": "संस्थागत प्रसव की योजना", "hist.birthplan": "प्रसव-तैयारी योजना है",
      "hist.family": "सहायक परिवार", "hist.noanc": "अभी तक कोई एएनसी जांच नहीं",
      includeEpds: "मेरा सहेजा गया मानसिक स्वास्थ्य (EPDS) स्कोर इस मूल्यांकन में शामिल करें",
      runAssessment: "मूल्यांकन करें",
      riskGauge: "जोखिम गेज", mlPrediction: "एआई पूर्वानुमान", dangerLadder: "खतरे के संकेत सीढ़ी",
      riskFactors: "जोखिम कारक", static: "स्थिर", dynamic: "गतिशील", protective: "सुरक्षात्मक",
      anemiaGrading: "एनीमिया ग्रेडिंग (भारत)", psychEval: "मानसिक मूल्यांकन (EPDS)",
      activeRules: "सक्रिय विशेषज्ञ नियम", recommendations: "सिफारिशें",
      newAssessment: "नया मूल्यांकन", readAloud: "ज़ोर से पढ़ें", printReport: "रिपोर्ट प्रिंट करें",
      "wizard.vitals": "वाइटल्स", "wizard.symptoms": "लक्षण", "wizard.history": "इतिहास", "wizard.review": "समीक्षा",
      "wizard.back": "← पीछे", "wizard.nextSymptoms": "अगला: लक्षण →", "wizard.nextHistory": "अगला: इतिहास →",
      "wizard.nextReview": "अगला: समीक्षा →", "wizard.reviewHeading": "4 · समीक्षा",
      "wizard.reviewSub": "जमा करने से पहले अपनी जानकारी जांच लें।",
      "guide.title": "गर्भावस्था गाइड",
      "guide.sub": "साप्ताहिक एएनसी यात्रा कार्यक्रम, पोषण सुझाव, और खतरे के संकेत — भारत के RCH कार्यक्रम के अनुसार।",
      "guide.byLmp": "अंतिम मासिक धर्म तिथि (LMP) से", "guide.byWeek": "वर्तमान सप्ताह से",
      "guide.lmpLabel": "अंतिम मासिक धर्म तिथि", "guide.weekLabel": "वर्तमान गर्भावधि सप्ताह",
      "guide.getGuide": "मेरी गाइड प्राप्त करें", "guide.nutrition": "पोषण सुझाव",
      "guide.dangerSigns": "ध्यान दें (खतरे के संकेत)", "guide.ancSchedule": "एएनसी यात्रा कार्यक्रम",
      "guide.schemes": "सरकारी योजनाएं",
      "psych.title": "मानसिक स्वास्थ्य जांच",
      "psych.sub": "एडिनबर्ग प्रसवोत्तर अवसाद स्केल (EPDS) — पिछले 7 दिनों में आप कैसा महसूस कर रही हैं, इसके लिए एक मान्य 10-प्रश्न जांच उपकरण। यह एक जांच सहायता है, निदान नहीं।",
      "psych.score": "मेरा मूड स्कोर करें", "psych.result": "आपका परिणाम",
      "history.title": "मूल्यांकन इतिहास", clear: "साफ़ करें",
      "history.stored": "केवल इस ब्राउज़र में संग्रहीत (कहीं भेजा नहीं जाता)।",
      "reports.title": "मेरी रिपोर्ट",
      "reports.sub": "प्रिस्क्रिप्शन या लैब रिपोर्ट (PDF/TXT) अपलोड करें, या उसका टेक्स्ट पेस्ट करें, और दवा का शेड्यूल (क्या लेना है, कब लेना है) पाएं।",
      "reports.uploadLabel": "फ़ाइल अपलोड करें (.pdf या .txt)", "reports.pasteLabel": "रिपोर्ट का टेक्स्ट पेस्ट करें",
      "reports.pastePlaceholder": "उदा. Tab. Folic Acid 5mg OD morning, Hemoglobin: 9.2 g/dl…",
      "reports.analyze": "रिपोर्ट का विश्लेषण करें", "reports.summary": "सारांश", "reports.schedule": "दवा शेड्यूल",
      "reports.findings": "मुख्य निष्कर्ष", "reports.preview": "निकाला गया टेक्स्ट (पूर्वावलोकन)",
      "help.title": "हेल्पलाइन", "help.ambulance": "आपातकालीन एम्बुलेंस",
      "help.transport": "गर्भावस्था आपातकालीन परिवहन", "help.national": "राष्ट्रीय स्वास्थ्य हेल्पलाइन",
      "help.women": "महिला हेल्पलाइन", "help.child": "चाइल्ड हेल्पलाइन",
      "help.mental": "मानसिक स्वास्थ्य हेल्पलाइन (1800-599-0019)", "help.schemes": "सरकारी योजनाएं",
      footer: "यूसीआई मातृ स्वास्थ्य जोखिम डेटासेट पर प्रशिक्षित एआई मॉडल और शारीरिक व मानसिक (EPDS) जोखिम को कवर करने वाली नियम-आधारित प्रणाली का संयोजन। यह निदान नहीं है।",
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

  function renderTodayCare() {
    const state = loadTodayCareState();
    const guide = loadLastGuide();
    const nutritionDone = !!loadSavedNutrition();

    const tasks = [
      { id: "supplement", text: "Take your prescribed iron-folic acid supplement", manual: true },
      { id: "hydration", text: "Stay hydrated through the day", manual: true },
      { id: "nutrition_check", text: "Complete your nutrition check", manual: false, done: nutritionDone },
    ];
    if (guide && guide.nextAncVisit) {
      tasks.push({ id: "anc_followup", text: `ANC follow-up: Visit ${guide.nextAncVisit.visit} (${guide.nextAncVisit.window})`, manual: true });
    }
    tasks.push({ id: "warning_signs_review", text: "Review this week's warning signs", manual: true });

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
        renderTodayCare();
      });
    });
  }

  function renderThisWeek() {
    const guide = loadLastGuide();
    const container = $("#home-this-week");
    if (!guide) {
      container.innerHTML = `<p class="footnote">Set your pregnancy week in the Pregnancy Guide tab to see week-specific guidance here.</p>`;
      return;
    }
    const sections = [
      { id: "mother", label: "Mother's Health", detail: `<p>${guide.note}</p>` },
      { id: "nutrition", label: "Nutrition Tips", detail: `<ul>${guide.nutrition.map((n) => `<li>${n}</li>`).join("")}</ul>` },
      { id: "tests", label: "Tests & Checkups", detail: `<ul>${guide.nextAncVisit.checks.map((c) => `<li>${c}</li>`).join("")}</ul>` },
      { id: "warning", label: "Warning Signs", detail: `<ul>${guide.dangerSigns.map((d) => `<li>${d}</li>`).join("")}</ul>` },
    ];
    container.innerHTML = sections.map((s) => `
      <button type="button" class="this-week-item" data-week-section="${s.id}"><span>${s.label}</span><span>→</span></button>
      <div class="this-week-detail" id="this-week-detail-${s.id}">${s.detail}</div>`).join("");
    container.querySelectorAll(".this-week-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("#this-week-detail-" + btn.dataset.weekSection).classList.toggle("open");
      });
    });
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
    renderTodayCare();
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
    });
  });

  $("#home-chat-action").addEventListener("click", () => chatFab.click());

  renderHome();

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

    const savedEpds = loadSavedEpds();
    const includeEpds = savedEpds && $("#include-epds").checked;
    const epdsResponses = includeEpds ? savedEpds.responses : null;

    if (!text && !vitals && hemoglobin === null && !epdsResponses) {
      errorMsg.textContent = currentLang === "hi"
        ? "मूल्यांकन चलाने से पहले Vitals, लक्षण, हीमोग्लोबिन या EPDS में से कुछ दर्ज करें।"
        : "Provide vitals, symptoms, hemoglobin, or an EPDS score before running an assessment.";
      errorMsg.hidden = false;
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text: text || null, vitals, history, hemoglobin, epdsResponses, pregnancyWeek }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.detail || "Assessment failed.");
      renderResult(payload.data);
      saveToHistory(payload.data);
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
      clinicalExplanation, gestationalContext } = data;

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
        <p class="footnote">${hemoglobinAssessment.methodology}</p>`;
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
        ${p.selfHarmFlagged ? `<div class="self-harm-alert">🚨 Self-harm item flagged — please reach out to the KIRAN helpline (1800-599-0019) or someone you trust now.</div>` : ""}`;
    } else {
      psychCard.hidden = true;
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

  async function renderHistory() {
    const container = $("#history-list");
    const serverHistory = await loadServerHistory();
    const history = serverHistory !== null ? serverHistory : loadHistory();
    container.innerHTML = "";

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

    $("#guide-nutrition").innerHTML = guide.nutrition.map((n) => `<li>${n}</li>`).join("");
    $("#guide-danger").innerHTML = guide.dangerSigns.map((d) => `<li>${d}</li>`).join("");

    $("#guide-anc-schedule").innerHTML = guide.ancSchedule.map((visit) => `
      <div class="anc-visit ${visit.visit === guide.nextAncVisit.visit ? "next" : ""}">
        <div class="anc-visit-head"><span>Visit ${visit.visit} — ${visit.window}</span>${visit.visit === guide.nextAncVisit.visit ? "<span>Next up</span>" : ""}</div>
        <ul>${visit.checks.map((c) => `<li>${c}</li>`).join("")}</ul>
      </div>`).join("");

    $("#guide-schemes").innerHTML = Object.entries(guide.schemes).map(([name, desc]) => `
      <div class="scheme-tile"><strong>${name}</strong><span>${desc}</span></div>`).join("");
  }

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
    } catch (err) {
      alert(err.message || "Could not score EPDS.");
    }
  });

  function renderEpdsResult(result) {
    $("#epds-result-card").hidden = false;
    $("#epds-result-content").innerHTML = `
      <div class="epds-total-display"><span class="big">${result.total}</span><span>/ ${result.maxScore}</span></div>
      <p><strong>${result.classification}</strong></p>
      ${result.selfHarmFlagged ? `<div class="self-harm-alert">🚨 You indicated thoughts of self-harm have occurred to you. Please talk to someone you trust right now, or call the KIRAN mental health helpline: 1800-599-0019 (toll-free, 24x7).</div>` : ""}
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

    $("#report-preview").textContent = data.extractedTextPreview || "";
    $("#report-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
