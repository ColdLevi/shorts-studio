// Bot-side edit logic (llm-proxy/api/_timeline.mjs) against timeline/example.json, plus parity with tools/timeline.py.
//   node tests/bot_timeline.test.mjs            (from ~/shorts-studio; finds ~/llm-proxy, or set STUDIO_PROXY_DIR)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proxyDir = process.env.STUDIO_PROXY_DIR || [path.join(root, '..', 'llm-proxy'), path.join(os.homedir(), 'llm-proxy')].find((d) => existsSync(path.join(d, 'api', '_timeline.mjs')));
if (!proxyDir) { console.error('llm-proxy/api/_timeline.mjs not found; set STUDIO_PROXY_DIR'); process.exit(1); }
const T = await import(pathToFileURL(path.join(proxyDir, 'api', '_timeline.mjs')).href);
const EX = JSON.parse(readFileSync(path.join(root, 'timeline', 'example.json'), 'utf8'));
const SCHEMA = JSON.parse(readFileSync(path.join(root, 'timeline', 'timeline.schema.json'), 'utf8'));
const ex = () => JSON.parse(JSON.stringify(EX));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

const run = (ops) => { const { ops: clean } = T.sanitize(ex(), ops); const neu = T.normalize(T.jsonPatch(ex(), clean)); return { clean, neu, p: T.plan(ex(), neu), errs: T.validate(neu, SCHEMA) }; };

test('example validates', () => assert.deepEqual(T.validate(ex(), SCHEMA), []));
test('swap scene 3 -> repaint only scene 3', () => {
  const { p, errs } = run([{ op: 'replace', path: '/tracks/visuals/@v3/gen/prompt', value: 'a rocket launch at dawn' }]);
  assert.deepEqual(errs, []); assert.deepEqual(p.repaint, ['v3']); assert.deepEqual(p.revoice, []); assert.equal(p.retime, false);
});
test('rewrite ending -> re-voice one line', () => {
  const { p } = run([{ op: 'replace', path: '/tracks/visuals/@v4/narration', value: 'So the country switched to dollars.' }]);
  assert.deepEqual(p.revoice, ['v4']); assert.deepEqual(p.repaint, []); assert.ok(p.retime);
});
test('cut scene 2 -> nothing re-made, retimed', () => {
  const { p, neu } = run([{ op: 'remove', path: '/tracks/visuals/@v2' }]);
  assert.deepEqual(p.diff.removed, ['v2']); assert.deepEqual(p.revoice, []); assert.equal(neu.tracks.visuals.length, 3);
  assert.match(T.planText(ex(), neu, p), /Cut scene 2/);
});
test('bigger yellow captions: replace on a missing key becomes add', () => {
  const { clean, p, errs } = run([{ op: 'replace', path: '/style/caption/size', value: 120 }, { op: 'replace', path: '/style/caption/color', value: '#FFD43B' }]);
  assert.deepEqual(errs, []); assert.equal(clean[0].op, 'add'); assert.deepEqual(p.diff.style, ['caption']); assert.deepEqual([p.revoice, p.repaint], [[], []]);
});
test('merge into a missing object becomes add', () => {
  const { neu, clean } = run([{ op: 'merge', path: '/style/title', value: { show: false } }]);
  assert.equal(clean[0].op, 'add'); assert.equal(neu.style.title.show, false);
});
test('make it 16:9', () => {
  const { p, errs } = run([{ op: 'replace', path: '/canvas', value: { width: 1920, height: 1080, fps: 30 } }]);
  assert.deepEqual(errs, []); assert.equal(p.diff.canvas, '1920x1080'); assert.deepEqual(p.repaint, []);
});
test('change the music', () => {
  const { neu, p } = run([{ op: 'replace', path: '/tracks/music/@m1/gen/name', value: 'tech-pulse' }]);
  assert.equal(neu.tracks.music[0].src, 'library/music/clips/tech-pulse.mp3'); assert.ok(p.diff.music);
});
test('slower pacing re-voices all lines', () => {
  const { p } = run([{ op: 'replace', path: '/tracks/voice/@vo/gen/rate', value: '-10%' }]);
  assert.deepEqual(p.revoice, ['v1', 'v2', 'v3', 'v4']);
});
test('add a scene: id, recipe, plan', () => {
  const { neu, p, errs } = run([{ op: 'add', path: '/tracks/visuals/2', value: { kind: 'image', narration: 'Bakeries changed prices twice a day.', gen: { tool: 'flux', prompt: 'chalk price board' } } }]);
  assert.deepEqual(errs, []); assert.equal(neu.tracks.visuals[2].id, 'v5'); assert.deepEqual(p.repaint, ['v5']); assert.deepEqual(p.revoice, ['v5']);
});
test('graphic -> image swap', () => {
  const { neu, p, errs } = run([{ op: 'merge', path: '/tracks/visuals/@v2', value: { kind: 'image', gen: { tool: 'flux', prompt: 'a market stall' } } }, { op: 'remove', path: '/tracks/visuals/@v2/graphic' }]);
  assert.deepEqual(errs, []); assert.equal(neu.tracks.visuals[1].kind, 'image'); assert.deepEqual(p.repaint, ['v2']);
});
test('locked fields are dropped', () => {
  const { clean } = run([{ op: 'replace', path: '/tracks/visuals/@v1/hash', value: 'x' }, { op: 'replace', path: '/rev', value: 99 }, { op: 'replace', path: '/tracks/captions/words', value: [] }]);
  assert.equal(clean.length, 0);
});
test('schema catches bad values', () => {
  const { errs } = run([{ op: 'merge', path: '/style/caption', value: { preset: 'sparkly' } }]);
  assert.ok(errs.some((e) => /caption\/preset/.test(e)));
  assert.throws(() => run([{ op: 'replace', path: '/tracks/visuals/@v9/narration', value: 'x' }]), /no clip with id v9/);
});
test('scenes numbered 1..N', () => {
  const sc = T.scenes(ex()); assert.deepEqual(sc.map((x) => x.n), [1, 2, 3, 4]); assert.equal(sc[1].kind, 'graphic');
  assert.match(T.editorView(ex()), /3\. @v3 \[image\]/);
});
test('versions and undo chain', () => {
  const log = [{ rev: 1, message: 'first build' }, { rev: 2, message: 'test edit' }, { rev: 3, message: 'rebuilt vo, v3' },
    { rev: 4, message: 'bigger captions', edit_id: 'a', kind: 'edit' }, { rev: 5, message: 'Undo', edit_id: 'b', kind: 'revert', revert_to: 3 }];
  const vs = T.versions(log);
  assert.deepEqual(vs.map((v) => v.rev), [1, 3, 4, 5]);
  assert.equal(T.undoTarget(vs).rev, 1, 'undo after an undo keeps going back');
  assert.equal(T.undoTarget(vs.slice(0, 3)).rev, 3);
  assert.equal(T.undoTarget(T.versions([{ rev: 1, message: 'x' }, { rev: 6, message: 'revert to r1' }])), null);
});

