// Style recipes at render time: what makes a stop-motion video feel stop-motion and a documentary feel
// like a documentary, beyond the pictures. All driven by timeline style tokens (types.ts Style.fx / backdrop):
//   fx.hold      hold every picture for N frames (stop motion = 2 or 3 at 24-30 fps)
//   fx.jitter    tiny per-frame position/rotation wobble in px at a 1080 short side (hand-placed objects)
//   fx.texture   paper | grain | film | vhs | none (an overlay that changes every held frame)
//   fx.letterbox 0..0.15 of the height as cinema bars
//   fx.flicker   film-projector brightness flicker
//   backdrop     one shared animated backdrop under all graphics (explainer mode): grid | gradient | paper | blueprint | dots
import React from 'react';
import { AbsoluteFill, Freeze, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layout } from './layout';

export type FX = { hold?: number; jitter?: number; texture?: 'paper' | 'grain' | 'film' | 'vhs' | 'none'; letterbox?: number; flicker?: boolean };

/** Holds frames (stop motion) and adds the hand-placed wobble. Wrap visuals only, never audio. */
export const Held: React.FC<{ fx?: FX; L: Layout; children: React.ReactNode }> = ({ fx, L, children }) => {
  const frame = useCurrentFrame();
  const hold = Math.max(1, Math.min(6, Math.round(fx?.hold || 1)));
  const jit = (fx?.jitter || 0) * L.u;
  const f = hold > 1 ? Math.floor(frame / hold) * hold : frame;
  const k = Math.floor(frame / hold);
  const tf = jit ? `translate(${(random(`jx${k}`) - 0.5) * 2 * jit}px, ${(random(`jy${k}`) - 0.5) * 2 * jit}px) rotate(${(random(`jr${k}`) - 0.5) * 0.5 * (jit / Math.max(1, L.u * 4))}deg)` : undefined;
  const inner = <AbsoluteFill style={tf ? { transform: tf } : undefined}>{children}</AbsoluteFill>;
  return hold > 1 ? <Freeze frame={f}>{inner}</Freeze> : inner;
};

const noiseUri = (seed: number, freq: number, alpha: number) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' seed='${seed}' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;

