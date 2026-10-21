// Claude API integration: turns spoken notes into structured shots, and scorecard photos into courses.
// Request building and result handling are pure so they can be tested without a network.

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (best accuracy)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (cheapest)' },
];

export const LIES = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'fringe', 'green', 'unknown'];
export const RESULT_LIES = ['fairway', 'rough', 'sand', 'green', 'fringe', 'holed', 'trees', 'water', 'ob', 'unknown'];
export const MISSES = ['left', 'right', 'short', 'long', 'none', 'unknown'];
export const QUALITY = ['good', 'ok', 'poor', 'unknown'];
export const RISK = ['conservative', 'standard', 'aggressive', 'unknown'];
export const ADJUST = ['down', 'up', 'none', 'unknown'];
export const CLUBS = ['Driver', '3W', '5W', '7W', 'Hybrid', '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'AW', 'SW', 'LW', 'Putter'];

const SHOT_SCHEMA = {
  type: 'object',
  properties: {
    club: { type: ['string', 'null'], description: `One of ${CLUBS.join(', ')}, or null if not stated.` },
    lie: { type: 'string', enum: LIES, description: 'Lie the ball was played FROM. "recovery" = trees/no angle/punch-out situation.' },
    dist: { type: ['number', 'null'], description: 'Distance to the hole when played from here. Yards, or feet for putts (see unit). null if not stated.' },
    unit: { type: 'string', enum: ['yd', 'ft'], description: 'Use ft for putts and anything on the green, otherwise yd.' },
    intent: { type: 'string', description: 'What the player planned, in a few words (e.g. "big cut around tree, take yardage off").' },
    resultLie: { type: 'string', enum: RESULT_LIES, description: 'Where the ball ended up. holed = went in.' },
    miss: { type: 'string', enum: MISSES, description: 'Direction of miss relative to target. none if on target.' },
    quality: { type: 'string', enum: QUALITY, description: 'Strike/execution quality if mentioned.' },
    penalty: { type: 'integer', description: 'Penalty strokes incurred by this shot (water/OB = 1). Usually 0.' },
    tags: {
      type: 'array', items: { type: 'string' },
      description: 'Short snake_case tags. Preferred vocabulary: shape (draw, fade, hook, slice, pull, push, straight, cut, flyer, punch, low, high), strike (chunk, thin, top, shank, pure), situation (tree_obstacle, from_trees, wind_into, wind_down, crosswind, uphill, downhill, sidehill, layup, recovery, forced_carry, short_sided, tucked_pin, plugged), decision (club_down, club_up, play_safe, go_for_it). Add others only if clearly needed.',
    },
    risk: { type: 'string', enum: RISK, description: 'How aggressive the decision was.' },
    clubAdjust: { type: 'string', enum: ADJUST, description: 'Whether the club was chosen to play shorter (down) or longer (up) than the raw yardage suggests, e.g. flyer or trouble.' },
    inferred: { type: 'boolean', description: 'true if this shot was not spoken about directly and you inferred it (e.g. from "2 putts").' },
    noteIds: { type: 'array', items: { type: 'string' }, description: 'Ids of the notes this shot came from.' },
  },
  required: ['club', 'lie', 'dist', 'unit', 'resultLie', 'miss', 'penalty', 'tags'],
};

export const ROUND_TOOL = {
  name: 'record_round',
  description: 'Record the structured holes and shots extracted from the player\'s spoken notes.',
  input_schema: {
    type: 'object',
    properties: {
      holes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hole: { type: 'integer' },
            score: { type: ['integer', 'null'], description: 'Final gross score for the hole if the recap states or implies it, else null.' },
            summary: { type: 'string', description: 'One line summary of the hole.' },
            shots: { type: 'array', items: SHOT_SCHEMA },
          },
          required: ['hole', 'score', 'shots'],
        },
      },
    },
    required: ['holes'],
  },
};

export const COURSE_TOOL = {
  name: 'record_course',
  description: 'Record the course and tee data read from a scorecard photo.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      tees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tee name or colour, e.g. White, Yellow, Blue.' },
            slope: { type: ['number', 'null'] },
            rating: { type: ['number', 'null'], description: 'Course rating.' },
            holes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hole: { type: 'integer' },
                  par: { type: 'integer' },
                  si: { type: ['integer', 'null'], description: 'Stroke index / handicap rank 1-18.' },
                  yards: { type: ['integer', 'null'], description: 'Length in yards for this tee.' },
                },
                required: ['hole', 'par', 'si', 'yards'],
              },
            },
          },
          required: ['name', 'holes'],
        },
      },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Anything unreadable or uncertain.' },
    },
    required: ['name', 'tees'],
  },
};

// ---------- Round parsing ----------

