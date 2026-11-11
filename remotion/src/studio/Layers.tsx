// Layers.tsx: pro layer engine for the Studio composition. Driven by timeline.tracks.layers (written by tools/timeline.py director_pass).
import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { url } from './assets';
import type { Layout } from './layout';
import { AssetPng, CornerText, GlyphChip, Illustration } from './Layers2';   // step3-assets

export type Layer = {
  id: string; kind: string; start: number; end: number; text?: string; src?: string; cutout?: string | null;
  icon?: string; shape?: string; x?: number; y?: number; w?: number; opacity?: number;
  from?: number[]; to?: number[]; via?: number[]; seed?: number; push?: number;
  asset?: string; subject?: string; fallback?: string; tilt?: number; side?: string;
};
type P = { l: Layer; L: Layout; accent: string; pid: string; palette: string[]; font?: string; grade?: string };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const g2 = (a: string, b: string) => `linear-gradient(120deg, ${a}, ${b})`;
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

const useEnv = (edge = 8) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const e = Math.max(1, Math.min(edge, Math.floor(d / 3)));
  return interpolate(f, [0, e, d - e, d], [0, 1, 1, 0], CL);
};

const ColorWash: React.FC<P> = ({ l, palette }) => {
  const f = useCurrentFrame();
  const env = useEnv(10);
  const t = f / 30 + (l.seed || 0);
  const a = palette[0], b = palette[1] || a, c = palette[2] || b;
  const bg = [
    `radial-gradient(60% 50% at ${50 + 30 * Math.sin(t * 0.7)}% ${30 + 20 * Math.cos(t * 0.5)}%, ${a}, transparent 70%)`,
    `radial-gradient(55% 45% at ${50 + 35 * Math.cos(t * 0.6)}% ${70 + 18 * Math.sin(t * 0.8)}%, ${b}, transparent 70%)`,
    `radial-gradient(40% 35% at ${50 + 25 * Math.sin(t * 0.9 + 2)}% ${50 + 25 * Math.cos(t * 0.4)}%, ${c}, transparent 70%)`,
  ].join(',');
  return <AbsoluteFill style={{ background: bg, opacity: (l.opacity ?? 0.5) * env, mixBlendMode: 'soft-light' as React.CSSProperties['mixBlendMode'] }} />;
};

// Text between the picture and the subject. With a cutout: real depth. Without: a soft hole in the middle of the text.
const DepthText: React.FC<P> = ({ l, L, pid, accent, font, grade }) => {
  const f = useCurrentFrame();
  const { fps, durationInFrames: d } = useVideoConfig();
  const env = useEnv(6);
  const pop = spring({ frame: f, fps, config: { damping: 16, stiffness: 80 } });
  const word = (l.text || '').toUpperCase();
  const size = Math.min((L.w * 0.94) / (0.6 * Math.max(3, word.length)), L.h * 0.26);
  const scale = 1.03 + (l.push ?? 0.1) * (f / d);
  const full: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  const hole = 'radial-gradient(ellipse 32% 42% at 50% 62%, transparent 58%, black 100%)';
  return (
    <AbsoluteFill style={{ opacity: env, transform: `scale(${scale})` }}>
      {l.src ? <Img src={url(l.src, pid)} style={{ ...full, filter: grade }} /> : null}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: `${(l.y ?? 0.3) * 100}%`, textAlign: 'center', whiteSpace: 'nowrap',
        transform: `translateY(-50%) scale(${0.86 + 0.14 * pop})`, opacity: 0.96 * pop, fontFamily: fam(font), fontWeight: 900,
        fontSize: size, lineHeight: 1, letterSpacing: '-0.02em', background: g2('#ffffff', accent),
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
        WebkitMaskImage: l.cutout ? undefined : hole, maskImage: l.cutout ? undefined : hole,
      }}>{word}</div>
      {l.cutout ? <Img src={url(l.cutout, pid)} style={{ ...full, filter: grade }} /> : null}
    </AbsoluteFill>
  );
};

