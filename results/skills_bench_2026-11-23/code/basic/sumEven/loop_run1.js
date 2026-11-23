function sumEven(numbers) {
  if (!Array.isArray(numbers)) return 0;
  return numbers.reduce((sum, n) => (typeof n === "number" && Number.isInteger(n) && n % 2 === 0 ? sum + n : sum), 0);
}
