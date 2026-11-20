// Layers10.tsx: browser-page-load kit. A browser window: the address types, a progress bar fills, then the page content appears.
// Steps: url{text}, load{dur}, page{title,text}, hold{dur}. Colours come from the theme.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; text?: string; title?: string; dur?: number };
type Planned = Step & { start: number; end: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const CPS = 25;
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

function planPage(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 6)) {
    let d = 0;
    if (s.type === 'url') d = 0.4 + (s.text || '').length / CPS;
    else if (s.type === 'load') d = s.dur ?? 1.2;
    else if (s.type === 'page') d = 0.8;
    else if (s.type === 'hold') d = s.dur ?? 0.6;
    else continue;
    out.push({ ...s, start: t, end: t + d });
    t += d + 0.2;
  }
  return out;
}

export const BrowserPageLoad: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const plan = planPage(a.steps);
  if (!plan.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#14141c');
  const ink = hex(theme && theme.text, '#ffffff');
  const acc = hex(accent, '#4f8cff');
  const u = L.u;
  const w = L.w * 0.9;
  const cy = (typeof a.y === 'number' ? a.y : 0.46) * L.h;
  const pop = OUT(interpolate(frame, [0, 10], [0, 1], CL));
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const started = (type: string) => plan.filter((s) => s.type === type && t >= s.start);
  const us = started('url');
  const ul = us.length ? us[us.length - 1] : undefined;
  let urlText = '';
  if (ul) urlText = (ul.text || '').slice(0, Math.max(0, Math.floor((t - ul.start - 0.1) * CPS)));
  const ls = started('load');
  const ll = ls.length ? ls[ls.length - 1] : undefined;
  const pr = ll ? OUT(interpolate(t, [ll.start, ll.end], [0, 1], CL)) : 0;
  const barOp = ll ? interpolate(t, [ll.end, ll.end + 0.25], [1, 0], CL) : 0;
  const ps = started('page');
  const pl = ps.length ? ps[ps.length - 1] : undefined;
  const pageOp = pl ? interpolate(t, [pl.start, pl.start + 0.5], [0, 1], CL) : 0;
  const pulse = 0.35 + 0.15 * Math.sin(t * 5);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{
        position: 'absolute', left: (L.w - w) / 2, top: cy, width: w, transform: `translateY(-50%) scale(${0.94 + 0.06 * pop})`, opacity: pop,
        borderRadius: 28 * u, overflow: 'hidden', background: surface, border: `${1.5 * u}px solid ${ink}22`,
        boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5)`, fontFamily: fam(font), color: ink,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * u, padding: `${18 * u}px ${24 * u}px`, background: `${ink}12` }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: '50%', background: c, flex: 'none' }} />)}
          <div style={{ flex: 1, minWidth: 0, height: 52 * u, borderRadius: 26 * u, background: `${ink}18`, display: 'flex', alignItems: 'center', padding: `0 ${22 * u}px`, fontSize: 27 * u, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span style={{ opacity: 0.55, marginRight: 10 * u }}>{'\uD83D\uDD12'}</span>{urlText}
          </div>
        </div>
        <div style={{ height: 6 * u, background: `${ink}10` }}>
          <div style={{ width: `${pr * 100}%`, height: '100%', background: acc, opacity: barOp }} />
        </div>
        <div style={{ position: 'relative', minHeight: 480 * u, padding: `${40 * u}px ${38 * u}px`, boxSizing: 'border-box' }}>
          {!pl ? (
            <div>
              {[0.7, 1, 0.85].map((x, i) => <div key={i} style={{ width: `${x * 100}%`, height: 34 * u, borderRadius: 12 * u, background: ink, opacity: pulse * (ll ? 1 : 0.5), marginBottom: 24 * u }} />)}
            </div>
          ) : (
            <div style={{ opacity: pageOp, transform: `translateY(${(1 - pageOp) * 18 * u}px)` }}>
              <div style={{ fontSize: 58 * u, fontWeight: 900, lineHeight: 1.1, color: acc, marginBottom: 20 * u }}>{pl.title}</div>
              <div style={{ fontSize: 34 * u, lineHeight: 1.4, opacity: 0.85 }}>{pl.text}</div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
