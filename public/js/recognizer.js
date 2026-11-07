// MobileNet embeddings with class-balanced nearest-neighbor matching.
// The vendored classifier stores tensors and keeps legacy backups compatible;
// matching.js supplies absolute similarity, separation, and unknown rejection.

let featureModel = null; // MobileNet
let classifier = null;   // KNN

async function loadRecognizer() {
  featureModel = await mobilenet.load({ version: 2, alpha: 1.0, modelUrl: CONFIG.MODEL_URL });
  classifier = knnClassifier.create();
  loadSavedItems();
}

function isRecognizerReady() {
  return featureModel !== null && classifier !== null;
}

// Number of enrolled frames per item, e.g. { Coffee: 25, Nothing: 25 }
function getEnrolledCounts() {
  return classifier ? classifier.getClassExampleCount() : {};
}

function hasEnrolledItems() {
  return classifier !== null && classifier.getNumClasses() > 0;
}

// Cache normalized examples once after enrollment, not on every camera frame.
let exampleCache = null;
const trainingCanvas = document.createElement("canvas");
trainingCanvas.width = trainingCanvas.height = 224;

function getExampleCache() {
  if (exampleCache) return exampleCache;
  exampleCache = Object.create(null);
  for (const [name, tensor] of Object.entries(classifier.getClassifierDataset())) {
    const data = tensor.dataSync();
    exampleCache[name] = Array.from({ length: tensor.shape[0] }, (_, i) =>
      normalizeEmbedding(data.subarray(i * tensor.shape[1], (i + 1) * tensor.shape[1])));
  }
  return exampleCache;
}

// Keep original framing for compatibility with existing backups. Add mild zoom
// and exposure variations so enrollment need not match scanning exactly.
function addExampleFromVideo(videoEl, itemName) {
  const ctx = trainingCanvas.getContext("2d", { willReadFrequently: true });
  ctx.filter = "none";
  const zone = getScanZone(videoEl); // only the middle of the picture
  ctx.drawImage(videoEl, zone.x, zone.y, zone.size, zone.size, 0, 0, 224, 224);
  const pixels = ctx.getImageData(0, 0, 224, 224).data;
  let light = 0;
  for (let i = 0; i < pixels.length; i += 16) light += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  light /= pixels.length / 16;
  if (light < 22 || light > 245) return false;
  const background = itemName !== CONFIG.BACKGROUND_LABEL ? getExampleCache()[CONFIG.BACKGROUND_LABEL] : null;
  for (const [scale, exposure] of [[1, 1], [0.86, 0.85], [1, 1.15]]) {
    const side = zone.size * scale; // zoom in slightly within the scan zone
    ctx.filter = `brightness(${exposure})`;
    ctx.drawImage(videoEl, zone.x + (zone.size - side) / 2, zone.y + (zone.size - side) / 2, side, side, 0, 0, 224, 224);
    const embedding = featureModel.infer(trainingCanvas, true);
    try {
      if (scale === 1 && exposure === 1 && background) {
        const values = normalizeEmbedding(embedding.dataSync());
        const looksEmpty = background.some((row) => {
          let similarity = 0;
          for (let i = 0; i < row.length; i++) similarity += row[i] * values[i];
          return similarity > 0.97;
        });
        if (looksEmpty) return false;
      }
      classifier.addExample(embedding, itemName);
    }
    finally { embedding.dispose(); }
  }
  ctx.filter = "none";
  exampleCache = null;
  return true;
}

function trimExamples(itemName) {
  const dataset = classifier.getClassifierDataset();
  const tensor = dataset[itemName];
  if (tensor.shape[0] <= CONFIG.MAX_EXAMPLES_PER_CLASS) return;
  const trimmed = tensor.slice([tensor.shape[0] - CONFIG.MAX_EXAMPLES_PER_CLASS, 0], [CONFIG.MAX_EXAMPLES_PER_CLASS, tensor.shape[1]]);
  dataset[itemName] = trimmed;
  classifier.setClassifierDataset(dataset);
  tensor.dispose();
  exampleCache = null;
}

// Reused every frame: holds just the scan zone, shrunk to MobileNet's 224×224 size.
const scanCanvas = document.createElement("canvas");
scanCanvas.width = scanCanvas.height = 224;

async function predictFromVideo(videoEl) {
  if (!hasEnrolledItems()) return null;
  const zone = getScanZone(videoEl);
  scanCanvas.getContext("2d").drawImage(videoEl, zone.x, zone.y, zone.size, zone.size, 0, 0, 224, 224);
  const embedding = featureModel.infer(scanCanvas, true);
  try { return rankEmbedding(await embedding.data(), getExampleCache(), CONFIG); }
  finally { embedding.dispose(); }
}