/** Texture, flicker and letterbox on top of everything except captions. */
export const Finish: React.FC<{ fx?: FX; L: Layout }> = ({ fx, L }) => {
  const frame = useCurrentFrame();
  if (!fx) return null;
  const hold = Math.max(1, Math.round(fx.hold || 1));
  const k = Math.floor(frame / Math.max(hold, fx.texture === 'film' || fx.texture === 'grain' ? 1 : 2));
  const seed = Math.floor(random(`t${k}`) * 999);
  const tex = fx.texture || 'none';
  const flick = fx.flicker ? 1 + (random(`f${frame}`) - 0.5) * 0.08 : 1;
  const bar = L.shape === 'wide' ? Math.max(0, Math.min(0.15, fx.letterbox || 0)) * L.h : 0;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {tex === 'paper' ? (
        <>
          <AbsoluteFill style={{ background: '#f1e4c8', mixBlendMode: 'multiply', opacity: 0.22 }} />
          <AbsoluteFill style={{ backgroundImage: noiseUri(seed, 0.9, 0.55), backgroundSize: `${512 * L.u}px`, mixBlendMode: 'overlay', opacity: 0.55 }} />
          <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(60,40,20,0.35) 100%)' }} />
        </>
      ) : null}
      {tex === 'grain' || tex === 'film' ? (
        <AbsoluteFill style={{ backgroundImage: noiseUri(seed, 0.75, tex === 'film' ? 0.6 : 0.45), backgroundSize: `${420 * L.u}px`, mixBlendMode: 'overlay', opacity: 0.5 }} />
      ) : null}
      {tex === 'film' ? (
        <>
          <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(10,6,2,0.55) 100%)' }} />
          {random(`s${Math.floor(frame / 4)}`) > 0.7 ? (
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: Math.max(1, 2 * L.u), left: `${random(`sx${Math.floor(frame / 4)}`) * 100}%`, background: 'rgba(255,255,255,0.18)' }} />
          ) : null}
        </>
      ) : null}
      {tex === 'vhs' ? (
        <>
          <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) ${Math.max(1, 2 * L.u)}px, transparent ${Math.max(1, 2 * L.u)}px, transparent ${Math.max(2, 5 * L.u)}px)` }} />
          <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(255,0,80,0.06), rgba(0,200,255,0.06))', mixBlendMode: 'screen' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, height: 40 * L.u, top: `${(frame * 7) % 110 - 5}%`, background: 'rgba(255,255,255,0.05)' }} />
          <AbsoluteFill style={{ backgroundImage: noiseUri(seed, 1.2, 0.35), backgroundSize: `${300 * L.u}px`, mixBlendMode: 'overlay', opacity: 0.4 }} />
        </>
      ) : null}
      {flick !== 1 ? <AbsoluteFill style={{ background: flick > 1 ? 'white' : 'black', opacity: Math.abs(flick - 1) }} /> : null}
      {bar ? (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: bar, background: '#000' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: bar, background: '#000' }} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

/** One continuous backdrop for the whole video, so motion-graphic scenes flow into each other. */
export const Backdrop: React.FC<{ kind?: string; accent: string; palette?: string[]; L: Layout }> = ({ kind, accent, palette, L }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!kind || kind === 'none') return null;
  const t = frame / fps;
  const bg = palette?.[0] || (kind === 'paper' ? '#3b3026' : kind === 'blueprint' ? '#0d2a4a' : '#0a0c12');
  const drift = (t * 18 * L.u) % (90 * L.u);
  const glowX = 50 + 18 * Math.sin(t / 5), glowY = 40 + 10 * Math.cos(t / 7);
  const second = palette?.[1] || accent;
  return (
    <AbsoluteFill style={{ background: bg }}>
      {kind === 'gradient' ? (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 55% at ${glowX}% ${glowY}%, ${accent}55 0%, transparent 70%), radial-gradient(ellipse 60% 50% at ${100 - glowX}% ${100 - glowY}%, ${second}44 0%, transparent 70%)` }} />
      ) : null}
      {kind === 'grid' || kind === 'blueprint' ? (
        <AbsoluteFill style={{ backgroundImage: `linear-gradient(${kind === 'blueprint' ? 'rgba(160,210,255,0.16)' : 'rgba(255,255,255,0.05)'} 1px, transparent 1px), linear-gradient(90deg, ${kind === 'blueprint' ? 'rgba(160,210,255,0.16)' : 'rgba(255,255,255,0.05)'} 1px, transparent 1px)`,
          backgroundSize: `${90 * L.u}px ${90 * L.u}px`, backgroundPosition: `${drift}px ${drift}px` }} />
      ) : null}
      {kind === 'dots' ? (
        <AbsoluteFill style={{ backgroundImage: `radial-gradient(${accent}44 ${2.5 * L.u}px, transparent ${3 * L.u}px)`, backgroundSize: `${60 * L.u}px ${60 * L.u}px`, backgroundPosition: `0 ${-drift}px` }} />
      ) : null}
      {kind === 'paper' ? (
        <AbsoluteFill style={{ backgroundImage: noiseUri(7, 0.8, 0.35), backgroundSize: `${512 * L.u}px`, mixBlendMode: 'multiply', opacity: 0.6 }} />
      ) : null}
      {kind !== 'gradient' ? (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 50% at ${glowX}% ${glowY}%, ${accent}${kind === 'paper' ? '22' : '30'} 0%, transparent 70%)`,
          opacity: interpolate(Math.sin(t / 3), [-1, 1], [0.7, 1]) }} />
      ) : null}
      <AbsoluteFill style={{ background: kind === 'paper' ? 'radial-gradient(ellipse 110% 85% at 50% 45%, transparent 55%, rgba(80,60,30,0.3) 100%)' : 'radial-gradient(ellipse 110% 85% at 50% 45%, transparent 45%, rgba(0,0,0,0.7) 100%)' }} />
    </AbsoluteFill>
  );
};
