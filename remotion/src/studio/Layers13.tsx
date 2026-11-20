// Layers13.tsx: transfer-progress kit. A file card: the name and size, a progress bar that fills (resuming from the last target), a percentage, a completion check.
// Steps: file{text,size?}, progress{to,dur}, done{text}, hold{dur}. All text and numbers come from the writer. Colours come from the theme.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; text?: string; size?: string; to?: number; dur?: number };
type Planned = Step & { start: number; end: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

function planTransfer(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 6)) {
    const d = s.type === 'file' ? 0.5 : s.type === 'progress' ? (s.dur ?? 1.5) : s.type === 'done' ? 0.8 : s.type === 'hold' ? (s.dur ?? 0.6) : 0;
    if (!d) continue;
    out.push({ ...s, start: t, end: t + d });
    t += d + 0.2;
  }
  return out;
}

export const TransferProgress: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const plan = planTransfer(a.steps);
  if (!plan.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#14141c');
  const ink = hex(theme && theme.text, '#ffffff');
  const acc = hex(accent, '#4f8cff');
  const u = L.u;
  const w = L.w * 0.88;
  const cy = (typeof a.y === 'number' ? a.y : 0.46) * L.h;
  const pop = OUT(interpolate(frame, [0, 10], [0, 1], CL));
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const files = plan.filter((s) => s.type === 'file' && t >= s.start);
  const file = files.length ? files[files.length - 1] : undefined;
  let value = 0;
  let prev = 0;
  for (const s of plan) {
    if (s.type !== 'progress' || t < s.start) continue;
    const to = Math.max(0, Math.min(100, s.to ?? 0));
    value = prev + (to - prev) * OUT(interpolate(t, [s.start, s.end], [0, 1], CL));
    prev = to;
  }
  const done = plan.find((s) => s.type === 'done' && t >= s.start);
  const doneP = done ? OUT(interpolate(t, [done.start, done.start + 0.6], [0, 1], CL)) : 0;
  const shown = done ? Math.max(value, 100) : value;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{
        position: 'absolute', left: (L.w - w) / 2, top: cy, width: w, transform: `translateY(-50%) scale(${0.94 + 0.06 * pop})`, opacity: pop,
        boxSizing: 'border-box', padding: `${36 * u}px ${38 * u}px`, borderRadius: 34 * u, background: `${surface}f2`,
        border: `${1.5 * u}px solid ${ink}22`, boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5)`, fontFamily: fam(font), color: ink,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 * u, marginBottom: 30 * u, opacity: file ? OUT(interpolate(t, [file.start, file.start + 0.4], [0, 1], CL)) : 0 }}>
          <div style={{ width: 92 * u, height: 92 * u, borderRadius: 24 * u, background: acc, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52 * u, fontWeight: 900, flex: 'none' }}>{'\u2193'}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 40 * u, fontWeight: 800, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file ? file.text : ''}</div>
            <div style={{ fontSize: 30 * u, opacity: 0.65, marginTop: 4 * u }}>{file && file.size ? file.size : ''}</div>
          </div>
        </div>
        <div style={{ height: 26 * u, borderRadius: 13 * u, background: `${ink}1a`, overflow: 'hidden' }}>
          <div style={{ width: `${shown}%`, height: '100%', borderRadius: 13 * u, background: acc }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 * u, minHeight: 80 * u }}>
          <div style={{ fontSize: 34 * u, fontWeight: 700, opacity: done ? doneP : 0.7 }}>{done ? done.text : ''}</div>
          {done ? (
            <svg viewBox="0 0 100 100" style={{ width: 80 * u, height: 80 * u, flex: 'none' }}>
              <circle cx="50" cy="50" r="44" fill="none" stroke={acc} strokeWidth="7" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - doneP} strokeLinecap="round" />
              <path d="M28 52 L44 68 L74 34" fill="none" stroke={acc} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" pathLength={1}
                strokeDasharray="1 1" strokeDashoffset={1 - Math.max(0, (doneP - 0.4) / 0.6)} />
            </svg>
          ) : (
            <div style={{ fontSize: 64 * u, fontWeight: 900, color: acc }}>{Math.round(shown) + '%'}</div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
