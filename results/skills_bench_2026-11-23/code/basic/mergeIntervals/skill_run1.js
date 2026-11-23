function mergeIntervals(list) {
  const sorted = list.slice().sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const [start, end] of sorted) {
    if (result.length && start <= result[result.length - 1][1]) {
      const last = result[result.length - 1];
      last[1] = Math.max(last[1], end);
    } else {
      result.push([start, end]);
    }
  }
  return result;
}
