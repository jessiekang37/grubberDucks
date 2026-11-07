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
  return "platform-" + platform.toLowerCase().replace(/\s+/g, "-");
}

const STATUS_LABELS = { waiting: "Waiting", packing: "Packing", ready: "Ready" };

// ---- Left side: order queue ----
function renderQueue() {
  const queueEl = document.getElementById("queue-list");
  const queue = getQueueOrders();
  const active = getActiveOrder();

  if (queue.length === 0) {
    queueEl.innerHTML = `<p class="empty-note">All orders packed 🎉</p>`;
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
    return;
  }

  headerEl.innerHTML = `
    <div>
      <h2>Order #${escapeHtml(order.number)}</h2>
      <p class="customer">${escapeHtml(order.customer)}</p>
    </div>
    <span class="platform-tag big ${platformClass(order.platform)}">${escapeHtml(order.platform)}</span>`;

  listEl.innerHTML = order.items
    .map((item, index) => {
      const done = item.scanned >= item.qty;
      return `
        <li class="check-item ${done ? "done" : ""}" data-item-index="${index}">
          <button class="check-main" onclick="onTapItem(${index})" ${done ? "disabled" : ""}>
            <span class="checkbox">${done ? "✓" : ""}</span>
            <span class="item-name">${escapeHtml(item.name)}</span>
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

  if (!result || result.label === CONFIG.BACKGROUND_LABEL) {
    labelEl.textContent = "No item";
    labelEl.classList.add("dim");
    barEl.style.width = "0%";
    percentEl.textContent = "";
    return;
  }

  const percent = Math.round(result.confidence * 100);
  labelEl.textContent = result.label;
  labelEl.classList.remove("dim");
  barEl.style.width = percent + "%";
  percentEl.textContent = percent + "%";
}

// Redraw everything.
function render() {
  renderQueue();
  renderReady();
  renderChecklist();
}
