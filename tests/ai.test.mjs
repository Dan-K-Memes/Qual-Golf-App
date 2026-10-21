import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParseRequest, applyParseResult, normalizeClub, normalizeShot, normalizeCourse, parseNotesText,
  callAnthropic, parseRound, parseScorecard, extractToolInput, buildCourseRequest,
} from '../js/ai.js';
import { load, save, exportJSON, importJSON, emptyState } from '../js/store.js';
import { makeRound } from './helpers.mjs';

const okFetch = (payload, status = 200) => {
  const f = async (url, opts) => {
    f.last = { url, opts, body: JSON.parse(opts.body) };
    return { ok: status < 400, status, json: async () => payload };
  };
  return f;
};

const toolResp = (name, input) => ({ content: [{ type: 'tool_use', name, input }] });

test('normalizeClub handles spoken variants', () => {
  assert.equal(normalizeClub('7 iron'), '7i');
  assert.equal(normalizeClub('7-iron'), '7i');
  assert.equal(normalizeClub('7i'), '7i');
  assert.equal(normalizeClub('driver'), 'Driver');
  assert.equal(normalizeClub('3 wood'), '3W');
  assert.equal(normalizeClub('pitching wedge'), 'PW');
  assert.equal(normalizeClub(null), null);
});

test('normalizeShot clamps unknown enums and keeps putts in feet', () => {
  const s = normalizeShot({ club: 'putter', lie: 'green', dist: '20', unit: 'yd', resultLie: 'banana', tags: ['Big Hook'], penalty: '1' });
  assert.equal(s.unit, 'ft');
  assert.equal(s.dist, 20);
  assert.equal(s.resultLie, 'unknown');
  assert.deepEqual(s.tags, ['big_hook']);
  assert.equal(s.penalty, 1);
  assert.equal(s.club, 'Putter');
});

