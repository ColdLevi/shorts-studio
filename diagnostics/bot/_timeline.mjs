// Shorts Studio timeline helpers for the bot (engine step 2: chat re-edit agent).
// Pure functions, no network: JSON patch with @id paths, a lenient sanitiser for LLM patches, a small
// JSON-Schema validator for timeline.schema.json, scene lists, and "what will be remade" plans.
// Mirrors shorts-studio/tools/timeline.py so the bot's preview matches what the renderer does.
// (The leading underscore keeps Vercel from serving this file as its own endpoint.)

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const normText = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const TRACKS = ['visuals', 'voice', 'music', 'sfx', 'overlays'];
const KINDS = ['image', 'ai_video', 'graphic', 'stock', 'upload', 'color', 'scene'];
export const SCHEMA_ID = 'shorts-studio/timeline@1';

// ---------- JSON patch (RFC 6902 + "merge"), clips addressable by id: /tracks/visuals/@v3/gen/prompt ----------
function tokens(doc, path) {
  if (path === '' || path === '/') return [];
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error(`bad path ${path}`);
  const toks = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  const out = [];
  let cur = doc;
  for (let tok of toks) {
    if (Array.isArray(cur) && tok.startsWith('@')) {
      const i = cur.findIndex((x) => x && typeof x === 'object' && x.id === tok.slice(1));
      if (i < 0) throw new Error(`no clip with id ${tok.slice(1)}`);
      tok = String(i);
    }
    out.push(tok);
    cur = cur == null ? undefined : Array.isArray(cur) ? (tok === '-' ? undefined : cur[+tok]) : typeof cur === 'object' ? cur[tok] : undefined;
  }
  return out;
}
function parent(doc, toks) {
  let cur = doc;
  for (const t of toks.slice(0, -1)) {
    cur = Array.isArray(cur) ? cur[+t] : cur?.[t];
    if (cur == null || typeof cur !== 'object') throw new Error(`path /${toks.join('/')} does not exist`);
  }
  return [cur, toks[toks.length - 1]];
}
function get(doc, toks) {
  let cur = doc;
  for (const t of toks) {
    cur = Array.isArray(cur) ? cur[+t] : cur?.[t];
    if (cur === undefined) throw new Error(`path /${toks.join('/')} does not exist`);
  }
  return cur;
}
function add(doc, toks, val) {
  const [p, k] = parent(doc, toks);
  if (Array.isArray(p)) {
    if (k === '-') p.push(val);
    else { const i = +k; if (!(i >= 0 && i <= p.length)) throw new Error(`index ${k} out of range`); p.splice(i, 0, val); }
  } else p[k] = val;
}
function remove(doc, toks) {
  const [p, k] = parent(doc, toks);
  if (Array.isArray(p)) { const i = +k; if (!(i >= 0 && i < p.length)) throw new Error(`index ${k} out of range`); return p.splice(i, 1)[0]; }
  if (!(k in p)) throw new Error(`remove: /${toks.join('/')} does not exist`);
  const v = p[k]; delete p[k]; return v;
}
function applyOp(doc, op) {
  const toks = tokens(doc, op.path);
  switch (op.op) {
    case 'add': add(doc, toks, clone(op.value)); break;
    case 'remove': remove(doc, toks); break;
    case 'replace': {
      const [p, k] = parent(doc, toks);
      if (Array.isArray(p)) { if (!(+k >= 0 && +k < p.length)) throw new Error(`index ${k} out of range`); p[+k] = clone(op.value); }
      else { if (!(k in p)) throw new Error(`replace: ${op.path} does not exist`); p[k] = clone(op.value); }
      break;
    }
    case 'move': { const v = remove(doc, tokens(doc, op.from)); add(doc, tokens(doc, op.path), v); break; }
    case 'copy': add(doc, toks, clone(get(doc, tokens(doc, op.from)))); break;
    case 'test': if (JSON.stringify(get(doc, toks)) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`); break;
    case 'merge': {
      const tgt = get(doc, toks);
      if (!tgt || typeof tgt !== 'object' || Array.isArray(tgt) || !op.value || typeof op.value !== 'object') throw new Error(`merge needs an object at ${op.path}`);
      Object.assign(tgt, clone(op.value));
      break;
    }
    default: throw new Error(`unknown op ${op.op}`);
  }
}
export function jsonPatch(doc, ops) {
  const d = clone(doc);
  for (const op of ops || []) applyOp(d, op);
  return d;
}

// LLM patches: drop ops on machine-owned fields, turn replace/merge on a missing key into add, so a reasonable
// request ("bigger captions" -> replace /style/caption/size) is not rejected for RFC pedantry.
const LOCKED = /^\/(rev|id|schema|meta)(\/|$)|\/(hash|segments|words|dirty)$|\/captions\/words(\/|$)/;
export function sanitize(doc, ops) {
  const d = clone(doc);
  const out = [], dropped = [];
  for (const raw of Array.isArray(ops) ? ops : []) {
    if (!raw || typeof raw !== 'object' || !raw.op || typeof raw.path !== 'string') { dropped.push('malformed op'); continue; }
    let op = { op: raw.op, path: raw.path, ...('value' in raw ? { value: raw.value } : {}), ...(raw.from ? { from: raw.from } : {}) };
    if (LOCKED.test(op.path)) { dropped.push(op.path); continue; }
    try { applyOp(d, op); out.push(op); continue; } catch (e) {
      // replace or merge on a key that is not there yet: add it instead (creating one missing parent object if needed)
      if (op.op === 'replace' || op.op === 'merge') {
        try {
          const toks = op.path.slice(1).split('/');
          const parentPath = '/' + toks.slice(0, -1).join('/');
          let fixed = { op: 'add', path: op.path, value: op.value };
          try { tokens(d, parentPath); get(d, tokens(d, parentPath)); }
          catch (_) { fixed = { op: 'add', path: parentPath, value: { [toks[toks.length - 1]]: op.value } }; }
          applyOp(d, fixed); out.push(fixed); continue;
        } catch (_) { /* fall through */ }
      }
      throw new Error(`${op.op} ${op.path}: ${e.message}`);
    }
  }
  return { ops: out, dropped, doc: d };
}

// ---------- same normalisation the renderer does (tools/timeline.py normalize) ----------
function nextId(t, prefix) {
  const used = new Set(TRACKS.flatMap((tr) => (t.tracks?.[tr] || []).map((c) => c?.id)));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
export function normalize(t) {
  const tr = (t.tracks ||= {});
  for (const [name, prefix] of [['visuals', 'v'], ['music', 'm'], ['sfx', 's'], ['overlays', 'o'], ['voice', 'vo']]) {
    const seen = new Set();
    for (const c of tr[name] || []) {
      if (!c || typeof c !== 'object') continue;
      if (!c.id || seen.has(c.id)) { c.id = null; c.id = nextId(t, prefix); }
      seen.add(c.id);
    }
  }
  let prevEnd = 0;
  for (const v of tr.visuals || []) {
    if (typeof v.start !== 'number' || v.start < 0) v.start = prevEnd;
    if (typeof v.end !== 'number' || v.end <= v.start) v.end = Math.round((v.start + 2.5) * 1000) / 1000;
    prevEnd = v.end;
    v.kind ||= 'image';
    if (v.kind === 'image' && !v.src && !v.gen) v.gen = { tool: 'flux', prompt: v.narration || '' };
    if (v.kind === 'graphic' && !v.gen) v.gen = { tool: 'graphic' };
    if (v.kind === 'scene' && !v.gen) v.gen = { tool: 'scene' };
  }
  for (const m of tr.music || []) {
    const g = m.gen || {};
    if (g.tool === 'library' && g.name) m.src = `library/music/clips/${g.name}.mp3`;
  }
  return t;
}

// ---------- validation: timeline.schema.json (subset of JSON Schema) + the renderer's own rules ----------
function typeOk(v, t) {
  if (Array.isArray(t)) return t.some((x) => typeOk(v, x));
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (t === 'array') return Array.isArray(v);
  if (t === 'null') return v === null;
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeof v === t;
}
function check(schema, v, path, errs, root) {
  if (!schema || errs.length > 12) return;
  if (schema.$ref && schema.$ref.startsWith('#/')) schema = schema.$ref.slice(2).split('/').reduce((a, k) => a?.[k], root) || {};
  if (schema.anyOf) {
    if (!schema.anyOf.some((s) => { const e = []; check(s, v, path, e, root); return !e.length; })) errs.push(`${path || '/'}: does not match any allowed form`);
    return;
  }
  if (schema.oneOf) {
    if (!schema.oneOf.some((s) => { const e = []; check(s, v, path, e, root); return !e.length; })) errs.push(`${path || '/'}: does not match any allowed form`);
    return;
  }
  if ('const' in schema && JSON.stringify(v) !== JSON.stringify(schema.const)) errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) errs.push(`${path}: ${JSON.stringify(v)} is not one of ${schema.enum.join(', ')}`);
  if (schema.type && !typeOk(v, schema.type)) { errs.push(`${path}: must be ${[].concat(schema.type).join(' or ')}`); return; }
  if (typeof v === 'number') {
    if (schema.minimum != null && v < schema.minimum) errs.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum != null && v > schema.maximum) errs.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (typeof v === 'string' && schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${path}: bad format`);
  if (Array.isArray(v) && schema.items) v.forEach((x, i) => check(schema.items, x, `${path}/${i}`, errs, root));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${path}/${k}: required`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) check(s, v[k], `${path}/${k}`, errs, root);
  }
}
export function validate(t, schema) {
  const errs = [];
  if (t?.schema !== SCHEMA_ID) errs.push(`schema must be ${SCHEMA_ID}`);
  for (const k of ['id', 'title', 'canvas', 'tracks']) if (!(k in (t || {}))) errs.push(`missing ${k}`);
  const c = t?.canvas || {};
  if (!(c.width >= 16 && c.width <= 7680 && c.height >= 16 && c.height <= 7680)) errs.push('canvas width/height out of range');
  if (!(c.fps >= 1 && c.fps <= 120)) errs.push('canvas fps out of range');
  const ids = new Set();
  for (const tr of TRACKS) for (const x of t?.tracks?.[tr] || []) {
    if (!x?.id) errs.push(`${tr}: clip without id`);
    else if (ids.has(x.id)) errs.push(`duplicate id ${x.id}`);
    ids.add(x?.id);
  }
  const vis = t?.tracks?.visuals || [];
  if (!vis.length) errs.push('the video needs at least one scene');
  for (const v of vis) {
    if (!KINDS.includes(v.kind)) errs.push(`${v.id}: kind must be one of ${KINDS.join(', ')}`);
    if (!(typeof v.start === 'number' && typeof v.end === 'number' && v.end > v.start && v.start >= 0)) errs.push(`${v.id}: needs 0 <= start < end`);
    if (v.kind === 'graphic' && (!v.graphic || typeof v.graphic !== 'object')) errs.push(`${v.id}: graphic scene needs a graphic object`);
    if (v.kind === 'scene' && (!v.scene || typeof v.scene !== 'object')) errs.push(`${v.id}: scene clip needs a scene object`);
    if (['image', 'ai_video', 'stock', 'upload'].includes(v.kind) && !v.src && !v.gen) errs.push(`${v.id}: needs a picture (src) or a gen recipe`);
  }
  if (schema) check(schema, t, '', errs, schema);
  return [...new Set(errs)];
}

// ---------- what an edit changes / remakes (tools/timeline.py diff + plan) ----------
const voiceKey = (g = {}) => `${g.voice || 'en-US-AndrewMultilingualNeural'}|${g.rate || '+0%'}|${g.pitch || ''}`;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function plan(old, neu) {
  const ov = new Map((old.tracks.visuals || []).map((v) => [v.id, v]));
  const nv = new Map((neu.tracks.visuals || []).map((v) => [v.id, v]));
  const oOrder = [...ov.keys()], nOrder = [...nv.keys()];
  const d = {
    added: nOrder.filter((i) => !ov.has(i)), removed: oOrder.filter((i) => !nv.has(i)), narration: [], visual: [], props: [],
    reordered: !same(oOrder.filter((i) => nv.has(i)), nOrder.filter((i) => ov.has(i))),
    style: [], canvas: null, music: false, voice: false, overlays: false, title: old.title !== neu.title,
  };
  for (const id of nOrder) {
    const a = ov.get(id), b = nv.get(id);
    if (!a) continue;
    if (normText(a.narration) !== normText(b.narration)) d.narration.push(id);
    if (!same(a.gen, b.gen) || a.kind !== b.kind || !same(a.graphic, b.graphic) || !same(a.scene, b.scene) || (b.dirty && !a.dirty)) d.visual.push(id);
    else if (['fit', 'motion', 'transition', 'focus', 'trim', 'playbackRate', 'color', 'src'].some((k) => !same(a[k], b[k]))) d.props.push(id);
  }
  const os = old.style || {}, ns = neu.style || {};
  d.style = [...new Set([...Object.keys(os), ...Object.keys(ns)])].filter((k) => !same(os[k], ns[k])).sort();
  if (!same(old.canvas, neu.canvas)) d.canvas = `${neu.canvas.width}x${neu.canvas.height}`;
  d.music = !same(old.tracks.music, neu.tracks.music);
  const og = old.tracks.voice?.[0]?.gen || {}, ng = neu.tracks.voice?.[0]?.gen || {};
  d.voice = voiceKey(og) !== voiceKey(ng);
  d.overlays = !same(old.tracks.overlays, neu.tracks.overlays) || !same({ ...(old.tracks.captions || {}), words: 0 }, { ...(neu.tracks.captions || {}), words: 0 });
  // lines to re-record: new text not spoken anywhere before (all of them if the voice or pace changed)
  const oldTexts = new Set(oOrder.map((i) => normText(ov.get(i).narration)).filter(Boolean));
  const revoice = neu.tracks.voice?.length
    ? nOrder.filter((i) => { const n = normText(nv.get(i).narration); return n && (d.voice || !oldTexts.has(n)); }) : [];
  const paintable = (v) => v.gen && !['graphic', 'library', 'scene'].includes(v.gen.tool) && !['graphic', 'color', 'scene'].includes(v.kind);
  const repaint = nOrder.filter((i) => paintable(nv.get(i)) && (!ov.has(i) ? !nv.get(i).src : d.visual.includes(i)));
  const retime = revoice.length > 0 || d.added.length > 0 || d.removed.length > 0 || d.reordered || d.narration.length > 0;
  return { diff: d, revoice, repaint, retime };
}

export const sceneNo = (t, id) => (t.tracks.visuals || []).findIndex((v) => v.id === id) + 1;
const ICON = { image: '🖼️', ai_video: '🎥', graphic: '📊', stock: '🎞', upload: '📎', color: '🟦', scene: '🎭' };
export function scenes(t) {
  return (t.tracks.visuals || []).map((v, i) => {
    const what = v.kind === 'graphic' ? `${v.graphic?.type || 'graphic'}${v.graphic?.label || v.graphic?.title || v.graphic?.text ? ': ' + (v.graphic.label || v.graphic.title || v.graphic.text) : ''}`
      : v.kind === 'scene' ? `${v.scene?.scene || 'scene'} (${v.scene?.shot || 'wide'})` : (v.gen?.prompt || v.src || '');
    return { n: i + 1, id: v.id, kind: v.kind, tool: v.gen?.tool, icon: ICON[v.kind] || '▫️', start: v.start, end: v.end, text: String(v.narration || '').trim(), visual: String(what).slice(0, 90) };
  });
}

// Plain-words summary of a plan, numbered the way the user sees scenes (old numbers for removed ones).
export function planText(old, neu, p) {
  const n = (id) => sceneNo(neu, id) || sceneNo(old, id);
  const list = (ids) => ids.map(n).filter(Boolean).sort((a, b) => a - b).join(', ');
  const L = [];
  if (p.diff.removed.length) L.push(`✂️ Cut scene ${p.diff.removed.map((id) => sceneNo(old, id)).join(', ')}`);
  if (p.diff.added.length) L.push(`➕ New scene ${list(p.diff.added)}`);
  if (p.diff.reordered) L.push('🔀 Scenes reordered');
  if (p.diff.narration.length) L.push(`📝 New words in scene ${list(p.diff.narration)}`);
  if (p.diff.canvas) L.push(`📐 Shape ${p.diff.canvas}`);
  if (p.diff.style.length) L.push(`🎨 Style: ${p.diff.style.join(', ')}`);
  if (p.diff.music) L.push('🎵 Music changed');
  if (p.diff.voice) L.push('🎙️ Voice or pace changed');
  if (p.diff.title) L.push('🏷️ New title');
  if (p.diff.overlays) L.push('🔤 Captions/overlays changed');
  if (p.diff.props.length) L.push(`🎬 Framing/motion of scene ${list(p.diff.props)}`);
  const work = [];
  if (p.revoice.length) work.push(`re-voice ${p.revoice.length} line${p.revoice.length > 1 ? 's' : ''}`);
  if (p.repaint.length) work.push(`repaint ${p.repaint.length} image${p.repaint.length > 1 ? 's' : ''} (scene ${list(p.repaint)})`);
  const total = (neu.tracks.visuals || []).length;
  const kept = total - new Set([...p.repaint, ...p.revoice, ...p.diff.added]).size;
  L.push(work.length ? `♻️ I'll ${work.join(' and ')}; the other ${kept} scene${kept === 1 ? '' : 's'} are reused.` : '♻️ Nothing to regenerate: same voice and pictures, just a re-render.');
  return L.join('\n');
}

// History -> user-facing versions ("rebuilt ..." revisions fold into the edit before them).
export function versions(log) {
  const out = [];
  for (const h of log || []) {
    const msg = h.message || '';
    if (out.length && msg.startsWith('rebuilt') && !h.edit_id) { out[out.length - 1] = { ...out[out.length - 1], rev: h.rev, at: h.at }; continue; }
    const m = msg.match(/^revert to r(\d+)/);
    out.push({ rev: h.rev, at: h.at, message: msg, edit_id: h.edit_id, kind: h.kind || (m ? 'revert' : ''), revert_to: h.revert_to ?? (m ? +m[1] : undefined) });
  }
  return out;
}
// Which version /undo goes back to: the one before the current state (following undo/restore chains).
export function undoTarget(vs) {
  if (vs.length < 2) return null;
  let cur = vs[vs.length - 1];
  const seen = new Set();
  while (cur && cur.kind === 'revert' && cur.revert_to != null && !seen.has(cur.rev)) {
    seen.add(cur.rev);
    const to = vs.find((v) => v.rev === cur.revert_to) || vs.filter((v) => v.rev <= cur.revert_to).pop();
    if (!to) break;
    cur = to;
  }
  const i = vs.findIndex((v) => v.rev === cur.rev);
  return i > 0 ? vs[i - 1] : null;
}

// Compact view of a timeline for the edit model.
export function editorView(t) {
  const vo = t.tracks.voice?.[0];
  const lines = scenes(t).map((s) => {
    const v = t.tracks.visuals[s.n - 1];
    const vis = v.kind === 'scene' ? `scene ${JSON.stringify(v.scene)}` : v.kind === 'graphic' ? `graphic ${JSON.stringify(v.graphic)}` : `${v.gen?.tool || v.kind} prompt: "${v.gen?.prompt || ''}"${v.gen?.motion ? ` motion: "${v.gen.motion}"` : ''}`;
    return `${s.n}. @${v.id} [${v.kind}] ${(+v.start).toFixed(1)}-${(+v.end).toFixed(1)}s\n   says: "${s.text}"\n   shows: ${vis}${v.transition ? `\n   transition: ${JSON.stringify(v.transition)}` : ''}${v.motion ? ` motion: ${v.motion}` : ''}`;
  });
  return [
    `PROJECT "${t.title}" (id ${t.id}, v${t.rev}) canvas ${t.canvas.width}x${t.canvas.height} @${t.canvas.fps}fps, ${t.duration}s`,
    `STYLE: ${JSON.stringify(t.style || {})}`,
    `VOICE: ${vo ? `@${vo.id} ${JSON.stringify({ voice: vo.gen?.voice, rate: vo.gen?.rate || '+0%' })}` : 'none'}`,
    `MUSIC: ${JSON.stringify((t.tracks.music || []).map((m) => ({ id: m.id, name: m.gen?.name, volume: m.volume })))}`,
    `CAPTIONS: ${t.tracks.captions?.enabled === false ? 'off' : 'on'}`,
    `OVERLAYS: ${JSON.stringify((t.tracks.overlays || []).map((o) => ({ id: o.id, kind: o.kind, text: o.text, start: o.start, end: o.end })))}`,
    `SFX: ${JSON.stringify((t.tracks.sfx || []).map((x) => ({ id: x.id, src: x.src, anchor: x.anchor })))}`,
    `IMAGE STYLE: ${t.meta?.image_style || ''}`,
    `SCENES (${lines.length}):`, ...lines,
  ].join('\n');
}
