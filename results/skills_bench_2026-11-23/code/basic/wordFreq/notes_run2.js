function wordFreq(text) {
  const counts = {};
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  for (const w of words) {
    if (!Object.prototype.hasOwnProperty.call(counts, w)) counts[w] = 0;
    counts[w] += 1;
  }
  return counts;
}
