// Layers3.tsx: the data tier (step 6). Code-built graphics that carry the message, never a picture of it.
//   chapter-card  numbered chapter for listicles ("03  THE PAPER TRAIL / The dashboard told it first")
//   chart         a real bar chart: axis, gridlines, bars that grow, values that count up, the last bar in the accent
//   panel         a UI mockup: metric tiles, an alert card, a log stream (dashboards, "the system said...")
// Composition laws (skill 4.7): the data IS the message; it sits on a dark glass panel, arrives with the words, leaves with them.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; pid: string; palette: string[]; font?: string; grade?: string };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

const useEnv = (inF = 8, outF = 8) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const o = Math.max(1, Math.min(outF, Math.floor(d / 3)));
  return interpolate(f, [0, inF, d - o, d], [0, 1, 1, 0], CL);
};
const rise = (frame: number, fps: number, delay = 0, len = 0.5) => OUT(Math.min(1, Math.max(0, frame - delay * fps) / (len * fps)));

const Glass: React.FC<{ L: P['L']; style?: React.CSSProperties; children: React.ReactNode }> = ({ L, style, children }) => (
  <div style={{
    background: 'linear-gradient(160deg, rgba(20,26,42,0.9), rgba(10,13,24,0.88))', border: `${Math.max(1, L.u)}px solid rgba(255,255,255,0.09)`, borderRadius: 26 * L.u,
    boxShadow: `0 ${24 * L.u}px ${60 * L.u}px rgba(0,0,0,0.5)`, backdropFilter: 'blur(6px)', ...style,
  }}>{children}</div>
);