const ROUND_SYSTEM = `You convert a golfer's spoken notes (transcribed by phone dictation, so expect mishearings like "sevn iron" or "bogie") into structured shot data for strokes-gained analysis.

Rules:
- Each note has an id, an optional hole hint from the app, a kind (pre = about the shot(s) about to be played, recap = end-of-hole summary, fix = a correction that overrides earlier notes) and the transcript.
- Use the hole hint unless the speech clearly names a different hole. Notes without a hint: infer the hole from what is said and from sequence; a recap normally ends a hole.
- Output one entry per hole that has notes. A hole's shots must be in playing order and must add up: number of shots + sum of penalty strokes = the hole score.
- A "pre" note usually describes the next shot's club, distance, lie and plan. The recap usually describes results and the remaining shots (approach result, chips, putts). Merge them into one coherent sequence.
- "190 in" or "I've got 190" = distance to the hole in yards for that shot. For the tee shot, if no distance is spoken leave dist null (the app fills it in from the scorecard).
- Putts: club "Putter", lie "green", unit "ft", dist in feet. "2 putts" with no distances means two putts with unknown dist; mark them inferred=true. If the first putt distance is given ("20 feet and 2 putt") use it for the first putt and leave the second dist null unless it can be reasonably inferred as short (a tap-in) - never invent precise numbers.
- Do not invent shots, clubs, distances or outcomes that are not stated or strongly implied. Use null / "unknown" when unsure. Mark any shot you had to infer with inferred=true.
- A recap score such as "bogey 5" means score 5. Words like par/bogey/birdie are relative to the hole par given in the course info. If both a name and a number are given and they disagree, trust the number.
- resultLie is where the ball finished after the shot, miss is the direction relative to the target ("missed right in the rough" => resultLie rough, miss right).
- Capture the golfer's decision-making: intent, risk (conservative/standard/aggressive), clubAdjust (down = took less club / played a shorter number than the yardage, up = more), and tags such as flyer, hook, cut, tree_obstacle.
- Penalty strokes (water, OB, unplayable) go on the shot that caused them; the next shot starts from where the ball was dropped.
- Holes marked LOCKED in the input were manually corrected by the player: do not output them.
- Always call the record_round tool.`;

export function teeHoleLine(th) {
  return `Hole ${th.hole}: par ${th.par}, ${th.yards ?? '?'} yds, SI ${th.si ?? '?'}`;
}

export function formatNotes(notes) {
  return notes
    .map((n) => {
      const t = n.ts ? new Date(n.ts).toISOString().slice(11, 16) : '';
      const hint = n.hole ? `hole hint ${n.hole}` : 'no hole hint';
      return `[${n.id}] (${hint}, ${n.kind}, ${t}Z) ${n.text}`;
    })
    .join('\n');
}

export function buildParseRequest(round, model) {
  const locked = Object.values(round.holes).filter((h) => h.edited).map((h) => h.hole);
  const notes = round.notes.filter((n) => !locked.includes(n.hole) || !n.hole);
  const course = round.tee.holes.map(teeHoleLine).join('\n');
  const user = [
    `Course: ${round.courseName}, ${round.tee.name} tees.`,
    course,
    locked.length ? `LOCKED holes (do not output): ${locked.join(', ')}` : '',
    '',
    'Notes in the order they were spoken:',
    formatNotes(notes),
  ].filter((l) => l !== '').join('\n');
  return {
    model,
    max_tokens: 16000,
    system: ROUND_SYSTEM,
    tools: [ROUND_TOOL],
    tool_choice: { type: 'tool', name: 'record_round' },
    messages: [{ role: 'user', content: user }],
  };
}

let idCounter = 0;
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

export function normalizeClub(c) {
  if (c == null) return null;
  const s = String(c).trim();
  const hit = CLUBS.find((x) => x.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  const m = s.match(/^(\d)\s*(?:-)?\s*(iron|i)$/i);
  if (m) return `${m[1]}i`;
  const w = s.match(/^(\d)\s*(?:-)?\s*(wood|w)$/i);
  if (w) return `${w[1]}W`;
  if (/driver/i.test(s)) return 'Driver';
  if (/putt/i.test(s)) return 'Putter';
  if (/pitching/i.test(s)) return 'PW';
  if (/sand|56/i.test(s)) return 'SW';
  if (/lob|60/i.test(s)) return 'LW';
  if (/gap|approach wedge|52/i.test(s)) return 'GW';
  if (/hybrid|rescue/i.test(s)) return 'Hybrid';
  return s;
}

export function normalizeShot(s) {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const club = normalizeClub(s.club);
  const lie = pick(s.lie, LIES, 'unknown');
  const unit = s.unit === 'ft' || lie === 'green' ? 'ft' : 'yd';
  return {
    id: uid('s'),
    club,
    lie,
    dist: num(s.dist),
    unit,
    intent: s.intent || '',
    resultLie: pick(s.resultLie, RESULT_LIES, 'unknown'),
    miss: pick(s.miss, MISSES, 'unknown'),
    quality: pick(s.quality, QUALITY, 'unknown'),
    penalty: Math.max(0, parseInt(s.penalty, 10) || 0),
    tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t).toLowerCase().trim().replace(/\s+/g, '_')).filter(Boolean) : [],
    risk: pick(s.risk, RISK, 'unknown'),
    clubAdjust: pick(s.clubAdjust, ADJUST, 'unknown'),
    inferred: !!s.inferred,
    noteIds: Array.isArray(s.noteIds) ? s.noteIds : [],
  };
}

