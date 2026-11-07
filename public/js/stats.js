// stats.js
// "Missing items caught" counter for the station bar, plus estimated refunds
// avoided.
//
// A "catch" = Mark ready was blocked because items were missing, i.e. a bag
// that would otherwise have gone out incomplete. Each order remembers the most
// units of each item it was ever missing (order.caught), so pressing Mark ready
// twice doesn't double-count. It's stored on the order, so it is saved with the
// order progress and resets when the orders reset.
//
// app.js calls recordMissingItemsCaught(); ui.js shows catchStatsHtml().

// ESTIMATE used for the dollar figure. Replace it with a real number if you
// have a source; the screen marks it as an estimate either way.
const STATS_ESTIMATES = {
  REFUND_PER_MISSING_ITEM: 15,  // dollars refunded / re-made per missing item
};

// missing = [{ name, missing }] from markOrderReady()
function recordMissingItemsCaught(order, missing) {
  if (!order || !Array.isArray(missing) || missing.length === 0) return;
  if (!order.caught || typeof order.caught !== "object") order.caught = {};

  let changed = false;
  for (const m of missing) {
    const key = String(m.name).toLowerCase();
    const units = Number(m.missing) || 0;
    if (units > (order.caught[key] || 0)) {
      order.caught[key] = units;
      changed = true;
    }
  }
  if (!changed) return;

  if (typeof saveOrders === "function") saveOrders();
  if (typeof renderStation === "function") renderStation();
  bumpCatchStats();
}

// Totals across every order in the current queue + ready list.
function getCatchTotals() {
  let items = 0;
  for (const order of orders) {
    if (!order.caught || typeof order.caught !== "object") continue;
    for (const units of Object.values(order.caught)) {
      if (Number.isFinite(units) && units > 0) items += units;
    }
  }
  return {
    items: items,
    dollars: items * STATS_ESTIMATES.REFUND_PER_MISSING_ITEM,
  };
}

// HTML for the station bar.
function catchStatsHtml() {
  const t = getCatchTotals();
  const noun = t.items === 1 ? "missing item" : "missing items";
  return `<span class="catch-stats" id="catch-stats" title="Refunds are an estimate (see js/stats.js)">` +
    `<span><strong>${t.items}</strong> ${noun} caught</span>` +
    `<span><strong>~$${t.dollars}</strong> refunds avoided</span>` +
    `<span class="catch-est">est.</span></span>`;
}

// Brief highlight when the number goes up.
function bumpCatchStats() {
  if (typeof document === "undefined") return; // running in tests
  const el = document.getElementById("catch-stats");
  if (!el) return;
  el.classList.remove("bump");
  void el.offsetWidth; // restart the animation
  el.classList.add("bump");
}

// Let the tests load this file in Node.
if (typeof module !== "undefined") module.exports = { STATS_ESTIMATES };
