// ui.js
// Draws the screen from the current order data.
// Whenever something changes, app.js calls render() and everything is redrawn.

// Makes text safe to put inside HTML (so a weird item name can't break the page).
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// "Uber Eats" -> "uber-eats" so CSS can color each platform tag.
function platformClass(platform) {
  return "platform-" + platform.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");
}

const STATUS_LABELS = { waiting: "Waiting", packing: "Packing", ready: "Ready" };

// ---- Left side: order queue ----
function renderQueue() {
  const queueEl = document.getElementById("queue-list");
  const query = document.getElementById("queue-search").value.trim().toLowerCase();
  const queue = getQueueOrders().filter((order) => `${order.number} ${order.customer} ${order.platform}`.toLowerCase().includes(query));
  const active = getActiveOrder();

  if (queue.length === 0) {
    queueEl.innerHTML = `<p class="empty-note">${query ? "No matching orders" : "All orders packed. Nicely done."}</p>`;
    return;
  }

  queueEl.innerHTML = queue
    .map((order) => {
      const isActive = active && order.id === active.id;
      return `
        <button class="queue-card ${isActive ? "active" : ""}" onclick="onSelectOrder('${order.id}')">
          <div class="queue-card-top">
            <span class="order-number">#${escapeHtml(order.number)}</span>
            <span class="platform-tag ${platformClass(order.platform)}">${escapeHtml(order.platform)}</span>
          </div>
          <div class="queue-customer">${escapeHtml(order.customer)}</div>
          <div class="queue-card-bottom">
            <span>${countScanned(order)} / ${countItems(order)} items</span>
            <span class="status status-${order.status}">${STATUS_LABELS[order.status]}</span>
          </div>
        </button>`;
    })
    .join("");
}

// ---- Left side: ready for pickup ----
function renderReady() {
  const readyEl = document.getElementById("ready-list");
  const ready = getReadyOrders();

  if (ready.length === 0) {
    readyEl.innerHTML = `<p class="empty-note">None yet</p>`;
    return;
  }

  readyEl.innerHTML = ready
    .map(
      (order) => `
        <div class="ready-card">
          <span class="order-number">#${escapeHtml(order.number)}</span>
          <span class="platform-tag ${platformClass(order.platform)}">${escapeHtml(order.platform)}</span>
          <span class="ready-check">✓</span>
        </div>`
    )
    .join("");
}

// ---- Right side: active order checklist ----
function renderChecklist() {
  const headerEl = document.getElementById("order-header");
  const listEl = document.getElementById("checklist");
  const readyBtn = document.getElementById("mark-ready-btn");
  const order = getActiveOrder();

  if (!order) {
    headerEl.innerHTML = `<h2>No active order</h2>`;
    listEl.innerHTML = "";
    readyBtn.style.display = "none";
    document.getElementById("order-progress").innerHTML = "";
    return;
  }

  headerEl.innerHTML = `
    <div>
      <h2>Order #${escapeHtml(order.number)}</h2>
      <p class="customer">${escapeHtml(order.customer)}</p>
    </div>
    <span class="platform-tag big ${platformClass(order.platform)}">${escapeHtml(order.platform)}</span>`;

  // Names the camera has learned (lowercase), so we can flag items it can't scan.
  const enrolledNames = Object.keys(getEnrolledCounts()).map((name) => name.toLowerCase());

  listEl.innerHTML = order.items
    .map((item, index) => {
      const done = item.scanned >= item.qty;
      const cameraKnowsIt = enrolledNames.includes(item.name.toLowerCase());
      const tapOnlyTag =
        !done && !cameraKnowsIt ? `<span class="tap-only-tag">AI or tap</span>` : "";
      return `
        <li class="check-item ${done ? "done" : ""}" data-item-index="${index}">
          <button class="check-main" onclick="onTapItem(${index})" ${done ? "disabled" : ""}>
            <span class="checkbox">${done ? "✓" : ""}</span>
            <span class="item-name">${escapeHtml(item.name)} ${tapOnlyTag}
              ${item.note ? `<span class="item-note">${escapeHtml(item.note)}</span>` : ""}
              ${item.scanned ? `<span class="scan-source">Last confirmed: ${escapeHtml(item.lastSource || "staff")}</span>` : ""}</span>
            <span class="item-count">${item.scanned} / ${item.qty}</span>
          </button>
          <button class="undo-btn" onclick="onUndoItem(${index})" ${item.scanned === 0 ? "disabled" : ""}
            aria-label="Undo one ${escapeHtml(item.name)}">↺</button>
        </li>`;
    })
    .join("");

  // The button always works (so tapping it can show the warning),
  // but it only LOOKS ready when everything is scanned.
  const allDone = getMissingItems(order).length === 0;
  readyBtn.style.display = "block";
  readyBtn.classList.toggle("is-ready", allDone);
  readyBtn.textContent = allDone ? "✓ Mark ready" : `Mark ready (${countScanned(order)}/${countItems(order)})`;
  const percent = Math.round(countScanned(order) / countItems(order) * 100);
  document.getElementById("order-progress").innerHTML = `<div class="progress-caption"><span>${allDone ? "Everything accounted for" : `${countItems(order) - countScanned(order)} ${countItems(order) - countScanned(order) === 1 ? "item" : "items"} left to pack`}</span><strong>${percent}%</strong></div><div class="order-track"><div style="width:${percent}%"></div></div>`;
}

// ---- Red "missing items" warning ----
function showMissingWarning(missing) {
  const warningEl = document.getElementById("missing-warning");
  const list = missing.map((m) => `${m.missing}× ${escapeHtml(m.name)}`).join(", ");
  warningEl.innerHTML = `⚠ Can't mark ready. Missing: <strong>${list}</strong>`;
  warningEl.classList.add("visible");

  // Re-trigger the shake animation even if the warning was already showing.
  warningEl.classList.remove("shake");
  void warningEl.offsetWidth;
  warningEl.classList.add("shake");
}