function deleteItem(itemName) {
  classifier.clearClass(itemName);
  exampleCache = null;
  saveItems();
}

function deleteAllItems() {
  classifier.clearAllClasses();
  exampleCache = null;
  saveItems();
}

// ---------------------------------------------------------------------------
// Saving and loading
// The browser's localStorage can only hold text (about 5 MB), so we convert
// each item's numbers to compact "base64" text and back. To fit more frames,
// numbers are stored at half precision ("float16"), which halves the size
// without noticeably changing accuracy.
// ---------------------------------------------------------------------------

const STORAGE_LIMIT_CHARS = 5000000; // roughly what Chrome allows per site
const canUseHalfPrecision = typeof Float16Array !== "undefined";

function floatsToBase64(floatArray) {
  const bytes = new Uint8Array(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
  let binary = "";
  const chunkSize = 8192; // build the string in chunks to avoid a browser limit
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// halfPrecision = true if the text was saved as float16.
function base64ToFloats(text, halfPrecision) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (halfPrecision) {
    // Decode IEEE float16 even on browsers without Float16Array.
    const words = new Uint16Array(bytes.buffer);
    return Float32Array.from(words, (word) => {
      const sign = word & 0x8000 ? -1 : 1;
      const exponent = (word >> 10) & 31, fraction = word & 1023;
      return sign * (exponent === 0 ? fraction * 2 ** -24 :
        exponent === 31 ? (fraction ? NaN : Infinity) : (1 + fraction / 1024) * 2 ** (exponent - 15));
    });
  }
  return new Float32Array(bytes.buffer);
}

// Turn everything the classifier knows into a text string.
function exportItemsAsText() {
  const dataset = classifier.getClassifierDataset(); // { itemName: tensor of [frames × 1280] }
  const saved = {};
  for (const itemName in dataset) {
    const tensor = dataset[itemName];
    const numbers = canUseHalfPrecision ? new Float16Array(tensor.dataSync()) : tensor.dataSync();
    saved[itemName] = { shape: tensor.shape, half: canUseHalfPrecision, data: floatsToBase64(numbers) };
  }
  return JSON.stringify(saved);
}

// Load items from a text string made by exportItemsAsText().
function importItemsFromText(text) {
  if (text.length > 15000000) throw new Error("Backup too large");
  const saved = JSON.parse(text);
  if (!saved || Array.isArray(saved) || typeof saved !== "object" || Object.keys(saved).length > 100) throw new Error("Invalid backup");
  const dataset = Object.create(null);
  const names = new Set();
  try {
    for (const [itemName, item] of Object.entries(saved)) {
      if (!itemName.trim() || itemName.length > 79 || Object.hasOwn(Object.prototype, itemName) || ["prototype", CONFIG.UNKNOWN_LABEL].includes(itemName) ||
          names.has(itemName.toLowerCase()) || !item || !Array.isArray(item.shape) || item.shape.length !== 2 ||
          !Number.isInteger(item.shape[0]) || item.shape[0] < 1 || item.shape[0] > 3000 || item.shape[1] !== 1280 ||
          typeof item.data !== "string") throw new Error("Invalid item in backup");
      names.add(itemName.toLowerCase());
      const numbers = base64ToFloats(item.data, item.half);
      if (numbers.length !== item.shape[0] * 1280 || !numbers.every(Number.isFinite)) throw new Error("Invalid features");
      for (let i = 0; i < numbers.length; i += 1280) normalizeEmbedding(numbers.subarray(i, i + 1280));
      dataset[itemName] = tf.tensor2d(numbers, item.shape);
    }
  } catch (err) {
    Object.values(dataset).forEach((tensor) => tensor.dispose());
    throw err;
  }
  // Validate the complete backup before replacing any existing training.
  classifier.clearAllClasses();
  classifier.setClassifierDataset(dataset);
  exampleCache = null;
}

// Returns true if saved OK. Can fail if the browser storage is full.
function saveItems() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, exportItemsAsText());
    return true;
  } catch (err) {
    console.error("Could not save enrolled items:", err);
    return false;
  }
}

// How full browser storage is, from 0 to 1.
function getStorageUsed() {
  const text = localStorage.getItem(CONFIG.STORAGE_KEY) || "";
  return text.length / STORAGE_LIMIT_CHARS;
}

function loadSavedItems() {
  const text = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (!text) return;
  try {
    importItemsFromText(text);
  } catch (err) {
    console.error("Saved items were unreadable, starting fresh:", err);
  }
}
