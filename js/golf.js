// Pure golf logic: handicap, scoring, strokes gained, stats and insights.
// No DOM or network access here so it can be unit tested in Node.
import { expectedStrokes } from './tables.js';

// ---------- Handicap & scoring ----------

export function courseHandicap(index, slope, rating, par) {
  if ([index, slope, rating, par].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  return Math.round(index * (slope / 113) + (rating - par));
}

export function playingHandicap(courseHcp, allowancePct = 100) {
  if (courseHcp == null) return null;
  return Math.round((courseHcp * allowancePct) / 100);
}

// Strokes a player receives on a hole with the given stroke index (1 = hardest).
export function strokesReceived(playingHcp, strokeIndex, holes = 18) {
  if (playingHcp == null || !strokeIndex) return 0;
  if (playingHcp >= 0) {
    const base = Math.floor(playingHcp / holes);
    const extra = playingHcp % holes;
    return base + (strokeIndex <= extra ? 1 : 0);
  }
  const give = -playingHcp;
  return strokeIndex > holes - give ? -1 : 0;
}

export function teePar(tee) {
  return tee.holes.reduce((s, h) => s + (Number(h.par) || 0), 0);
}

export function teeYards(tee) {
  return tee.holes.reduce((s, h) => s + (Number(h.yards) || 0), 0);
}

export function fmtToPar(n) {
  if (n == null || Number.isNaN(n)) return '-';
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

// ---------- Shots ----------

export const isPutt = (shot) => shot.club === 'Putter' || shot.lie === 'green';

export function penaltyTotal(hole) {
  return (hole.shots || []).reduce((s, sh) => s + (Number(sh.penalty) || 0), 0);
}

export function holeStrokeCount(hole) {
  return (hole.shots || []).length + penaltyTotal(hole);
}

function startState(shot, index, teeHole) {
  let lie = shot.lie && shot.lie !== 'unknown' ? shot.lie : null;
  let unit = shot.unit || 'yd';
  let dist = shot.dist;
  if (index === 0) {
    if (!lie) lie = 'tee';
    if ((dist == null || Number.isNaN(dist)) && teeHole && lie === 'tee') {
      dist = teeHole.yards;
      unit = 'yd';
    }
  }
  if (!lie && unit === 'ft') lie = 'green';
  return { lie, dist, unit };
}

export function categoryFor(start, par, index) {
  if (start.lie === 'tee' && index === 0) return par >= 4 ? 'off_the_tee' : 'approach';
  if (start.lie === 'green' || start.unit === 'ft') return 'putting';
  const yd = start.unit === 'ft' ? start.dist / 3 : start.dist;
  return yd != null && yd <= 30 ? 'around_green' : 'approach';
}

// Returns a copy of the hole's shots enriched with start state, category and strokes gained.
export function shotsWithSG(hole, teeHole, handicapIndex = null) {
  const shots = hole.shots || [];
  const par = teeHole ? teeHole.par : 4;
  return shots.map((shot, i) => {
    const start = startState(shot, i, teeHole);
    const eStart = start.lie ? expectedStrokes(start.lie, start.dist, start.unit, handicapIndex) : null;
    let eEnd;
    if (i < shots.length - 1) {
      const next = startState(shots[i + 1], i + 1, teeHole);
      eEnd = next.lie ? expectedStrokes(next.lie, next.dist, next.unit, handicapIndex) : null;
    } else {
      const holed = shot.resultLie === 'holed' || hole.score != null;
      eEnd = holed ? 0 : null;
    }
    const sg = eStart == null || eEnd == null ? null : eStart - eEnd - 1 - (Number(shot.penalty) || 0);
    return { ...shot, start, eStart, eEnd, sg, category: categoryFor(start, par, i) };
  });
}

export const SG_CATEGORIES = ['off_the_tee', 'approach', 'around_green', 'putting'];
export const SG_LABELS = {
  off_the_tee: 'Off the tee',
  approach: 'Approach',
  around_green: 'Around the green',
  putting: 'Putting',
};

// ---------- Hole analysis ----------

export function analyzeHole(hole, teeHole) {
  const issues = [];
  const shots = hole.shots || [];
  if (!shots.length && hole.score == null) {
    issues.push({ type: 'empty', msg: 'No data for this hole yet' });
    return issues;
  }
  if (hole.score == null) issues.push({ type: 'no_score', msg: 'No score recorded (say your hole recap)' });
  const count = holeStrokeCount(hole);
  if (hole.score != null && count !== hole.score) {
    issues.push({
      type: 'count_mismatch',
      msg: `Recap says ${hole.score} but ${count} stroke${count === 1 ? '' : 's'} were found`,
    });
  }
  shots.forEach((s, i) => {
    const start = startState(s, i, teeHole);
    if (!start.lie) issues.push({ type: 'missing_lie', shot: i, msg: `Shot ${i + 1}: lie unknown` });
    if (start.dist == null) issues.push({ type: 'missing_dist', shot: i, msg: `Shot ${i + 1}: distance unknown` });
  });
  return issues;
}

export function holeStats(hole, teeHole) {
  const shots = hole.shots || [];
  const par = teeHole ? teeHole.par : null;
  const score = hole.score != null ? hole.score : shots.length ? holeStrokeCount(hole) : null;
  const putts = shots.filter(isPutt).length;
  let fir = null;
  if (par >= 4 && shots[0]) {
    const r = shots[0].resultLie;
    fir = r && r !== 'unknown' ? r === 'fairway' : null;
  }
  let gir = null;
  let scramble = null;
  if (par && shots.length) {
    const firstGreen = shots.findIndex((s) => s.lie === 'green' || (s.club === 'Putter' && s.lie !== 'fringe'));
    if (firstGreen >= 0) {
      const strokesToGreen = firstGreen + shots.slice(0, firstGreen).reduce((s, x) => s + (Number(x.penalty) || 0), 0);
      gir = strokesToGreen <= par - 2;
      if (!gir && score != null) scramble = score <= par;
    }
  }
  return { score, putts: shots.length ? putts : null, fir, gir, scramble };
}

// ---------- Round summary ----------

export function roundSummary(round) {
  const tee = round.tee;
  const rows = [];
  let gross = 0, net = 0, par = 0, played = 0;
  const sg = Object.fromEntries(SG_CATEGORIES.map((c) => [c, 0]));
  let sgCount = 0;
  const idx = round.baselineIndex ?? null;
  for (const th of tee.holes) {
    const hole = round.holes[th.hole] || { shots: [] };
    const st = holeStats(hole, th);
    const received = strokesReceived(round.playingHandicap, th.si, tee.holes.length);
    const shots = shotsWithSG(hole, th, idx);
    shots.forEach((s) => {
      if (s.sg != null) {
        sg[s.category] += s.sg;
        sgCount++;
      }
    });
    const netScore = st.score != null ? st.score - received : null;
    if (st.score != null) {
      gross += st.score;
      net += netScore;
      par += th.par;
      played++;
    }
    rows.push({
      hole: th.hole, par: th.par, si: th.si, yards: th.yards, received,
      gross: st.score, net: netScore, toPar: st.score != null ? st.score - th.par : null,
      stats: st, issues: analyzeHole(hole, th), edited: !!hole.edited,
    });
  }
  return {
    rows, gross, net, par, played, toPar: gross - par, netToPar: net - par,
    sg, sgTotal: Object.values(sg).reduce((a, b) => a + b, 0), sgShots: sgCount,
  };
}

// ---------- Aggregate stats ----------

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function aggregateStats(rounds) {
  const out = {
    rounds: 0, holes: 0, avgToPar: null, avgGross: null, fir: null, gir: null, puttsPerHole: null,
    scramble: null, penaltiesPerRound: null, sgPerRound: Object.fromEntries(SG_CATEGORIES.map((c) => [c, null])),
    byPar: {}, trend: [],
  };
  const firs = [], girs = [], scrambles = [], putts = [];
  const sgRounds = Object.fromEntries(SG_CATEGORIES.map((c) => [c, []]));
  const byPar = { 3: [], 4: [], 5: [] };
  let penalties = 0, counted = 0;
  const toPars = [], grosses = [];
  for (const round of rounds) {
    const sum = roundSummary(round);
    if (!sum.played) continue;
    counted++;
    if (sum.played === round.tee.holes.length) {
      toPars.push(sum.toPar);
      grosses.push(sum.gross);
    }
    out.trend.push({
      date: round.date, course: round.courseName, gross: sum.gross, toPar: sum.toPar,
      net: sum.net, played: sum.played, sg: sum.sgTotal,
    });
    for (const row of sum.rows) {
      if (row.gross == null) continue;
      out.holes++;
      if (byPar[row.par]) byPar[row.par].push(row.toPar);
      if (row.stats.fir != null) firs.push(row.stats.fir ? 1 : 0);
      if (row.stats.gir != null) girs.push(row.stats.gir ? 1 : 0);
      if (row.stats.scramble != null) scrambles.push(row.stats.scramble ? 1 : 0);
      if (row.stats.putts != null && row.stats.putts > 0) putts.push(row.stats.putts);
      penalties += penaltyTotal(round.holes[row.hole] || {});
    }
    if (sum.sgShots) for (const c of SG_CATEGORIES) sgRounds[c].push(sum.sg[c]);
  }
  out.rounds = counted;
  out.avgToPar = mean(toPars);
  out.avgGross = mean(grosses);
  out.fir = mean(firs);
  out.gir = mean(girs);
  out.scramble = mean(scrambles);
  out.puttsPerHole = mean(putts);
  out.penaltiesPerRound = counted ? penalties / counted : null;
  for (const c of SG_CATEGORIES) out.sgPerRound[c] = mean(sgRounds[c]);
  for (const p of [3, 4, 5]) out.byPar[p] = mean(byPar[p]);
  return out;
}

// ---------- Insights ----------

export const MIN_SAMPLE = 3;

function collectShots(rounds) {
  const all = [];
  for (const round of rounds) {
    for (const th of round.tee.holes) {
      const hole = round.holes[th.hole];
      if (!hole) continue;
      shotsWithSG(hole, th, round.baselineIndex ?? null).forEach((s) => {
        all.push({ ...s, round: round.id, hole: th.hole, par: th.par });
      });
    }
  }
  return all;
}

function groupStats(shots) {
  const withSG = shots.filter((s) => s.sg != null);
  const total = withSG.reduce((a, s) => a + s.sg, 0);
  return { n: shots.length, nSG: withSG.length, total, avg: withSG.length ? total / withSG.length : null };
}

export function buildInsights(rounds) {
  const shots = collectShots(rounds);
  const groups = new Map();
  const add = (key, label, kind, shot) => {
    if (!groups.has(key)) groups.set(key, { key, label, kind, shots: [] });
    groups.get(key).shots.push(shot);
  };
  for (const s of shots) {
    const tags = [...new Set((s.tags || []).map((t) => t.toLowerCase()))];
    tags.forEach((t) => add(`tag:${t}`, `Shots tagged "${t.replace(/_/g, ' ')}"`, 'tag', s));
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const [a, b] = [tags[i], tags[j]].sort();
        add(`pair:${a}+${b}`, `"${a.replace(/_/g, ' ')}" + "${b.replace(/_/g, ' ')}"`, 'pair', s);
      }
    }
    if (s.risk && s.risk !== 'unknown') add(`risk:${s.risk}`, `${s.risk[0].toUpperCase()}${s.risk.slice(1)} decisions`, 'risk', s);
    if (s.clubAdjust && s.clubAdjust !== 'unknown' && s.clubAdjust !== 'none') {
      add(`adj:${s.clubAdjust}`, `Clubbing ${s.clubAdjust}`, 'adjust', s);
    }
    if (s.miss && !['none', 'unknown'].includes(s.miss)) add(`miss:${s.miss}`, `Misses ${s.miss}`, 'miss', s);
  }
  const insights = [];
  for (const g of groups.values()) {
    const st = groupStats(g.shots);
    if (st.nSG < MIN_SAMPLE) continue;
    insights.push({ ...g, shots: undefined, ...st });
  }
  insights.sort((a, b) => a.total - b.total);
  return {
    leaks: insights.filter((i) => i.avg <= -0.1).slice(0, 8),
    strengths: insights.filter((i) => i.avg >= 0.1).sort((a, b) => b.total - a.total).slice(0, 8),
    all: insights,
    shotCount: shots.length,
  };
}