export function extractToolInput(response, toolName) {
  const block = (response.content || []).find((b) => b.type === 'tool_use' && b.name === toolName);
  if (!block) throw new Error('The model did not return structured data. Try again.');
  return block.input;
}

// Merge a record_round result into the round. Edited (locked) holes are left alone.
export function applyParseResult(round, input) {
  const touched = [];
  for (const h of input.holes || []) {
    const n = parseInt(h.hole, 10);
    if (!n || !round.tee.holes.some((t) => t.hole === n)) continue;
    const existing = round.holes[n];
    if (existing && existing.edited) continue;
    round.holes[n] = {
      hole: n,
      score: h.score == null ? null : parseInt(h.score, 10),
      summary: h.summary || '',
      shots: (h.shots || []).map(normalizeShot),
      edited: false,
      parsedAt: Date.now(),
    };
    touched.push(n);
  }
  const noteHoles = new Map();
  for (const n of touched) {
    for (const s of round.holes[n].shots) for (const id of s.noteIds) noteHoles.set(id, n);
  }
  round.notes.forEach((note) => {
    if (noteHoles.has(note.id)) note.parsedHole = noteHoles.get(note.id);
    note.parsed = true;
  });
  return touched;
}

// ---------- Course parsing ----------

export function buildCourseRequest(base64, mediaType, model) {
  return {
    model,
    max_tokens: 8000,
    tools: [COURSE_TOOL],
    tool_choice: { type: 'tool', name: 'record_course' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        {
          type: 'text',
          text: 'Read this golf scorecard. Return every tee box with its slope, course rating and, for each of the 18 holes, par, stroke index (handicap rank) and yardage for that tee. Stroke index is usually in a row labelled HCP, Hdcp, SI or Stroke Index; if there are separate men\'s and ladies\' index rows, use the men\'s one. If a value is unreadable use null and add a warning. Do not guess numbers.',
        },
      ],
    }],
  };
}

export function normalizeCourse(input) {
  const tees = (input.tees || []).map((t) => {
    const holes = [];
    for (let n = 1; n <= 18; n++) {
      const h = (t.holes || []).find((x) => parseInt(x.hole, 10) === n) || {};
      holes.push({
        hole: n,
        par: Number.isFinite(parseInt(h.par, 10)) ? parseInt(h.par, 10) : 4,
        si: Number.isFinite(parseInt(h.si, 10)) ? parseInt(h.si, 10) : null,
        yards: Number.isFinite(parseInt(h.yards, 10)) ? parseInt(h.yards, 10) : null,
      });
    }
    return {
      name: t.name || 'Tee',
      slope: t.slope == null ? null : Number(t.slope),
      rating: t.rating == null ? null : Number(t.rating),
      holes,
    };
  });
  return { id: uid('c'), name: input.name || 'New course', tees, warnings: input.warnings || [] };
}

// ---------- Network ----------

export async function callAnthropic(apiKey, body, fetchImpl = globalThis.fetch) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings first.');
  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('No connection. Your notes are saved; try parsing again when you have signal.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `API error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function parseRound(round, settings, fetchImpl) {
  const body = buildParseRequest(round, settings.model);
  const data = await callAnthropic(settings.apiKey, body, fetchImpl);
  return applyParseResult(round, extractToolInput(data, 'record_round'));
}

export async function parseScorecard(base64, mediaType, settings, fetchImpl) {
  const body = buildCourseRequest(base64, mediaType, settings.model);
  const data = await callAnthropic(settings.apiKey, body, fetchImpl);
  return normalizeCourse(extractToolInput(data, 'record_course'));
}

// ---------- Notes import (Shortcut file / paste) ----------

// Each line: "<timestamp>|<text>" or just "<text>".
export function parseNotesText(text, now = Date.now()) {
  const notes = [];
  let i = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^|]{6,40})\|(.+)$/);
    let ts = now + i;
    let body = line;
    if (m && !Number.isNaN(Date.parse(m[1]))) {
      ts = Date.parse(m[1]);
      body = m[2].trim();
    }
    const kind = /^\s*(recap|re-cap|scored|i scored)\b/i.test(body) ? 'recap' : 'pre';
    notes.push({ id: uid('n'), ts, hole: null, kind, text: body, parsed: false });
    i++;
  }
  return notes;
}
