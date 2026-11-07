// overlay.js
// Scan visuals drawn inside the scan zone (the .camera-guide box):
// thin corner marks that change color with the match, and a small label with
// the current match. Everything shown comes from the real recognizer result.
//
// ui.js calls three functions:
//   updateScanOverlay(result)     every prediction
//   setScanOverlayLock(progress)  0..1 while a scan is being confirmed
//   flashScanOverlay(kind)        "success" or "warn" when a scan counts / is rejected
// If this file is removed, those calls are skipped and nothing breaks.

let overlayEl = null;
let overlayLabelEl = null;
let overlayFlashTimer = null;

function buildScanOverlay() {
  const guide = document.querySelector(".camera-guide");
  if (!guide || overlayEl) return;

  overlayEl = document.createElement("div");
  overlayEl.className = "scan-overlay state-idle";

  overlayEl.innerHTML = `
    <span class="scan-corner tl"></span><span class="scan-corner tr"></span>
    <span class="scan-corner bl"></span><span class="scan-corner br"></span>
    <div class="scan-label"></div>`;
  guide.appendChild(overlayEl);
  overlayLabelEl = overlayEl.querySelector(".scan-label");
}

// result is { label, confidence, reliable } or null.
function updateScanOverlay(result) {
  buildScanOverlay();
  if (!overlayEl) return;

  const isItem =
    result && result.label !== CONFIG.BACKGROUND_LABEL && result.label !== CONFIG.UNKNOWN_LABEL;

  let state = "idle";
  if (isItem) state = result.reliable ? "match" : "detecting";
  else if (result && result.label === CONFIG.UNKNOWN_LABEL) state = "unknown";

  overlayEl.classList.remove("state-idle", "state-detecting", "state-match", "state-unknown");
  overlayEl.classList.add("state-" + state);
  overlayEl.style.setProperty("--level", isItem ? result.confidence.toFixed(2) : "0");

  if (isItem) {
    overlayLabelEl.textContent = `${result.label} · ${Math.round(result.confidence * 100)}%`;
  } else if (state === "unknown") {
    overlayLabelEl.textContent = "Unfamiliar item";
  } else {
    overlayLabelEl.textContent = "";
  }
}

// Brackets close in as the scan is being confirmed (0 = open, 1 = locked).
function setScanOverlayLock(progress) {
  buildScanOverlay();
  if (overlayEl) overlayEl.style.setProperty("--lock", progress.toFixed(2));
}

// Big flash when a scan counts ("success") or is rejected ("warn").
function flashScanOverlay(kind) {
  buildScanOverlay();
  if (!overlayEl) return;
  overlayEl.classList.remove("flash-success", "flash-warn");
  void overlayEl.offsetWidth; // restart the animation
  overlayEl.classList.add("flash-" + kind);
  clearTimeout(overlayFlashTimer);
  overlayFlashTimer = setTimeout(() => overlayEl.classList.remove("flash-success", "flash-warn"), 900);
}

// Show the idle brackets right away (scripts load at the end of <body>, so the box exists).
buildScanOverlay();
