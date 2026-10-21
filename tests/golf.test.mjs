import test from 'node:test';
import assert from 'node:assert/strict';
import {
  courseHandicap, playingHandicap, strokesReceived, shotsWithSG, analyzeHole, holeStats,
  roundSummary, buildInsights, aggregateStats, teePar, clubStats,
} from '../js/golf.js';
import { expectedStrokes, interpolate, TABLES } from '../js/tables.js';
import { makeRound, makeTee } from './helpers.mjs';

test('course handicap uses WHS formula', () => {
  // 5.1 * 128/113 + (69.1 - 70) = 5.777 - 0.9 = 4.877 -> 5
  assert.equal(courseHandicap(5.1, 128, 69.1, 70), 5);
  assert.equal(courseHandicap(null, 128, 69.1, 70), null);
  assert.equal(playingHandicap(5, 95), 5);
  assert.equal(playingHandicap(20, 95), 19);
});

test('strokes received follow stroke index', () => {
  assert.equal(strokesReceived(5, 3), 1);
  assert.equal(strokesReceived(5, 6), 0);
  assert.equal(strokesReceived(20, 2), 2);
  assert.equal(strokesReceived(20, 10), 1);
  assert.equal(strokesReceived(0, 1), 0);
  assert.equal(strokesReceived(-2, 18), -1);
  assert.equal(strokesReceived(-2, 17), -1);
  assert.equal(strokesReceived(-2, 16), 0);
});

test('expected strokes interpolate and are monotonic', () => {
  assert.ok(Math.abs(interpolate(TABLES.green, 10) - 1.61) < 1e-9);
  assert.ok(interpolate(TABLES.fairway, 150) > interpolate(TABLES.fairway, 140));
  assert.equal(expectedStrokes('green', 0, 'ft'), 0);
  assert.ok(expectedStrokes('rough', 190, 'yd', 5.1) > expectedStrokes('fairway', 190, 'yd', 5.1));
  assert.ok(expectedStrokes('fairway', 150, 'yd', 18) > expectedStrokes('fairway', 150, 'yd', 0));
  assert.equal(expectedStrokes('fairway', null, 'yd'), null);
});

const shot = (o) => ({ club: null, lie: 'fairway', dist: null, unit: 'yd', resultLie: 'unknown', miss: 'unknown', penalty: 0, tags: [], ...o });

function bogeyHole() {
  // par 4, 390 yds: drive to rough, 7 iron from 185 missing green, chip, 2 putts => wait 5 shots = bogey
  return {
    hole: 1, score: 5, edited: false,
    shots: [
      shot({ club: 'Driver', lie: 'tee', dist: null, resultLie: 'rough', miss: 'right' }),
      shot({ club: '7i', lie: 'rough', dist: 185, resultLie: 'fringe', miss: 'short', tags: ['flyer'] }),
      shot({ club: 'SW', lie: 'fringe', dist: 10, resultLie: 'green' }),
      shot({ club: 'Putter', lie: 'green', dist: 20, unit: 'ft', resultLie: 'green' }),
      shot({ club: 'Putter', lie: 'green', dist: 3, unit: 'ft', resultLie: 'holed' }),
    ],
  };
}

test('strokes gained telescopes to expected - score', () => {
  const round = makeRound();
  const th = round.tee.holes[0];
  const hole = bogeyHole();
  const shots = shotsWithSG(hole, th, 5.1);
  assert.ok(shots.every((s) => s.sg != null));
  const total = shots.reduce((a, s) => a + s.sg, 0);
  const eTee = expectedStrokes('tee', th.yards, 'yd', 5.1);
  assert.ok(Math.abs(total - (eTee - hole.score)) < 1e-9, `${total} vs ${eTee - hole.score}`);
  assert.equal(shots[0].category, 'off_the_tee');
  assert.equal(shots[1].category, 'approach');
  assert.equal(shots[2].category, 'around_green');
  assert.equal(shots[3].category, 'putting');
});

test('penalty strokes are charged to the shot and still telescope', () => {
  const th = makeTee().holes[0];
  const hole = {
    hole: 1, score: 5, shots: [
      shot({ club: 'Driver', lie: 'tee', penalty: 1, resultLie: 'water' }),
      shot({ club: '7i', lie: 'fairway', dist: 150, resultLie: 'green' }),
      shot({ club: 'Putter', lie: 'green', dist: 10, unit: 'ft' }),
      shot({ club: 'Putter', lie: 'green', dist: 2, unit: 'ft' }),
    ],
  };
  assert.deepEqual(analyzeHole(hole, th), []); // 4 shots + 1 penalty = 5
  const shots = shotsWithSG(hole, th, null);
  const total = shots.reduce((a, s) => a + s.sg, 0);
  assert.ok(Math.abs(total - (expectedStrokes('tee', th.yards, 'yd', null) - 5)) < 1e-9);
  assert.ok(shots[0].sg < -0.5); // the penalty makes this shot costly
});

