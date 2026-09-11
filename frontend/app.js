(() => {
  const GAUGE_ARC_LENGTH = 283; // approx length of the semicircle path used in the SVG
  const HISTORY_KEY = "janamdatri_history";
  const MAX_HISTORY = 20;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------------- Navigation ----------------

  function showView(id) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === id));
    $$(".navlink").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === id));
    if (id === "history-view") renderHistory();
  }

  $$(".navlink").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  // ---------------- Vitals enable toggle ----------------

  const vitalsEnable = $("#vitals-enable");
  const vitalsGrid = $("#vitals-grid");

  function syncVitalsEnabled() {
    const enabled = vitalsEnable.checked;
    vitalsGrid.style.opacity = enabled ? "1" : "0.45";
    $$("#vitals-grid input").forEach((inp) => (inp.disabled = !enabled));
  }
  vitalsEnable.addEventListener("change", syncVitalsEnabled);
  syncVitalsEnabled();

  // ---------------- Symptom chips ----------------

  const symptomText = $("#symptom-text");

  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const phrase = chip.dataset.phrase;
      const current = symptomText.value;
      const already = current.toLowerCase().includes(phrase.toLowerCase());

      if (already) {
        const re = new RegExp("\\.?\\s*" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        symptomText.value = current.replace(re, "").trim();
        chip.classList.remove("selected");
      } else {
        symptomText.value = current ? current.trim().replace(/\.?$/, ". ") + phrase : phrase;
        chip.classList.add("selected");
      }
    });
  });

  // ---------------- Form submit ----------------

  const form = $("#assess-form");
  const submitBtn = $("#submit-btn");
  const errorMsg = $("#form-error");

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.querySelector(".spinner").hidden = !loading;
    submitBtn.querySelector(".btn-label").textContent = loading ? "Assessing…" : "Run Assessment";
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
    return {
      Age: Number($("#v-age").value),
      SystolicBP: Number($("#v-sbp").value),
      DiastolicBP: Number($("#v-dbp").value),
      BS: Number($("#v-bs").value),
      BodyTemp: Number($("#v-temp").value),
      HeartRate: Number($("#v-hr").value),
    };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.hidden = true;

    const text = symptomText.value.trim();
    const vitals = collectVitals();
    const history = collectHistoryFlags();

    if (!text && !vitals) {
      errorMsg.textContent = "Enable vitals and/or describe symptoms before running an assessment.";
      errorMsg.hidden = false;
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text || null, vitals, history }),
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

  // ---------------- Rendering ----------------

  const SEVERITY_COLOR = {
    Critical: "#d63031",
    Severe: "#e17055",
    Moderate: "#e0a300",
    Mild: "#00b894",
    Minimal: "#00b894",
  };

  function renderResult(data) {
    const { severity, mri, mlPrediction, dangerLadder, riskFormulation, activeExpertRules, recommendations } = data;

    // Severity banner
    const banner = $("#severity-banner");
    banner.className = "severity-banner level-" + severity.level.toLowerCase();
    $("#severity-emoji").textContent = severity.emoji;
    $("#severity-level").textContent = severity.level;
    $("#severity-sub").textContent =
      `Maternal Risk Index: ${mri}` + (severity.escalatedBy ? ` · escalated by: ${severity.escalatedBy.replace(/_/g, " ")}` : "");

    // Gauge
    const frac = Math.max(0, Math.min(mri, 100)) / 100;
    const fill = $("#gauge-fill");
    fill.style.stroke = SEVERITY_COLOR[severity.level] || "#00b894";
    fill.style.strokeDasharray = `${frac * GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`;
    $("#gauge-value").textContent = mri;

    // ML bars
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
        `Trained model — test accuracy ${(mlPrediction.modelTestAccuracy * 100).toFixed(1)}%, macro F1 ${mlPrediction.modelTestMacroF1.toFixed(2)}`;
    } else {
      $("#ml-model-name").textContent = "not used";
      mlBars.innerHTML = `<p class="footnote">No vitals were provided — ML prediction skipped.</p>`;
      $("#ml-footnote").textContent = "";
    }

    // Danger ladder
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

    // Risk factor tags
    $("#rf-multiplier").textContent = `×${riskFormulation.multiplier.toFixed(2)}`;
    fillTags("#tags-static", riskFormulation.staticRiskFactors, "static-tag");
    fillTags("#tags-dynamic", riskFormulation.dynamicRiskFactors, "dynamic-tag");
    fillTags("#tags-protective", riskFormulation.protectiveFactors, "protective-tag");

    // Expert rules
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

    // Recommendations
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

  // ---------------- New assessment / print ----------------

  $("#new-assessment-btn").addEventListener("click", () => {
    $("#results").hidden = true;
    $$(".chip.selected").forEach((c) => c.classList.remove("selected"));
    symptomText.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("#print-btn").addEventListener("click", () => window.print());

  // ---------------- History (localStorage) ----------------

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveToHistory(result) {
    try {
      const history = loadHistory();
      history.unshift({
        timestamp: new Date().toISOString(),
        severityLevel: result.severity.level,
        mri: result.mri,
        result,
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {
      // localStorage unavailable (private browsing etc.) - non-fatal, just skip persisting
    }
  }

  function renderHistory() {
    const container = $("#history-list");
    const history = loadHistory();
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
        <div>
          <strong>${entry.severityLevel}</strong>
          <div class="history-row-meta">${date.toLocaleString()}</div>
        </div>
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
})();
