export function expected(a: number, b: number) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}
export function updateElo(a: number, b: number, scoreA: 0|0.5|1, k=20) {
  const ea = expected(a,b);
  const eb = expected(b,a);
  const newA = a + k * (scoreA - ea);
  const newB = b + k * ((1 - scoreA) - eb);
  return [newA, newB];
}
