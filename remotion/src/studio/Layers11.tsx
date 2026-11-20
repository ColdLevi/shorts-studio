// Layers11.tsx: checkout kit. A payment panel: item rows slide in, the total appears, the pay button is pressed, a success check draws.
// Steps: item{text,price?}, total{text,price}, pay{text}, done{text}, hold{dur}. All text comes from the writer. Colours come from the theme.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; text?: string; price?: string; dur?: number };
type Planned = Step & { start: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const DUR: Record<string, number> = { item: 0.5, total: 0.6, pay: 0.9, done: 1.0 };
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

function planCheckout(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 8)) {
    const d = s.type === 'hold' ? (s.dur ?? 0.6) : DUR[s.type];
    if (!d) continue;
    out.push({ ...s, start: t });
    t += d + 0.2;
  }
  return out;
}

export const CheckoutKit: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const plan = planCheckout(a.steps);
  if (!plan.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#14141c');
  const ink = hex(theme && theme.text, '#ffffff');
  const acc = hex(accent, '#4ade80');
  const u = L.u;
  const w = L.w * 0.88;
  const cy = (typeof a.y === 'number' ? a.y : 0.46) * L.h;
  const pop = OUT(interpolate(frame, [0, 10], [0, 1], CL));
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const items = plan.filter((s) => s.type === 'item' && t >= s.start);
  const totals = plan.filter((s) => s.type === 'total' && t >= s.start);
  const tot = totals.length ? totals[totals.length - 1] : undefined;
  const pay = plan.find((s) => s.type === 'pay' && t >= s.start);
  const done = plan.find((s) => s.type === 'done' && t >= s.start);
  const press = pay ? interpolate(t, [pay.start + 0.35, pay.start + 0.5, pay.start + 0.75], [0, 1, 0], CL) : 0;
  const doneP = done ? OUT(interpolate(t, [done.start, done.start + 0.6], [0, 1], CL)) : 0;
  const row = (key: string, label: string, price: string | undefined, p: number, big?: boolean) => (
    <div key={key} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 20 * u, marginBottom: 20 * u,
      opacity: p, transform: `translateX(${(1 - p) * 60 * u}px)`, fontSize: (big ? 44 : 34) * u, fontWeight: big ? 900 : 600,
    }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: big ? acc : ink, flex: 'none' }}>{price}</span>
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{
        position: 'absolute', left: (L.w - w) / 2, top: cy, width: w, transform: `translateY(-50%) scale(${0.94 + 0.06 * pop})`, opacity: pop,
        boxSizing: 'border-box', padding: `${36 * u}px ${38 * u}px`, borderRadius: 34 * u, background: `${surface}f2`, overflow: 'hidden',
        border: `${1.5 * u}px solid ${ink}22`, boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5)`, fontFamily: fam(font), color: ink,
      }}>
        <div style={{ minHeight: 300 * u }}>
          {items.map((s, i) => row('i' + i, s.text || '', s.price, OUT(interpolate(t, [s.start, s.start + 0.4], [0, 1], CL))))}
          {tot ? (
            <div>
              <div style={{ height: 2 * u, background: `${ink}22`, margin: `${6 * u}px 0 ${22 * u}px` }} />
              {row('t', tot.text || '', tot.price, OUT(interpolate(t, [tot.start, tot.start + 0.4], [0, 1], CL)), true)}
            </div>
          ) : null}
        </div>
        {pay ? (
          <div style={{
            marginTop: 12 * u, height: 104 * u, borderRadius: 26 * u, background: acc, color: '#0b0b10', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 42 * u, fontWeight: 900, transform: `scale(${1 - 0.06 * press})`, filter: `brightness(${1 - 0.18 * press})`,
            opacity: OUT(interpolate(t, [pay.start, pay.start + 0.3], [0, 1], CL)),
          }}>{pay.text}</div>
        ) : null}
        {done ? (
          <div style={{
            position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, background: surface, opacity: interpolate(t, [done.start, done.start + 0.3], [0, 1], CL),
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 * u,
          }}>
            <svg viewBox="0 0 100 100" style={{ width: 180 * u, height: 180 * u }}>
              <circle cx="50" cy="50" r="44" fill="none" stroke={acc} strokeWidth="6" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - doneP} strokeLinecap="round" />
              <path d="M28 52 L44 68 L74 34" fill="none" stroke={acc} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength={1}
                strokeDasharray="1 1" strokeDashoffset={1 - Math.max(0, (doneP - 0.4) / 0.6)} />
            </svg>
            <div style={{ fontSize: 44 * u, fontWeight: 900, textAlign: 'center', padding: `0 ${30 * u}px`, opacity: doneP }}>{done.text}</div>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
