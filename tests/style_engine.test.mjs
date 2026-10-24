// Offline test of the style engine in the Studio bot (llm-proxy/api/studio.mjs + _style.mjs):
// request reading (format/length/style), recipe pick, long-form chapters, render spec, style learning.
//   node tests/style_engine.test.mjs    (from ~/shorts-studio; finds ~/llm-proxy, or set STUDIO_PROXY_DIR)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proxyDir = process.env.STUDIO_PROXY_DIR || [path.join(root, '..', 'llm-proxy'), path.join(os.homedir(), 'llm-proxy')].find((d) => existsSync(path.join(d, 'api', 'studio.mjs')));
Object.assign(process.env, { STUDIO_TG_TOKEN: 'tg', STUDIO_TOKEN: 'gh', STUDIO_REPO: 'me/shorts-studio', STUDIO_CHAT_ID: '42', STUDIO_TG_SECRET: '', TG_SECRET: '', PROXY_KEY: 'k' });
const SX = await import(pathToFileURL(path.join(proxyDir, 'api', '_style.mjs')).href);

// 1) the request itself carries format, length and style
const j1 = SX.parseJob('Create a documentary style video like Issacverse of how money came to be done it a 3 mins video for youtube');
assert.deepEqual(j1, { length: 180, format: 'landscape', style: 'documentary' });
assert.equal(SX.parseJob('the daily life of a guy named Adam do the graphics in stop motion style').style, 'stop-motion');
assert.equal(SX.parseJob('make a short about lagos traffic').format, 'vertical');
assert.equal(SX.parseJob('a 90 second motion graphics explainer on inflation').length, 90);
assert.equal(SX.parseJob('a 90 second motion graphics explainer on inflation').style, 'motion-explainer');
console.log('ok parseJob');

// 2) graphics: 14 new types are cleaned, emoji stripped, junk refused
const G = SX.cleanGraphic2;
assert.equal(G({ type: 'versus', left: { label: 'Gold 🪙', value: '1,900' }, right: { label: 'Paper', value: 1 } }).left.label, 'Gold');
assert.equal(G({ type: 'versus', left: { label: 'Gold 🪙', value: '1,900' }, right: { label: 'Paper' } }).left.value, 1900);
assert.equal(G({ type: 'percent', value: 140 }).value, 100);
assert.equal(G({ type: 'pie', items: [{ label: 'a', value: 1 }] }), null);
assert.equal(G({ type: 'timeline', events: [{ date: '600 BC', label: 'Lydia mints coins' }, { date: '1971', label: 'Gold standard ends' }] }).events.length, 2);
assert.equal(G({ type: 'flow', steps: ['barter', 'coins', 'paper'] }).steps.length, 3);
assert.equal(G({ type: 'kinetic', words: ['money', 'is', 'a', 'story', '🔥'] }).words.length, 4);
assert.equal(G({ type: 'people', value: 30, total: 10 }).value, 10);
assert.equal(G({ type: 'map', countries: ['Turkey', 'China'] }).countries.length, 2);
assert.equal(G({ type: 'icons', items: [{ icon: 'Coins', label: 'Coins' }, { icon: 'landmark', label: 'Banks' }] }).items[0].icon, 'coins');
assert.equal(G({ type: 'nope' }), null);
console.log('ok graphics');
assert.equal(SX.plan(180, 6).beats, 30); assert.equal(SX.plan(180, 6).chapters, 4); assert.equal(SX.plan(45).chapters, 0);

