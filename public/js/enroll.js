// enroll.js
// The "Enroll items" screen: this is how a restaurant teaches PackPal its menu.
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
      return `<button class="chip ${count > 0 ? "enrolled" : ""}" onclick="onPickName('${escapeHtml(name).replaceAll("'", "\\'")}')">
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
          <button class="delete-btn" onclick="onDeleteItem('${escapeHtml(name).replaceAll("'", "\\'")}')">Delete</button>
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
  const itemName = input.value.trim();
  const button = document.getElementById("capture-btn");

  if (!itemName) {
    showToast("Type an item name first");
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

  // Countdown, so staff can get the item ready before frames are grabbed.
  for (let s = CONFIG.CAPTURE_COUNTDOWN_S; s > 0; s--) {
    button.textContent = `Get ready… ${s}`;
    showScanNotice(`Get ready… ${s}`, "warn");
    await wait(1000);
  }
  showScanNotice("Swipe it across now!", "success");
  button.textContent = "Capturing… keep swiping";

  for (let i = 0; i < CONFIG.FRAMES_PER_CAPTURE; i++) {
    addExampleFromVideo(getCameraVideo(), itemName);
    setCaptureProgress(i + 1, CONFIG.FRAMES_PER_CAPTURE);
    await wait(CONFIG.CAPTURE_INTERVAL_MS);
  }

  const saved = saveItems();
  isCapturing = false;
  button.disabled = false;
  button.textContent = "📸 Capture frames";
  setCaptureProgress(0, 1);
  renderEnrollScreen();
  showToast(saved ? `Learned "${itemName}"` : "Learned, but browser storage is full. Use Export to back up.");
}

function onDeleteItem(name) {
  if (!confirm(`Delete everything learned for "${name}"?`)) return;
  deleteItem(name);
  renderEnrollScreen();
}

function onDeleteAllItems() {
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
  link.download = "packpal-items.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

// Load items from a backup file. Replaces what's currently enrolled.
function onImportItems(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importItemsFromText(reader.result);
      saveItems();
      renderEnrollScreen();
      showToast("Items imported");
    } catch (err) {
      showToast("That file couldn't be read");
    }
    fileInput.value = ""; // allow importing the same file again
  };
  reader.readAsText(file);
}
