// orders.js
// All order data and the rules about orders live here.
// Nothing in this file touches the screen; ui.js does the drawing.
//
// IMPORTANT: item names here must match the names you type when enrolling
// items with the camera (Milestone 2). Matching ignores upper/lower case.

// Normal mock orders (what a regular shift might look like).
const MOCK_ORDERS = [
  {
    number: "1041",
    platform: "DoorDash",
    customer: "Priya S.",
    items: [
      { name: "Coffee", qty: 1 },
      { name: "Muffin", qty: 2 },
    ],
  },
  {
    number: "1042",
    platform: "Uber Eats",
    customer: "Marcus T.",
    items: [{ name: "Coffee", qty: 2 }],
  },
  {
    number: "1043",
    platform: "Grubhub",
    customer: "Lena K.",
    items: [
      { name: "Muffin", qty: 1 },
      { name: "Coffee", qty: 1 },
    ],
  },
  {
    number: "1044",
    platform: "DoorDash",
    customer: "Sam R.",
    items: [{ name: "Muffin", qty: 3 }],
  },
  {
    number: "1045",
    platform: "Uber Eats",
    customer: "Jo W.",
    items: [
      { name: "Coffee", qty: 3 },
      { name: "Muffin", qty: 1 },
    ],
  },
];

// Demo mode orders, designed for the pitch.
// Order 2001 is "the forgotten drink": pack the Muffin, skip the Coffee,
// tap "Mark ready", and Pack’em blocks it and names the Coffee.
const DEMO_ORDERS = [
  {
    number: "2001",
    platform: "DoorDash",
    customer: "Alex M.",
    items: [
      { name: "Muffin", qty: 1 },
      { name: "Coffee", qty: 1 },
    ],
  },
  {
    number: "2002",
    platform: "DoorDash",
    customer: "Jordan P.",
    items: [{ name: "Coffee", qty: 2 }], // shows quantity handling: 2 scans needed
  },
  {
    number: "2003",
    platform: "Uber Eats",
    customer: "Casey L.",
    items: [
      { name: "Coffee", qty: 1 },
      { name: "Muffin", qty: 1 },
    ],
  },
  {
    number: "2004",
    platform: "Grubhub",
    customer: "Riley D.",
    items: [{ name: "Muffin", qty: 2 }],
  },
];

// ---- Current state ----
let orders = [];         // every order, including ready ones
let activeOrderId = null; // the order shown on the right side
let orderStorageKey = "packem-orders-main";

function saveOrders() {
  try { localStorage.setItem(orderStorageKey, JSON.stringify({ orders, activeOrderId })); }
  catch { if (typeof showToast === "function") showToast("Order progress could not be saved on this device."); }
}

function restoreOrders(isDemo) {
  orderStorageKey = isDemo ? "packem-orders-demo" : "packem-orders-main";
  try {
    const saved = JSON.parse(localStorage.getItem(orderStorageKey));
    if (!saved || !Array.isArray(saved.orders) || saved.orders.length > 500) return false;
    const ids = new Set();
    for (const order of saved.orders) {
      if (!/^order-[\w-]+$/.test(order.id) || ids.has(order.id) || !["waiting", "packing", "ready"].includes(order.status) ||
          ![order.number, order.customer, order.platform].every((value) => typeof value === "string") ||
          !Array.isArray(order.items) || !order.items.length || !order.items.every((item) =>
            typeof item.name === "string" && item.name.trim() && Number.isInteger(item.qty) && item.qty > 0 && item.qty <= 20 &&
            Number.isInteger(item.scanned) && item.scanned >= 0 && item.scanned <= item.qty) ||
          (order.status === "ready" && order.items.some((item) => item.scanned !== item.qty))) return false;
      ids.add(order.id);
    }
    orders = saved.orders;
    activeOrderId = orders.find((order) => order.id === saved.activeOrderId && order.status !== "ready")?.id || getQueueOrders()[0]?.id || null;
    return true;
  } catch { return false; }
}

// Replace all orders with a fresh copy of a list (mock or demo).
// Each item gets a "scanned" counter that starts at 0.
function loadOrders(list) {
  orders = list.map((order, index) => ({
    id: "order-" + index + "-" + order.number,
    number: order.number,
    platform: order.platform,
    customer: order.customer,
    status: "waiting", // waiting -> packing -> ready
    items: order.items.map((item) => ({ name: item.name, qty: item.qty, scanned: 0 })),
  }));
  activeOrderId = orders.length > 0 ? orders[0].id : null;
  checkHistory.length = 0; // fresh orders: nothing to undo
  saveOrders();
}

