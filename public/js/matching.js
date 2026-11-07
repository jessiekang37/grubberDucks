// Pure matching logic shared by the browser and regression tests.
// Each class contributes the same number of neighbors: recording one item
// more often cannot drown out the other classes as it does with a global vote.
function normalizeEmbedding(values) {
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Invalid embedding");
  return Float32Array.from(values, (value) => value / norm);
}

function rankEmbedding(values, examples, settings) {
  const query = normalizeEmbedding(values);
  const ranked = Object.entries(examples).map(([label, rows]) => {
    const scores = rows.map((row) => {
      let dot = 0;
      for (let i = 0; i < query.length; i++) dot += query[i] * row[i];
      return dot;
    }).sort((a, b) => b - a).slice(0, settings.NEIGHBORS_PER_CLASS);
    return { label, count: rows.length, similarity: scores.reduce((a, b) => a + b, 0) / scores.length };
  }).filter((entry) => Number.isFinite(entry.similarity)).sort((a, b) => b.similarity - a.similarity);
  if (!ranked.length) return null;
  const best = ranked[0];
  const runnerUp = ranked[1];
  const margin = best.similarity - (runnerUp?.similarity || 0);
  // Being close to the empty area is normal for an item that fills part of the
  // view; being close to another ITEM is a real risk, so it needs a bigger gap.
  const vsBackground = runnerUp?.label === settings.BACKGROUND_LABEL || best.label === settings.BACKGROUND_LABEL;
  const requiredMargin = vsBackground ? (settings.MIN_BACKGROUND_MARGIN ?? settings.MIN_CLASS_MARGIN) : settings.MIN_CLASS_MARGIN;
  const unknown = best.similarity < settings.MIN_SIMILARITY;
  // A match score, NOT a calibrated probability of correctness.
  const similarityScore = Math.max(0, Math.min(1, (best.similarity - 0.5) / 0.4));
  const separationScore = Math.max(0, Math.min(1, margin / (requiredMargin * 2)));
  const confidence = 0.7 * similarityScore + 0.3 * separationScore;
  const hasBackground = Boolean(examples[settings.BACKGROUND_LABEL]?.length >= settings.MIN_EXAMPLES);
  return {
    label: unknown ? settings.UNKNOWN_LABEL : best.label,
    nearestLabel: best.label, confidence, similarity: best.similarity, margin,
    alternatives: ranked.slice(0, 3),
    reliable: !unknown && hasBackground && best.count >= settings.MIN_EXAMPLES &&
      margin >= requiredMargin && confidence >= settings.SCAN_CONFIDENCE,
    reason: unknown ? "Unfamiliar view" : !hasBackground ? "Teach the empty area first" :
      best.count < settings.MIN_EXAMPLES ? "Needs more examples" :
      margin < requiredMargin ? `Too close to ${runnerUp.label}` :
      confidence < settings.SCAN_CONFIDENCE ? "Match too weak to count" : "",
  };
}

if (typeof module !== "undefined") module.exports = { normalizeEmbedding, rankEmbedding };