// ---------- bot with GitHub, Telegram and the LLM mocked ----------
let state = { projects: [{ id: 'old-proj', title: 'Old', topic: 'x', at: Date.now() }], current_project: 'old-proj', history: [{ role: 'user', text: 'hi', t: 1 }] };
const sent = [], dispatches = [], systems = [];
let reply = () => ({});
const ok = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.includes('api.telegram.org')) { if (url.endsWith('sendMessage')) sent.push(body); return ok({ ok: true, result: {} }); }
  if (url.endsWith('/contents/state/studio.json')) {
    if (opts.method === 'PUT') { state = JSON.parse(Buffer.from(body.content, 'base64').toString()); return ok({ content: { sha: 'x' } }); }
    return ok({ sha: 's', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  }
  if (url.includes('/contents/')) return ok('', 404);
  if (url.endsWith('/dispatches')) { dispatches.push(body); return new Response(null, { status: 204 }); }
  if (url.includes('/api/v1/chat/completions')) { systems.push(body.messages[0].content); return ok({ choices: [{ message: { content: JSON.stringify(reply(body)) } }] }); }
  if (url.includes('/search')) return ok({ text: 'Lydia minted the first coins around 600 BC. The gold standard ended in 1971.', sources: [] });
  if (url.includes('/api/v1/memory')) return ok({});
  if (url.includes('/dispatches') || url.includes('github.com')) return ok({});
  throw new Error('unexpected fetch ' + url);
};
const { default: handler } = await import(pathToFileURL(path.join(proxyDir, 'api', 'studio.mjs')).href);
let uid = 1;
const res = { status: () => ({ end() {}, json() {}, send() {} }) };
const msg = (text, extra = {}) => handler({ method: 'POST', headers: { host: 'proxy.test' }, query: {}, body: { update_id: uid++, message: { chat: { id: 42 }, text, ...extra } } }, res);
const tap = (data) => handler({ method: 'POST', headers: { host: 'proxy.test' }, query: {}, body: { update_id: uid++, callback_query: { id: 'c', data, message: { chat: { id: 42 }, message_id: 1 } } } }, res);
const last = () => sent[sent.length - 1];

// 3) a "create a ... video" message is a new video (never an edit of the last project), with the job read from it
reply = () => ({ title: 'Three Metal Bars Ruled The World', hook: 'In 600 BC a king stamped a lion on a lump of metal.', angle: 'a', key_facts: ['f'], visual_style: 'painterly', length_seconds: 45, music: 'docu-pluck', accent: 'gold', style: 'motion-explainer', style_reason: 'x' });
await msg('Create a documentary style video like Issacverse of how money came to be done it a 3 mins video for youtube');
assert.equal(state.stage, 'pitch');
assert.match(systems[0], /STYLE: The user asked for the "documentary" style/);
assert.equal(state.pitch.style, 'documentary', 'the asked-for style wins over the model');
assert.equal(state.pitch.length_seconds, 180); assert.equal(state.pitch.format, 'landscape');
assert.match(state.topic, /how money came to be/i); assert.doesNotMatch(state.topic, /3 mins|youtube|documentary style/i);
assert.match(sent.find((m) => /As asked/.test(m.text)).text, /Documentary · landscape · 3 min/);
assert.match(last().text, /Style: Documentary/);
console.log('ok new video + job:', state.topic);

// 4) script for 3 minutes: outline + chapters written in parallel; chapters and the new graphics come through
let calls = 0;
reply = (b) => {
  calls++;
  const u = b.messages[b.messages.length - 1].content;
  if (/ONLY the outline/.test(u)) return { title: 'Money', chapters: [{ title: 'Cold open', beats: 6, covers: 'hook' }, { title: 'Barter', beats: 8, covers: 'b' }, { title: 'Coins', beats: 8, covers: 'c' }, { title: 'Paper', beats: 8, covers: 'd' }] };
  const n = Number((u.match(/exactly (\d+) beats/) || [])[1] || 6);
  return { beats: Array.from({ length: n }, (_, i) => i % 3 === 1
    ? { narration: 'By 1971 the gold link was gone.', image_prompt: 'x', tool: 'graphic', graphic: { type: 'timeline', events: [{ date: '600 BC', label: 'First coins' }, { date: '1971', label: 'Gold link ends' }] } }
    : { narration: 'A merchant weighs silver.', image_prompt: 'merchant weighing silver', tool: 'flux' }), fact_check: [] };
};
await tap('approve');
assert.equal(state.stage, 'script');
assert.equal(state.script.beats.length, 30);
assert.deepEqual(state.script.chapters.map((c) => c.beat), [6, 14, 22]);
assert.ok(state.script.beats.some((b) => b.graphic?.type === 'timeline'));
assert.match(systems.at(-1), /"type": "map"/); assert.match(systems.at(-1), /About a third of beats are graphics/);
console.log('ok long script:', state.script.beats.length, 'beats,', state.script.chapters.length, 'chapters,', calls, 'calls');

// 5) render spec carries the shape, recipe, chapters
await tap('approve');
const spec = dispatches.at(-1).client_payload.spec;
assert.equal(spec.canvas, '16:9'); assert.equal(spec.style_preset, 'documentary'); assert.equal(spec.chapters.length, 3); assert.equal(spec.fps, 30);
assert.deepEqual(state.recent_styles, ['documentary']);
console.log('ok render spec', spec.canvas, spec.style_preset);

// 6) "the daily life of Adam in stop motion" with a project open goes to the router, not straight to an edit
reply = (b) => (/brain of a Shorts Studio/.test(b.messages[0].content) ? { intent: 'new_topic', topic: 'the daily life of a guy named Adam, stop motion style' }
  : { title: 'Adam', hook: 'h', angle: 'a', key_facts: [], visual_style: 'clay', length_seconds: 40, music: 'lofi-warm', accent: 'gold', style: 'stop-motion' });
const nSys = systems.length;
await msg('I meant the daily life of a guy named Adam do the graphics in stop motion style');
assert.ok(!systems.slice(nSys).some((x) => /video editor of a Shorts Studio/.test(x)), 'never the editor');
assert.equal(state.stage, 'pitch'); assert.equal(state.pitch.style, 'stop-motion'); assert.equal(state.pitch.format, 'vertical');
console.log('ok stop-motion is a new video');

// 7) a video upload is a style reference -> learn-style workflow; the result comes back and is used
await msg('', { caption: 'learn this style, call it chalk', video: { file_id: 'FILE1', file_size: 5e6 } });
const ls = dispatches.at(-1);
assert.equal(ls.event_type, 'learn-style'); assert.equal(ls.client_payload.source, 'tg:FILE1'); assert.equal(ls.client_payload.name, 'chalk');
const key = crypto.createHash('sha256').update('tg').digest('hex').slice(0, 32);
const style = { name: 'chalk', summary: 'Chalkboard doodles.', base: 'motion-explainer', mode: 'motion-graphics', graphic_ratio: 0.9, beat_seconds: 3, image_style: 'chalk on blackboard',
  format: 'vertical', music: 'tech-pulse', pacing: 'fast', writer_notes: 'playful', style_tokens: { backdrop: 'grid', transitions: ['wipe', 'cut'] }, metrics: { cuts_per_min: 22, avg_shot_s: 2.7 } };
await handler({ method: 'POST', headers: { host: 'proxy.test', 'x-studio-key': key }, query: { event: 'style' }, body: { style } }, res);
assert.equal(state.settings.style, 'chalk'); assert.ok(state.styles.chalk);
assert.match(last().text, /Learned the style "chalk"/);
await msg('/styles');
assert.match(last().text, /chalk: Chalkboard doodles/);
// a YouTube link with "style" is a reference too
await msg('make my videos look like this style https://youtu.be/abc123');
assert.equal(dispatches.at(-1).event_type, 'learn-style'); assert.equal(dispatches.at(-1).client_payload.source, 'https://youtu.be/abc123');
await msg('auto style');
assert.equal(state.settings.style, undefined);
console.log('ok style learning');

// 8) /look restyles the last video with a whole recipe
await msg('/look stop-motion');
const rp = dispatches.at(-1);
assert.equal(rp.event_type, 'render-project');
assert.deepEqual(rp.client_payload.edits.at(-1).patch, [{ op: 'merge', path: '/style', value: { apply_recipe: 'stop-motion' } }]);
console.log('ok /look');

console.log('\nstyle engine: all passed');
