function wordFreq(text) {
  const counts = {};
  const matches = String(text).match(/[A-Za-z']+/g) || [];
  for (const word of matches) {
    const key = word.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
