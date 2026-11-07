const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { normalizeEmbedding, rankEmbedding } = require('../public/js/matching');
const read = (file) => fs.readFileSync(`public/js/${file}.js`, 'utf8');
const base = vm.createContext({});
vm.runInContext(read('config') + ';globalThis.settings = CONFIG;', base);
const settings = base.settings;
const rows = (v, n = 6) => Array.from({ length: n }, () => normalizeEmbedding(v));

test('unfamiliar inputs are rejected even when only one item was taught', () => {
  const result = rankEmbedding([0, 1, 0], { Coffee: rows([1, 0, 0]) }, settings);
  assert.equal(result.label, settings.UNKNOWN_LABEL);
  assert.equal(result.reliable, false);
});
test('clear matches need background examples and enough item examples', () => {
  assert.equal(rankEmbedding([1, 0, 0], { Coffee: rows([1, 0, 0]) }, settings).reliable, false);
  const examples = { Coffee: rows([1, 0, 0]), Nothing: rows([0, 0, 1]) };
  assert.equal(rankEmbedding([1, .05, 0], examples, settings).reliable, true);
  examples.Coffee = rows([1, 0, 0], 2);
  assert.equal(rankEmbedding([1, 0, 0], examples, settings).reliable, false);
});
test('near ties cannot automatically count, even with a high similarity', () => {
  const result = rankEmbedding([1, 0, 0], {
    Coffee: rows([1, 0, 0]), Latte: rows([1, .05, 0]), Nothing: rows([0, 0, 1]),
  }, settings);
  assert.equal(result.reliable, false);
  assert.ok(result.margin < settings.MIN_CLASS_MARGIN);
});
test('an item narrowly ahead of the empty area still counts, but not one narrowly ahead of another item', () => {
  // Coffee only slightly more similar than the empty table: OK (no other item to confuse it with).
  const vsEmpty = rankEmbedding([1, .95, 0], { Coffee: rows([1, 1, 0]), Nothing: rows([.75, 1, 0]) }, settings);
  assert.equal(vsEmpty.label, 'Coffee');
  assert.ok(vsEmpty.margin < settings.MIN_CLASS_MARGIN && vsEmpty.margin >= settings.MIN_BACKGROUND_MARGIN);
  assert.equal(vsEmpty.reliable, true);
  // Same small gap, but the runner-up is another item: must not count.
  const vsItem = rankEmbedding([1, .95, 0], { Coffee: rows([1, 1, 0]), Latte: rows([.75, 1, 0]), Nothing: rows([0, 0, 1]) }, settings);
  assert.equal(vsItem.reliable, false);
});
test('an overrepresented class does not drown out a closer class', () => {
  const result = rankEmbedding([1, 0, 0], {
    Coffee: rows([1, 0, 0]), Muffin: rows([.75, .65, 0], 180), Nothing: rows([0, 0, 1]),
  }, settings);
  assert.equal(result.label, 'Coffee');
  assert.equal(result.reliable, true);
});
test('invalid embeddings are rejected', () => {
  assert.throws(() => normalizeEmbedding([0, 0]));
  assert.throws(() => normalizeEmbedding([NaN, 1]));
});

function orderContext(storage = new Map()) {
  const context = vm.createContext({
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'test-unique-id' },
  });
  vm.runInContext(read('orders'), context);
  return { context, run: (code) => vm.runInContext(code, context), storage };
}
test('quantity, completion, undo, and completed-order immutability', () => {
  const { run } = orderContext();
  run('loadOrders(MOCK_ORDERS); var order = getActiveOrder();');
  assert.equal(run('markOrderReady(order).ok'), false);
  assert.equal(run('checkOffItem(order, 0)'), true);
  assert.equal(run('checkOffItem(order, 0)'), false);
  assert.equal(run('checkOffItem(order, 1)'), true);
  assert.equal(run('markOrderReady(order).ok'), false);
  assert.equal(run('undoItem(order, 1)'), true);
  run('checkOffItem(order, 1); checkOffItem(order, 1)');
  assert.equal(run('markOrderReady(order).ok'), true);
  assert.equal(run('undoItem(order, 1)'), false);
  assert.equal(run('checkOffItem(order, 1)'), false);
});
test('thumbs-down undo removes the most recent check-off, and never touches ready orders', () => {
  const { run } = orderContext();
  run('loadOrders([{number:"9",platform:"Other",customer:"",items:[{name:"Coffee",qty:2},{name:"Muffin",qty:1}]}]); var order = getActiveOrder();');
  run('checkOffItem(order, 0); checkOffItem(order, 1); checkOffItem(order, 0);'); // Coffee, Muffin, Coffee
  assert.equal(run('undoLastCheck(order)'), 0); // last was Coffee
  assert.equal(run('undoLastCheck(order)'), 1); // then Muffin
  assert.equal(run('order.items[0].scanned + "," + order.items[1].scanned'), '1,0');
  run('checkOffItem(order, 0); checkOffItem(order, 1); markOrderReady(order)');
  assert.equal(run('order.status'), 'ready');
  assert.equal(run('undoLastCheck(order)'), -1);
  assert.equal(run('countScanned(order)'), 3);
});
test('same-name ticket lines advance to the next unfilled modifier line', () => {
  const { run } = orderContext();
  run('var order = addOrder({ number: "1", platform: "Other", items: [{name:"Coffee", qty:1, note:"oat"}, {name:"Coffee", qty:1, note:"whole"}] });');
  assert.equal(run('findItemByName(order, "coffee").note'), 'oat');
  run('checkOffItem(order, 0)');
  assert.equal(run('findItemByName(order, "coffee").note'), 'whole');
});
test('progress survives reload; demo and normal queues stay separate', () => {
  const first = orderContext();
  first.run('restoreOrders(false); loadOrders(MOCK_ORDERS); checkOffItem(getActiveOrder(), 0)');
  const second = orderContext(first.storage);
  assert.equal(second.run('restoreOrders(false)'), true);
  assert.equal(second.run('getActiveOrder().items[0].scanned'), 1);
  second.run('restoreOrders(true); loadOrders(DEMO_ORDERS)');
  assert.equal(second.run('getActiveOrder().number'), '2001');
  second.run('restoreOrders(false)');
  assert.equal(second.run('getActiveOrder().number'), '1041');
  assert.equal(second.run('getActiveOrder().items[0].scanned'), 1);
});
test('invalid persisted completed orders cannot bypass the completion rule', () => {
  const { run, storage } = orderContext();
  run('loadOrders(MOCK_ORDERS)');
  const saved = JSON.parse(storage.get('packem-orders-main'));
  saved.orders[0].status = 'ready';
  storage.set('packem-orders-main', JSON.stringify(saved));
  assert.equal(run('restoreOrders(false)'), false);
});

