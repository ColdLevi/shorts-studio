// Overlay track: title card, free text, lower thirds and images (logos, stickers), placed by Layout.
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { url } from './assets';
import { font } from './fonts';
import { Layout } from './layout';
import type { TextOverlay } from './types';

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

const OverlayBase: React.FC<{ o: TextOverlay; L: Layout; accent: string; pid: string; displayFont?: string }> = ({ o, L, accent, pid, displayFont }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = Math.max(0.2, o.end - o.start);
  const inP = spring({ frame, fps, config: { damping: 16 } });
  const out = interpolate(frame, [(len - 0.5) * fps, len * fps], [1, 0], CLAMP);
  const f = font(o.font || displayFont || 'Montserrat');
  const u = L.u;
  const top = typeof o.position === 'object' ? o.position.y * L.h
    : o.position === 'middle' ? L.h * 0.42 : o.position === 'bottom' ? L.h * 0.8 : L.titleY;

  if (o.kind === 'image' && o.src) {
    const pos = typeof o.position === 'object' ? o.position : { x: 0.82, y: 0.06, w: 0.12 };
    return (
      <AbsoluteFill style={{ opacity: Math.min(inP, out) }}>
        <Img src={url(o.src, pid)} style={{ position: 'absolute', left: pos.x * L.w, top: pos.y * L.h, width: (pos.w ?? 0.12) * L.w }} />
      </AbsoluteFill>
    );
  }
  if (o.kind === 'lower-third') {
    return (
      <AbsoluteFill style={{ opacity: out }}>
        <div style={{ position: 'absolute', left: L.pad, top: typeof o.position === 'object' ? top : L.h * (L.shape === 'wide' ? 0.62 : 0.8),
          transform: `translateX(${(1 - inP) * -60 * u}px)`, opacity: inP }}>
          <div style={{ background: o.background || accent, color: '#111', fontFamily: f.family, fontWeight: f.weight(900), fontSize: 46 * u,
            padding: `${10 * u}px ${22 * u}px`, borderRadius: 10 * u, display: 'inline-block' }}>{o.text}</div>
          {o.sub ? <div style={{ marginTop: 8 * u, color: o.color || 'white', fontFamily: f.family, fontWeight: f.weight(700), fontSize: 34 * u,
            textShadow: '0 3px 12px rgba(0,0,0,0.7)' }}>{o.sub}</div> : null}
        </div>
      </AbsoluteFill>
    );
  }
  if (o.kind === 'text') {
    return (
      <AbsoluteFill style={{ alignItems: 'center', top, opacity: Math.min(inP, out) }}>
        <div style={{ color: o.color || 'white', background: o.background, fontFamily: f.family, fontWeight: f.weight(800), fontSize: 58 * u,
          textAlign: 'center', maxWidth: L.w - L.pad * 2, padding: o.background ? `${12 * u}px ${24 * u}px` : 0, borderRadius: 14 * u,
          textShadow: o.background ? 'none' : '0 4px 18px rgba(0,0,0,0.7)' }}>{o.text}</div>
      </AbsoluteFill>
    );
  }
  if (o.kind === 'chapter') {
    // documentary chapter card: small numeral, wide-tracked title, a rule that draws itself
    const rule = interpolate(frame, [0.2 * fps, 0.9 * fps], [0, 1], CLAMP);
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: Math.min(inP, out), background: `rgba(0,0,0,${0.45 * Math.min(inP, out)})` }}>
        {o.sub ? <div style={{ color: accent, fontFamily: f.family, fontWeight: f.weight(700), fontSize: 34 * u, letterSpacing: 8 * u, textTransform: 'uppercase' }}>{o.sub}</div> : null}
        <div style={{ height: 3 * u, width: 360 * u * rule, background: accent, margin: `${18 * u}px 0` }} />
        <div style={{ color: o.color || 'white', fontFamily: f.family, fontWeight: f.weight(800), fontSize: (L.shape === 'wide' ? 84 : 76) * u, letterSpacing: 3 * u,
          textAlign: 'center', maxWidth: L.w - L.pad * 2, textTransform: 'uppercase', transform: `translateY(${(1 - inP) * 20 * u}px)`, textShadow: '0 6px 30px rgba(0,0,0,0.6)' }}>{o.text}</div>
      </AbsoluteFill>
    );
  }
  // title card (the original StoryShort look)
  return (
    <AbsoluteFill style={{ alignItems: 'center', top, opacity: out }}>
      <div style={{
        transform: `translateY(${(1 - inP) * -60 * u}px)`, background: o.background || accent, color: o.color || '#111',
        fontFamily: f.family, fontWeight: f.weight(900), fontSize: (L.shape === 'wide' ? 58 : 64) * u * (String(o.text || '').length > 70 ? 0.72 : String(o.text || '').length > 40 ? 0.86 : 1), lineHeight: 1.1, textAlign: 'center',
        padding: `${22 * u}px ${36 * u}px`, borderRadius: 18 * u, maxWidth: Math.min(L.w - L.pad * 2, (L.shape === 'wide' ? 1300 : 920) * u),
        textTransform: 'uppercase', boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      }}>{o.text}</div>
    </AbsoluteFill>
  );
};

type OvProps = React.ComponentProps<typeof OverlayBase>;
const ENTR = ['slide-l', 'blur', 'rise', 'wipe', 'slide-r'] as const;
// o1: act-aware entrance. Hook (first 4 s) punches in; the middle rotates styles so neighbours differ.
export const Overlay: React.FC<OvProps & { total?: number }> = (props) => {
  const { o, L } = props;
  const total = props.total || 0;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (o.kind === 'image' || o.kind === 'chapter') return <OverlayBase {...props} />;
  const hook = o.start < 4;
  const payoff = !hook && total > 0 && o.start >= total - 6;
  const e = hook ? 'punch' : payoff ? 'hold' : ENTR[Math.abs(Math.round(o.start)) % ENTR.length];
  const p = spring({ frame, fps, config: hook ? { damping: 12, stiffness: 260 } : payoff ? { damping: 30, stiffness: 50 } : { damping: 18, stiffness: 120 } });
  const q = 1 - Math.min(1, Math.max(0, p));
  const w = interpolate(frame, [0, 0.45 * fps], [0, 1], CLAMP);
  const u = L.u;
  let transform = 'none', filter = 'none', clipPath = 'none';
  if (e === 'hold') { transform = `translateY(${40 * u * q}px) scale(${1 - 0.05 * q})`; }
  else if (e === 'punch') { transform = `scale(${1 + 0.3 * q})`; if (q > 0.01) filter = `blur(${10 * q * u}px)`; }
  else if (e === 'slide-l') transform = `translateX(${-140 * u * q}px)`;
  else if (e === 'slide-r') transform = `translateX(${140 * u * q}px)`;
  else if (e === 'rise') transform = `translateY(${70 * u * q}px)`;
  else if (e === 'blur') { if (q > 0.01) filter = `blur(${18 * q * u}px)`; }
  else if (e === 'wipe') { if (w < 1) clipPath = `inset(0 ${(1 - w) * 100}% 0 0)`; }
  return <AbsoluteFill style={{ transform, filter, clipPath, transformOrigin: '50% 20%' }}><OverlayBase {...props} /></AbsoluteFill>;
};

export const Progress: React.FC<{ accent: string; L: Layout }> = ({ accent, L }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 0, left: 0, height: Math.max(6, 10 * L.u), background: accent,
        width: `${(frame / durationInFrames) * 100}%`, opacity: 0.9 }} />
    </AbsoluteFill>
  );
};