test('analyzeHole flags mismatch and missing data', () => {
  const th = makeTee().holes[0];
  const hole = { hole: 1, score: 5, shots: [shot({ lie: 'tee' }), shot({ lie: 'unknown', dist: null })] };
  const types = analyzeHole(hole, th).map((i) => i.type);
  assert.ok(types.includes('count_mismatch'));
  assert.ok(types.includes('missing_lie'));
  assert.ok(types.includes('missing_dist'));
  assert.deepEqual(analyzeHole({ hole: 1, shots: [] }, th).map((i) => i.type), ['empty']);
});

test('holeStats derives FIR, GIR, putts and scrambling', () => {
  const th = makeTee().holes[0];
  const st = holeStats(bogeyHole(), th);
  assert.equal(st.score, 5);
  assert.equal(st.putts, 2);
  assert.equal(st.fir, false);
  assert.equal(st.gir, false);
  assert.equal(st.scramble, false);
  const parHole = {
    hole: 1, score: 4, shots: [
      shot({ lie: 'tee', resultLie: 'fairway' }), shot({ club: '8i', dist: 150, resultLie: 'green' }),
      shot({ club: 'Putter', lie: 'green', dist: 30, unit: 'ft' }), shot({ club: 'Putter', lie: 'green', dist: 3, unit: 'ft' }),
    ],
  };
  const s2 = holeStats(parHole, th);
  assert.equal(s2.fir, true);
  assert.equal(s2.gir, true);
  assert.equal(s2.scramble, null);
});

test('roundSummary computes gross, net and sg totals', () => {
  const round = makeRound();
  round.holes[1] = bogeyHole();
  const sum = roundSummary(round);
  assert.equal(sum.gross, 5);
  assert.equal(sum.par, 4);
  assert.equal(sum.toPar, 1);
  const received = sum.rows[0].received;
  assert.equal(sum.net, 5 - received);
  assert.ok(Math.abs(sum.sgTotal - (expectedStrokes('tee', 390, 'yd', 5.1) - 5)) < 1e-9);
  assert.equal(teePar(round.tee), 72);
});

test('insights need a minimum sample and rank leaks', () => {
  const round = makeRound();
  const th = round.tee.holes;
  // Three holes where a hooked shot around a tree leads to a poor result
  for (let n = 1; n <= 3; n++) {
    round.holes[n] = {
      hole: n, score: 6, shots: [
        shot({ club: 'Driver', lie: 'tee', resultLie: 'fairway' }),
        shot({ club: '6i', lie: 'fairway', dist: 160, resultLie: 'trees', tags: ['hook', 'tree_obstacle'], risk: 'aggressive' }),
        shot({ club: 'SW', lie: 'recovery', dist: 40, resultLie: 'green', tags: ['recovery'] }),
        shot({ club: 'Putter', lie: 'green', dist: 25, unit: 'ft' }),
        shot({ club: 'Putter', lie: 'green', dist: 5, unit: 'ft' }),
        shot({ club: 'Putter', lie: 'green', dist: 1, unit: 'ft' }),
      ],
    };
  }
  void th;
  const ins = buildInsights([round]);
  const hook = ins.all.find((i) => i.key === 'tag:hook');
  assert.ok(hook, 'hook group present');
  assert.equal(hook.nSG, 3);
  assert.ok(ins.all.find((i) => i.key === 'pair:hook+tree_obstacle'));
  assert.ok(ins.leaks.length > 0);
  // under the sample threshold nothing is reported
  const small = makeRound();
  small.holes[1] = bogeyHole();
  assert.equal(buildInsights([small]).all.find((i) => i.key === 'tag:flyer'), undefined);
  const cs = clubStats([round]);
  assert.ok(cs.find((c) => c.club === 'Driver'));
  assert.ok(!cs.find((c) => c.club === 'Putter'));
});

test('aggregateStats handles partial rounds', () => {
  const round = makeRound();
  round.holes[1] = bogeyHole();
  const agg = aggregateStats([round]);
  assert.equal(agg.rounds, 1);
  assert.equal(agg.holes, 1);
  assert.equal(agg.gir, 0);
  assert.equal(agg.avgToPar, null); // partial round does not count towards average
  assert.equal(agg.puttsPerHole, 2);
});
