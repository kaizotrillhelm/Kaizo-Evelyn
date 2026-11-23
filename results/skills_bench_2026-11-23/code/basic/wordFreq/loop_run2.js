function wordFreq(text) {
  const counts = {};
  const matches = String(text).match(/[\p{L}']+/gu) || [];
  for (const word of matches) {
    const key = word.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