test('buildParseRequest includes course, notes and forces the tool', () => {
  const round = makeRound();
  round.notes = [
    { id: 'n1', ts: 1_700_000_000_000, hole: 1, kind: 'pre', text: 'drive went right in the rough, 190 in, 7 iron, flyer' },
    { id: 'n2', ts: 1_700_000_100_000, hole: 1, kind: 'recap', text: 'bogey 5' },
  ];
  round.holes[2] = { hole: 2, edited: true, shots: [], score: 4 };
  const req = buildParseRequest(round, 'claude-sonnet-5-5');
  assert.equal(req.tool_choice.name, 'record_round');
  assert.equal(req.model, 'claude-sonnet-5-5');
  const text = req.messages[0].content;
  assert.match(text, /Hole 1: par 4, 390 yds, SI 1/);
  assert.match(text, /\[n1\] \(hole hint 1, pre,/);
  assert.match(text, /190 in/);
  assert.match(text, /LOCKED holes \(do not output\): 2/);
});

test('applyParseResult fills holes, skips locked holes and marks notes', () => {
  const round = makeRound();
  round.notes = [{ id: 'n1', hole: 1, kind: 'pre', text: 'x' }, { id: 'n2', hole: 2, kind: 'pre', text: 'y' }];
  round.holes[2] = { hole: 2, edited: true, score: 3, shots: [] };
  const touched = applyParseResult(round, {
    holes: [
      { hole: 1, score: 5, summary: 'bogey', shots: [{ club: '7 iron', lie: 'rough', dist: 185, unit: 'yd', resultLie: 'green', miss: 'none', penalty: 0, tags: ['flyer'], noteIds: ['n1'] }] },
      { hole: 2, score: 9, shots: [] },
      { hole: 99, score: 4, shots: [] },
    ],
  });
  assert.deepEqual(touched, [1]);
  assert.equal(round.holes[1].score, 5);
  assert.equal(round.holes[1].shots[0].club, '7i');
  assert.equal(round.holes[2].score, 3, 'locked hole untouched');
  assert.equal(round.notes[0].parsedHole, 1);
  assert.ok(round.notes.every((n) => n.parsed));
});

test('callAnthropic sends browser-safe headers and surfaces API errors', async () => {
  const f = okFetch({ content: [] });
  await callAnthropic('sk-test', { a: 1 }, f);
  assert.equal(f.last.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.last.opts.headers['x-api-key'], 'sk-test');
  assert.equal(f.last.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
  await assert.rejects(() => callAnthropic('', {}, f), /API key/);
  await assert.rejects(() => callAnthropic('k', {}, okFetch({ error: { message: 'bad key' } }, 401)), /bad key/);
  await assert.rejects(() => callAnthropic('k', {}, async () => { throw new TypeError('offline'); }), /No connection/);
});

test('parseRound end to end with mocked model response', async () => {
  const round = makeRound();
  round.notes = [{ id: 'n1', hole: 1, kind: 'pre', text: 'hole 1 drive right in the rough' }];
  const f = okFetch(toolResp('record_round', { holes: [{ hole: 1, score: 5, shots: [{ club: 'Driver', lie: 'tee', dist: null, unit: 'yd', resultLie: 'rough', miss: 'right', penalty: 0, tags: [] }] }] }));
  const touched = await parseRound(round, { apiKey: 'k', model: 'claude-haiku-5-5' }, f);
  assert.deepEqual(touched, [1]);
  assert.equal(f.last.body.model, 'claude-haiku-5-5');
  assert.throws(() => extractToolInput({ content: [{ type: 'text', text: 'hi' }] }, 'record_round'), /structured/);
});

test('scorecard photo parsing pads to 18 holes and keeps missing values null', async () => {
  const f = okFetch(toolResp('record_course', {
    name: 'Hendon Golf Club',
    tees: [{ name: 'White', slope: 128, rating: 69.1, holes: [{ hole: 1, par: 4, si: 7, yards: 380 }, { hole: 2, par: 3, si: null, yards: 150 }] }],
  }));
  const course = await parseScorecard([{ base64: 'BASE64', mediaType: 'image/jpeg' }, { base64: 'PART2', mediaType: 'image/jpeg' }], { apiKey: 'k', model: 'm' }, f);
  assert.equal(course.name, 'Hendon Golf Club');
  assert.equal(course.tees[0].holes.length, 18);
  assert.equal(course.tees[0].holes[1].si, null);
  assert.equal(course.tees[0].holes[0].yards, 380);
  assert.equal(f.last.body.messages[0].content[0].source.data, 'BASE64');
  assert.equal(f.last.body.messages[0].content[1].source.data, 'PART2');
  assert.match(f.last.body.messages[0].content[2].text, /2 images are screenshots or slices/);
  const single = buildCourseRequest([{ base64: 'x', mediaType: 'image/png' }], 'm');
  assert.equal(single.tool_choice.name, 'record_course');
  assert.doesNotMatch(single.messages[0].content[1].text, /slices/);
  assert.equal(normalizeCourse({}).tees.length, 0);
});

test('parseNotesText reads timestamped and plain lines', () => {
  const notes = parseNotesText('2026-10-21 10:05|hole 1 drive right in the rough\n\nrecap bogey 5\n2026-10-21 10:20|hole 2 8 iron');
  assert.equal(notes.length, 3);
  assert.equal(notes[0].ts, Date.parse('2026-10-21 10:05'));
  assert.equal(notes[0].text, 'hole 1 drive right in the rough');
  assert.equal(notes[1].kind, 'recap');
  assert.equal(notes[2].kind, 'pre');
});

test('store round trips and backup strips the API key', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const st = emptyState();
  st.settings.apiKey = 'secret';
  st.rounds.push({ id: 'r1' });
  assert.ok(save(st, storage));
  assert.equal(load(storage).rounds.length, 1);
  const out = exportJSON(st);
  assert.ok(!out.includes('secret'));
  const cur = emptyState();
  cur.settings.apiKey = 'mine';
  assert.equal(importJSON(out, cur).settings.apiKey, 'mine');
  assert.throws(() => importJSON('{"x":1}', cur), /backup/);
  assert.equal(load({ getItem: () => { throw new Error('blocked'); } }).rounds.length, 0);
});
