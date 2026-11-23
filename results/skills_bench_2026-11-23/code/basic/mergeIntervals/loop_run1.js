function mergeIntervals(list) {
  const intervals = list.map(([start, end]) => [start, end]);
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged = [];
  for (const [start, end] of intervals) {
    if (merged.length === 0) {
      merged.push([start, end]);
      continue;
    }
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}
