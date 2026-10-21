// Local-only persistence. Everything lives in this browser's localStorage; use Export as a backup.
const KEY = 'qgolf.v1';

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-sonnet-5-5',
  index: null,
  allowance: 100,
  baseline: 'hcp', // 'hcp' = scaled to handicap index, 'pro' = PGA Tour style
  autoParse: true, // parse in the background after each hole recap
};

export function emptyState() {
  return { settings: { ...DEFAULT_SETTINGS }, courses: [], rounds: [], activeRoundId: null, inbox: [] };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    const base = emptyState();
    return {
      ...base, ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
  } catch (e) {
    return emptyState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

export function exportJSON(state) {
  const copy = { ...state, settings: { ...state.settings, apiKey: '' } };
  return JSON.stringify(copy, null, 2);
}

export function importJSON(text, current) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rounds)) {
    throw new Error('That file does not look like a backup from this app.');
  }
  const base = emptyState();
  return {
    ...base, ...parsed,
    settings: { ...base.settings, ...(parsed.settings || {}), apiKey: current.settings.apiKey },
  };
}
