const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(`public/js/${file}.js`, 'utf8');

// Load config + orders + stats into one sandbox (no browser needed).
function makeStation() {
  const ctx = vm.createContext({ localStorage: { setItem() {}, getItem() { return null; } }, crypto: globalThis.crypto });
  vm.runInContext(read('config') + ';' + read('orders') + ';' + read('stats') + `;
    globalThis.api = { loadOrders, getActiveOrder, markOrderReady, checkOffItem, recordMissingItemsCaught,
      getCatchTotals, catchStatsHtml, STATS_ESTIMATES, DEMO_ORDERS };`, ctx);
  return ctx.api;
}

test('a blocked Mark ready counts each missing unit once per order', () => {
  const s = makeStation();
  s.loadOrders(s.DEMO_ORDERS);
  const order = s.getActiveOrder(); // #2001: Muffin x1, Coffee x1
  s.checkOffItem(order, 0);         // pack the Muffin, forget the Coffee

  for (let i = 0; i < 3; i++) {     // pressing Mark ready repeatedly
    const result = s.markOrderReady(order);
    assert.equal(result.ok, false);
    s.recordMissingItemsCaught(order, result.missing);
  }
  const t = s.getCatchTotals();
  assert.equal(t.items, 1);
  assert.equal(t.dollars, s.STATS_ESTIMATES.REFUND_PER_MISSING_ITEM);
});

test('a larger shortfall on the same order raises the count, a smaller one does not', () => {
  const s = makeStation();
  s.loadOrders([{ number: '1', platform: 'DoorDash', customer: 'A', items: [{ name: 'Coffee', qty: 3 }] }]);
  const order = s.getActiveOrder();
  s.checkOffItem(order, 0);
  s.recordMissingItemsCaught(order, s.markOrderReady(order).missing); // 2 missing
  s.checkOffItem(order, 0);
  s.recordMissingItemsCaught(order, s.markOrderReady(order).missing); // 1 missing
  assert.equal(s.getCatchTotals().items, 2);
});

test('completed orders without a block add nothing, and the label is marked as an estimate', () => {
  const s = makeStation();
  s.loadOrders(s.DEMO_ORDERS);
  const order = s.getActiveOrder();
  s.checkOffItem(order, 0);
  s.checkOffItem(order, 1);
  assert.equal(s.markOrderReady(order).ok, true);
  assert.equal(s.getCatchTotals().items, 0);
  assert.match(s.catchStatsHtml(), /est\./);
});
