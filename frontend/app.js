(() => {
  const GAUGE_ARC_LENGTH = 283;
  const HISTORY_KEY = "janamdatri_history";
  const EPDS_KEY = "janamdatri_last_epds";
  const LANG_KEY = "janamdatri_lang";
  const MAX_HISTORY = 20;

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
      showWelcomeOverlay(false);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  $("#guest-btn").addEventListener("click", () => {
    localStorage.setItem(GUEST_KEY, "true");
    showWelcomeOverlay(false);
  });

  $("#logout-btn").addEventListener("click", () => {
    clearSession();
    syncUserArea();
    showWelcomeOverlay(true);
  });

  // ==================================================================
  // i18n
  // ==================================================================

  const TRANSLATIONS = {
    en: {
      tagline: "Maternal Risk Triage",
      "nav.assess": "Assessment", "nav.guide": "Pregnancy Guide", "nav.psych": "Mental Health",
      "nav.history": "History", "nav.reports": "My Reports", "nav.help": "Helplines",
      emergencyBtn: "🚨 Call 108",
      disclaimer: "⚠️ Screening aid only — not a diagnosis. <strong>Critical</strong> or <strong>Severe</strong> always means seek facility care now.",
      "section.vitals": "1 · Vitals", includeVitals: "Include vitals",
      "field.age": "Age (years)", "field.sbp": "Systolic BP", "field.dbp": "Diastolic BP",
      "field.bs": "Blood Sugar (mmol/L)", "field.temp": "Body Temp (°F)", "field.hr": "Heart Rate (bpm)",
      "section.anemia": "1b · Anemia Check",
      "anemia.sub": "If you have a recent hemoglobin (Hb) test result, enter it here for India-specific anemia grading.",
      "field.hb": "Hemoglobin (g/dL)",
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
      "nav.assess": "मूल्यांकन", "nav.guide": "गर्भावस्था गाइड", "nav.psych": "मानसिक स्वास्थ्य",
      "nav.history": "इतिहास", "nav.reports": "मेरी रिपोर्ट", "nav.help": "हेल्पलाइन",
      emergencyBtn: "🚨 108 पर कॉल करें",
      disclaimer: "⚠️ यह केवल एक जांच सहायता है — निदान नहीं। <strong>गंभीर</strong> या <strong>अति गंभीर</strong> परिणाम का मतलब है तुरंत अस्पताल जाएं।",
      "section.vitals": "1 · महत्वपूर्ण संकेत", includeVitals: "Vitals शामिल करें",
      "field.age": "आयु (वर्ष)", "field.sbp": "सिस्टोलिक बीपी", "field.dbp": "डायस्टोलिक बीपी",
      "field.bs": "ब्लड शुगर (mmol/L)", "field.temp": "शरीर का तापमान (°F)", "field.hr": "हृदय गति (bpm)",
      "section.anemia": "1b · एनीमिया जांच",
      "anemia.sub": "यदि आपके पास हाल की हीमोग्लोबिन (Hb) रिपोर्ट है, तो भारत-विशिष्ट एनीमिया ग्रेडिंग के लिए यहां दर्ज करें।",
      "field.hb": "हीमोग्लोबिन (g/dL)",
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
  }));

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
        body: JSON.stringify({ text: text || null, vitals, history, hemoglobin, epdsResponses }),
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
    Critical: "#d63031", Severe: "#e17055", Moderate: "#e0a300", Mild: "#00b894", Minimal: "#00b894",
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
      recommendations, hemoglobinAssessment, psychologicalEvaluation, clinicalImpression } = data;

    const banner = $("#severity-banner");
    banner.className = "severity-banner level-" + severity.level.toLowerCase();
    $("#severity-emoji").textContent = severity.emoji;
    $("#severity-level").textContent = severity.level;
    $("#severity-sub").textContent =
      `Maternal Risk Index: ${mri}` + (severity.escalatedBy ? ` · escalated by: ${severity.escalatedBy.replace(/_/g, " ")}` : "");

    const frac = Math.max(0, Math.min(mri, 100)) / 100;
    const fill = $("#gauge-fill");
    fill.style.stroke = SEVERITY_COLOR[severity.level] || "#00b894";
    fill.style.strokeDasharray = `${frac * GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`;
    animateGaugeValue(mri);

    const mlBars = $("#ml-bars");
    mlBars.innerHTML = "";
    if (mlPrediction) {
      $("#ml-model-name").textContent = mlPrediction.modelName.replace(/_/g, " ");
      const order = [["low risk", "#00b894"], ["mid risk", "#e0a300"], ["high risk", "#d63031"]];
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
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  }

  function saveToHistory(result) {
    try {
      const history = loadHistory();
      history.unshift({ timestamp: new Date().toISOString(), severityLevel: result.severity.level, mri: result.mri, result });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
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
    localStorage.removeItem(HISTORY_KEY);
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
      localStorage.setItem(EPDS_KEY, JSON.stringify({ responses, result, savedAt: new Date().toISOString() }));
    } catch { /* non-fatal */ }
  }

  function loadSavedEpds() {
    try { return JSON.parse(localStorage.getItem(EPDS_KEY)); } catch { return null; }
  }

  syncEpdsIncludeVisibility();

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
  const chatMessages = $("#chat-messages");

  function loadChatHistory() {
    try { return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY)) || []; } catch { return []; }
  }

  function saveChatHistory(messages) {
    try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-40))); } catch { /* non-fatal */ }
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
    chatFab.hidden = true;
    if (!chatMessages.children.length) renderChatHistory();
    $("#chat-input").focus();
  });

  $("#chat-close-btn").addEventListener("click", () => {
    chatPanel.hidden = true;
    chatFab.hidden = false;
  });

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

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message }),
      });
      const payload = await res.json();
      typingEl.remove();
      if (!res.ok) throw new Error(payload.detail || "Chat failed.");
      appendChatMessage("bot", payload.data.reply, payload.data.isEmergency);
      history.push({ sender: "bot", text: payload.data.reply, isEmergency: payload.data.isEmergency });
      saveChatHistory(history);
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
