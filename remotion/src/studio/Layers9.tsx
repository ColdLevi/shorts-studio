// Layers9.tsx: counter-graph kit. A big number counts up and a line graph draws under it.
// Steps: counter{value,from?,label?,prefix?,suffix?}, line{points[]}, hold{dur}. A later counter replaces an earlier one. Colours come from the theme.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; label?: string; value?: number; from?: number; prefix?: string; suffix?: string; points?: number[]; dur?: number };
type Planned = Step & { start: number; end: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

function planGraph(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 6)) {
    const d = s.type === 'counter' ? 1.4 : s.type === 'line' ? 1.6 : s.type === 'hold' ? (s.dur ?? 0.6) : 0;
    if (!d) continue;
    out.push({ ...s, start: t, end: t + d });
    t += d + 0.2;
  }
  return out;
}

export const CounterGraph: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const plan = planGraph(a.steps);
  if (!plan.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#14141c');
  const ink = hex(theme && theme.text, '#ffffff');
  const acc = hex(accent, '#4ade80');
  const u = L.u;
  const w = L.w * 0.88;
  const cy = (typeof a.y === 'number' ? a.y : 0.45) * L.h;
  const pop = OUT(interpolate(frame, [0, 10], [0, 1], CL));
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const counters = plan.filter((s) => s.type === 'counter' && t >= s.start);
  const cs = counters.length ? counters[counters.length - 1] : undefined;
  const lines = plan.filter((s) => s.type === 'line' && t >= s.start);
  const ls = lines.length ? lines[lines.length - 1] : undefined;
  let numText = '';
  if (cs) {
    const from = cs.from ?? 0;
    const to = cs.value ?? 0;
    const v = from + (to - from) * OUT(interpolate(t, [cs.start, cs.end], [0, 1], CL));
    const whole = Number.isInteger(to) && Number.isInteger(from);
    numText = (cs.prefix || '') + (whole ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + (cs.suffix || '');
  }
  const W = 1000, H = 360, pad = 24;
  let path = '';
  let head: number[] | null = null;
  let pl = 0;
  if (ls && ls.points && ls.points.length >= 2) {
    const pts = ls.points;
    const lo = Math.min(...pts), hi = Math.max(...pts);
    const span = hi - lo || 1;
    const xy = pts.map((p, i) => [pad + ((W - 2 * pad) * i) / (pts.length - 1), pad + (H - 2 * pad) * (1 - (p - lo) / span)]);
    path = 'M' + xy.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    pl = OUT(interpolate(t, [ls.start, ls.end], [0, 1], CL));
    const idx = pl * (pts.length - 1);
    const i0 = Math.min(pts.length - 1, Math.floor(idx));
    const i1 = Math.min(pts.length - 1, i0 + 1);
    const fr = idx - i0;
    head = [xy[i0][0] + (xy[i1][0] - xy[i0][0]) * fr, xy[i0][1] + (xy[i1][1] - xy[i0][1]) * fr];
  }
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{
        position: 'absolute', left: (L.w - w) / 2, top: cy, width: w, transform: `translateY(-50%) scale(${0.94 + 0.06 * pop})`, opacity: pop,
        boxSizing: 'border-box', padding: `${34 * u}px ${38 * u}px`, borderRadius: 34 * u, background: `${surface}f2`,
        border: `${1.5 * u}px solid ${ink}22`, boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5)`, fontFamily: fam(font), color: ink,
      }}>
        {cs && cs.label ? <div style={{ fontSize: 32 * u, fontWeight: 700, opacity: 0.75, marginBottom: 6 * u }}>{cs.label}</div> : null}
        {cs ? <div style={{ fontSize: 150 * u, fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.02em', color: acc }}>{numText}</div> : null}
        {path ? (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 20 * u, display: 'block', overflow: 'visible' }}>
            <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke={ink} strokeOpacity={0.18} strokeWidth={3} />
            <path d={path} pathLength={1} fill="none" stroke={acc} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="1 1" strokeDashoffset={1 - pl} />
            {head && pl > 0.02 ? <circle cx={head[0]} cy={head[1]} r={15} fill={acc} stroke={surface} strokeWidth={5} /> : null}
          </svg>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
