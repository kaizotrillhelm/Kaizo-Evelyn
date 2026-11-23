function sumEven(numbers) {
  return numbers.reduce((total, x) => total + (x % 2 === 0 ? x : 0), 0);
}
