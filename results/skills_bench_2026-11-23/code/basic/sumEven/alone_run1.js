function sumEven(numbers) {
  if (!Array.isArray(numbers)) return 0;
  let total = 0;
  for (const n of numbers) {
    if (typeof n === "number" && Number.isInteger(n) && n % 2 === 0) {
      total += n;
    }
  }
  return total;
}
