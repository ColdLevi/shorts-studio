// Shared matching brain (stage 1: visual judge). Fail-open with a hard deadline so it can never hang the bot.
const DEADLINE_MS = 15000;
const MODELS = [process.env.GEMINI_VISION_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);
const DEAD = new Set();

async function fetchB64(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('img ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4000000) throw new Error('img too big');
  return buf.toString('base64');
}

const COOL = new Map();
let FOUND = null;
async function modelList(key) {
  if (!FOUND) {
    FOUND = [];
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=' + encodeURIComponent(key), { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const d = await r.json();
        FOUND = (d.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/.test(m.name) && !/(image|tts|thinking|live|audio|embedding)/.test(m.name))
          .map((m) => m.name.replace(/^models\//, ''))
          .sort((x, y) => (/preview|exp/.test(x) - /preview|exp/.test(y)) || y.localeCompare(x));
        console.log('judgeImages models', FOUND.join(','));
      } else { console.log('judgeImages list', r.status); }
    } catch (e) { console.log('judgeImages list', e && e.message); }
  }
  const PREF = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const okm = PREF.filter((m) => FOUND.includes(m));
  const extra = FOUND.filter((m) => !/omni|preview/.test(m)).slice(0, 2);
  return [...new Set([process.env.GEMINI_VISION_MODEL, ...okm, ...extra].filter(Boolean))].filter((m) => !DEAD.has(m) && !(COOL.get(m) > Date.now())).slice(0, 3);
}

async function judgeInner(request, cands) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !cands || !cands.length) return null;
  const list = cands.slice(0, 4);
  const got = await Promise.allSettled(list.map((c) => fetchB64(c.url)));
  const imgs = [], idx = [];
  got.forEach((g, i) => { if (g.status === 'fulfilled') { imgs.push(g.value); idx.push(i); } });
  if (!imgs.length) return null;
  const instr = `You check stock photos against a request. Request: "${String(request).slice(0, 400)}"\n` +
    `For each numbered image return a JSON array like [{"i":0,"subject":0,"place":"unknown"}].\n` +
    `subject = 0-10, how well what is VISIBLE matches the scene asked for (ignore style words like cinematic or vibrant). 9-10 = clearly exactly that, 5-6 = loosely related, 0-2 = unrelated (for example a makeup kit when a city was asked for).\n` +
    `place = if the request names a specific place, does the image show it (a visible landmark or sign, or clearly characteristic)? Answer "no" if it clearly shows somewhere else or is unrelated, otherwise "unknown". If no place is named, answer "unknown".\n` +
    `Be strict. Return only the JSON array.`;
  const parts = [{ text: instr }];
  imgs.forEach((b64, n) => { parts.push({ text: `Image ${n}:` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } }); });
  for (const m of await modelList(key)) {
    if (DEAD.has(m)) continue;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { console.log('judgeImages', m, r.status); if (r.status === 404) DEAD.add(m); if (r.status === 429 || r.status === 503) COOL.set(m, Date.now() + 300000); continue; }
      const d = await r.json();
      const raw = d.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      const arr = JSON.parse(raw.replace(/```json|```/g, '').trim());
      const good = (Array.isArray(arr) ? arr : []).filter((x) => Number(x.subject) >= 7 && x.place !== 'no' && idx[Number(x.i)] !== undefined)
        .sort((a, b) => Number(b.subject) - Number(a.subject));
      if (!good.length) return { ok: false };
      return { ok: true, index: idx[Number(good[0].i)], subject: Number(good[0].subject), place: good[0].place || 'unknown' };
    } catch (e) { console.log('judgeImages', m, e && e.message); }
  }
  return null;
}

// request: what the person asked for. cands: [{ url, tags }]. Returns null when the judge is unavailable or too slow,
// { ok: false } when it looked and nothing matched, or { ok: true, index, subject, place }.
export async function judgeImages(request, cands) {
  let t;
  const deadline = new Promise((res) => { t = setTimeout(() => { console.log('judgeImages deadline'); res(null); }, DEADLINE_MS); });
  try { return await Promise.race([judgeInner(request, cands).catch(() => null), deadline]); }
  finally { clearTimeout(t); }
}
