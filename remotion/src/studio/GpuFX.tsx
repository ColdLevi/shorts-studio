// Remotion's built-in effects (@remotion/effects, WebGL2) used by the style recipes.
// They run on a CPU-only GitHub runner through SwiftShader (render with --gl=swangle).
//
// Style tokens (timeline style.gfx), all optional, 0 or missing = off:
//   grain       film grain over everything            noise()      (0..0.4)
//   scanlines   CRT/VHS lines over everything          scanlines()  (0..0.6)
//   paper       real paper fibres and folds            paper()      (0..1)
//   vignette    lens edge darkening                    vignette()   (0..1)
//   chroma      RGB split on pictures, px at 1080      chromaticAberration()
//   chroma_hit  RGB split that kicks in as a picture enters, then settles
//   barrel      CRT bulge on pictures                  barrelDistortion() (0..0.3)
//   glow        bloom on bright parts of pictures      glow()       (0..1.5)
//   vibrance    extra colour on pictures               vibrance()   (-1..1)
//   focus_pull  pictures come in out of focus          lensBlur()   (true/false)
//   off         true = skip every effect (CSS look only; the workflow retries with this if WebGL fails)
// Transitions added with these: 'page-turn' (CSS 3D, works everywhere), 'leak' (lightLeak()), 'focus' (lensBlur()).
import React from 'react';
import { AbsoluteFill, Solid, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { barrelDistortion } from '@remotion/effects/barrel-distortion';
import { chromaticAberration } from '@remotion/effects/chromatic-aberration';
import { glow } from '@remotion/effects/glow';
import { lensBlur } from '@remotion/effects/lens-blur';
import { lightLeak } from '@remotion/effects/light-leak';
import { noise } from '@remotion/effects/noise';
import { paper } from '@remotion/effects/paper';
import { scanlines } from '@remotion/effects/scanlines';
import { vibrance } from '@remotion/effects/vibrance';
import { vignette } from '@remotion/effects/vignette';
import type { Layout } from './layout';

export type GFX = {
  off?: boolean;
  grain?: number; scanlines?: number; paper?: number; vignette?: number;
  chroma?: number; chroma_hit?: number; barrel?: number; glow?: number; vibrance?: number;
  focus_pull?: boolean;
};

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

/** The effects to use, or undefined when there are none (or they are switched off). */
export function resolveGfx(g?: GFX | null): GFX | undefined {
  if (!g || g.off) return undefined;
  const r: GFX = {
    grain: num(g.grain, 0, 0.4), scanlines: num(g.scanlines, 0, 0.6), paper: num(g.paper, 0, 1), vignette: num(g.vignette, 0, 1),
    chroma: num(g.chroma, 0, 20), chroma_hit: num(g.chroma_hit, 0, 40), barrel: num(g.barrel, 0, 0.3), glow: num(g.glow, 0, 1.5),
    vibrance: num(g.vibrance, -1, 1), focus_pull: !!g.focus_pull,
  };
  const any = Object.entries(r).some(([, v]) => (typeof v === 'number' ? v !== 0 : v === true));
  return any ? r : undefined;
}

/** True when this picture needs the canvas pipeline (an effect on the picture itself). */
export const wantsPictureFx = (g: GFX | undefined, transition?: string) =>
  !!g && (!!g.chroma || !!g.chroma_hit || !!g.barrel || !!g.glow || !!g.vibrance || !!g.focus_pull || transition === 'focus');

/** Effects on one still picture. `frame` is frames since the clip started coming in. */
export function pictureEffects(g: GFX, frame: number, fps: number, L: Layout, transition?: string, enterLen = 0.5) {
  const fx = [];
  const focus = g.focus_pull || transition === 'focus';
  if (focus) {
    const r = interpolate(frame, [0, Math.max(6, (enterLen + 0.35) * fps)], [26 * L.u, 0], CLAMP);
    fx.push(lensBlur({ radius: Math.max(0.01, r), samples: 48, irisShape: 'hexagon', irisRoundness: 0.4, repeatEdgePixels: true, disabled: r < 0.4 }));
  }
  if (g.vibrance) fx.push(vibrance({ amount: g.vibrance }));
  if (g.glow) fx.push(glow({ radius: 26 * L.u, intensity: g.glow, threshold: 0.78 }));
  if (g.barrel) fx.push(barrelDistortion({ amount: g.barrel }));
  const hit = g.chroma_hit ? interpolate(frame, [0, 0.12 * fps, 0.45 * fps], [g.chroma_hit, g.chroma_hit, 0], CLAMP) : 0;
  const ca = (g.chroma || 0) + hit;
  if (ca > 0.2) fx.push(chromaticAberration({ amount: ca * L.u, angle: 0 }));
  return fx;
}

/** Grain, scanlines, paper and vignette over the whole picture (stills, footage and graphics alike). */
export const GpuFinish: React.FC<{ g?: GFX; L: Layout; hold?: number }> = ({ g, L, hold = 1 }) => {
  const frame = useCurrentFrame();
  if (!g) return null;
  const W = Math.round(L.w), H = Math.round(L.h);
  const k = Math.floor(frame / Math.max(1, Math.round(hold)));
  // Grain re-seeds every 3rd frame: still reads as film, and keeps the MP4 small (fresh noise every frame is 5x the file size).
  const full: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {g.paper ? (
        // Paper boils (new fibres) on every held frame, like a real stop-motion sheet.
        <Solid width={W} height={H} color="#f4e9d2" style={{ ...full, mixBlendMode: 'multiply', opacity: g.paper }}
          effects={[paper({ seed: hold > 1 ? (k % 12) * 37 + 6 : 6, scale: 0.6, roughness: 0.45, fiber: 0.35, crumples: 0.35, folds: 0.5, foldCount: 4, drops: 0.15, contrast: 0.35 })]} />
      ) : null}
      {g.scanlines ? (
        <Solid width={W} height={H} color="#ffffff" style={{ ...full, mixBlendMode: 'multiply' }}
          effects={[scanlines({ amount: g.scanlines, spacing: Math.max(3, Math.round(5 * L.u)), thickness: Math.max(1, Math.round(2 * L.u)), offset: (frame * 1.5 * L.u) % 1000 })]} />
      ) : null}
      {g.grain ? (
        <Solid width={W} height={H} color="#808080" style={{ ...full, mixBlendMode: 'overlay' }}
          effects={[noise({ amount: g.grain, seed: Math.floor(k / 3) % 997 })]} />
      ) : null}
      {g.vignette ? (
        <Solid width={W} height={H} color="rgba(0,0,0,0)" style={full}
          effects={[vignette({ amount: g.vignette, radius: 0.72, feather: 0.6, roundness: 0.6, color: '#000000' })]} />
      ) : null}
    </AbsoluteFill>
  );
};

