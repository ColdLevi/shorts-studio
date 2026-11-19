// theme.ts: one colour theme per video. Every layer reads these tokens instead of its own hard-coded colours.
// Built from the style (accent, palette) or from a "theme" set on the style (for example by the script direction).
export type Theme = {
  accent: string; accent2: string; accent3: string;
  surface: string; surface2: string;
  text: string; onAccent: string; muted: string;
  soft: string; faint: string; line: string;
  mode: 'dark' | 'light';
};
type RGB = [number, number, number];
const parse = (c: string): RGB | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const rgba = (c: string, a: number) => {
  const p = parse(c);
  return p ? `rgba(${p[0]},${p[1]},${p[2]},${a})` : c;
};
const rgb2hsl = ([R, G, B]: RGB): [number, number, number] => {
  const r = R / 255, g = G / 255, b = B / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
const hsl2rgb = (h: number, s: number, l: number): RGB => {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hh / 60) % 6];
  return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
};
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c: string) => { const p = parse(c); return p ? 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]) : 0; };
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function makeTheme(i: { accent: string; palette?: string[] } & Partial<Theme>): Theme {
  const accent = i.accent;
  const pa = parse(accent);
  const hsl: [number, number, number] = pa ? rgb2hsl(pa) : [220, 0.2, 0.5];
  const shift = (d: number) => (pa ? toHex(hsl2rgb(hsl[0] + d, Math.max(hsl[1], 0.55), Math.min(0.62, Math.max(0.45, hsl[2])))) : accent);
  const pal = i.palette || [];
  const mode = i.mode || 'dark';
  const dark = mode === 'dark';
  const surface = i.surface || toHex(hsl2rgb(hsl[0], 0.3, dark ? 0.11 : 0.95));
  const surface2 = i.surface2 || toHex(hsl2rgb(hsl[0], 0.3, dark ? 0.07 : 0.9));
  let text = i.text || toHex(hsl2rgb(hsl[0], 0.25, dark ? 0.97 : 0.08));
  if (!i.text && contrast(text, surface) < 4.5) text = dark ? '#ffffff' : '#000000';
  const onAccent = i.onAccent || (contrast(accent, '#ffffff') >= contrast(accent, '#0b0f1a') ? '#ffffff' : '#0b0f1a');
  return {
    accent, accent2: i.accent2 || pal[1] || shift(35), accent3: i.accent3 || pal[2] || shift(75),
    surface, surface2, text, onAccent,
    muted: i.muted || rgba(text, 0.6), soft: i.soft || rgba(text, 0.12), faint: i.faint || rgba(text, 0.08), line: i.line || rgba(text, 0.14),
    mode,
  };
}

/** Plain-language problems with a theme (hard to read), for the director's report. */
export function themeWarnings(t: Theme): string[] {
  const w: string[] = [];
  if (contrast(t.text, t.surface) < 4.5) w.push('text is hard to read on the surface colour');
  if (contrast(t.accent, t.surface) < 3) w.push('the accent is hard to see on the surface colour');
  return w;
}
