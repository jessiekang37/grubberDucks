// gesture.js
// Uses Google's MediaPipe gesture recognizer to spot a thumbs-up 👍.
// It's a pretrained model that already knows hand gestures, no enrolling needed.
//
// This file is loaded as a "module" (type="module" in index.html) because
// that's the only format MediaPipe comes in. When it's ready, it creates
// window.detectThumbsUp(), which app.js uses.

import { FilesetResolver, GestureRecognizer } from "/vendor/mediapipe/vision_bundle.mjs";

async function createRecognizer(delegate) {
  const files = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
  return GestureRecognizer.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: "/vendor/mediapipe/gesture_recognizer.task",
      delegate: delegate, // "GPU" is fastest; "CPU" works everywhere
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

async function loadGestureRecognizer() {
  if (!CONFIG.THUMBS_UP_ENABLED) return;

  let recognizer;
  try {
    recognizer = await createRecognizer("GPU");
  } catch (err) {
    console.warn("MediaPipe GPU failed, trying CPU:", err);
    recognizer = await createRecognizer("CPU");
  }

  let lastTimestamp = 0;

  // Returns how sure MediaPipe is that a thumbs-up is showing (0 = not at all, 1 = certain).
  window.detectThumbsUp = function (videoEl) {
    // MediaPipe needs each timestamp to be later than the last one.
    const timestamp = Math.max(performance.now(), lastTimestamp + 1);
    lastTimestamp = timestamp;

    const result = recognizer.recognizeForVideo(videoEl, timestamp);
    const topGesture = result.gestures.length > 0 ? result.gestures[0][0] : null;
    if (topGesture && topGesture.categoryName === "Thumb_Up") return topGesture.score;
    return 0;
  };
  console.log("Thumbs-up detection ready");
}

loadGestureRecognizer().catch((err) => {
  console.error("Thumbs-up detection failed to load (tap Mark ready instead):", err);
});
