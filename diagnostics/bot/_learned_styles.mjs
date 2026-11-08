// Learned styles store (style-fix): styles/*.json in the shorts-studio repo, committed by
// learn-style.yml. The bot reads them straight from GitHub, so learned styles survive lambda
// restarts and are identical everywhere. Stdlib only, cached 60 s.
const REPO = (process.env.STUDIO_REPO || 'ColdLevi/shorts-studio').replace(/^.*github\.com\//, '');
const TTL = 60000;
const CACHE = globalThis.__learnedStyles || (globalThis.__learnedStyles = { at: 0, index: {} });

async function rawJSON(path) {
  const url = `https://raw.githubusercontent.com/${REPO}/main/${path}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'shorts-studio-bot' } });
  if (!r.ok) throw new Error(`gh ${r.status} for ${path}`);
  return r.json();
}

async function index() {
  if (Date.now() - CACHE.at < TTL && Object.keys(CACHE.index).length) return CACHE.index;
  try {
    const j = await rawJSON('styles/index.json');
    CACHE.index = j.styles || j;
    CACHE.at = Date.now();
  } catch (e) {
    CACHE.at = Date.now();
  }
  return CACHE.index;
}

export async function learnedList() {
  return index();
}

export async function learnedGet(id) {
  const idx = await index();
  const key = String(id || '').trim().toLowerCase();
  if (!key) return null;
  const hit = Object.keys(idx).find((k) => k.toLowerCase() === key || String(idx[k].name || '').toLowerCase() === key);
  if (!hit) return null;
  try {
    return await rawJSON(`styles/${hit}.json`);
  } catch {
    return idx[hit];
  }
}

// Which learned style does this text name? Longest match wins ('fastedit2' beats 'fastedit').
export function learnedMatch(text, idx) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  const cands = [];
  for (const [k, v] of Object.entries(idx || {})) {
    for (const key of new Set([k.toLowerCase(), String(v.name || '').toLowerCase()].filter(Boolean))) {
      if (t.includes(key)) cands.push([key.length, k]);
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b[0] - a[0]);
  return cands[0][1];
}

// Put a learned look into a make-short spec: style_preset (the renderer resolves it) + inline tokens.
export async function applyLearnedToSpec(spec, userText) {
  try {
    const idx = await index();
    const key = learnedMatch(userText, idx) || learnedMatch(spec.style || '', idx)
      || (idx[spec.style_preset] ? spec.style_preset : null);
    if (!key) return spec;
    const st = await learnedGet(key);
    if (!st) return spec;
    spec.style_preset = key;
    spec.style_tokens = { ...(st.style_tokens || {}), ...(spec.style_tokens || {}) };
    const is = (st.image_style || '').trim();
    if (is && !String(spec.style || '').includes(is)) spec.style = is + (spec.style ? '. ' + spec.style : '');
    spec.learned_style = key;
  } catch {}
  return spec;
}
