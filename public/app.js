const byId = (id) => document.getElementById(id);
const state = byId("state");
const questions = byId("questions");
const run = byId("run");
let activePreset = "refund";
let lastResult = null;
let runs = 0;
let running = false;
let toastTimer;
const presets = {};

function icons() { window.lucide.createIcons(); }
function showError(message) { byId("error").textContent = message; byId("error").hidden = !message; }
function toast(message) {
  clearTimeout(toastTimer);
  byId("toast").textContent = message;
  byId("toast").hidden = false;
  toastTimer = setTimeout(() => { byId("toast").hidden = true; }, 2500);
}
function updateCounts() {
  byId("state-size").textContent = `${state.value.length.toLocaleString()} characters`;
  try { byId("question-count").textContent = Object.keys(JSON.parse(questions.value)).length; }
  catch { byId("question-count").textContent = "-"; }
}
function clearResult() {
  lastResult = null;
  byId("answers").replaceChildren();
  byId("raw").textContent = "{}";
  byId("empty").hidden = false;
  byId("result-summary").hidden = true;
  byId("copy").disabled = true;
  byId("download").disabled = true;
  byId("result-status").textContent = "AWAITING INPUT";
}
function loadPreset(name) {
  activePreset = name;
  state.value = JSON.stringify(presets[name].state, null, 2);
  questions.value = JSON.stringify(presets[name].questions, null, 2);
  document.querySelectorAll(".preset").forEach((button) => {
    const active = button.dataset.preset === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateCounts(); clearResult(); showError("");
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const percent = (value) => `${(value * 100).toFixed(1)}%`;
function renderResult(result) {
  byId("answers").replaceChildren();
  for (const [name, answer] of Object.entries(result.answers)) {
    const section = element("article", "answer");
    const heading = element("div", "answer-heading");
    heading.append(element("h3", "", name), element("span", "type-label", answer.type === "noul" ? "YES / NO" : answer.type));
    const value = element("div", "answer-value");
    const label = answer.type === "choice" ? answer.choice : answer.type === "score" ? answer.score.toFixed(2) : answer.noul >= 0.5 ? "Yes" : "No";
    value.append(element("strong", "", label), element("span", "", percent(answer.answer_confidence)));
    section.append(heading, value);
    const probabilities = answer.type === "noul" ? { Yes: answer.noul, No: 1 - answer.noul } : answer.probabilities;
    const maximum = Math.max(...Object.values(probabilities));
    for (const [key, probability] of Object.entries(probabilities)) {
      const row = element("div", `probability-row${probability === maximum ? " winner" : ""}`);
      const track = element("div", "probability-track");
      const fill = element("div", "probability-fill");
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, probability))})`;
      track.append(fill);
      row.append(element("span", "probability-label", answer.legend?.[key] ?? key), track, element("span", "probability-number", percent(probability)));
      section.append(row);
    }
    section.append(element("div", "confidence-label", "Answer confidence"));
    byId("answers").append(section);
  }
  byId("latency").textContent = `${result.duration_ms.toLocaleString()} ms`;
  byId("tokens").textContent = result.usage.input_tokens.toLocaleString();
  byId("answer-total").textContent = Object.keys(result.answers).length;
  byId("result-summary").hidden = false;
  byId("empty").hidden = true;
  byId("raw").textContent = JSON.stringify(result, null, 2);
  byId("result-status").textContent = "COMPLETE";
  byId("copy").disabled = false;
  byId("download").disabled = false;
  byId("run-count").textContent = `${++runs} ${runs === 1 ? "run" : "runs"}`;
}

async function decide() {
  if (running) return;
  showError("");
  let input;
  try { input = { state: JSON.parse(state.value), questions: JSON.parse(questions.value) }; }
  catch (error) { showError(`Invalid JSON: ${error.message}`); return; }
  running = true;
  run.disabled = true;
  run.querySelector("span").textContent = "Deciding...";
  document.querySelector(".results-panel").setAttribute("aria-busy", "true");
  state.disabled = true; questions.disabled = true;
  document.querySelectorAll(".preset, #reset, #add-question, #format-state, #format-questions").forEach((button) => { button.disabled = true; });
  clearResult();
  byId("result-status").textContent = "RUNNING";
  try {
    const response = await fetch("/api/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Decision failed.");
    lastResult = result;
    renderResult(result);
  } catch (error) { showError(error.message); byId("result-status").textContent = "FAILED"; }
  finally {
    running = false; run.disabled = false;
    run.querySelector("span").textContent = "Run decision";
    document.querySelector(".results-panel").setAttribute("aria-busy", "false");
    state.disabled = false; questions.disabled = false;
    document.querySelectorAll(".preset, #reset, #add-question, #format-state, #format-questions").forEach((button) => { button.disabled = false; });
  }
}

for (const editor of [state, questions]) editor.addEventListener("input", () => { updateCounts(); clearResult(); showError(""); });
byId("presets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (button && !running) loadPreset(button.dataset.preset);
});
byId("reset").addEventListener("click", () => loadPreset(activePreset));
run.addEventListener("click", decide);
for (const [button, editor] of [["format-state", state], ["format-questions", questions]]) {
  byId(button).addEventListener("click", () => {
    try { editor.value = JSON.stringify(JSON.parse(editor.value), null, 2); updateCounts(); showError(""); }
    catch (error) { showError(`Invalid JSON: ${error.message}`); }
  });
}
byId("add-question").addEventListener("click", () => {
  try {
    const current = JSON.parse(questions.value);
    if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("Questions must be a JSON object.");
    const type = byId("question-type").value;
    let index = 1;
    while (Object.hasOwn(current, `question_${index}`)) index++;
    current[`question_${index}`] = { type, instructions: "Is the customer satisfied?", ...(type === "choice" ? { criteria: ["satisfied", "not satisfied"] } : type === "score" ? { criteria: ["not satisfied", "neutral", "satisfied"] } : {}) };
    questions.value = JSON.stringify(current, null, 2);
    updateCounts(); clearResult(); showError("");
    questions.focus(); questions.scrollTop = questions.scrollHeight;
  } catch (error) { showError(error.message); }
});
const tabs = [byId("answers-tab"), byId("json-tab")];
function selectTab(index) {
  tabs.forEach((tab, position) => {
    tab.classList.toggle("selected", position === index);
    tab.setAttribute("aria-selected", String(position === index));
    tab.tabIndex = position === index ? 0 : -1;
    byId(tab.getAttribute("aria-controls")).hidden = position !== index;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(index));
  tab.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
      selectTab(next); tabs[next].focus();
    }
  });
});
byId("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2)); toast("Result copied"); }
  catch { showError("Clipboard unavailable. Use the download button instead."); }
});
byId("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastResult, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "laya-decision.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function initialize() {
  icons();
  try {
    const [exampleResponse, healthResponse] = await Promise.all([fetch("/example.json"), fetch("/api/health")]);
    if (!exampleResponse.ok || !healthResponse.ok) throw new Error("Local server is unavailable. Reload after restarting it.");
    presets.refund = await exampleResponse.json();
    const health = await healthResponse.json();
    presets.security = {
      state: { subject: "Unrecognized sign-in", body: "I received a login alert from a new device in another country. I did not sign in. Please secure my account." },
      questions: {
        risk: { type: "score", instructions: "How high is the account security risk?", criteria: ["low", "moderate", "high", "critical"] },
        action: { type: "choice", instructions: "What action should be taken first?", criteria: { secure_account: "Revoke sessions and reset credentials", billing: "Review payment history", no_action: "No action needed" } },
        suspicious_login: { type: "noul", instructions: "Does the message report an unauthorized login?" },
      },
    };
    presets.support = {
      state: { subject: "Export fails with an error", body: "Every time I export our monthly report the app shows error 500. This started after yesterday's update and blocks our finance team." },
      questions: {
        department: { type: "choice", instructions: "Which team should handle this ticket?", criteria: { engineering: "Software defects and server errors", billing: "Invoices and payments", sales: "New subscriptions" } },
        urgency: { type: "score", instructions: "How urgent is the request?", criteria: ["low", "normal", "high", "critical"] },
        blocking: { type: "noul", instructions: "Does the issue block the customer's work?" },
      },
    };
    loadPreset("refund");
    byId("connection").textContent = health.ready ? "Model ready" : "Not ready";
    run.disabled = !health.ready;
  } catch (error) { byId("connection").textContent = "Disconnected"; showError(error.message); }
}
initialize();