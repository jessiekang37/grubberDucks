// config.js
// Every number you might want to tune lives here.

const CONFIG = {
  // ---- Recognition (Milestone 2) ----
  // Where the MobileNet model files are stored (saved locally so no internet is needed).
  MODEL_URL: "/vendor/mobilenet/model.json",

  // How many frames to grab each time you press "Capture" on the enroll screen.
  // More frames = more accurate, but uses more browser storage.
  FRAMES_PER_CAPTURE: 24,

  // Pause between views. Each view adds three lighting/framing variations.
  CAPTURE_INTERVAL_MS: 180,

  // Seconds of "get ready" countdown before capturing starts, so the first
  // frames aren't of your hand coming back from the button.
  CAPTURE_COUNTDOWN_S: 3,

  // Pause between recognition attempts (milliseconds). Small = fast scanning.
  // The real speed is limited by how fast the laptop runs the model (~20-30 per second).
  PREDICT_INTERVAL_MS: 30,

  // Special item name for "nothing is being held up". Enroll this first,
  // pointing the camera at the empty packing area.
  BACKGROUND_LABEL: "Nothing",

  // Where enrolled items are saved in the browser.
  STORAGE_KEY: "packpal-enrolled-items",

  // ---- Scanning (Milestone 3) ----
  // Tuned for SWIPING items across the camera: fast, slightly less accurate.
  // For a slower, more careful "hold it up" style, use:
  //   SCAN_CONFIDENCE: 0.85, SWIPE_MIN_FRAMES: 6

  // How sure the camera must be for a frame to count as "confident" (0 to 1).
  // This is a heuristic match score, not a probability of correctness.
  SCAN_CONFIDENCE: 0.78,
  MIN_SIMILARITY: 0.72,
  MIN_CLASS_MARGIN: 0.045,
  NEIGHBORS_PER_CLASS: 3,
  MIN_EXAMPLES: 6,
  MAX_EXAMPLES_PER_CLASS: 180,
  UNKNOWN_LABEL: "__unknown__",
  SCAN_MIN_DURATION_MS: 180,

  // How many confident frames are needed to check an item off.
  // Also require SCAN_MIN_DURATION_MS of evidence.
  SWIPE_MIN_FRAMES: 3,

  // How long (ms) with no sighting before we decide an item has left the view.
  SWIPE_GAP_MS: 150,

  // If an item stays in view this long (ms) but is never confident, ask the AI anyway.
  UNSURE_DECIDE_MS: 800,

  // After any scan, wait this long (ms) before another scan can happen.
  SCAN_COOLDOWN_MS: 200,

  // A scanned item stays locked until a reliable EMPTY view lasts this long.
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
  AI_LOW_CONFIDENCE: 0.4,

  // Give up on the AI after this long (ms) and ask staff to tap-confirm instead.
  // Scanning keeps going while the AI thinks, so this doesn't slow staff down.
  AI_TIMEOUT_MS: 5000,

  // Known lookalikes always need AI or staff confirmation, even if only one
  // is enrolled: lack of training for the other does not make them distinct.
  LOOKALIKE_GROUPS: [
    ["Coke", "Diet Coke"],
    ["Coffee", "Iced Coffee", "Latte"],
  ],

  // The "tap to confirm" panel closes by itself after this long (ms).
  CONFIRM_AUTO_CLOSE_MS: 12000,

  // ---- Thumbs-up to mark ready (MediaPipe) ----
  // A thumbs-up presses "Mark ready". It goes through the same check as a tap,
  // so an order with missing items is still blocked.
  THUMBS_UP_ENABLED: true,
  THUMBS_UP_MIN_SCORE: 0.7,    // how sure MediaPipe must be that it's a thumbs-up (0 to 1)
  THUMBS_UP_HOLD_MS: 500,      // hold the thumbs-up this long
  THUMBS_UP_COOLDOWN_MS: 2000, // wait this long before another thumbs-up counts
  // Only check for a thumbs-up on every Nth camera frame. This leaves more
  // time for item recognition, so swipes get more frames.
  THUMBS_UP_EVERY_N_FRAMES: 3,

  // ---- Ticket photo to order (Milestone 5) ----
  TICKET_TIMEOUT_MS: 25000, // reading a whole ticket takes longer than one item
};
