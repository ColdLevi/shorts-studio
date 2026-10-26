// The visuals track: one layer per clip (image, AI video, graphic, stock footage, user upload, colour),
// with fit modes that survive any aspect ratio, camera motion and transitions between clips.
import React from 'react';
import { AbsoluteFill, CanvasImage, Img, Loop, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { GraphicBeat } from '../story/graphics';
import { url, publicPath } from './assets';
import { graphicFit, Layout } from './layout';
import type { Transition, VisualClip } from './types';
import { GFX, LeakFlash, pageTurnStyle, pictureEffects, wantsPictureFx } from './GpuFX';

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const EASE = Easing.bezier(0.33, 1, 0.68, 1);

export const transitionLen = (t?: Transition) => (!t || t.type === 'cut' ? 0 : Math.max(0.05, t.duration ?? 0.35));

// Entering transition: wraps the incoming clip for its first `len` seconds.
const Enter: React.FC<{ t?: Transition; L: Layout; g?: GFX; lensFocus?: boolean; seed?: number; children: React.ReactNode }> = ({ t, L, g, lensFocus, seed = 0, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = transitionLen(t);
  if (!len) return <AbsoluteFill>{children}</AbsoluteFill>;
  const p = interpolate(frame, [0, len * fps], [0, 1], { ...CLAMP, easing: EASE });
  const q = 1 - p;
  let style: React.CSSProperties = {};
  switch (t!.type) {
    case 'slide-left': style = { transform: `translateX(${q * L.w}px)` }; break;
    case 'slide-right': style = { transform: `translateX(${-q * L.w}px)` }; break;
    case 'slide-up': style = { transform: `translateY(${q * L.h}px)` }; break;
    case 'slide-down': style = { transform: `translateY(${-q * L.h}px)` }; break;
    case 'zoom-in': style = { opacity: p, transform: `scale(${1 + 0.25 * q})` }; break;
    case 'zoom-out': style = { opacity: p, transform: `scale(${1 - 0.15 * q})` }; break;
    case 'wipe': style = { clipPath: `inset(0 ${q * 100}% 0 0)` }; break;
    case 'blur': style = { opacity: p, filter: `blur(${q * 30 * L.u}px)` }; break;
    case 'flash': break;
    case 'page-turn': style = pageTurnStyle(p, L).page; break;
    case 'focus': style = lensFocus ? { opacity: interpolate(p, [0, 0.5], [0, 1], CLAMP) } : { opacity: p, filter: `blur(${q * 24 * L.u}px)` }; break;
    default: style = { opacity: p }; // fade, dissolve, leak
  }
  const flash = t!.type === 'flash' ? interpolate(frame, [0, (len * fps) / 2, len * fps], [0, 0.9, 0], CLAMP) : 0;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={style}>
        {children}
        {t!.type === 'page-turn' && q > 0.01 ? <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0.1) 60%, rgba(255,255,255,0.08))', opacity: pageTurnStyle(p, L).shade * 2 }} /> : null}
      </AbsoluteFill>
      {flash ? <AbsoluteFill style={{ background: 'white', opacity: flash }} /> : null}
      {t!.type === 'leak' ? <LeakFlash L={L} len={len} seed={seed} gpu={!!g} /> : null}
    </AbsoluteFill>
  );
};

function pickFit(c: VisualClip, L: Layout): 'cover' | 'contain' | 'blur-fill' {
  if (c.fit && c.fit !== 'auto') return c.fit;
  if (c.w && c.h) {
    const off = Math.abs(Math.log((c.w / c.h) / (L.w / L.h)));
    return off > 0.28 ? 'blur-fill' : 'cover'; // e.g. a 9:16 still in a 16:9 video gets a blurred fill
  }
  return 'cover';
}

const MOTIONS = ['zoom-in', 'zoom-out', 'zoom-in', 'zoom-out'] as const;