function scannerContext() {
  let now = 0;
  const { context, run } = orderContext();
  Object.assign(context, {
    performance: { now: () => now }, document: { createElement: () => ({}) },
    setHoldProgress() {}, getEnrolledCounts: () => ({ Nothing: 6, Muffin: 6 }),
    getCameraVideo: () => null, showScanNotice() {}, playSound() {}, hideMissingWarning() {},
    render() {}, flashChecklistItem() {}, hideConfirmPanel() {}, clearTimeout() {},
    captureFrameAsJpeg: () => 'data:image/jpeg;base64,test',
    showAiChecking() {}, askAiWhichItem: async () => 'unsure',
    setTimeout: () => 0, showConfirmPanel() {},
  });
  run(read('config') + read('scanner'));
  run('loadOrders([{number:"1",platform:"Other",customer:"",items:[{name:"Muffin",qty:3}]}]);');
  return { run, frame: (label, ms, reliable = true) => {
    now = ms;
    context.frameResult = { label, confidence: .95, reliable };
    run('handlePrediction(frameResult)');
  } };
}
test('scan requires stable evidence and a truly empty gap before counting again', () => {
  const { run, frame } = scannerContext();
  frame('Muffin', 0);
  assert.equal(run('countScanned(getActiveOrder())'), 0); // one frame is never enough
  frame('Muffin', 40);
  assert.equal(run('countScanned(getActiveOrder())'), 1); // a quick swipe (2 frames) counts
  frame('Muffin', 200);
  assert.equal(run('countScanned(getActiveOrder())'), 1);
  frame('Coffee', 500); frame('Coffee', 800); frame('Muffin', 1000);
  assert.equal(run('countScanned(getActiveOrder())'), 1);
  frame('Nothing', 1100); frame('Nothing', 1500);
  frame('Muffin', 1600); frame('Muffin', 1700); frame('Muffin', 1800);
  assert.equal(run('countScanned(getActiveOrder())'), 2);
});
test('a fast swipe with blurry edges counts once, and the next swipe counts again', () => {
  const { run, frame } = scannerContext();
  // ~25 frames per second: blurry entering, 2 clear frames, blurry leaving (~0.2 s)
  frame('Muffin', 0, false); frame('Muffin', 40); frame('Muffin', 80); frame('Muffin', 120, false);
  assert.equal(run('countScanned(getActiveOrder())'), 1);
  frame('Nothing', 160); frame('Nothing', 200); frame('Nothing', 320); // brief empty view
  frame('Muffin', 360, false); frame('Muffin', 400); frame('Muffin', 440);
  assert.equal(run('countScanned(getActiveOrder())'), 2);
});
test('uncertain frames reset the consecutive confident tally', () => {
  const { run, frame } = scannerContext();
  frame('Muffin', 0); frame('Muffin', 100, false); frame('Muffin', 200);
  assert.equal(run('countScanned(getActiveOrder())'), 0);
});
test('physical item lock survives order switches', () => {
  const { run, frame } = scannerContext();
  frame('Muffin', 0); frame('Muffin', 100); frame('Muffin', 200);
  run('resetScanner()');
  frame('Muffin', 500); frame('Muffin', 600); frame('Muffin', 700);
  assert.equal(run('countScanned(getActiveOrder())'), 1);
});
test('unreliable background frames cannot release a physical item lock', () => {
  const { run, frame } = scannerContext();
  frame('Muffin', 0); frame('Muffin', 100); frame('Muffin', 200);
  frame('Nothing', 500, false); frame('Nothing', 1000, false);
  frame('Muffin', 1100); frame('Muffin', 1200); frame('Muffin', 1300);
  assert.equal(run('countScanned(getActiveOrder())'), 1);
});
test('a failed automatic AI check does not open a blocking panel', async () => {
  const { run } = scannerContext();
  run('askAiWhichItem = async () => { throw new Error("offline"); };');
  await run('checkWithAi(getActiveOrder(), "Muffin", "test-image")');
  assert.equal(run('confirmOrderId'), null);
  assert.equal(run('aiChecksRunning'), 0);
});
test('late AI answers cannot count after manual intervention', async () => {
  const { run } = scannerContext();
  run('askAiWhichItem = () => new Promise(resolve => { globalThis.resolveAi = resolve; });');
  const pending = run('checkWithAi(getActiveOrder(), "Muffin", "test-image")');
  run('cancelPendingAiChecks(); resolveAi("Muffin")');
  await pending;
  assert.equal(run('countScanned(getActiveOrder())'), 0);
  assert.equal(run('aiChecksRunning'), 0);
});
