// PackPal local server
// Job 1: serve the files in /public so the browser can load the app.
// Job 2 (Milestone 4): provide /api/vision so the OpenRouter key stays secret.
//
// Uses only built-in Node features, so there is nothing to install.

const http = require("http");
const fs = require("fs");
const path = require("path");

// Load settings from .env if it exists (API key, model name, port).
try {
  process.loadEnvFile(".env");
} catch {
  console.log("No .env file found. That's fine until the AI fallback (Milestone 4).");
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// Tells the browser what kind of file it's receiving.
const CONTENT_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".bin": "application/octet-stream",
};

function serveStaticFile(req, res) {
  // "/" means the main page.
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Build the file path and make sure it stays inside /public (security).
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const type = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// AI vision fallback (Milestone 4)
// The browser sends { image, itemNames }. We build the prompt HERE (not in the
// browser) and check the answer, so the AI can only ever reply with one of
// this order's item names or "unsure".
// ---------------------------------------------------------------------------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_SERVER_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB is plenty for one photo

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Collect the request body and parse it as JSON.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function hasApiKey() {
  const key = process.env.OPENROUTER_API_KEY;
  return Boolean(key) && key !== "sk-or-your-key-here";
}

// Send one image + instructions to the model and return its text reply.
async function askVisionModel(prompt, imageDataUrl) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "PackPal",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5",
      temperature: 0,
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(AI_SERVER_TIMEOUT_MS),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${details.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// Models sometimes wrap JSON in extra text or ```code fences```. Grab the {...} part.
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model reply: " + text.slice(0, 200));
  return JSON.parse(text.slice(start, end + 1));
}

async function handleVisionRequest(req, res) {
  if (!hasApiKey()) {
    sendJson(res, 503, { error: "AI is not set up: add OPENROUTER_API_KEY to .env and restart." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  // Check the input is what we expect.
  const { image, itemNames } = body;
  const validImage = typeof image === "string" && image.startsWith("data:image/");
  const validNames =
    Array.isArray(itemNames) &&
    itemNames.length > 0 &&
    itemNames.length <= 30 &&
    itemNames.every((name) => typeof name === "string" && name.length > 0 && name.length < 80);
  if (!validImage || !validNames) {
    sendJson(res, 400, { error: "Send { image: 'data:image/...', itemNames: ['...'] }" });
    return;
  }

  const prompt = [
    "You are checking a restaurant delivery order at a packing station.",
    "A staff member is holding ONE item up to the camera.",
    "Which of these order items is it? Choose ONLY from this list:",
    ...itemNames.map((name) => `- ${name}`),
    "",
    'If the item is not clearly one of these, or you cannot tell (for example, two similar drinks you cannot tell apart), answer "unsure".',
    'Reply with ONLY JSON, no other text, in exactly this form: {"item": "<exact name from the list, or unsure>"}',
  ].join("\n");

  try {
    const reply = await askVisionModel(prompt, image);
    const answer = extractJson(reply);

    // Only accept an exact item name from the list (ignoring case). Anything else = "unsure".
    const said = String(answer.item || "").trim().toLowerCase();
    const match = itemNames.find((name) => name.toLowerCase() === said);
    console.log(`[vision] model said ${JSON.stringify(answer.item)} -> ${match || "unsure"}`);
    sendJson(res, 200, { item: match || "unsure" });
  } catch (err) {
    console.error("[vision] failed:", err.message);
    sendJson(res, 502, { error: "AI request failed" });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/vision") {
    handleVisionRequest(req, res);
    return;
  }
  serveStaticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`PackPal running at http://localhost:${PORT}`);
});