// Parity: the renderer (python) must produce the same timeline from the bot's sanitised patch.
const parity = [
  [{ op: 'replace', path: '/tracks/visuals/@v3/gen/prompt', value: 'a rocket launch' }, { op: 'remove', path: '/tracks/visuals/@v2' }],
  [{ op: 'add', path: '/style/caption/size', value: 120 }, { op: 'move', from: '/tracks/visuals/@v4', path: '/tracks/visuals/0' }],
  [{ op: 'add', path: '/tracks/visuals/-', value: { kind: 'image', narration: 'One more line.', gen: { tool: 'flux', prompt: 'x' } } }],
];
try { execFileSync('python3', ['-c', 'print(1)']); } catch (e) { console.log('python3 missing: parity skipped'); process.exit(0); }
const strip = (t) => { const c = JSON.parse(JSON.stringify(t)); for (const v of c.tracks.visuals) delete v.dirty; for (const v of c.tracks.voice) { delete v.dirty; delete v.segments; delete v.gen.text; } delete c.meta.format; return c; };
for (const ops of parity) {
  const { neu } = run(ops);
  const py = JSON.parse(execFileSync('python3', ['-c', `import sys,json;sys.path.insert(0,'tools');import timeline as TL
t=json.load(open('timeline/example.json'));new,_=TL.apply_patch(t,json.loads(sys.argv[1]));print(json.dumps(new))`, JSON.stringify(T.sanitize(ex(), ops).ops)], { cwd: root }).toString());
  assert.deepEqual(strip(py), strip(neu));
  n++; console.log('ok parity', ops.map((o) => o.op).join('+'));
}
console.log(`\n${n} passed`);
