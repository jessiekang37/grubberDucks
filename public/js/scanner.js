// Stable visual matches check off one unit. A reliably empty view releases
// the physical-item lock; label flicker does not. AI checks are serialized,
// and invalidated when the order, screen, or manual confirmation changes.
// Only markOrderReady() can complete an order.

let candidate = null;      // item currently passing the camera (see startCandidate)
let lockedLabel = null;    // item just scanned, waiting to leave view
let lockedLastSeen = 0;    // last time we saw the locked item
let lastScanTime = -Infinity; // when the last scan happened (never, at start)
let aiChecksRunning = 0;   // how many AI checks are waiting for an answer
let aiGeneration = 0;      // goes up to cancel AI answers that arrive too late
let confirmOrderId = null; // set while the "tap to confirm" panel is open
let confirmTimer = null;
let scannerPaused = false;
let emptySince = null;

function resetScanner() {
  resetHold();
  cancelPendingAiChecks();
  closeConfirm();
  // Keep the physical item lock across order changes and pauses.
  emptySince = null;
}

function onToggleScanning() {
  scannerPaused = !scannerPaused;
  resetScanner();
  document.getElementById("pause-scan-btn").textContent = scannerPaused ? "Resume scanning" : "Pause scanning";
  document.getElementById("pause-scan-btn").setAttribute("aria-pressed", String(scannerPaused));
  renderStation();
}

// Explicit photo check works even for an item that has never been enrolled.
function onCheckWithAi() {
  const order = getActiveOrder();
  if (!isOrderScreenActive() || !order || aiChecksRunning || confirmOrderId) return;
  if (!isCameraReady()) { showToast("Camera isn't ready. Tap an item to confirm it by hand."); return; }
  lockAfterScan("manual-photo", performance.now());
  checkWithAi(order, "", captureFrameAsJpeg(768, 0.85));
}

// Where we keep a copy of the candidate's clearest frame (for the AI).
const bestFrameCanvas = document.createElement("canvas");

function resetHold() {
  candidate = null;
  setHoldProgress(0);
}

// The other items that look like this one, e.g. "Coke" -> ["Diet Coke"]
function getLookalikesOf(label) {
  const wanted = label.toLowerCase();
  const group = CONFIG.LOOKALIKE_GROUPS.find((g) => g.some((name) => name.toLowerCase() === wanted));
  return group ? group.filter((name) => name.toLowerCase() !== wanted) : [];
}

// Hidden differences require confirmation even when only one variant is taught.
function isLookalike(label) {
  return getLookalikesOf(label).length > 0;
}

// Copy the current camera frame, so the AI can see it even after the item has moved on.
function saveBestFrame() {
  const video = getCameraVideo();
  if (!video || !video.videoWidth) return;
  bestFrameCanvas.width = video.videoWidth;
  bestFrameCanvas.height = video.videoHeight;
  bestFrameCanvas.getContext("2d").drawImage(video, 0, 0);
}

function startCandidate(label, now) {
  candidate = { label: label, firstSeen: now, lastSeen: now, frames: 0, confidentFrames: 0, bestConfidence: 0 };
}

// Called by app.js every time the camera makes a prediction.
// result is { label, confidence } or null.
function handlePrediction(result) {
  const now = performance.now();
  const order = getActiveOrder();
  const topLabel = result ? result.label : null;

  // Step 1: unlock the last scanned item once it has been out of view long enough.
  if (lockedLabel) {
    // A label changing is not proof that the previous physical item left.
    // Require a confidently empty area before another automatic count.
    if (topLabel === CONFIG.BACKGROUND_LABEL && result.reliable) {
      if (emptySince === null) emptySince = now;
      if (now - emptySince >= CONFIG.RELEASE_MS) { lockedLabel = null; emptySince = null; }
    } else emptySince = null;
  }

  const inCooldown = now - lastScanTime < CONFIG.SCAN_COOLDOWN_MS;
  if (!order || inCooldown || lockedLabel || scannerPaused || aiChecksRunning || confirmOrderId) {
    resetHold();
    return;
  }

  // Step 2: does this frame show an item worth tracking?
  const seesItem =
    result &&
    topLabel !== CONFIG.BACKGROUND_LABEL &&
    topLabel !== CONFIG.UNKNOWN_LABEL &&
    topLabel !== lockedLabel &&
    result.confidence >= CONFIG.AI_LOW_CONFIDENCE;

  if (!seesItem) {
    // The candidate has left the view. If it was only "unsure", ask the AI now.
    if (candidate && now - candidate.lastSeen > CONFIG.SWIPE_GAP_MS) finishUnsureCandidate(order, now);
    return;
  }

  // A different item appeared: wrap up the old one first.
  if (candidate && candidate.label !== topLabel) resetHold();
  if (!candidate) startCandidate(topLabel, now);

  // Step 3: add this frame to the candidate's tally.
  candidate.lastSeen = now;
  candidate.frames += 1;
  if (result.reliable) candidate.confidentFrames += 1;
  else candidate.confidentFrames = 0;
  if (result.confidence > candidate.bestConfidence) {
    candidate.bestConfidence = result.confidence;
    saveBestFrame();
  }
  setHoldProgress(Math.min(candidate.confidentFrames / CONFIG.SWIPE_MIN_FRAMES, 1));

  // Step 4: enough confident frames? Count it now (or ask the AI if it's a lookalike).
  if (candidate.confidentFrames >= CONFIG.SWIPE_MIN_FRAMES && now - candidate.firstSeen >= CONFIG.SCAN_MIN_DURATION_MS) {
    const label = candidate.label;
    lockAfterScan(label, now);
    if (isLookalike(label)) checkWithAi(order, label, captureFrameAsJpeg(512, 0.8, bestFrameCanvas));
    else onItemScanned(order, label, "camera");
    return;
  }

  // Held still in view for a while but never confident? Ask the AI without waiting.
  if (now - candidate.firstSeen > CONFIG.UNSURE_DECIDE_MS) finishUnsureCandidate(order, now);
}

