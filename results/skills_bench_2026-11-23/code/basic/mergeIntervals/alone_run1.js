function mergeIntervals(list) {
  const sorted = list
    .map(interval => [interval[0], interval[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged = [];

  for (const [start, end] of sorted) {
    if (merged.length === 0 || start > merged[merged.length - 1][1]) {
      merged.push([start, end]);
    } else {
      const last = merged[merged.length - 1];
      if (end > last[1]) last[1] = end;
    }
  }

  return merged;
}
