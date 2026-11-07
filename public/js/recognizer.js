// recognizer.js
// The "brain" that learns and recognizes items. Two pieces:
//
// 1. MobileNet (pretrained by Google) looks at a camera frame and turns it into
//    a list of 1,280 numbers that describe what it looks like (its "embedding").
//    Similar-looking things get similar numbers.
//
// 2. A KNN classifier stores the embeddings of frames you enrolled, each tagged
//    with an item name. To recognize a new frame, it finds the most similar
//    stored frames and lets them vote. No training step needed.

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

// Take the current camera frame and store it as an example of `itemName`.
function addExampleFromVideo(videoEl, itemName) {
  const embedding = featureModel.infer(videoEl, true); // true = give us the embedding
  classifier.addExample(embedding, itemName);
  embedding.dispose(); // free memory (the classifier keeps its own copy)
}

// What's in front of the camera right now?
// Returns { label: "Coffee", confidence: 0.9 } or null if nothing is enrolled.
async function predictFromVideo(videoEl) {
  if (!hasEnrolledItems()) return null;
  const embedding = featureModel.infer(videoEl, true);
  const result = await classifier.predictClass(embedding, CONFIG.KNN_K);
  embedding.dispose();
  return { label: result.label, confidence: result.confidences[result.label] };
}

function deleteItem(itemName) {
  classifier.clearClass(itemName);
  saveItems();
}

function deleteAllItems() {
  classifier.clearAllClasses();
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
  if (halfPrecision) return Float32Array.from(new Float16Array(bytes.buffer));
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
  const saved = JSON.parse(text);
  const dataset = {};
  for (const itemName in saved) {
    const item = saved[itemName];
    dataset[itemName] = tf.tensor2d(base64ToFloats(item.data, item.half), item.shape);
  }
  classifier.clearAllClasses();
  classifier.setClassifierDataset(dataset);
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
