// config.js
// Every number you might want to tune lives here.

const CONFIG = {
  // ---- Recognition (Milestone 2) ----
  // Where the MobileNet model files are stored (saved locally so no internet is needed).
  MODEL_URL: "/vendor/mobilenet/model.json",

  // How many frames to grab each time you press "Capture" on the enroll screen.
  FRAMES_PER_CAPTURE: 25,

  // Milliseconds between captured frames. 25 frames × 120ms ≈ 3 seconds.
  CAPTURE_INTERVAL_MS: 120,

  // How often the camera tries to recognize what it sees (milliseconds).
  PREDICT_INTERVAL_MS: 150,

  // KNN "k": how many of the closest enrolled examples get a vote.
  // Confidence = share of those votes the winning item got (e.g. 9 of 10 = 0.9).
  KNN_K: 10,

  // Special item name for "nothing is being held up". Enroll this first,
  // pointing the camera at the empty packing area.
  BACKGROUND_LABEL: "Nothing",

  // Where enrolled items are saved in the browser.
  STORAGE_KEY: "packpal-enrolled-items",

  // ---- Scanning (Milestone 3) ----
  // How sure the camera must be before a scan can count (0 to 1).
  // Note: with KNN_K = 10, confidence moves in steps of 0.1, so 0.85 means "at least 90%".
  SCAN_CONFIDENCE: 0.85,

  // How long (ms) the item must stay recognized before it's checked off.
  HOLD_MS: 700,

  // After any scan, wait this long (ms) before another scan can happen.
  SCAN_COOLDOWN_MS: 1200,

  // A scanned item can't count again until it has been OUT of view this long (ms).
  // This is what stops one Coffee from being counted twice.
  RELEASE_MS: 400,

  // How long the "✓ Coffee 1/2" or "not on this order" message stays up (ms).
  SCAN_NOTICE_MS: 1800,

  // ---- AI fallback (Milestone 4) ----
  // Set to false to never call the AI (e.g. if venue Wi-Fi is bad).
  // Unsure scans then go straight to "tap to confirm".
  AI_ENABLED: true,

  // If the camera's confidence is at least this but below SCAN_CONFIDENCE,
  // it's "unsure" and we ask the AI. Below this, we ignore it.
  AI_LOW_CONFIDENCE: 0.5,

  // Give up on the AI after this long (ms) and ask staff to tap-confirm instead.
  AI_TIMEOUT_MS: 6000,

  // Groups of items that look alike. If the camera sees one of these AND another
  // item from the same group is also enrolled, we always double-check with the
  // AI, even if the camera is confident. (If only "Coffee" is enrolled, Coffee
  // scans stay instant and work offline.)
  // Names must match enrolled item names (upper/lower case doesn't matter).
  LOOKALIKE_GROUPS: [
    ["Coke", "Diet Coke"],
    ["Coffee", "Iced Coffee", "Latte"],
  ],

  // The "tap to confirm" panel closes by itself after this long (ms).
  CONFIRM_AUTO_CLOSE_MS: 12000,
};
