// Layers12.tsx: alert-glitch kit. A warning panel appears, then glitches: colour-split ghosts, jitter and flicker.
// Steps: alert{title,text}, glitch{dur}, hold{dur}. All text comes from the writer. The panel colour is the style accent. No random calls: the glitch is a pure function of the frame.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; title?: string; text?: string; dur?: number };
type Planned = Step & { start: number; end: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function planGlitch(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 6)) {
    const d = s.type === 'alert' ? 0.8 : s.type === 'glitch' ? (s.dur ?? 0.7) : s.type === 'hold' ? (s.dur ?? 0.6) : 0;
    if (!d) continue;
    out.push({ ...s, start: t, end: t + d });
    t += d + 0.2;
  }
  return out;
}

export const AlertGlitch: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const plan = planGlitch(a.steps);
  if (!plan.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#14141c');
  const ink = hex(theme && theme.text, '#ffffff');
  const acc = hex(accent, '#ff3b30');
  const u = L.u;
  const w = L.w * 0.86;
  const cy = (typeof a.y === 'number' ? a.y : 0.46) * L.h;
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const alerts = plan.filter((s) => s.type === 'alert' && t >= s.start);
  const al = alerts.length ? alerts[alerts.length - 1] : undefined;
  if (!al) return null;
  const pop = OUT(interpolate(t, [al.start, al.start + 0.3], [0, 1], CL));
  const inGlitch = plan.some((s) => s.type === 'glitch' && t >= s.start && t < s.end);
  const g = inGlitch ? 1 : t - al.start < 0.25 ? 0.6 : 0;
  const k = Math.floor(frame / 2);
  const dx = g * (hash(k) - 0.5) * 46 * u;
  const dy = g * (hash(k + 50) - 0.5) * 12 * u;
  const flick = g > 0 && hash(k + 99) > 0.8 ? 0.55 : 1;
  const panel = (key: string, x: number, y: number, col: string, op: number, solid: boolean) => (
    <div key={key} style={{
      position: 'absolute', left: (L.w - w) / 2 + x, top: cy + y, width: w, transform: `translateY(-50%) scale(${0.92 + 0.08 * pop})`, opacity: op * pop,
      boxSizing: 'border-box', padding: `${34 * u}px ${38 * u}px`, borderRadius: 26 * u, fontFamily: fam(font), color: solid ? ink : col,
      background: solid ? `${surface}f2` : 'transparent', border: `${4 * u}px solid ${solid ? acc : col}`, mixBlendMode: solid ? 'normal' : 'screen',
      boxShadow: solid ? `0 0 ${50 * u}px ${acc}66` : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 * u, marginBottom: 14 * u }}>
        <div style={{ width: 60 * u, height: 60 * u, borderRadius: '50%', background: solid ? acc : 'transparent', border: solid ? undefined : `${4 * u}px solid ${col}`, color: solid ? '#0b0b10' : col,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42 * u, fontWeight: 900, flex: 'none' }}>!</div>
        <div style={{ fontSize: 48 * u, fontWeight: 900, lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{al.title}</div>
      </div>
      <div style={{ fontSize: 34 * u, lineHeight: 1.35, opacity: 0.9 }}>{al.text}</div>
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {g > 0 ? panel('r', dx * 1.6, dy, '#ff2d55', 0.7, false) : null}
      {g > 0 ? panel('c', -dx * 1.6, -dy, '#00e5ff', 0.7, false) : null}
      {panel('m', dx * 0.4, dy * 0.4, acc, flick, true)}
      {g > 0 ? <div style={{ position: 'absolute', left: 0, right: 0, top: `${hash(k + 7) * 100}%`, height: 10 * u, background: `${ink}22` }} /> : null}
    </AbsoluteFill>
  );
};
