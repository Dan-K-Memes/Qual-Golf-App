export function makeTee() {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return {
    name: 'White', slope: 128, rating: 69.1,
    holes: pars.map((par, i) => ({ hole: i + 1, par, si: ((i * 7) % 18) + 1, yards: par === 3 ? 160 : par === 4 ? 390 : 510 })),
  };
}
export function makeRound(overrides = {}) {
  const tee = makeTee();
  return {
    id: 'r1', courseName: 'Hendon', date: '2026-10-21', tee, notes: [], holes: {},
    playingHandicap: 6, baselineIndex: 5.1, ...overrides,
  };
}
