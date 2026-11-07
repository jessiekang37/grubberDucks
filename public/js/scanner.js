// scanner.js
// Decides when a camera recognition counts as a real "scan".
//
// Rules:
//  1. The camera must recognize the same item for HOLD_MS (about 0.7 seconds).
//  2. Then:
//     - confident (>= SCAN_CONFIDENCE) and not a lookalike -> check it off
//     - unsure (between AI_LOW_CONFIDENCE and SCAN_CONFIDENCE), or a lookalike
//       item like Coke vs Diet Coke -> ask the AI (Milestone 4)
//     - AI unsure / fails / too slow -> ask staff to tap-confirm
//     The AI check runs in the background: staff can keep scanning other items.
//  3. After a scan, that item is "locked" until it leaves the camera's view,
//     and a short cooldown applies. This stops one item counting twice.
//
// SAFETY: the AI and the camera can only CHECK OFF items. Neither can mark an
// order ready. Only the "Mark ready" button does that, using markOrderReady()
// in orders.js, which always requires every item to be scanned.

let holdLabel = null;      // item currently being held up
let holdStartTime = 0;     // when we started seeing it
let lockedLabel = null;    // item just scanned, waiting to leave view
let lockedLastSeen = 0;    // last time we saw the locked item
let lastScanTime = -Infinity; // when the last scan happened (never, at start)
let aiChecksRunning = 0;   // how many AI checks are waiting for an answer
let aiGeneration = 0;      // goes up to cancel AI answers that arrive too late
let confirmOrderId = null; // set while the "tap to confirm" panel is open
let confirmTimer = null;

function resetHold() {
  holdLabel = null;
  setHoldProgress(0);
}

// The other items that look like this one, e.g. "Coke" -> ["Diet Coke"]
function getLookalikesOf(label) {
  const wanted = label.toLowerCase();
  const group = CONFIG.LOOKALIKE_GROUPS.find((g) => g.some((name) => name.toLowerCase() === wanted));
  return group ? group.filter((name) => name.toLowerCase() !== wanted) : [];
}

// Could the camera be mixing this item up with a lookalike?
// Only if one of its lookalikes is ALSO enrolled. If "Diet Coke" was never
// enrolled, the camera can't confuse "Coke" with it, so no AI check is needed.
function isLookalike(label) {
  const enrolledNames = Object.keys(getEnrolledCounts()).map((name) => name.toLowerCase());
  return getLookalikesOf(label).some((name) => enrolledNames.includes(name.toLowerCase()));
}

// Called by app.js every time the camera makes a prediction.
// result is { label, confidence } or null.
function handlePrediction(result) {
  const now = performance.now();
  const order = getActiveOrder();
  const topLabel = result ? result.label : null;

  // Step 1: unlock the last scanned item once it has been out of view long enough.
  if (lockedLabel) {
    if (topLabel === lockedLabel) lockedLastSeen = now;
    else if (now - lockedLastSeen > CONFIG.RELEASE_MS) lockedLabel = null;
  }

  // Step 2: is there an item we could scan right now?
  const isItem = result && topLabel !== CONFIG.BACKGROUND_LABEL;
  const isConfident = isItem && result.confidence >= CONFIG.SCAN_CONFIDENCE;
  const isUnsure = isItem && !isConfident && result.confidence >= CONFIG.AI_LOW_CONFIDENCE;
  const inCooldown = now - lastScanTime < CONFIG.SCAN_COOLDOWN_MS;

  if (!order || !(isConfident || isUnsure) || topLabel === lockedLabel || inCooldown) {
    resetHold();
    return;
  }

  // Step 3: start (or keep) timing how long it's been held up.
  if (topLabel !== holdLabel) {
    holdLabel = topLabel;
    holdStartTime = now;
  }
  const progress = (now - holdStartTime) / CONFIG.HOLD_MS;
  setHoldProgress(Math.min(progress, 1));
  if (progress < 1) return;

  // Step 4: held long enough. Decide who gets the final say.
  lockedLabel = topLabel;
  lockedLastSeen = now;
  lastScanTime = now;
  resetHold();

  if (isConfident && !isLookalike(topLabel)) {
    onItemScanned(order, topLabel, "camera");
  } else {
    checkWithAi(order, topLabel);
  }
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

  if (item.scanned >= item.qty) {
    showScanNotice(`All ${item.name} already scanned`, "warn");
    playSound("error");
    return;
  }

  // Check off ONE unit. (This never marks the order ready.)
  checkOffItem(order, order.items.indexOf(item));
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

async function checkWithAi(order, cameraGuess) {
  const myGeneration = aiGeneration;
  aiChecksRunning += 1;
  showAiChecking(true);

  let reason;
  try {
    const itemNames = order.items.map((item) => item.name);
    const answer = await askAiWhichItem(itemNames);

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
    onItemScanned(order, order.items[itemIndex].name, "staff");
  }
}