/** A warm light leak that blooms and fades across a cut (the 'leak' transition). */
export const LeakFlash: React.FC<{ L: Layout; len: number; seed: number; gpu: boolean }> = ({ L, len, seed, gpu }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.max(8, (len + 0.4) * fps);
  if (frame > total) return null;
  const p = interpolate(frame, [0, total], [0, 1], CLAMP);
  const full: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: 'screen' };
  if (!gpu) {
    const o = Math.sin(p * Math.PI) * 0.75;
    const x = 20 + 60 * random(`lk${seed}`);
    return <div style={{ ...full, opacity: o, background: `radial-gradient(ellipse 70% 60% at ${x}% 40%, #ffb347 0%, #ff6a3d55 45%, transparent 75%)` }} />;
  }
  return <Solid width={Math.round(L.w)} height={Math.round(L.h)} color="#000000" style={full}
    effects={[lightLeak({ seed: seed % 50, hueShift: (seed * 23) % 40, progress: p })]} />;
};

/** CSS 3D page turn: the new scene swings in like a page laid over the last one. Works without a GPU. */
export function pageTurnStyle(p: number, L: Layout): { page: React.CSSProperties; shade: number } {
  const q = 1 - p;
  return {
    page: { transformOrigin: '0% 50%', transform: `perspective(${Math.round(2.6 * Math.max(L.w, L.h))}px) rotateY(${92 * q}deg)`,
      backfaceVisibility: 'hidden', boxShadow: q > 0.02 ? `${-30 * L.u * q}px 0 ${60 * L.u}px rgba(0,0,0,${0.55 * q})` : undefined },
    shade: 0.5 * q,
  };
}
