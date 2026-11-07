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
};
