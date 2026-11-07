// app.js
// Connects buttons to actions. Each "on..." function runs when staff tap something.

// ---- Tapping an order in the queue ----
function onSelectOrder(orderId) {
  setActiveOrder(orderId);
  resetScanner();
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
    resetHold();
    lockAfterScan(order.items[itemIndex].name, performance.now());
    closeConfirm();
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
    resetScanner();
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
    if (typeof recordMissingItemsCaught === "function") recordMissingItemsCaught(order, result.missing); // stats.js
    return;
  }

  // Success: move on to the next order still in the queue.
  hideMissingWarning();
  closeConfirm();
  resetScanner();
  showToast(`${byThumbsUp ? "👍 " : ""}Order #${order.number} ready for pickup`);
  const nextOrder = getQueueOrders()[0];
  setActiveOrder(nextOrder ? nextOrder.id : null);
  render();
}

// ---- Demo mode toggle ----
// On = pitch orders (with the forgotten drink). Off = regular mock orders.
// Each mode keeps its own saved queue.
function onToggleDemoMode() {
  const isDemo = document.getElementById("demo-toggle").checked;
  if (!restoreOrders(isDemo)) loadOrders(isDemo ? DEMO_ORDERS : MOCK_ORDERS);
  localStorage.setItem("packpal-demo-mode", isDemo ? "on" : "off");
  cancelPendingAiChecks();
  resetScanner();
  closeConfirm();
  hideMissingWarning();
  render();
  showToast(isDemo ? "Demo mode on" : "Demo mode off");
}

// ---- Switching between the orders screen and the enroll screen ----
function onToggleEnrollScreen() {
  if (isCapturing) return;
  resetScanner();
  const enrollScreen = document.getElementById("enroll-screen");
  const mainScreen = document.getElementById("main-screen");
  const button = document.getElementById("enroll-toggle-btn");
  const goingToEnroll = enrollScreen.hidden;

  enrollScreen.hidden = !goingToEnroll;
  mainScreen.hidden = goingToEnroll;
  button.textContent = goingToEnroll ? "← Back to orders" : "Teach menu";
  moveCameraTo(goingToEnroll ? "enroll-camera-slot" : "main-camera-slot");
  if (goingToEnroll) renderEnrollScreen();
  else render(); // enrolled items may have changed
}

// ---- Thumbs-down: undo the last check-off ----
function onUndoLast() {
  const order = getActiveOrder();
  if (!order) return;
  const itemIndex = undoLastCheck(order);
  if (itemIndex === -1) {
    showScanNotice("Nothing to undo", "warn");
    playSound("error");
    return;
  }
  const item = order.items[itemIndex];
  resetScanner();
  hideMissingWarning();
  render();
  showScanNotice(`↺ Undid ${item.name}  ${item.scanned}/${item.qty}`, "warn");
  playSound("undo");
}

// ---- Hand gestures: 👍 = Mark ready, 👎 = undo ----
// Each gesture must be held for THUMBS_UP_HOLD_MS. After either one fires,
// both wait THUMBS_UP_COOLDOWN_MS, so gestures can't trigger back to back.
const gestures = {
  up: { start: null, lastSeen: -Infinity, label: "👍 Marking ready…", action: () => onMarkReady(true) },
  down: { start: null, lastSeen: -Infinity, label: "👎 Undoing last item…", action: () => onUndoLast() },
};
let lastGestureTime = -Infinity;

function resetGestures() {
  for (const g of Object.values(gestures)) {
    g.start = null;
    g.lastSeen = -Infinity;
  }
  setGestureProgress("", 0);
}

// score = how sure MediaPipe is that this gesture is showing (0 to 1).
// Returns how far along the hold is (0 to 1).
function updateGesture(g, score, enabled) {
  const now = performance.now();
  if (enabled && score >= CONFIG.THUMBS_UP_MIN_SCORE) g.lastSeen = now;

  // Count it as "still showing" through a brief flicker (under 0.2 s).
  const isShowing = now - g.lastSeen < 200;
  const inCooldown = now - lastGestureTime < CONFIG.THUMBS_UP_COOLDOWN_MS;
  if (!isShowing || inCooldown || !getActiveOrder()) {
    g.start = null;
    return 0;
  }

  if (g.start === null) g.start = now;
  const progress = Math.min((now - g.start) / CONFIG.THUMBS_UP_HOLD_MS, 1);
  if (progress >= 1) {
    lastGestureTime = now;
    resetGestures();
    g.action();
    return 0;
  }
  return progress;
}