function hideMissingWarning() {
  document.getElementById("missing-warning").classList.remove("visible");
}

// ---- Short message that pops up at the bottom, then fades ----
let toastTimer = null;
function showToast(message) {
  const toastEl = document.getElementById("toast");
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2500);
}

// ---- Camera status line (loading, errors, tips) ----
function setCameraStatus(message) {
  const statusEl = document.getElementById("camera-status");
  statusEl.textContent = message;
  statusEl.style.display = message ? "block" : "none";
}

// ---- What the camera thinks it sees, with a confidence bar ----
// result is { label, confidence } or null.
function renderPrediction(result) {
  const labelEl = document.getElementById("prediction-label");
  const barEl = document.getElementById("confidence-bar");
  const percentEl = document.getElementById("confidence-percent");

  const detail = document.getElementById("match-detail");
  if (typeof updateScanOverlay === "function") updateScanOverlay(result); // scan visuals (overlay.js)
  if (!result || result.label === CONFIG.BACKGROUND_LABEL || result.label === CONFIG.UNKNOWN_LABEL) {
    labelEl.textContent = !result ? "Ready to learn" : result.label === CONFIG.BACKGROUND_LABEL ? "Clear view" : "Unfamiliar item";
    detail.textContent = result?.reason || (result ? "Ready for the next item" : "Teach the menu to enable local recognition.");
    labelEl.classList.add("dim");
    barEl.style.width = "0%";
    percentEl.textContent = "";
    return;
  }

  const percent = Math.round(result.confidence * 100);
  detail.textContent = result.reason || (result.reliable ? "Strong match · hold briefly to confirm" : "Checking the match · hold steady");
  labelEl.textContent = result.label;
  labelEl.classList.remove("dim");
  barEl.style.width = percent + "%";
  barEl.classList.toggle("above-threshold", result.reliable);
  percentEl.textContent = percent + "% match";
}

// ---- Scanning feedback (Milestone 3) ----

// Bar along the bottom of the video that fills while an item is held up.
// progress goes from 0 to 1.
function setHoldProgress(progress) {
  document.getElementById("hold-bar").style.width = Math.round(progress * 100) + "%";
  if (typeof setScanOverlayLock === "function") setScanOverlayLock(progress); // scan visuals (overlay.js)
}

// Big message over the camera, e.g. "✓ Coffee 1/2". kind = "success" or "warn".
let scanNoticeTimer = null;
function showScanNotice(message, kind) {
  const noticeEl = document.getElementById("scan-notice");
  const cameraBox = document.getElementById("camera-box");
  noticeEl.textContent = message;
  noticeEl.className = "scan-notice visible " + kind;
  if (typeof flashScanOverlay === "function") flashScanOverlay(kind); // scan visuals (overlay.js)
  cameraBox.classList.remove("flash-success", "flash-warn");
  void cameraBox.offsetWidth; // restart the flash animation
  cameraBox.classList.add("flash-" + kind);

  clearTimeout(scanNoticeTimer);
  scanNoticeTimer = setTimeout(() => {
    noticeEl.classList.remove("visible");
  }, CONFIG.SCAN_NOTICE_MS);
}

// Briefly highlight a checklist row that was just scanned.
function flashChecklistItem(itemIndex) {
  const row = document.querySelector(`.check-item[data-item-index="${itemIndex}"]`);
  if (row) row.classList.add("just-scanned");
}

// ---- AI fallback feedback (Milestone 4) ----
function showAiChecking(isChecking) {
  document.getElementById("ai-checking").classList.toggle("visible", isChecking);
  document.getElementById("ai-checking").setAttribute("aria-hidden", String(!isChecking));
  document.getElementById("ai-photo-btn").disabled = isChecking || scannerPaused || !aiAvailable || !getActiveOrder();
}

// choices = [{ name, index }] items staff can tap to confirm
function showConfirmPanel(reason, choices) {
  document.getElementById("confirm-reason").textContent = reason + " What are you holding?";
  document.getElementById("confirm-choices").innerHTML = choices
    .map((c) => `<button class="confirm-choice" onclick="onConfirmChoice(${c.index})">${escapeHtml(c.name)}</button>`)
    .join("");
  document.getElementById("confirm-panel").hidden = false;
}

function hideConfirmPanel() {
  document.getElementById("confirm-panel").hidden = true;
}

// ---- Gesture feedback (👍 / 👎) ----
// label = text to show; progress goes from 0 to 1 while the gesture is held.
function setGestureProgress(label, progress) {
  const indicator = document.getElementById("thumbs-indicator");
  if (label) document.getElementById("gesture-label").textContent = label;
  indicator.classList.toggle("visible", progress > 0);
  indicator.setAttribute("aria-hidden", String(progress <= 0));
  document.getElementById("thumbs-bar").style.width = Math.round(progress * 100) + "%";
}

// Redraw everything.
function render() {
  renderQueue();
  renderReady();
  renderChecklist();
  renderStation();
}

function renderStation() {
  document.getElementById("station-stats").innerHTML = `<span><strong>${getQueueOrders().length}</strong> in queue</span><span><strong>${getReadyOrders().length}</strong> ready</span><span class="saved-tag">Progress saved locally</span>${typeof catchStatsHtml === "function" ? catchStatsHtml() : ""}`;
  document.querySelector(".station-label").classList.toggle("paused", scannerPaused);
  document.getElementById("ai-photo-btn").disabled = scannerPaused || aiChecksRunning > 0 || !aiAvailable || !getActiveOrder();
}
