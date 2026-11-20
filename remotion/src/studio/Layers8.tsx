// Layers8.tsx: notification-stack kit. Phone-style banners slide in from the top one after another; older ones slide down and fade.
// Steps: note{title,text}, hold{dur}. Colours come from the theme.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; title?: string; text?: string; dur?: number };
type Planned = Step & { start: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const SPRING = Easing.bezier(0.34, 1.4, 0.64, 1);
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

function planStack(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 8)) {
    if (s.type === 'note') { out.push({ ...s, start: t }); t += 0.7 + 0.2; }
    else if (s.type === 'hold') t += (s.dur ?? 0.6) + 0.2;
  }
  return out;
}

export const NotificationStack: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const notes = planStack(a.steps);
  if (!notes.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#1c1c24');
  const ink = hex(theme && theme.text, '#ffffff');
  const acc = hex(accent, '#4f8cff');
  const u = L.u;
  const bh = 132 * u;
  const gap = 18 * u;
  const w = L.w * 0.9;
  const top = (typeof a.y === 'number' ? a.y : 0.13) * L.h;
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const prog = notes.map((n) => SPRING(interpolate(t, [n.start, n.start + 0.45], [0, 1], CL)));
  const arrived = notes.map((n) => t >= n.start);
  const items = notes.map((n, i) => {
    let age = 0;
    for (let j = i + 1; j < notes.length; j++) if (arrived[j]) age += prog[j];
    return { n, i, age };
  }).filter((x) => arrived[x.i] && x.age < 4.2);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {items.map(({ n, i, age }) => (
        <div key={i} style={{
          position: 'absolute', left: (L.w - w) / 2, top: top + age * (bh + gap) - (1 - prog[i]) * (bh + 70 * u), width: w, height: bh,
          transform: `scale(${1 - 0.035 * age})`, transformOrigin: '50% 0%', opacity: Math.max(0, 1 - 0.24 * age) * Math.min(1, prog[i] * 1.6),
          display: 'flex', alignItems: 'center', gap: 22 * u, padding: `0 ${26 * u}px`, boxSizing: 'border-box',
          borderRadius: 34 * u, background: `${surface}ee`, border: `${1.5 * u}px solid ${ink}22`, boxShadow: `0 ${14 * u}px ${36 * u}px rgba(0,0,0,0.45)`,
          fontFamily: fam(font), color: ink,
        }}>
          <div style={{ width: 76 * u, height: 76 * u, borderRadius: 20 * u, background: acc, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 * u, fontWeight: 800, color: '#fff', flex: 'none' }}>
            {(n.title || n.text || '?').trim().charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 30 * u, fontWeight: 800, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</div>
            <div style={{ fontSize: 27 * u, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.text}</div>
          </div>
        </div>
      ))}
    </AbsoluteFill>
  );
};