type MotionStyle = 'kenburns' | 'static' | 'parallax' | 'drift' | 'handheld';
function motionTransform(c: VisualClip, index: number, p: number, L: Layout, still: boolean, style: MotionStyle, frame = 0): string {
  let m: string = c.motion || 'auto';
  if (style === 'static' && m === 'auto') m = 'static';
  if (style === 'handheld' && m === 'auto') m = 'handheld';
  if (style === 'drift' && m === 'auto') return `scale(${1.06 + 0.03 * p}) translate(${interpolate(p, [0, 1], [-12, 12]) * L.u}px, ${interpolate(p, [0, 1], [6, -6]) * L.u}px)`;
  if (m === 'handheld') {
    const t = frame / 30;
    return `scale(1.08) translate(${(Math.sin(t * 1.3) * 7 + Math.sin(t * 3.1) * 3) * L.u}px, ${(Math.cos(t * 1.1) * 6 + Math.sin(t * 2.7) * 2) * L.u}px) rotate(${Math.sin(t * 0.9) * 0.35}deg)`;
  }
  if (!still && m === 'auto') return `scale(${1.02 + 0.04 * p})`;
  const dir = index % 4 < 2 ? 1 : -1;
  const px = 30 * L.u;
  switch (m === 'auto' ? MOTIONS[index % 4] : m) {
    case 'zoom-in': return `scale(${1.04 + 0.14 * p}) translateX(${dir * interpolate(p, [0, 1], [-px, px])}px)`;
    case 'zoom-out': return `scale(${1.18 - 0.14 * p}) translateX(${dir * interpolate(p, [0, 1], [-px, px])}px)`;
    case 'pan-left': return `scale(1.15) translateX(${interpolate(p, [0, 1], [px * 2, -px * 2])}px)`;
    case 'pan-right': return `scale(1.15) translateX(${interpolate(p, [0, 1], [-px * 2, px * 2])}px)`;
    case 'pan-up': return `scale(1.15) translateY(${interpolate(p, [0, 1], [px * 2, -px * 2])}px)`;
    case 'pan-down': return `scale(1.15) translateY(${interpolate(p, [0, 1], [-px * 2, px * 2])}px)`;
    default: return 'none';
  }
}

const Media: React.FC<{ c: VisualClip; pid: string; fit: string; transform: string; grade?: string; len: number; fps: number; L?: Layout; g?: GFX }> = ({ c, pid, fit, transform, grade, len, fps, L, g }) => {
  const frame = useCurrentFrame();
  const src = url(c.src, pid);
  const pos = c.focus ? `${c.focus.x * 100}% ${c.focus.y * 100}%` : 'center';
  const isVideo = c.kind === 'ai_video' || c.kind === 'stock' || (c.kind === 'upload' && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(c.src || ''));
  const base: React.CSSProperties = { width: '100%', height: '100%', objectFit: fit === 'cover' ? 'cover' : 'contain', objectPosition: pos,
    transform, filter: grade, imageRendering: c.pixel ? 'pixelated' : 'auto' };
  if (isVideo) {
    // AI clips shorter than their slot are slowed a little (never sped up), other footage loops.
    const rate = c.playbackRate ?? (c.kind === 'ai_video' && c.duration ? Math.max(0.6, Math.min(1, c.duration / Math.max(0.5, len))) : 1);
    const v = <OffthreadVideo src={src} muted={!c.volume} volume={c.volume || 0} playbackRate={rate}
      trimBefore={c.trim ? Math.round(c.trim * fps) : undefined} style={base} />;
    const srcLen = c.duration ? (c.duration - (c.trim || 0)) / rate : 0;
    const loop = c.loop ?? (c.kind !== 'ai_video');
    if (loop && srcLen > 0.5 && srcLen < len) return <Loop durationInFrames={Math.max(1, Math.floor(srcLen * fps))}>{v}</Loop>;
    return v;
  }
  if (L && g && canvasStill(c, fit, g)) {
    // Remotion effects run on a canvas copy of the picture (local files only: canvas needs same-origin pixels).
    return <CanvasImage src={src} width={Math.round(L.w)} height={Math.round(L.h)} fit={fit === 'cover' ? 'cover' : 'contain'}
      style={{ width: '100%', height: '100%', transform, filter: grade, imageRendering: c.pixel ? 'pixelated' : 'auto' }}
      effects={pictureEffects(g, frame, fps, L, c.transition?.type, transitionLen(c.transition))} />;
  }
  return <Img src={src} style={base} />;
};

