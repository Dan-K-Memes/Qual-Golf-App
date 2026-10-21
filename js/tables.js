// Approximate expected-strokes tables (PGA Tour style, in the spirit of Broadie's
// "Every Shot Counts"). These are public-domain approximations, NOT the original
// proprietary data, so treat strokes gained as directional, not exact.
// Distances are yards, except `green` which is feet.

export const TABLES = {
  tee: [
    [100, 2.92], [120, 2.99], [140, 3.05], [160, 3.10], [180, 3.15], [200, 3.19],
    [240, 3.45], [300, 3.71], [350, 3.86], [400, 3.99], [450, 4.17], [500, 4.41],
    [550, 4.62], [600, 4.83],
  ],
  fairway: [
    [5, 2.10], [10, 2.18], [20, 2.40], [30, 2.52], [40, 2.60], [60, 2.70], [80, 2.75],
    [100, 2.80], [120, 2.85], [140, 2.91], [160, 2.98], [180, 3.08], [200, 3.19],
    [220, 3.32], [240, 3.45], [260, 3.58], [300, 3.78], [400, 4.05], [500, 4.50],
    [600, 4.90],
  ],
  rough: [
    [5, 2.25], [10, 2.35], [20, 2.59], [30, 2.70], [40, 2.78], [60, 2.88], [80, 2.95],
    [100, 3.02], [120, 3.08], [140, 3.15], [160, 3.23], [180, 3.31], [200, 3.42],
    [220, 3.55], [240, 3.68], [260, 3.80], [300, 4.00], [400, 4.30], [500, 4.70],
    [600, 5.10],
  ],
  sand: [
    [5, 2.35], [10, 2.43], [20, 2.53], [30, 2.66], [40, 2.82], [60, 3.02], [80, 3.12],
    [100, 3.23], [150, 3.45], [200, 3.70], [300, 4.20], [600, 5.40],
  ],
  // feet
  green: [
    [1, 1.00], [2, 1.01], [3, 1.04], [4, 1.13], [5, 1.23], [6, 1.34], [7, 1.42],
    [8, 1.50], [10, 1.61], [12, 1.69], [15, 1.78], [20, 1.87], [25, 1.93], [30, 1.98],
    [40, 2.06], [50, 2.14], [60, 2.21], [75, 2.30], [90, 2.40], [120, 2.55], [150, 2.70],
  ],
};

// Recovery shots (trees, deep rough, no angle) cost roughly 0.4 over rough.
export const RECOVERY_PENALTY = 0.4;

export function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

// Scale pro numbers up for a handicap player. Short game and putting are
// scaled less, since amateurs lose most of their strokes off the tee and on approach.
export function handicapScale(index) {
  if (index == null || Number.isNaN(index)) return 1;
  return Math.max(1, 1 + 0.0135 * (index + 3));
}

export function expectedStrokes(lie, dist, unit = 'yd', index = null) {
  if (dist == null || Number.isNaN(dist)) return null;
  if (dist <= 0) return 0;
  const s = handicapScale(index);
  const onGreen = lie === 'green' || (unit === 'ft' && lie !== 'sand');
  if (onGreen) {
    const ft = unit === 'ft' ? dist : dist * 3;
    return interpolate(TABLES.green, ft) * (1 + (s - 1) * 0.5);
  }
  const yd = unit === 'ft' ? dist / 3 : dist;
  let base;
  switch (lie) {
    case 'tee': base = interpolate(TABLES.tee, yd); break;
    case 'rough': base = interpolate(TABLES.rough, yd); break;
    case 'sand': base = interpolate(TABLES.sand, yd); break;
    case 'recovery': base = interpolate(TABLES.rough, yd) + RECOVERY_PENALTY; break;
    case 'fairway':
    case 'fringe':
    default: base = interpolate(TABLES.fairway, yd);
  }
  return base * s;
}