const SHAPES: Record<string, [string, number, string]> = {
  underline: ['0 0 100 30', 30, 'M2 20 C 22 6, 48 28, 98 12'],
  circle: ['0 0 100 100', 100, 'M52 5 C 84 5 98 28 95 54 C 92 82 68 96 42 93 C 14 90 2 68 6 42 C 10 16 34 5 60 9'],
  arrow: ['0 0 100 100', 100, 'M4 82 C 30 82 52 44 90 22 M90 22 L66 24 M90 22 L80 46'],
  bracket: ['0 0 100 100', 100, 'M24 6 L6 6 L6 94 L24 94'],
};
const DrawLine: React.FC<P> = ({ l, L, accent }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(6);
  const p = interpolate(f, [3, 3 + 0.55 * fps], [0, 1], { ...CL, easing: OUT });
  const [vb, vh, d] = SHAPES[l.shape || 'underline'] || SHAPES.underline;
  const w = (l.w ?? 0.6) * L.w;
  const gid = `lg-${l.id}`;
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <svg viewBox={vb} style={{ position: 'absolute', left: (l.x ?? 0.2) * L.w, top: (l.y ?? 0.4) * L.h, width: w, height: (w * vh) / 100, overflow: 'visible', filter: `drop-shadow(0 0 ${10 * L.u}px ${accent})` }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor={accent} /></linearGradient></defs>
        <path d={d} pathLength={1} fill="none" stroke={`url(#${gid})`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1} strokeDashoffset={1 - p} />
      </svg>
    </AbsoluteFill>
  );
};

// Stylised route map: dark grid, a curve that draws itself, a travelling dot and pulsing pins.
const RouteMap: React.FC<P> = ({ l, L, accent, font }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(8);
  const p = interpolate(f, [6, 6 + 1.4 * fps], [0, 1], { ...CL, easing: Easing.inOut(Easing.cubic) });
  const a = l.from || [0.2, 0.72], b = l.to || [0.8, 0.3], c = l.via || [0.5, 0.82];
  const P0 = [a[0] * L.w, a[1] * L.h], P1 = [b[0] * L.w, b[1] * L.h], C = [c[0] * L.w, c[1] * L.h];
  const pt = (t: number) => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * C[0] + t * t * P1[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * C[1] + t * t * P1[1]];
  const cur = pt(p);
  const pulse = (f % 40) / 40;
  const step = 64 * L.u;
  const grid = `repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, transparent 1px, transparent ${step}px), repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, transparent 1px, transparent ${step}px)`;
  const pin = (xy: number[], k: string) => (
    <g key={k}>
      <circle cx={xy[0]} cy={xy[1]} r={(14 + 36 * pulse) * L.u} fill="none" stroke={accent} strokeWidth={3 * L.u} opacity={1 - pulse} />
      <circle cx={xy[0]} cy={xy[1]} r={12 * L.u} fill={accent} />
    </g>
  );
  return (
    <AbsoluteFill style={{ opacity: env, backgroundColor: 'rgba(6,10,20,0.62)', backgroundImage: grid }}>
      <svg width={L.w} height={L.h} viewBox={`0 0 ${L.w} ${L.h}`} style={{ position: 'absolute', left: 0, top: 0, filter: `drop-shadow(0 0 ${14 * L.u}px ${accent})` }}>
        <path d={`M ${P0[0]} ${P0[1]} Q ${C[0]} ${C[1]} ${P1[0]} ${P1[1]}`} pathLength={1} fill="none" stroke={accent} strokeWidth={6 * L.u} strokeLinecap="round" strokeDasharray={1} strokeDashoffset={1 - p} />
        {pin(P0, 'a')}
        {p > 0.95 ? pin(P1, 'b') : null}
        <circle cx={cur[0]} cy={cur[1]} r={14 * L.u} fill="#fff" />
        {l.text && p > 0.95 ? <text x={P1[0]} y={P1[1] - 44 * L.u} fill="#fff" fontSize={40 * L.u} fontWeight={800} textAnchor="middle" fontFamily={fam(font)}>{l.text}</text> : null}
      </svg>
    </AbsoluteFill>
  );
};

