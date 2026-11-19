// Layers5.tsx: glass-ui kit. Frosted "liquid glass" controls: a now-playing pill, a tab bar and a round search button.
// Steps: pill{text,sub}, tab{to:0-3}, search{text}, hold{dur}. Frost = backdrop blur + bright edge + soft highlight.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';
import { makeTheme, rgba } from './theme';
import type { Theme } from './theme';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; pid: string; palette: string[]; font?: string; grade?: string; theme?: Theme };
type Step = { type: string; text?: string; sub?: string; to?: number; dur?: number };
type Planned = Step & { start: number; end: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const SPRING = Easing.bezier(0.34, 1.4, 0.64, 1);
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const c01 = (n: number) => Math.max(0, Math.min(1, n));
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');
const TABS = ['Home', 'New', 'Radio', 'Library'];

function planGlass(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 10)) {
    if (!['pill', 'tab', 'search', 'hold'].includes(s.type)) continue;
    const dur = s.type === 'search' ? 0.5 + (s.text || '').length / 18 : s.type === 'hold' ? s.dur ?? 0.6 : 0.8;
    out.push({ ...s, start: t, end: t + dur });
    t += dur + 0.15;
  }
  return out;
}

export const GlassUI: React.FC<P> = ({ l, L, accent, font, theme }) => {
  const th = theme || makeTheme({ accent });
  const f = useCurrentFrame();
  const { fps, durationInFrames: d } = useVideoConfig();
  const ft = f / fps;
  const u = L.u;
  const edge = Math.max(1, Math.min(8, Math.floor(d / 3)));
  const env = interpolate(f, [0, edge, d - edge, d], [0, 1, 1, 0], CL);
  const plan = planGlass((l as any).steps);
  const fullW = L.w * 0.86;
  const left = (L.w - fullW) / 2;
  const blur = `blur(${22 * u}px) saturate(1.7)`;
  const glass = (r: number): React.CSSProperties => ({
    background: `linear-gradient(135deg, ${rgba('#ffffff', 0.24)}, ${rgba('#ffffff', 0.06)})`,
    backdropFilter: blur, WebkitBackdropFilter: blur,
    border: `${Math.max(1, 1.5 * u)}px solid ${rgba('#ffffff', 0.4)}`, borderRadius: r, boxSizing: 'border-box',
    boxShadow: `inset 0 ${2 * u}px ${3 * u}px ${rgba('#ffffff', 0.45)}, inset 0 ${-3 * u}px ${8 * u}px ${rgba(th.accent, 0.2)}, 0 ${18 * u}px ${44 * u}px rgba(0,0,0,0.35)`,
  });
  const txt: React.CSSProperties = { fontFamily: fam(font), color: '#ffffff', textShadow: `0 ${1 * u}px ${6 * u}px rgba(0,0,0,0.35)` };

  const pill = plan.find((s) => s.type === 'pill');
  const pa = pill ? SPRING(c01((ft - pill.start) / 0.7)) : 0;
  const tabs = plan.filter((s) => s.type === 'tab');
  const srch = plan.find((s) => s.type === 'search');
  const barStart = Math.min(...[...tabs, ...(srch ? [srch] : [])].map((s) => s.start), 1e9);
  const ba = barStart < 1e9 ? OUT(c01((ft - barStart) / 0.6)) : 0;
  let pos = 0;
  let prev = 0;
  for (const s of tabs) {
    if (ft < s.start) break;
    const to = Math.max(0, Math.min(3, s.to ?? 0));
    pos = prev + (to - prev) * OUT(c01((ft - s.start) / 0.5));
    prev = to;
  }
  const sp = srch ? OUT(c01((ft - srch.start) / 0.5)) : 0;
  const q = srch?.text || '';
  const typed = srch ? Math.floor(c01((ft - srch.start - 0.5) / Math.max(0.2, srch.end - srch.start - 0.5)) * q.length) : 0;
  const barTop = L.h * 0.8;
  const barH = 120 * u;
  const btn = 120 * u;
  const tabW = fullW - btn - 16 * u;
  const cell = tabW / 4;
  const pillW = L.w * 0.78;

  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{ position: 'absolute', left: -L.w * 0.1, top: L.h * 0.06, width: L.w * 0.7, height: L.w * 0.7, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(th.accent, 0.55)}, ${rgba(th.accent, 0)} 70%)`, opacity: 0.8 }} />
      <div style={{ position: 'absolute', right: -L.w * 0.15, top: L.h * 0.62, width: L.w * 0.75, height: L.w * 0.75, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(th.accent2, 0.5)}, ${rgba(th.accent2, 0)} 70%)`, opacity: 0.8 }} />
      {pill ? (
        <div style={{ ...glass(60 * u), position: 'absolute', left: (L.w - pillW) / 2, top: L.h * 0.14, width: pillW, height: 112 * u, display: 'flex', alignItems: 'center', gap: 20 * u, padding: `0 ${28 * u}px`, opacity: c01(pa), transform: `translateY(${(1 - pa) * -40 * u}px) scale(${0.7 + 0.3 * pa})` }}>
          <div style={{ width: 68 * u, height: 68 * u, borderRadius: 20 * u, background: `linear-gradient(135deg, ${th.accent}, ${th.accent2})`, flexShrink: 0 }} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ ...txt, fontWeight: 700, fontSize: 32 * u, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pill.text || 'Now Playing'}</div>
            <div style={{ ...txt, fontWeight: 500, fontSize: 24 * u, opacity: 0.75, whiteSpace: 'nowrap' }}>{pill.sub || 'Now playing'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 * u, height: 40 * u }}>
            {[0, 1, 2].map((k) => <span key={k} style={{ width: 7 * u, height: (10 + 26 * Math.abs(Math.sin(ft * 6 + k * 1.7))) * u, borderRadius: 4 * u, background: '#ffffff' }} />)}
          </div>
        </div>
      ) : null}
      {ba > 0 ? (
        <>
          <div style={{ ...glass(barH / 2), position: 'absolute', left, top: barTop, width: tabW, height: barH, opacity: ba * (1 - sp), transform: `translateY(${(1 - ba) * 60 * u}px)` }}>
            <div style={{ ...glass(barH / 2 - 8 * u), position: 'absolute', top: 8 * u, left: 8 * u + pos * cell, width: cell - 16 * u, height: barH - 16 * u, background: rgba('#ffffff', 0.28) }} />
            {TABS.map((t, k) => (
              <div key={t} style={{ ...txt, position: 'absolute', top: 0, left: k * cell, width: cell, height: barH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 26 * u, opacity: Math.abs(pos - k) < 0.5 ? 1 : 0.7 }}>{t}</div>
            ))}
          </div>
          <div style={{ ...glass(barH / 2), position: 'absolute', right: left, top: barTop, width: btn + (fullW - btn) * sp, height: barH, opacity: ba, transform: `translateY(${(1 - ba) * 60 * u}px)`, display: 'flex', alignItems: 'center', padding: `0 ${(btn - 40 * u) / 2}px`, gap: 18 * u }}>
            <svg width={40 * u} height={40 * u} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" style={{ flexShrink: 0 }}>
              <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
            </svg>
            {sp > 0.5 ? <div style={{ ...txt, fontWeight: 600, fontSize: 34 * u, whiteSpace: 'nowrap', overflow: 'hidden', opacity: c01((sp - 0.5) * 2) }}>{q.slice(0, typed)}<span style={{ display: 'inline-block', width: 3 * u, height: 38 * u, marginLeft: 3 * u, verticalAlign: 'middle', background: '#ffffff', opacity: Math.floor(f / (fps / 2)) % 2 === 0 ? 1 : 0 }} /></div> : null}
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
