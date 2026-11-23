function wordFreq(text) {
  const counts = {};
  const matches = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  for (const word of matches) {
    counts[word] = (counts[word] || 0) + 1;
  }
  return counts;
}