const ICONS: Record<string, string> = {
  check: 'M5 13l4 4L19 7',
  warn: 'M12 3L2 21h20L12 3z M12 10v5 M12 18v.5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  clock: 'M12 7v5l3 2 M12 3a9 9 0 100 18 9 9 0 000-18z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z M9 12l2 2 4-4',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z',
  coin: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v10 M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1 1.6 2.5 1.6 2.5-.5 2.5-1.5',
  question: 'M9 9a3 3 0 115 2c-1 1-2 1.5-2 3 M12 18v.5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
  fire: 'M12 3c1 3 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  'arrow-up': 'M12 20V5 M6 11l6-6 6 6',
};
const IconPop: React.FC<P> = ({ l, L, accent, palette }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(6);
  const pop = spring({ frame: f, fps, config: { damping: 9, stiffness: 140, mass: 0.7 } });
  const size = Math.min(L.w, L.h) * (l.w ?? 0.3);
  const bob = Math.sin(f / 9) * 6 * L.u;
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{
        position: 'absolute', left: (l.x ?? 0.5) * L.w - size / 2, top: (l.y ?? 0.24) * L.h - size / 2 + bob, width: size, height: size,
        borderRadius: size * 0.3, background: g2(accent, palette[1] || '#7c3aed'), boxShadow: `0 ${12 * L.u}px ${50 * L.u}px ${accent}88`,
        transform: `scale(${pop}) rotate(${(1 - pop) * -25}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d={ICONS[l.icon || 'star'] || ICONS.star} />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

const Kinetic: React.FC<P> = ({ l, L, accent, font }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnv(6);
  const words = (l.text || '').split(/\s+/).filter(Boolean).slice(0, 4);
  const size = Math.min((L.w * 0.9) / (0.58 * Math.max(3, words.join(' ').length)), L.h * 0.16);
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{ position: 'absolute', top: `${(l.y ?? 0.26) * 100}%`, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: size * 0.28, transform: 'translateY(-50%)' }}>
        {words.map((w, i) => {
          const s = spring({ frame: f - i * 4, fps, config: { damping: 11, stiffness: 150 } });
          return (
            <span key={i} style={{
              display: 'inline-block', fontFamily: fam(font), fontWeight: 900, fontSize: size, lineHeight: 1, transform: `scale(${2.2 - 1.2 * s})`,
              opacity: Math.min(1, s * 1.5), background: g2('#ffffff', accent), WebkitBackgroundClip: 'text', backgroundClip: 'text',
              color: 'transparent', WebkitTextFillColor: 'transparent', filter: `drop-shadow(0 ${6 * L.u}px ${22 * L.u}px rgba(0,0,0,0.55))`,
            }}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const KINDS: Record<string, React.FC<P>> = {
  'color-wash': ColorWash, 'depth-text': DepthText, 'draw-line': DrawLine, 'route-map': RouteMap, 'icon-pop': GlyphChip, kinetic: Kinetic,
  illustration: Illustration, asset: AssetPng, 'corner-text': CornerText,
};

export const LayerStack: React.FC<{ layers?: Layer[]; L: Layout; accent: string; pid: string; palette?: string[]; font?: string; grade?: string }> = ({ layers, L, accent, pid, palette, font, grade }) => {
  const { fps } = useVideoConfig();
  if (!layers || !layers.length) return null;
  const pal = palette && palette.length ? palette : [accent, '#7c3aed', '#06b6d4'];
  return (
    <>
      {layers.map((l) => {
        const C = KINDS[l.kind];
        if (!C) return null;
        return (
          <Sequence key={l.id} from={Math.round(l.start * fps)} durationInFrames={Math.max(3, Math.round((l.end - l.start) * fps))}>
            <C l={l} L={L} accent={accent} pid={pid} palette={pal} font={font} grade={grade} />
          </Sequence>
        );
      })}
    </>
  );
};
