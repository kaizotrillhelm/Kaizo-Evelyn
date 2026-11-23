function wordFreq(text) {
  const counts = Object.create(null);
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  for (const w of words) {
    counts[w] = (counts[w] || 0) + 1;
  }
  return counts;
}
