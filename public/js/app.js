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
  return !document.getElementById("main-screen").hidden && !isTicketScannerOpen() && !scannerPaused;
}

let frameCount = 0;
let lastThumbsUpScore = 0;

async function cameraLoop() {
  try {
    if (isCameraReady() && !isCapturing) {
      const video = getCameraVideo();
      const scanning = isOrderScreenActive();
      if (!scanning) {
        lastThumbsUpScore = 0;
        thumbsUpStart = null;
        thumbsUpLastSeen = -Infinity;
        setThumbsUpProgress(0);
      }

      // 1. Thumbs-up? (window.detectThumbsUp appears once MediaPipe has loaded)
      //    Only every Nth frame, to leave more time for item recognition.
      frameCount += 1;
      if (scanning && CONFIG.THUMBS_UP_ENABLED && !aiChecksRunning && !confirmOrderId && window.detectThumbsUp) {
        if (frameCount % CONFIG.THUMBS_UP_EVERY_N_FRAMES === 0) {
          lastThumbsUpScore = window.detectThumbsUp(video);
        }
        handleThumbsUp(lastThumbsUpScore);
      }
      const thumbsUpScore = lastThumbsUpScore;

      // 2. Which item is being held up?
      if (isRecognizerReady()) {
        const generation = aiGeneration;
        const result = await predictFromVideo(video);
        renderPrediction(result);
        if (scanning && isOrderScreenActive() && generation === aiGeneration) {
          // A hand giving a thumbs-up isn't an item, so don't scan during it.
          if (thumbsUpScore >= CONFIG.THUMBS_UP_MIN_SCORE) resetHold();
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
