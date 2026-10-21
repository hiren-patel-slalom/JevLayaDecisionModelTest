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
    presets.sales = {
      state: { subject: "Enterprise plan for 80 seats", body: "We have approved a budget for 80 licenses and need SSO and audit logs. Can we arrange a demo this week? We want to launch next month." },
      questions: {
        intent: { type: "choice", instructions: "What is the primary intent of this message?", criteria: { purchase: "Evaluate or buy a paid product", support: "Get help with an existing technical problem", cancellation: "Cancel an existing subscription" } },
        purchase_readiness: { type: "score", instructions: "How ready is this lead to purchase?", criteria: ["casual interest", "exploring options", "active evaluation", "budget and timeline confirmed"] },
        demo_requested: { type: "noul", instructions: "Does the sender explicitly request a product demo?" },
      },
    };
    presets.feedback = {
      state: { review: "The new dashboard is beautiful and the reports are useful, but pages take forever to load. We like the product overall, yet the slow performance is frustrating.", rating: "3 out of 5" },
      questions: {
        sentiment: { type: "choice", instructions: "What is the overall sentiment of this review?", criteria: { positive: "Mostly praise without substantial complaints", negative: "Mostly dissatisfaction without praise", mixed: "Both meaningful praise and meaningful criticism" } },
        main_complaint: { type: "choice", instructions: "What is the main complaint?", criteria: { performance: "Slow loading or response times", pricing: "Cost or subscription fees", usability: "Confusing navigation or difficult controls" } },
        performance_issue: { type: "noul", instructions: "Does the reviewer report slow performance?" },
      },
    };
    presets.spam = {
      state: { sender: "Prize Claims Team", subject: "You won a prize you never entered!", body: "Congratulations! You have been randomly selected for a cash prize. Reply with your bank account details and pay a processing fee today to claim it.", prior_contact: false },
      questions: {
        category: { type: "choice", instructions: "How should this email be categorized?", criteria: { personal: "Expected message from a personal contact", business: "Legitimate work-related correspondence", suspicious: "Unsolicited prize or sensitive-data request" } },
        suspicion: { type: "score", instructions: "How suspicious is this message?", criteria: ["not suspicious", "slightly suspicious", "suspicious", "highly suspicious"] },
        requests_bank_details: { type: "noul", instructions: "Does the sender ask for bank account details?" },
      },
    };
    presets.delivery = {
      state: { order_id: "DEMO-1042", carrier_status: "delivered", customer_message: "Tracking says my order was delivered this morning, but there is no package at my door or reception. I checked with my neighbors too. Please help locate it." },
      questions: {
        issue: { type: "choice", instructions: "Which order issue does the customer report?", criteria: { missing_delivery: "Marked delivered but not received", damaged_item: "An item arrived broken or damaged", wrong_item: "A different product was delivered" } },
        next_step: { type: "choice", instructions: "What is the most relevant next step?", criteria: { investigate_delivery: "Check delivery proof and contact the carrier", explain_setup: "Send product installation instructions", send_invoice: "Send a copy of the invoice" } },
        received_package: { type: "noul", instructions: "Has the customer received the package?" },
      },
    };
    presets.returns = {
      state: { policy: "Returns are allowed within 30 days of delivery only if the item is unopened. Opened or late returns require manual review.", days_since_delivery: 12, item_condition: "unopened", customer_request: "I ordered the wrong size. The package is still sealed. Can I return it?" },
      questions: {
        eligibility: { type: "choice", instructions: "Based only on the stated policy and facts, how should this return be classified?", criteria: { eligible: "Within 30 days and unopened", manual_review: "Opened or outside the 30-day window", missing_information: "Delivery age or item condition is unknown" } },
        within_window: { type: "noul", instructions: "Is the item within the stated 30-day return window?" },
        unopened: { type: "noul", instructions: "Is the item unopened?" },
      },
    };
    presets.agent = {
      state: { user_request: "Where is order DEMO-208? Please check its current shipping status.", available_tools: { lookup_order: "Retrieve order details and tracking status by order ID", search_docs: "Search product help articles", create_refund: "Issue a refund for an order" }, known_order_id: "DEMO-208", tracking_status: null },
      questions: {
        tool: { type: "choice", instructions: "Which available tool best addresses the user's request?", criteria: { lookup_order: "Retrieve the requested order's current shipping status", search_docs: "Look up generic product documentation", create_refund: "Issue a refund" } },
        needs_clarification: { type: "noul", instructions: "Is the order ID missing, so that the agent needs to ask the user for it?" },
        refund_requested: { type: "noul", instructions: "Did the user request a refund?" },
      },
    };
    presets.meeting = {
      state: { transcript: ["Priya: The release is scheduled for Friday.", "Alex: I will send the final test report by Thursday afternoon.", "Priya: The accessibility review is still open. We cannot approve the launch until it is complete.", "Alex: Let's meet again on Thursday at 3 PM to review both items."] },
      questions: {
        launch_status: { type: "choice", instructions: "What is the current launch approval status?", criteria: { approved: "Launch has final approval", blocked: "Approval depends on an unfinished review", cancelled: "The launch has been cancelled" } },
        report_committed: { type: "noul", instructions: "Has Alex committed to sending the final test report?" },
        follow_up_proposed: { type: "noul", instructions: "Has a follow-up meeting been proposed for Thursday?" },
      },
    };
    byId("case-count").textContent = String(Object.keys(presets).length).padStart(2, "0");
    loadPreset("refund");
    byId("connection").textContent = health.ready ? "Model ready" : "Not ready";
    run.disabled = !health.ready;
  } catch (error) { byId("connection").textContent = "Disconnected"; showError(error.message); }
}
initialize();