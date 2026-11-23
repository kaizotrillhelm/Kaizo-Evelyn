function wordFreq(text) {
  const counts = new Map();
  if (typeof text !== 'string') return {};
  const matches = text.match(/[\p{L}'’]+/gu);
  if (matches) {
    for (const match of matches) {
      const word = match.toLowerCase();
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  const result = {};
  for (const [word, n] of counts) {
    Object.defineProperty(result, word, {
      value: n,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return result;
}
