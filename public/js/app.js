// app.js
// Connects buttons to actions. Each "on..." function runs when staff tap something.

// ---- Tapping an order in the queue ----
function onSelectOrder(orderId) {
  setActiveOrder(orderId);
  hideMissingWarning();
  render();
}

// ---- Tapping an item (manual check-off, used when the camera fails) ----
function onTapItem(itemIndex) {
  const order = getActiveOrder();
  if (!order) return;
  if (checkOffItem(order, itemIndex)) {
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

// ---- Big "Mark ready" button ----
function onMarkReady() {
  const order = getActiveOrder();
  if (!order) return;

  const result = markOrderReady(order);
  if (!result.ok) {
    showMissingWarning(result.missing);
    return;
  }

  // Success: move on to the next order still in the queue.
  hideMissingWarning();
  showToast(`Order #${order.number} ready for pickup`);
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
}

// ---- Recognition loop ----
// Every PREDICT_INTERVAL_MS: look at the camera, show the best guess.
async function predictionLoop() {
  try {
    if (isRecognizerReady() && isCameraReady() && !isCapturing) {
      const result = await predictFromVideo(getCameraVideo());
      renderPrediction(result);
      if (!result) setCameraStatus("No items enrolled yet. Tap \"Enroll items\".");
      else if (!getEnrolledCounts()[CONFIG.BACKGROUND_LABEL]) setCameraStatus("Tip: enroll \"Nothing\" so an empty view isn't mistaken for an item.");
      else setCameraStatus("");
    }
  } catch (err) {
    console.error("Prediction failed:", err);
  }
  setTimeout(predictionLoop, CONFIG.PREDICT_INTERVAL_MS);
}

// Camera and model load in the background. If either fails, the app still
// works with tap-to-check-off.
async function startCameraAndRecognizer() {
  try {
    setCameraStatus("Starting camera…");
    await startCamera();
  } catch (err) {
    console.error(err);
    setCameraStatus("Camera unavailable. Tap items to check them off.");
    return;
  }
  try {
    setCameraStatus("Loading recognition model…");
    await loadRecognizer();
    setCameraStatus("");
    predictionLoop();
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