// Add one brand-new order (used later by "ticket photo to order").
function addOrder(order) {
  const newOrder = {
    id: "order-" + crypto.randomUUID(),
    number: order.number,
    platform: order.platform,
    customer: order.customer || "",
    status: "waiting",
    // "note" holds modifiers read from a ticket, e.g. "no pickles" (shown as a reminder).
    items: order.items.map((item) => ({ name: item.name, qty: item.qty, note: item.note || "", scanned: 0 })),
  };
  orders.push(newOrder);
  saveOrders();
  return newOrder;
}

function getOrder(orderId) {
  return orders.find((order) => order.id === orderId);
}

function getActiveOrder() {
  return getOrder(activeOrderId);
}

function setActiveOrder(orderId) {
  activeOrderId = orderId;
  saveOrders();
}

// Orders still being worked on.
function getQueueOrders() {
  return orders.filter((order) => order.status !== "ready");
}

// Orders that passed the check and are waiting for a driver.
function getReadyOrders() {
  return orders.filter((order) => order.status === "ready");
}

// Total number of things in the bag (2 Coffees + 1 Muffin = 3).
function countItems(order) {
  return order.items.reduce((total, item) => total + item.qty, 0);
}

function countScanned(order) {
  return order.items.reduce((total, item) => total + item.scanned, 0);
}

// Find an item on an order by name, ignoring upper/lower case.
function findItemByName(order, name) {
  const wanted = name.trim().toLowerCase();
  return order.items.find((item) => item.name.toLowerCase() === wanted && item.scanned < item.qty) ||
    order.items.find((item) => item.name.toLowerCase() === wanted);
}

// Check off ONE unit of an item. Returns true if it worked,
// false if the item is already fully scanned.
// Most recent check-offs (newest last), so a thumbs-down can undo the latest one.
// Kept in memory only; after a reload, undo falls back to the last checked item.
const checkHistory = [];

function checkOffItem(order, itemIndex, source = "staff") {
  const item = order.items[itemIndex];
  if (order.status === "ready" || !item || item.scanned >= item.qty) return false;
  item.scanned += 1;
  item.lastSource = source;
  if (order.status === "waiting") order.status = "packing";
  checkHistory.push({ orderId: order.id, itemIndex: itemIndex });
  saveOrders();
  return true;
}

// Undo the most recent check-off on this order. Returns the item's index,
// or -1 if there was nothing to undo. Ready orders can't be changed.
function undoLastCheck(order) {
  for (let i = checkHistory.length - 1; i >= 0; i--) {
    const entry = checkHistory[i];
    if (entry.orderId !== order.id) continue;
    checkHistory.splice(i, 1);
    if (undoItem(order, entry.itemIndex)) return entry.itemIndex;
  }
  // No history (e.g. after a reload): undo the last item on the list that has a check.
  for (let i = order.items.length - 1; i >= 0; i--) {
    if (undoItem(order, i)) return i;
  }
  return -1;
}

// Undo ONE unit (in case of a mistake).
function undoItem(order, itemIndex) {
  const item = order.items[itemIndex];
  if (order.status === "ready" || !item || item.scanned <= 0) return false;
  item.scanned -= 1;
  saveOrders();
  return true;
}

// List what's still missing, e.g. [{ name: "Coffee", missing: 1 }]
function getMissingItems(order) {
  return order.items
    .filter((item) => item.scanned < item.qty)
    .map((item) => ({ name: item.name, missing: item.qty - item.scanned }));
}

// THE COMPLETION RULE.
// An order can only be marked ready when every unit of every item is scanned.
// This is plain, predictable code. The AI (Milestone 4) can check off items,
// but it never calls this function and can never complete an order by itself.
function markOrderReady(order) {
  if (!order.items.length) return { ok: false, missing: [] };
  const missing = getMissingItems(order);
  if (missing.length > 0) {
    return { ok: false, missing: missing };
  }
  order.status = "ready";
  saveOrders();
  return { ok: true, missing: [] };
}
