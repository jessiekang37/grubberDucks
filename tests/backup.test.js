const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const tf = require('../public/vendor/tf.min.js');
function setup() {
  const context = vm.createContext({ tf, atob, btoa, console,
    document: { createElement: () => ({}) },
    localStorage: { setItem() {}, getItem: () => null },
  });
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync('public/vendor/knn-classifier.min.js', 'utf8'));
  for (const file of ['config', 'matching', 'recognizer']) run(fs.readFileSync(`public/js/${file}.js`, 'utf8'));
  run('classifier = knnClassifier.create(); var row = tf.ones([1280]); classifier.addExample(row, "Coffee"); row.dispose();');
  return { run, context };
}
test('backups round trip with real TensorFlow tensors', () => {
  const { run } = setup();
  const before = run('exportItemsAsText()');
  run('var backup = exportItemsAsText(); importItemsFromText(backup)');
  assert.equal(run('getEnrolledCounts().Coffee'), 1);
  assert.equal(run('exportItemsAsText()'), before);
  run('deleteAllItems()');
});
test('bad imports preserve existing training and dispose temporary tensors', () => {
  const { run } = setup();
  const before = tf.memory().numTensors;
  assert.throws(() => run('var bad = JSON.parse(exportItemsAsText()); bad.Invalid = {shape:[1,2],data:"AAAA"}; importItemsFromText(JSON.stringify(bad))'));
  assert.equal(run('getEnrolledCounts().Coffee'), 1);
  assert.equal(tf.memory().numTensors, before);
  run('deleteAllItems()');
});
test('legacy float16 backups decode without browser Float16Array support', () => {
  const { run } = setup();
  assert.equal(run('base64ToFloats(btoa(String.fromCharCode(0,60)), true)[0]'), 1);
  assert.equal(run('base64ToFloats(btoa(String.fromCharCode(0,184)), true)[0]'), -.5);
  run('deleteAllItems()');
});
test('training cap keeps recent examples and correct class counts', () => {
  const { run } = setup();
  run('var many = tf.ones([190,1280]); classifier.clearAllClasses(); classifier.setClassifierDataset({Coffee: many}); trimExamples("Coffee");');
  assert.equal(run('getEnrolledCounts().Coffee'), 180);
  assert.equal(run('classifier.getClassifierDataset().Coffee.shape[0]'), 180);
  run('deleteAllItems()');
});
