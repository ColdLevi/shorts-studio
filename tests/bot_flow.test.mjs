// Offline run of the Studio bot's re-edit flow (llm-proxy/api/studio.mjs) with GitHub, Telegram and the LLM mocked.
//   node tests/bot_flow.test.mjs        (from ~/shorts-studio; finds ~/llm-proxy, or set STUDIO_PROXY_DIR)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proxyDir = process.env.STUDIO_PROXY_DIR || [path.join(root, '..', 'llm-proxy'), path.join(os.homedir(), 'llm-proxy')].find((d) => existsSync(path.join(d, 'api', 'studio.mjs')));
Object.assign(process.env, { STUDIO_TG_TOKEN: 'tg', STUDIO_TOKEN: 'gh', STUDIO_REPO: 'me/shorts-studio', STUDIO_CHAT_ID: '42', STUDIO_TG_SECRET: '', TG_SECRET: '', PROXY_KEY: 'k' });
const EX = JSON.parse(readFileSync(path.join(root, 'timeline', 'example.json'), 'utf8'));
const SCHEMA = readFileSync(path.join(root, 'timeline', 'timeline.schema.json'), 'utf8');
const PID = EX.id;

let state = { projects: [{ id: PID, title: EX.title, topic: 'zimbabwe', at: Date.now() }], history: [{ role: 'user', text: 'hi', t: 1 }] };
let log = [{ rev: 1, message: 'first build' }];
let repoTL = EX;  // what the renderer has committed
const sent = [], dispatches = [];
let llmReply = null, llmCalls = 0, llmSystem = '';
const ok = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.includes('api.telegram.org')) { const m = url.split('/').pop(); if (m === 'sendMessage') sent.push(body); return ok({ ok: true, result: {} }); }
  if (url.endsWith('/contents/state/studio.json')) {
    if (opts.method === 'PUT') { state = JSON.parse(Buffer.from(body.content, 'base64').toString()); return ok({ content: { sha: 'x' } }); }
    return ok({ sha: 's', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  }
  if (url.endsWith(`/contents/media/projects/${PID}/timeline.json`)) return ok(JSON.stringify(repoTL));
  if (url.endsWith(`/contents/media/projects/${PID}/history/log.jsonl`)) return ok(log.map((l) => JSON.stringify(l)).join('\n'));
  if (url.includes(`/contents/media/projects/${PID}/history/r`)) return ok(JSON.stringify({ ...EX, rev: 1 }));
  if (url.endsWith('/contents/timeline/timeline.schema.json')) return ok(SCHEMA);
  if (url.includes('/contents/')) return ok('', 404);
  if (url.endsWith('/dispatches')) { dispatches.push(body); return new Response(null, { status: 204 }); }
  if (url.includes('/api/v1/chat/completions')) { llmCalls++; llmSystem = body.messages[0].content; return ok({ choices: [{ message: { content: JSON.stringify(llmReply) } }] }); }
  if (url.includes('/api/v1/memory')) return ok({});
  throw new Error('unexpected fetch ' + url);
};
const TLX = await import(pathToFileURL(path.join(proxyDir, 'api', '_timeline.mjs')).href);
const { default: handler } = await import(pathToFileURL(path.join(proxyDir, 'api', 'studio.mjs')).href);
let uid = 1;
async function msg(text) { await handler({ method: 'POST', headers: { host: 'proxy.test' }, query: {}, body: { update_id: uid++, message: { chat: { id: 42 }, text } } }, { status: () => ({ end() {}, json() {}, send() {} }) }); }
async function tap(data) { await handler({ method: 'POST', headers: { host: 'proxy.test' }, query: {}, body: { update_id: uid++, callback_query: { id: 'c', data, message: { chat: { id: 42 }, message_id: 1 } } } }, { status: () => ({ end() {}, json() {}, send() {} }) }); }
const last = () => sent[sent.length - 1];

// 1) natural-language edit -> one LLM call -> proposal with Apply/Cancel
llmReply = { kind: 'edit', summary: 'Scene 3 now shows a rocket launch at dawn', message: 'scene 3: rocket launch', patch: [{ op: 'replace', path: '/tracks/visuals/@v3/gen/prompt', value: 'a rocket launch at dawn' }] };
await msg('swap scene 3 for a rocket launch');
assert.equal(llmCalls, 1, 'one model call, no router');
assert.match(last().text, /rocket launch/); assert.match(last().text, /repaint 1 image \(scene 3\)/);
const btn = last().reply_markup.inline_keyboard[0][0].callback_data;
assert.ok(btn.startsWith('edit:apply:')); assert.ok(state.pending_edit); assert.equal(dispatches.length, 0);
console.log('ok proposal:', last().text.split('\n')[0]);

// 2) Apply -> render-project with the edit queue
await tap(btn);
assert.equal(dispatches.length, 1);
let d = dispatches[0];
assert.equal(d.event_type, 'render-project'); assert.equal(d.client_payload.project_id, PID);
assert.equal(d.client_payload.edits.length, 1); assert.deepEqual(d.client_payload.edits[0].patch, llmReply.patch);
assert.equal(state.pending_edit, null);
console.log('ok applied ->', d.client_payload.edits[0].id);

// 3) "just ..." applies straight away; the unconfirmed first edit rides along
llmReply = { kind: 'edit', summary: 'Captions are bigger and yellow', message: 'bigger yellow captions', patch: [{ op: 'replace', path: '/style/caption/size', value: 120 }, { op: 'replace', path: '/style/caption/color', value: '#FFD43B' }] };
await msg('just make the captions bigger and yellow');
assert.equal(dispatches.length, 2);
d = dispatches[1].client_payload;
assert.equal(d.edits.length, 2, 'queued edit re-sent');
assert.equal(d.edits[1].patch[0].op, 'add', 'replace on missing key sanitised to add');
console.log('ok direct edit with queue of', d.edits.length);

// 4) once the renderer logged the first edit, it is no longer re-sent; /scenes shows the virtual timeline
log.push({ rev: 2, message: 'scene 3: rocket launch', edit_id: d.edits[0].id, kind: 'edit' });
repoTL = { ...TLX.jsonPatch(EX, d.edits[0].patch), rev: 2 };
await msg('/scenes');
assert.match(last().text, /1\. 🖼️ image\/flux/); assert.match(last().text, /rocket launch at dawn/);
console.log('ok /scenes');
await msg('/history');
assert.match(last().text, /v2 · scene 3: rocket launch/); assert.match(last().text, /rendering: bigger yellow captions/);
console.log('ok /history');

// 5) /undo while the captions edit is still rendering -> revert to the repo version, queue dropped
await msg('/undo');
d = dispatches[2].client_payload;
assert.equal(d.edits.length, 1); assert.equal(d.edits[0].revert, 2);
console.log('ok /undo ->', d.edits[0].message);

// 6) /restore 1 and /project
log.push({ rev: 3, message: d.edits[0].message, edit_id: d.edits[0].id, kind: 'revert', revert_to: 2 });
await msg('/restore 1');
assert.equal(dispatches[3].client_payload.edits.at(-1).revert, 1);
await msg('/restore 9');
assert.match(last().text, /no v9/);
await msg('/project');
assert.match(last().text, /←/);
console.log('ok /restore, /project');

// 7) invalid model patch is refused without dispatch; questions are answered
llmReply = { kind: 'edit', summary: 'x', message: 'x', patch: [{ op: 'merge', path: '/style/caption', value: { preset: 'sparkly' } }] };
await msg('make the captions sparkly');
assert.match(last().text, /would break the video/); assert.equal(dispatches.length, 4);
llmReply = { kind: 'question', reply: 'It has 4 scenes and runs about 13 seconds.' };
await msg('how many scenes does the hook scene have');
assert.match(last().text, /4 scenes/);
console.log('ok validation + question');

// 8) pending edit answered with "yes"
llmReply = { kind: 'edit', summary: 'Ending rewritten', message: 'new ending', patch: [{ op: 'replace', path: '/tracks/visuals/@v4/narration', value: 'So the country switched to dollars.' }] };
await msg('rewrite the ending');
assert.match(last().text, /re-voice 1 line/);
await msg('yes');
assert.equal(dispatches.at(-1).client_payload.edits.at(-1).patch[0].path, '/tracks/visuals/@v4/narration');
console.log('ok yes applies pending');

// 9) step-1 commands still work, through the same queue
await msg('/reformat 16:9');
assert.deepEqual(dispatches.at(-1).client_payload.edits.at(-1).patch, [{ op: 'replace', path: '/canvas', value: { width: 1920, height: 1080, fps: 30 } }]);
await msg('/captions neon');
assert.equal(dispatches.at(-1).client_payload.edits.at(-1).patch[0].value.preset, 'neon');
console.log('ok /reformat, /captions');

// 10) "redo it" and chit-chat still go to the router, not the editor
llmReply = { intent: 'chat', reply: 'Hi! Send a topic or tell me what to change.' };
await msg('redo it');
assert.match(llmSystem, /brain of a Shorts Studio/);
await msg('thanks, that was fun');
assert.match(llmSystem, /brain of a Shorts Studio/);
// router can still pick the editor for an edit phrased without keywords
llmReply = { intent: 'edit', feedback: 'more drama' };
const before = llmCalls;
await msg('give it more drama please');
assert.equal(llmCalls, before + 2, 'router + one editor call');
assert.match(llmSystem, /video editor of a Shorts Studio/);
console.log('ok routing');

// 11) the /short flow is untouched: a new topic goes to research + pitch
llmReply = { title: 'Rockets', hook: 'A rocket burns a ton a second.', angle: 'a', key_facts: [], visual_style: 'photo', length_seconds: 40, music: 'docu-pluck', accent: 'gold' };
await msg('/short rocket fuel');
assert.match(llmSystem, /showrunner/);
console.log('ok /short');
console.log('\nbot flow: all passed');
