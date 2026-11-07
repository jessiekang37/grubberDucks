// ai.js
// Asks a vision AI (through OUR server at /api/vision) what's being held up.
// The API key lives only on the server; the browser never sees it.

// Turn a frame into a small JPEG image (as text the server can send on).
// source = the live camera (default) or a saved frame on a canvas.
function captureFrameAsJpeg(maxWidth = 512, quality = 0.8, source = getCameraVideo()) {
  const sourceWidth = source.videoWidth || source.width;
  const sourceHeight = source.videoHeight || source.height;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Returns the item name the AI picked (always one of itemNames) or "unsure".
// Throws an error if the AI is off, not set up, fails, or takes longer than AI_TIMEOUT_MS.
async function askAiWhichItem(itemNames, imageDataUrl) {
  if (!CONFIG.AI_ENABLED) throw new Error("AI is turned off in config.js");

  const response = await fetch("/api/vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl, itemNames: itemNames }),
    signal: AbortSignal.timeout(CONFIG.AI_TIMEOUT_MS),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI request failed");
  return data.item;
}

// Send a ticket photo to /api/ticket. Returns
// { orderNumber, platform, customer, items: [{ name, qty, note }] }
// knownNames = menu items the app already knows, so the AI uses the same names.
async function askAiToReadTicket(imageDataUrl, knownNames) {
  const response = await fetch("/api/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl, knownNames: knownNames }),
    signal: AbortSignal.timeout(CONFIG.TICKET_TIMEOUT_MS),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI request failed");
  return data;
}
