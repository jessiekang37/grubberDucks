// ai.js
// Asks a vision AI (through OUR server at /api/vision) what's being held up.
// The API key lives only on the server; the browser never sees it.

// Grab the current camera frame as a small JPEG image (as text the server can send on).
function captureFrameAsJpeg(maxWidth = 512) {
  const video = getCameraVideo();
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

// Returns the item name the AI picked (always one of itemNames) or "unsure".
// Throws an error if the AI is off, not set up, fails, or takes longer than AI_TIMEOUT_MS.
async function askAiWhichItem(itemNames) {
  if (!CONFIG.AI_ENABLED) throw new Error("AI is turned off in config.js");

  const response = await fetch("/api/vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: captureFrameAsJpeg(), itemNames: itemNames }),
    signal: AbortSignal.timeout(CONFIG.AI_TIMEOUT_MS),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI request failed");
  return data.item;
}
