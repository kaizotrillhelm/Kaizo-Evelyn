function sumEven(numbers) {
  return numbers.reduce((total, x) => (x % 2 === 0 ? total + x : total), 0);
}
