// ticket.js
// "Scan ticket": photograph a printed order ticket and turn it into a new order.
// The AI reads the ticket, then staff review (and can fix) the items before
// the order is added. The AI's reading is never added without a human check.

let pendingTicket = null; // what the AI read, waiting for staff to approve

function isTicketScannerOpen() {
  return !document.getElementById("ticket-modal").hidden;
}

function onOpenTicketScanner() {
  pendingTicket = null;
  document.getElementById("ticket-modal").hidden = false;
  moveCameraTo("ticket-camera-slot");
  setCameraHighRes(true); // sharper image so small ticket text is readable
  showTicketStep("capture");
}

function onCloseTicketScanner() {
  document.getElementById("ticket-modal").hidden = true;
  moveCameraTo("main-camera-slot");
  setCameraHighRes(false);
}

// Show one of the steps: "capture", "reading", "review", "error"
function showTicketStep(step, message) {
  for (const name of ["capture", "reading", "review", "error"]) {
    document.getElementById("ticket-step-" + name).hidden = name !== step;
  }
  if (step === "error") document.getElementById("ticket-error-message").textContent = message;
}

// ---- Getting the photo ----
function onTakeTicketPhoto() {
  if (!isCameraReady()) {
    showToast("Camera isn't ready. Try Upload photo.");
    return;
  }
  readTicket(captureFrameAsJpeg(1600, 0.9));
}

// A photo file chosen from the computer (or AirDropped from a phone).
function onUploadTicketPhoto(fileInput) {
  const file = fileInput.files[0];
  fileInput.value = ""; // allow choosing the same file again
  if (!file) return;

  const image = new Image();
  image.onload = () => {
    // Shrink big phone photos so they upload quickly.
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(image.src);
    readTicket(canvas.toDataURL("image/jpeg", 0.9));
  };
  image.onerror = () => showToast("That file isn't a photo Chrome can open");
  image.src = URL.createObjectURL(file);
}

// ---- Sending it to the AI ----
async function readTicket(imageDataUrl) {
  document.getElementById("ticket-photo").src = imageDataUrl;
  showTicketStep("reading");

  // Names the app already knows, so the AI uses matching names (needed for scanning).
  const knownNames = [...new Set([...getSuggestedNames(), ...Object.keys(getEnrolledCounts())])].filter(
    (name) => name !== CONFIG.BACKGROUND_LABEL
  );

  try {
    const ticket = await askAiToReadTicket(imageDataUrl, knownNames);
    if (!isTicketScannerOpen()) return; // staff closed the window while waiting
    if (ticket.items.length === 0) {
      showTicketStep("error", "Couldn't find any items on that ticket. Try again with the ticket flat, close, and well lit.");
      return;
    }
    pendingTicket = ticket;
    renderTicketReview();
    showTicketStep("review");
  } catch (err) {
    console.error("Ticket reading failed:", err);
    const message =
      err.name === "TimeoutError"
        ? "The AI took too long. Check the internet connection and try again."
        : "Couldn't read the ticket: " + err.message;
    showTicketStep("error", message);
  }
}

// ---- Review step: staff can fix quantities before adding ----
function renderTicketReview() {
  const t = pendingTicket;
  document.getElementById("ticket-summary").innerHTML = `
    <span class="order-number">#${escapeHtml(t.orderNumber || "new")}</span>
    <span class="platform-tag ${platformClass(t.platform)}">${escapeHtml(t.platform)}</span>
    <span class="customer">${escapeHtml(t.customer)}</span>`;

  document.getElementById("ticket-items").innerHTML = t.items
    .map(
      (item, index) => `
      <div class="ticket-item">
        <div class="ticket-item-name">
          ${escapeHtml(item.name)}
          ${item.note ? `<span class="item-note">${escapeHtml(item.note)}</span>` : ""}
        </div>
        <button class="qty-btn" onclick="onChangeTicketQty(${index}, -1)" aria-label="One less">−</button>
        <span class="ticket-qty">${item.qty}</span>
        <button class="qty-btn" onclick="onChangeTicketQty(${index}, 1)" aria-label="One more">+</button>
      </div>`
    )
    .join("");

  document.getElementById("add-ticket-btn").disabled = t.items.length === 0;
}

// Quantity 0 removes the item.
function onChangeTicketQty(index, change) {
  const item = pendingTicket.items[index];
  item.qty = Math.min(20, item.qty + change);
  if (item.qty <= 0) pendingTicket.items.splice(index, 1);
  renderTicketReview();
}

function onAddTicketOrder() {
  if (!pendingTicket || pendingTicket.items.length === 0) return;
  const newOrder = addOrder({
    number: pendingTicket.orderNumber || "T" + Math.floor(100 + Math.random() * 900),
    platform: pendingTicket.platform,
    customer: pendingTicket.customer,
    items: pendingTicket.items,
  });
  setActiveOrder(newOrder.id);
  onCloseTicketScanner();
  hideMissingWarning();
  render();
  showToast(`Order #${newOrder.number} added`);
}
