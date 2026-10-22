// QA frames for project timelines: bundles once, renders chosen moments of one or more timelines
// with the universal "Studio" composition (any canvas size). Handy before sending a video.
//   node scripts/timeline-frames.mjs ../media/projects/<id>/timeline.json [more.json ...] --at=1,4.5,9 --scale=0.4
// Writes out/qa/<id>-<w>x<h>-<sec>s.jpg
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const AT = opt('at', '1').split(',').map(Number);
const SCALE = Number(opt('scale', '0.4'));
if (!files.length) { console.error('usage: node scripts/timeline-frames.mjs <timeline.json> ... [--at=1,4.5] [--scale=0.4]'); process.exit(1); }

const outDir = path.join(root, 'out', 'qa');
mkdirSync(outDir, { recursive: true });
console.log('bundling...');
const serveUrl = await bundle({ entryPoint: path.join(root, 'src', 'studio-index.ts'), publicDir: path.join(root, '..', 'media') });
for (const f of files) {
  const t = JSON.parse(readFileSync(f, 'utf8'));
  const composition = await selectComposition({ serveUrl, id: 'Studio', inputProps: t });
  for (const s of AT) {
    const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(s * composition.fps)));
    const name = files.length > 1 ? path.basename(f, '.json') : t.id;
    const out = path.join(outDir, `${name}-${composition.width}x${composition.height}-${s}s.jpg`);
    await renderStill({ serveUrl, composition, inputProps: t, output: out, frame, scale: SCALE, overwrite: true, imageFormat: 'jpeg', jpegQuality: 85 });
    console.log('  ->', path.relative(root, out));
  }
}
console.log('done');