/** A still that gets Remotion picture effects: local file, no custom focus point, not pixel art. */
export const canvasStill = (c: VisualClip, fit: string, g?: GFX) =>
  wantsPictureFx(g, c.transition?.type) && !!c.src && !/^(https?:|data:)/.test(c.src) && !c.focus && !c.pixel && fit !== 'blur-fill' &&
  (c.kind === 'image' || (c.kind === 'upload' && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(c.src)));

// 2.5D parallax for stills (documentary look): a blurred, slower background copy and a sharper,
// faster foreground cut-out (soft radial mask), moving in opposite directions, so the frame has depth.
const Parallax: React.FC<{ src: string; p: number; L: Layout; index: number; grade?: string }> = ({ src, p, L, index, grade }) => {
  const dir = index % 2 ? 1 : -1;
  const px = 40 * L.u;
  const mask = 'radial-gradient(ellipse 62% 58% at 50% 52%, black 55%, transparent 100%)';
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#08080c' }}>
      <Img src={src} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: `${grade || ''} blur(${3 * L.u}px) brightness(0.8)`,
        transform: `scale(${1.18 + 0.04 * p}) translateX(${dir * interpolate(p, [0, 1], [-px * 0.4, px * 0.4])}px)` }} />
      <Img src={src} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: grade, WebkitMaskImage: mask, maskImage: mask,
        transform: `scale(${1.12 + 0.12 * p}) translateX(${-dir * interpolate(p, [0, 1], [-px, px])}px) translateY(${interpolate(p, [0, 1], [px * 0.3, -px * 0.3])}px)` }} />
    </AbsoluteFill>
  );
};

export const VisualLayer: React.FC<{ c: VisualClip; index: number; len: number; L: Layout; pid: string; accent: string;
  motion: MotionStyle; grade?: string; nearImage?: string; graphicSfx?: boolean; sharedBackdrop?: boolean; g?: GFX }> = ({ c, index, len, L, pid, accent, motion, grade, nearImage, graphicSfx, sharedBackdrop, g }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.min(1, frame / fps / Math.max(0.5, len));
  let body: React.ReactNode;
  let lensFocus = false;
  if (c.kind === 'graphic' && c.graphic) {
    body = <GraphicBeat g={c.graphic} accent={accent} len={len} image={nearImage} fit={graphicFit(L)} sfx={graphicSfx} backdrop={!sharedBackdrop} />;
  } else if (c.kind === 'color' || !c.src) {
    const col = c.color || '#15151d';
    body = <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 35%, ${col} 0%, #08080c 100%)` }} />;
  } else {
    const fit = pickFit(c, L);
    const still = c.kind === 'image' || (c.kind === 'upload' && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(c.src));
    const tf = motionTransform(c, index, p, L, still, motion, frame);
    const para = still && fit !== 'blur-fill' && (c.motion === 'parallax' || (motion === 'parallax' && (!c.motion || c.motion === 'auto')));
    lensFocus = !para && canvasStill(c, fit, g);
    body = para ? <Parallax src={url(c.src, pid)} p={p} L={L} index={index} grade={grade} /> : (
      <AbsoluteFill style={{ backgroundColor: '#08080c', overflow: 'hidden' }}>
        {fit === 'blur-fill' && still ? (
          <AbsoluteFill>
            <Img src={url(c.src, pid)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: `blur(${40 * L.u}px) brightness(0.55) saturate(1.2)`, transform: 'scale(1.2)' }} />
          </AbsoluteFill>
        ) : null}
        <Media c={c} pid={pid} fit={fit} transform={fit === 'cover' ? tf : (still ? `scale(${1 + 0.05 * p})` : 'none')} grade={grade} len={len} fps={fps} L={L} g={g} />
      </AbsoluteFill>
    );
  }
  return <Enter t={c.transition} L={L} g={g} lensFocus={lensFocus} seed={index + 1}>{body}</Enter>;
};

/** Closest clip with a real picture, used blurred behind graphic clips (path relative to media/). */
export function nearestImage(clips: VisualClip[], i: number, pid: string): string | undefined {
  for (let d = 1; d < clips.length; d++) {
    for (const j of [i - d, i + d]) {
      const c = clips[j];
      if (c && c.kind === 'image' && c.src) return publicPath(c.src, pid);
    }
  }
  return undefined;
}
