// enroll.js
// The "Enroll items" screen: this is how a restaurant teaches Pack’em its menu.
// Staff type an item name, hold the item up, and capture ~25 frames of it.

let isCapturing = false; // true while frames are being grabbed

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Item names that appear on any order, so staff can tap instead of typing.
function getSuggestedNames() {
  const names = [CONFIG.BACKGROUND_LABEL];
  for (const order of [...MOCK_ORDERS, ...DEMO_ORDERS, ...orders]) {
    for (const item of order.items) {
      if (!names.some((n) => n.toLowerCase() === item.name.toLowerCase())) names.push(item.name);
    }
  }
  return names;
}

// ---- Drawing the enroll screen ----
function renderEnrollScreen() {
  const counts = getEnrolledCounts();

  // Quick-pick buttons for item names
  document.getElementById("name-suggestions").innerHTML = getSuggestedNames()
    .map((name) => {
      const count = counts[name] || 0;
      const label = name === CONFIG.BACKGROUND_LABEL ? "Nothing (empty area)" : name;
      return `<button class="chip ${count > 0 ? "enrolled" : ""}" data-name="${escapeHtml(name)}" onclick="onPickName(this.dataset.name)">
        ${escapeHtml(label)}${count > 0 ? ` · ${count}` : ""}</button>`;
    })
    .join("");

  // List of what's been enrolled so far
  const names = Object.keys(counts);
  const listEl = document.getElementById("enrolled-list");
  if (names.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Nothing enrolled yet. Start with "Nothing (empty area)", then each item.</p>`;
  } else {
    listEl.innerHTML = names
      .map(
        (name) => `
        <div class="enrolled-row">
          <span class="enrolled-name">${escapeHtml(name)}</span>
          <span class="enrolled-count">${counts[name]} frames</span>
          <button class="delete-btn" data-name="${escapeHtml(name)}" onclick="onDeleteItem(this.dataset.name)">Delete</button>
        </div>`
      )
      .join("");
  }

  // How full browser storage is
  const used = Math.round(getStorageUsed() * 100);
  const storageEl = document.getElementById("storage-meter");
  storageEl.textContent = `Storage used: ${used}%` + (used >= 80 ? " (nearly full: export a backup)" : "");
  storageEl.classList.toggle("warn", used >= 80);

  // Remind staff about the background class
  const tipEl = document.getElementById("enroll-tip");
  tipEl.style.display = counts[CONFIG.BACKGROUND_LABEL] ? "none" : "block";
}

function setCaptureProgress(done, total) {
  const percent = Math.round((done / total) * 100);
  document.getElementById("capture-progress-bar").style.width = percent + "%";
}

// ---- Actions ----
function onPickName(name) {
  document.getElementById("item-name-input").value = name;
}

async function onCapture() {
  const input = document.getElementById("item-name-input");
  const typedName = input.value.trim();
  const itemName = typedName.toLowerCase() === CONFIG.BACKGROUND_LABEL.toLowerCase() ? CONFIG.BACKGROUND_LABEL :
    Object.keys(getEnrolledCounts()).find((name) => name.toLowerCase() === typedName.toLowerCase()) || typedName;
  const button = document.getElementById("capture-btn");

  if (!itemName || itemName.length > 79 || Object.hasOwn(Object.prototype, itemName) || ["prototype", CONFIG.UNKNOWN_LABEL].includes(itemName)) {
    showToast("Use an item name between 1 and 79 characters");
    input.focus();
    return;
  }
  if (!isRecognizerReady() || !isCameraReady()) {
    showToast("Camera or model still loading…");
    return;
  }
  if (isCapturing) return;

  isCapturing = true;
  button.disabled = true;

  document.getElementById("enroll-toggle-btn").disabled = true;
  let accepted = 0;
  try {
    for (let s = CONFIG.CAPTURE_COUNTDOWN_S; s > 0; s--) {
      button.textContent = `Get ready… ${s}`;
      showScanNotice(`Get ready… ${s}`, "warn");
      await wait(1000);
    }
    showScanNotice(itemName === CONFIG.BACKGROUND_LABEL ? "Keep the area empty" : "Swipe it across a few times", "success");
    button.textContent = "Learning… vary the angle";
    for (let i = 0; i < CONFIG.FRAMES_PER_CAPTURE; i++) {
      if (!isCameraReady()) throw new Error("Camera disconnected. Try capturing again.");
      if (addExampleFromVideo(getCameraVideo(), itemName)) accepted++;
      setCaptureProgress(i + 1, CONFIG.FRAMES_PER_CAPTURE);
      await wait(CONFIG.CAPTURE_INTERVAL_MS);
    }
    if (accepted) trimExamples(itemName);
    const saved = saveItems();
    showToast(!accepted ? "No usable views. Keep the item visible and check the lighting." :
      !saved ? "Storage full. Export a backup before closing." :
      `Learned ${itemName}: ${accepted} views + lighting and framing variations`);
  } catch (err) {
    saveItems();
    showToast(err.message || "Capture failed. Please try again.");
  } finally {
    isCapturing = false;
    button.disabled = false;
    document.getElementById("enroll-toggle-btn").disabled = false;
    button.textContent = "Capture item";
    setCaptureProgress(0, 1);
    renderEnrollScreen();
  }
}

function onDeleteItem(name) {
  if (isCapturing) return;
  if (!confirm(`Delete everything learned for "${name}"?`)) return;
  deleteItem(name);
  renderEnrollScreen();
}

function onDeleteAllItems() {
  if (isCapturing) return;
  if (!confirm("Delete ALL enrolled items? This can't be undone (unless you exported a backup).")) return;
  deleteAllItems();
  renderEnrollScreen();
}

// Download enrolled items as a file (backup before a demo!).
function onExportItems() {
  if (!hasEnrolledItems()) {
    showToast("Nothing to export yet");
    return;
  }
  const blob = new Blob([exportItemsAsText()], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "packem-items.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

// Load items from a backup file. Replaces what's currently enrolled.
function onImportItems(fileInput) {
  if (isCapturing) { fileInput.value = ""; return; }
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importItemsFromText(reader.result);
      const saved = saveItems();
      renderEnrollScreen();
      showToast(saved ? "Items imported" : "Imported, but storage is full. Keep your backup.");
    } catch (err) {
      showToast("That file couldn't be read");
    }
    fileInput.value = ""; // allow importing the same file again
  };
  reader.readAsText(file);
}