export const ChapterCard: React.FC<P> = ({ l, L, accent, palette, font }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(5, 8);
  const num = String(l.n ?? '').padStart(2, '0').slice(-2);
  const title = (l.title || '').slice(0, 46);
  const a = rise(f, fps, 0, 0.5), b = rise(f, fps, 0.12, 0.5), c = rise(f, fps, 0.25, 0.55);
  const acc2 = palette[1] || '#7c3aed';
  const nsize = L.w * 0.2;
  const words = title.split(' ');
  const last = words.pop() || '';
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: L.h * 0.34, background: 'linear-gradient(180deg, rgba(5,7,14,0.78), rgba(5,7,14,0))' }} />
      <div style={{ position: 'absolute', left: L.w * 0.07, right: L.w * 0.07, top: L.h * 0.09, display: 'flex', alignItems: 'center', gap: L.w * 0.04 }}>
        <div style={{
          fontFamily: fam(font), fontWeight: 900, fontSize: nsize, lineHeight: 0.9, color: 'transparent', WebkitTextStroke: `${Math.max(3, 4 * L.u)}px ${accent}`,
          transform: `translateX(${(1 - a) * -60 * L.u}px)`, opacity: a, filter: `drop-shadow(0 0 ${22 * L.u}px ${accent}66)`,
        }}>{num}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: fam(font), fontWeight: 700, fontSize: L.w * 0.036, letterSpacing: L.w * 0.006, color: 'rgba(255,255,255,0.7)', opacity: b, transform: `translateY(${(1 - b) * 14 * L.u}px)` }}>CHAPTER {Number(l.n) || ''}</div>
          <div style={{ overflow: 'hidden', paddingBottom: L.w * 0.01 }}>
            <div style={{ fontFamily: fam(font), fontWeight: 900, fontSize: L.w * 0.066, lineHeight: 1.04, color: '#fff', transform: `translateY(${(1 - c) * 105}%)` }}>
              {words.join(' ')}{words.length ? ' ' : ''}
              <span style={{ background: `linear-gradient(120deg, ${accent}, ${acc2})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>{last}</span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const fmt = (v: number, unit: string) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'bn' : a >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'm' : a >= 1e4 ? Math.round(v / 1e3) + 'k' : a >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v * 10) / 10);
  return unit === '%' ? s + '%' : (unit || '') + s;
};

export const BarChart: React.FC<P> = ({ l, L, accent, palette }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(8, 8);
  const labels = (l.labels || []).slice(0, 6), values = (l.values || []).slice(0, 6);
  if (labels.length < 2 || labels.length !== values.length) return null;
  const unit = l.unit || '';
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const W = L.w * 0.88, H = L.h * 0.3;
  const pad = 22 * L.u, plotH = H - 70 * L.u;
  const bw = (W - pad * 2) / (values.length * 1.6);
  const acc2 = palette[1] || '#7c3aed';
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <Glass L={L} style={{ position: 'absolute', left: (L.w - W) / 2, top: L.h * 0.3, width: W, height: H + 56 * L.u, padding: pad, boxSizing: 'border-box' }}>
        <div style={{ fontFamily: MONO, fontSize: 22 * L.u, letterSpacing: 2 * L.u, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', marginBottom: 10 * L.u }}>{(l.title || '').slice(0, 40)}</div>
        <div style={{ position: 'relative', height: plotH + 30 * L.u }}>
          {[0, 1, 2, 3].map((k) => <div key={k} style={{ position: 'absolute', left: 0, right: 0, top: plotH * (k / 3), height: 1, background: 'rgba(255,255,255,0.07)' }} />)}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: plotH, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around' }}>
            {values.map((v, i) => {
              const g = rise(f, fps, 0.15 + i * 0.12, 0.7);
              const isLast = i === values.length - 1;
              return (
                <div key={i} style={{ width: bw, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30 * L.u, color: isLast ? '#fff' : 'rgba(255,255,255,0.78)', marginBottom: 6 * L.u, opacity: g }}>{fmt(v * g, unit)}</div>
                  <div style={{ width: '100%', height: Math.max(3, (Math.abs(v) / max) * (plotH - 34 * L.u) * g), borderRadius: 8 * L.u, background: isLast ? `linear-gradient(180deg, ${accent}, ${acc2})` : 'linear-gradient(180deg, #5C6780, #3A4359)', boxShadow: isLast ? `0 0 ${26 * L.u}px ${accent}77` : 'none' }} />
                </div>
              );
            })}
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: plotH + 8 * L.u, display: 'flex', justifyContent: 'space-around' }}>
            {labels.map((lb, i) => <div key={i} style={{ width: bw, textAlign: 'center', fontFamily: MONO, fontSize: 26 * L.u, color: i === labels.length - 1 ? '#fff' : 'rgba(255,255,255,0.5)'}}>{lb}</div>)}
          </div>
        </div>
      </Glass>
    </AbsoluteFill>
  );
};

export const UiPanel: React.FC<P> = ({ l, L, accent, font }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(8, 8);
  const tiles = (l.tiles || []).slice(0, 4);
  const log = (l.log || []).slice(0, 4);
  const W = L.w * 0.86;
  const a = rise(f, fps, 0, 0.5);
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <Glass L={L} style={{ position: 'absolute', left: (L.w - W) / 2, top: L.h * 0.26, width: W, padding: 24 * L.u, boxSizing: 'border-box', transform: `translateY(${(1 - a) * 30 * L.u}px)`, opacity: a }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 * L.u, fontFamily: MONO, fontSize: 21 * L.u, letterSpacing: 2 * L.u, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', marginBottom: 18 * L.u }}>
          <span style={{ width: 9 * L.u, height: 9 * L.u, borderRadius: '50%', background: accent, boxShadow: `0 0 ${10 * L.u}px ${accent}` }} />{(l.title || 'dashboard').slice(0, 34)}
        </div>
        {tiles.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 * L.u }}>
            {tiles.map((t, i) => {
              const g = rise(f, fps, 0.2 + i * 0.1, 0.45);
              return (
                <div key={i} style={{ background: 'rgba(255,255,255,0.05)', border: `${Math.max(1, L.u)}px solid rgba(255,255,255,0.08)`, borderRadius: 16 * L.u, padding: 16 * L.u, opacity: g, transform: `translateY(${(1 - g) * 16 * L.u}px)` }}>
                  <div style={{ fontFamily: MONO, fontSize: 20 * L.u, letterSpacing: 1.5 * L.u, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>{t.label}</div>
                  <div style={{ fontFamily: fam(font), fontWeight: 800, fontSize: 58 * L.u, color: '#fff', marginTop: 6 * L.u }}>{t.value}</div>
                </div>
              );
            })}
          </div>
        ) : null}
        {l.alert ? (
          <div style={{ marginTop: 14 * L.u, borderLeft: `${5 * L.u}px solid #FF6B6B`, background: 'rgba(255,107,107,0.1)', borderRadius: 12 * L.u, padding: `${12 * L.u}px ${16 * L.u}px`, opacity: rise(f, fps, 0.7, 0.4) }}>
            <div style={{ fontFamily: MONO, fontSize: 18 * L.u, letterSpacing: 1.5 * L.u, color: '#FF8A8A' }}>CRITICAL</div>
            <div style={{ fontFamily: fam(font), fontWeight: 700, fontSize: 34 * L.u, color: '#fff', marginTop: 4 * L.u }}>{l.alert.slice(0, 60)}</div>
          </div>
        ) : null}
        {log.length ? (
          <div style={{ marginTop: 14 * L.u, fontFamily: MONO, fontSize: 24 * L.u, lineHeight: 1.6, color: 'rgba(255,255,255,0.7)' }}>
            {log.map((line, i) => {
              const shown = Math.floor(Math.min(1, Math.max(0, (f - (0.9 + i * 0.35) * fps) / (0.5 * fps))) * line.length);
              return <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}><span style={{ color: accent }}>&gt; </span>{line.slice(0, shown)}</div>;
            })}
          </div>
        ) : null}
      </Glass>
    </AbsoluteFill>
  );
};