// An item passed by but was never confident enough. If it was seen in enough
// frames to be real (not a flicker), send its clearest frame to the AI.
function finishUnsureCandidate(order, now) {
  const finished = candidate;
  resetHold();
  if (!finished || finished.frames < CONFIG.SWIPE_MIN_FRAMES) return; // just a flicker
  lockAfterScan(finished.label, now);
  checkWithAi(order, finished.label, captureFrameAsJpeg(512, 0.8, bestFrameCanvas));
}

function lockAfterScan(label, now) {
  lockedLabel = label;
  lockedLastSeen = now;
  lastScanTime = now;
  emptySince = null;
  resetHold();
}

// An item was identified (by camera, AI, or staff). Check it off if it belongs.
// source = "camera", "AI", or "staff" (only changes the message shown).
function onItemScanned(order, label, source) {
  const item = findItemByName(order, label);

  if (!item) {
    showScanNotice(`${label} isn't on this order`, "warn");
    playSound("error");
    return;
  }

  if (item.scanned >= item.qty || order.status === "ready") {
    showScanNotice(`All ${item.name} already scanned`, "warn");
    playSound("error");
    return;
  }

  // Check off ONE unit. (This never marks the order ready.)
  if (!checkOffItem(order, order.items.indexOf(item), source)) return;
  closeConfirm();
  hideMissingWarning();
  render();
  flashChecklistItem(order.items.indexOf(item));
  const tag = source === "AI" ? "  (AI)" : "";
  showScanNotice(`✓ ${item.name}  ${item.scanned}/${item.qty}${tag}`, "success");
  playSound(getMissingItems(order).length === 0 ? "complete" : "success");
}

// ---- AI fallback (runs in the background) ----

// Ignore any AI answers still on their way. Called when staff tap an item by
// hand or switch orders, so a late AI answer can't count the same item twice.
function cancelPendingAiChecks() {
  aiGeneration += 1;
}

// imageDataUrl = the frame to show the AI (the clearest one from the swipe).
async function checkWithAi(order, cameraGuess, imageDataUrl) {
  if (aiChecksRunning) return;
  const myGeneration = aiGeneration;
  aiChecksRunning += 1;
  showAiChecking(true);

  let reason;
  try {
    const itemNames = order.items.map((item) => item.name);
    const answer = await askAiWhichItem(itemNames, imageDataUrl);

    // Too late (staff tapped by hand or switched orders)? Ignore the answer.
    if (myGeneration !== aiGeneration || getActiveOrder() !== order) return;

    if (answer !== "unsure") {
      onItemScanned(order, answer, "AI");
      return;
    }
    reason = "AI wasn't sure.";
  } catch (err) {
    console.warn("AI check failed:", err.message);
    reason = err.name === "TimeoutError" ? "AI took too long." : "AI unavailable.";
  } finally {
    aiChecksRunning -= 1;
    showAiChecking(aiChecksRunning > 0);
  }

  if (myGeneration === aiGeneration && getActiveOrder() === order) openConfirm(order, cameraGuess, reason);
}

// ---- "Tap to confirm" panel (when neither camera nor AI is sure) ----
// Scanning keeps working while this panel is open.
function openConfirm(order, cameraGuess, reason) {
  // Offer the unscanned items, with the camera's guess and its lookalikes first.
  const likelyNames = [cameraGuess, ...getLookalikesOf(cameraGuess)].map((n) => n.toLowerCase());
  const choices = order.items
    .map((item, index) => ({ name: item.name, index: index, item: item }))
    .filter((choice) => choice.item.scanned < choice.item.qty)
    .sort((a, b) => likelyNames.includes(b.name.toLowerCase()) - likelyNames.includes(a.name.toLowerCase()))
    .slice(0, 4);

  if (choices.length === 0) {
    showScanNotice("Everything on this order is already scanned", "warn");
    return;
  }

  confirmOrderId = order.id;
  showConfirmPanel(reason, choices);
  playSound("error");
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(closeConfirm, CONFIG.CONFIRM_AUTO_CLOSE_MS);
}

function closeConfirm() {
  confirmOrderId = null;
  clearTimeout(confirmTimer);
  hideConfirmPanel();
}

// Staff tapped one of the choices in the confirm panel.
function onConfirmChoice(itemIndex) {
  const order = getOrder(confirmOrderId);
  closeConfirm();
  if (order && order === getActiveOrder()) {
    cancelPendingAiChecks();
    if (checkOffItem(order, itemIndex, "staff")) {
      hideMissingWarning();
      render();
      showScanNotice(`✓ ${order.items[itemIndex].name} confirmed`, "success");
      playSound("success");
    }
  }
}
