function sumEven(numbers) {
  return numbers.reduce((sum, n) => sum + (n % 2 === 0 ? n : 0), 0);
}
