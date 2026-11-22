// desk-math.ts: pure helpers for the desk scene (no React). Calculator key presses and mouth shapes from the voice level.
import type { Mouth } from './rig';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const SYM: Record<string, string> = { '+': '+', '-': '-', '*': 'x', '/': '/' };
const apply = (a: number, op: string, b: number) => (op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? (b === 0 ? NaN : a / b) : b);
const fmt = (x: number) => (Number.isFinite(x) ? String(parseFloat(x.toFixed(4))) : 'ERR');

/** What a calculator shows after `f` (0..1) of the key presses in `keys` (e.g. "64340-64100="), and which key is being pressed. */
export function calcView(keys: string, f: number): { line: string; big: string; pressed: string } {
  const n = keys.length;
  if (!n) return { line: '', big: '0', pressed: '' };
  const pos = clamp(f, 0, 1) * n;
  const k = Math.min(n, Math.floor(pos + 1e-9));
  let acc: number | null = null, op = '', entry = '', line = '', result: string | null = null;
  for (const ch of keys.slice(0, k)) {
    if (/[0-9.]/.test(ch)) {
      if (result !== null) { acc = null; op = ''; line = ''; result = null; entry = ''; }
      entry += ch; line += ch;
    } else if (SYM[ch]) {
      if (entry !== '') acc = acc === null || op === '' ? parseFloat(entry) : apply(acc, op, parseFloat(entry));
      entry = ''; op = ch; line += SYM[ch]; result = null;
    } else if (ch === '=') {
      if (entry !== '' && op !== '' && acc !== null) acc = apply(acc, op, parseFloat(entry));
      result = acc === null ? (entry || '0') : fmt(acc); entry = ''; op = '';
    }
  }
  const big = result !== null ? result : entry !== '' ? entry : acc !== null ? fmt(acc) : '0';
  const pressed = k >= 1 && k <= n && pos - Math.floor(pos + 1e-9) < 0.5 ? keys[k - 1] : '';
  return { line, big, pressed };
}

/** One digit per 1/12 s (0 silent .. 9 loud), made from the voice file. Returns the mouth to draw, or the pose's own mouth. */
export function mouthFor(talk: string | undefined, t: number, fallback: Mouth): Mouth {
  if (!talk) return fallback;
  const c = talk.charAt(Math.min(talk.length - 1, Math.max(0, Math.floor(t * 12))));
  const v = parseInt(c, 10);
  if (isNaN(v)) return fallback;
  return v === 0 ? 'flat' : v <= 3 ? 'o' : v <= 6 ? 'open' : 'grin';
}
