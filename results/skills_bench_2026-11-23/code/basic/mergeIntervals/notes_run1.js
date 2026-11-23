function mergeIntervals(list) {
  const sorted = list.slice().sort((a, b) => a[0] - b[0]);
  const result = [];

  for (const [start, end] of sorted) {
    if (result.length > 0) {
      const last = result[result.length - 1];
      if (start <= last[1]) {
        last[1] = Math.max(last[1], end);
        continue;
      }
    }
    result.push([start, end]);
  }

  return result;
}