// scores = { up, down } from window.detectGestures
function handleGestures(scores) {
  const up = updateGesture(gestures.up, scores.up, CONFIG.THUMBS_UP_ENABLED);
  const down = updateGesture(gestures.down, scores.down, CONFIG.THUMBS_DOWN_ENABLED);
  if (up > 0) setGestureProgress(gestures.up.label, up);
  else if (down > 0) setGestureProgress(gestures.down.label, down);
  else setGestureProgress("", 0);
}

// ---- Camera loop ----
// Runs over and over: look for a thumbs-up, then recognize the item.

// Only scan on the orders screen (not while enrolling or reading a ticket).
function isOrderScreenActive() {
  return !document.getElementById("main-screen").hidden && !isTicketScannerOpen() && !scannerPaused;
}

let frameCount = 0;
let lastGestureScores = { up: 0, down: 0 };

async function cameraLoop() {
  try {
    if (isCameraReady()) updateScanZoneGuide();
    if (isCameraReady() && !isCapturing) {
      const video = getCameraVideo();
      const scanning = isOrderScreenActive();
      if (!scanning) {
        lastGestureScores = { up: 0, down: 0 };
        resetGestures();
      }

      // 1. Thumbs-up or thumbs-down? (window.detectGestures appears once MediaPipe has loaded)
      //    Only every Nth frame, to leave more time for item recognition.
      frameCount += 1;
      const gesturesOn = CONFIG.THUMBS_UP_ENABLED || CONFIG.THUMBS_DOWN_ENABLED;
      if (scanning && gesturesOn && !aiChecksRunning && !confirmOrderId && window.detectGestures) {
        if (frameCount % CONFIG.THUMBS_UP_EVERY_N_FRAMES === 0) {
          lastGestureScores = window.detectGestures(video);
        }
        handleGestures(lastGestureScores);
      }
      const handGestureScore = Math.max(lastGestureScores.up, lastGestureScores.down);

      // 2. Which item is being held up?
      if (isRecognizerReady()) {
        const generation = aiGeneration;
        const result = await predictFromVideo(video);
        renderPrediction(result);
        if (scanning && isOrderScreenActive() && generation === aiGeneration) {
          // A hand giving a thumbs-up/down isn't an item, so don't scan during it.
          if (handGestureScore >= CONFIG.THUMBS_UP_MIN_SCORE) resetHold();
          else handlePrediction(result);
        }
        if (!result) setCameraStatus("Teach your menu for automatic scans, check a photo with AI, or tap an item.");
        else if (scannerPaused) setCameraStatus("Scanning paused. You can still check items by hand.");
        else if (!getEnrolledCounts()[CONFIG.BACKGROUND_LABEL]) setCameraStatus("Teach the empty area to enable automatic scans.");
        else if (lockedLabel) setCameraStatus("Move the item away. Show the empty area briefly before the next item.");
        else setCameraStatus(result.reason || "Swipe one item at a time through the view.");
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
  // Loading training must still work when camera access is denied.
  const modelLoading = loadRecognizer().then(() => {
    render();
    if (!document.getElementById("enroll-screen").hidden) renderEnrollScreen();
  }).catch((err) => {
    console.error(err);
    setCameraStatus("Recognition failed to load. Tap items to check them off.");
  });
  try {
    setCameraStatus("Starting camera…");
    await startCamera();
  } catch (err) {
    console.error(err);
    setCameraStatus("Camera unavailable. Tap items to check them off.");
    await modelLoading;
    return;
  }
  cameraLoop(); // thumbs-up can work even before the item model finishes loading
  if (!isRecognizerReady()) setCameraStatus("Loading recognition model…");
  await modelLoading;
}

// ---- Start-up ----
function start() {
  // Remember whether demo mode was on last time.
  const isDemo = localStorage.getItem("packpal-demo-mode") === "on";
  document.getElementById("demo-toggle").checked = isDemo;
  if (!restoreOrders(isDemo)) loadOrders(isDemo ? DEMO_ORDERS : MOCK_ORDERS);
  render();
  loadAiStatus();
  startCameraAndRecognizer();
}

function onResetOrders() {
  if (!confirm("Start a fresh sample queue? This replaces saved order progress in the current mode.")) return;
  resetScanner();
  loadOrders(document.getElementById("demo-toggle").checked ? DEMO_ORDERS : MOCK_ORDERS);
  hideMissingWarning();
  render();
}

start();
