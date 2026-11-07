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

const server = http.createServer((req, res) => {
  serveStaticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`PackPal running at http://localhost:${PORT}`);
});