export function insightSentence(i) {
  const per = `${i.avg >= 0 ? '+' : ''}${i.avg.toFixed(2)}`;
  const tot = `${i.total >= 0 ? '+' : ''}${i.total.toFixed(1)}`;
  return `${i.label}: ${i.nSG} shots, ${per} strokes each (${tot} total)`;
}

export function clubStats(rounds) {
  const shots = collectShots(rounds).filter((s) => s.club && !isPutt(s));
  const byClub = new Map();
  for (const s of shots) {
    if (!byClub.has(s.club)) byClub.set(s.club, []);
    byClub.get(s.club).push(s);
  }
  const order = ['Driver', '3W', '5W', '7W', 'Hybrid', '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'AW', 'SW', 'LW'];
  const rows = [];
  for (const [club, list] of byClub) {
    const dists = list.map((s) => (s.start.unit === 'ft' ? s.start.dist / 3 : s.start.dist)).filter((d) => d != null);
    const st = groupStats(list);
    const targeted = list.filter((s) => s.resultLie && s.resultLie !== 'unknown');
    const misses = { left: 0, right: 0, short: 0, long: 0 };
    list.forEach((s) => { if (misses[s.miss] != null) misses[s.miss]++; });
    rows.push({
      club, n: list.length, avgDist: mean(dists), avgSG: st.avg,
      greenRate: targeted.length ? targeted.filter((s) => s.resultLie === 'green').length / targeted.length : null,
      misses,
    });
  }
  rows.sort((a, b) => (order.indexOf(a.club) + 1 || 99) - (order.indexOf(b.club) + 1 || 99));
  return rows;
}
