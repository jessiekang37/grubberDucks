// app.js
// Connects buttons to actions. Each "on..." function runs when staff tap something.

// ---- Tapping an order in the queue ----
function onSelectOrder(orderId) {
  setActiveOrder(orderId);
  hideMissingWarning();
  resetHold();
  cancelPendingAiChecks();
  closeConfirm();
  render();
}

// ---- Tapping an item (manual check-off, used when the camera fails) ----
function onTapItem(itemIndex) {
  const order = getActiveOrder();
  if (!order) return;
  if (checkOffItem(order, itemIndex)) {
    cancelPendingAiChecks(); // a late AI answer must not count this item again
    hideMissingWarning();
    render();
  }
}

// ---- Undo button next to an item ----
function onUndoItem(itemIndex) {
  const order = getActiveOrder();
  if (!order) return;
  if (undoItem(order, itemIndex)) {
    render();
  }
}

// ---- Big "Mark ready" button (also pressed by a thumbs-up) ----
// Always uses markOrderReady(), so missing items block it either way.
function onMarkReady(byThumbsUp = false) {
  const order = getActiveOrder();
  if (!order) return;

  const result = markOrderReady(order);
  if (!result.ok) {
    showMissingWarning(result.missing);
    playSound("error");
    return;
  }

  // Success: move on to the next order still in the queue.
  hideMissingWarning();
  closeConfirm();
  showToast(`${byThumbsUp ? "👍 " : ""}Order #${order.number} ready for pickup`);
  const nextOrder = getQueueOrders()[0];
  setActiveOrder(nextOrder ? nextOrder.id : null);
  render();
}

// ---- Demo mode toggle ----
// On = pitch orders (with the forgotten drink). Off = regular mock orders.
// Switching resets all orders.
function onToggleDemoMode() {
  const isDemo = document.getElementById("demo-toggle").checked;
  loadOrders(isDemo ? DEMO_ORDERS : MOCK_ORDERS);
  localStorage.setItem("packpal-demo-mode", isDemo ? "on" : "off");
  cancelPendingAiChecks();
  closeConfirm();
  hideMissingWarning();
  render();
  showToast(isDemo ? "Demo mode on" : "Demo mode off");
}

// ---- Switching between the orders screen and the enroll screen ----
function onToggleEnrollScreen() {
  const enrollScreen = document.getElementById("enroll-screen");
  const mainScreen = document.getElementById("main-screen");
  const button = document.getElementById("enroll-toggle-btn");
  const goingToEnroll = enrollScreen.hidden;

  enrollScreen.hidden = !goingToEnroll;
  mainScreen.hidden = goingToEnroll;
  button.textContent = goingToEnroll ? "← Back to orders" : "Enroll items";
  moveCameraTo(goingToEnroll ? "enroll-camera-slot" : "main-camera-slot");
  if (goingToEnroll) renderEnrollScreen();
  else render(); // enrolled items may have changed
}

// ---- Thumbs-up to mark ready ----
let thumbsUpStart = null;          // when the current thumbs-up started
let thumbsUpLastSeen = -Infinity;  // last frame a thumbs-up was seen
let lastThumbsUpTime = -Infinity;  // when a thumbs-up last pressed Mark ready

// score = how sure MediaPipe is that a thumbs-up is showing (0 to 1)
function handleThumbsUp(score) {
  const now = performance.now();
  if (score >= CONFIG.THUMBS_UP_MIN_SCORE) thumbsUpLastSeen = now;

  // Count it as "still showing" through a brief flicker (under 0.2 s).
  const isShowing = now - thumbsUpLastSeen < 200;
  const inCooldown = now - lastThumbsUpTime < CONFIG.THUMBS_UP_COOLDOWN_MS;

  if (!isShowing || inCooldown || !getActiveOrder()) {
    thumbsUpStart = null;
    setThumbsUpProgress(0);
    return;
  }

  if (thumbsUpStart === null) thumbsUpStart = now;
  const progress = (now - thumbsUpStart) / CONFIG.THUMBS_UP_HOLD_MS;
  setThumbsUpProgress(Math.min(progress, 1));

  if (progress >= 1) {
    thumbsUpStart = null;
    lastThumbsUpTime = now;
    setThumbsUpProgress(0);
    onMarkReady(true);
  }
}

// ---- Camera loop ----
// Runs over and over: look for a thumbs-up, then recognize the item.

// Only scan on the orders screen (not while enrolling or reading a ticket).
function isOrderScreenActive() {
  return !document.getElementById("main-screen").hidden && !isTicketScannerOpen();
}

async function cameraLoop() {
  try {
    if (isCameraReady() && !isCapturing) {
      const video = getCameraVideo();
      const scanning = isOrderScreenActive();

      // 1. Thumbs-up? (window.detectThumbsUp appears once MediaPipe has loaded)
      let thumbsUpScore = 0;
      if (scanning && CONFIG.THUMBS_UP_ENABLED && window.detectThumbsUp) {
        thumbsUpScore = window.detectThumbsUp(video);
        handleThumbsUp(thumbsUpScore);
      }

      // 2. Which item is being held up?
      if (isRecognizerReady()) {
        const result = await predictFromVideo(video);
        renderPrediction(result);
        if (scanning) {
          // A hand giving a thumbs-up isn't an item, so don't scan during it.
          if (thumbsUpScore >= CONFIG.THUMBS_UP_MIN_SCORE) resetHold();
          else handlePrediction(result);
        }
        if (!result) setCameraStatus("No items enrolled yet. Tap \"Enroll items\".");
        else if (!getEnrolledCounts()[CONFIG.BACKGROUND_LABEL]) setCameraStatus("Tip: enroll \"Nothing\" so an empty view isn't mistaken for an item.");
        else setCameraStatus("");
      }
    }
  } catch (err) {
    console.error("Camera loop error:", err);
  }
  setTimeout(cameraLoop, CONFIG.PREDICT_INTERVAL_MS);
}

// Camera and models load in the background. If anything fails, the app still
// works with tap-to-check-off and the Mark ready button.
async function startCameraAndRecognizer() {
  try {
    setCameraStatus("Starting camera…");
    await startCamera();
  } catch (err) {
    console.error(err);
    setCameraStatus("Camera unavailable. Tap items to check them off.");
    return;
  }
  cameraLoop(); // thumbs-up can work even before the item model finishes loading
  try {
    setCameraStatus("Loading recognition model…");
    await loadRecognizer();
    setCameraStatus("");
    render(); // redraw so "tap only" tags reflect what's enrolled
  } catch (err) {
    console.error(err);
    setCameraStatus("Recognition failed to load. Tap items to check them off.");
  }
}

// ---- Start-up ----
function start() {
  // Remember whether demo mode was on last time.
  const isDemo = localStorage.getItem("packpal-demo-mode") === "on";
  document.getElementById("demo-toggle").checked = isDemo;
  loadOrders(isDemo ? DEMO_ORDERS : MOCK_ORDERS);
  render();
  startCameraAndRecognizer();
}

start();
