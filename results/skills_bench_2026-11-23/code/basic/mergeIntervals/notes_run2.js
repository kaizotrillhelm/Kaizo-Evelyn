function mergeIntervals(list) {
  const sorted = list.slice().sort((a, b) => a[0] - b[0]);
  const result = [];

  for (const [start, end] of sorted) {
    if (result.length > 0 && start <= result[result.length - 1][1]) {
      result[result.length - 1][1] = Math.max(result[result.length - 1][1], end);
    } else {
      result.push([start, end]);
    }
  }

  return result;
}
