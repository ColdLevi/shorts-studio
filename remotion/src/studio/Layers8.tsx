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
  const phone = String(a.frame || '') === 'phone';
  const u = L.u;
  const k = phone ? 0.68 : 1;
  const s = u * k;
  const bh = 132 * s;
  const gap = 18 * s;
  const pw = L.w * 0.64;
  const ph = Math.min(L.h * 0.78, pw * 2.05);
  const px = (L.w - pw) / 2;
  const py = (L.h - ph) / 2;
  const bz = 14 * u;
  const w = phone ? pw - 2 * bz - 24 * u : L.w * 0.9;
  const left0 = phone ? 12 * u : (L.w - w) / 2;
  const top = phone ? 96 * u : (typeof a.y === 'number' ? a.y : 0.13) * L.h;
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const prog = notes.map((n) => SPRING(interpolate(t, [n.start, n.start + 0.45], [0, 1], CL)));
  const arrived = notes.map((n) => t >= n.start);
  const items = notes.map((n, i) => {
    let age = 0;
    for (let j = i + 1; j < notes.length; j++) if (arrived[j]) age += prog[j];
    return { n, i, age };
  }).filter((x) => arrived[x.i] && x.age < 4.2);
  const cards = items.map(({ n, i, age }) => (
    <div key={i} style={{
      position: 'absolute', left: left0, top: top + age * (bh + gap) - (1 - prog[i]) * (bh + 70 * s), width: w, height: bh,
      transform: `scale(${1 - 0.035 * age})`, transformOrigin: '50% 0%', opacity: Math.max(0, 1 - 0.24 * age) * Math.min(1, prog[i] * 1.6),
      display: 'flex', alignItems: 'center', gap: 22 * s, padding: `0 ${26 * s}px`, boxSizing: 'border-box',
      borderRadius: 34 * s, background: `${surface}ee`, border: `${1.5 * u}px solid ${ink}22`, boxShadow: `0 ${14 * s}px ${36 * s}px rgba(0,0,0,0.45)`,
      fontFamily: fam(font), color: ink,
    }}>
      <div style={{ width: 76 * s, height: 76 * s, borderRadius: 20 * s, background: acc, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 * s, fontWeight: 800, color: '#fff', flex: 'none' }}>
        {(n.title || n.text || '?').trim().charAt(0).toUpperCase()}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 30 * s, fontWeight: 800, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</div>
        <div style={{ fontSize: 27 * s, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.text}</div>
      </div>
    </div>
  ));
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {phone && (
        <div style={{ position: 'absolute', left: px, top: py, width: pw, height: ph, borderRadius: 64 * u, background: '#0b0b10', border: `${bz}px solid #2a2a33`, boxSizing: 'border-box', boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.55)` }}>
          <div style={{ position: 'absolute', left: '50%', top: 14 * u, transform: 'translateX(-50%)', width: 120 * u, height: 30 * u, borderRadius: 20 * u, background: '#000' }} />
        </div>
      )}
      <div style={{ position: 'absolute', left: phone ? px + bz : 0, top: phone ? py + bz : 0, width: phone ? pw - 2 * bz : L.w, height: phone ? ph - 2 * bz : L.h, overflow: 'hidden', borderRadius: phone ? 50 * u : 0 }}>
        {cards}
      </div>
    </AbsoluteFill>
  );
};
