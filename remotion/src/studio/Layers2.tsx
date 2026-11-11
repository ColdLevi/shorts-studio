// Layers2.tsx: asset-library layers for the Studio composition (step 3).
//   illustration  a flat illustration that assembles itself part by part (illustrations.tsx)
//   asset         a checked PNG cutout from the asset library (library/assets/manifest.json), settles in with a soft glow
//   corner-text   tilted text in a corner, revealed through a mask (variety next to the centred kinetic text)
//   icon-pop      chrome glyph (Lucide) with a gradient stroke, instead of the old flat rounded square
// Composition laws (skill 4.7): a prop stays <= 1/3 of the frame width, arrives after the text lands, leaves with it.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import * as Lucide from 'lucide-react';
import { url } from './assets';
import type { Layout } from './layout';
import type { Layer } from './Layers';
import { ILLUSTRATIONS, makeBuild } from './illustrations';

type P = { l: Layer; L: Layout; accent: string; pid: string; palette: string[]; font?: string; grade?: string };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');

// 0 -> 1 on entry, 1 -> 0 over the last frames of the layer
const useEnvelope = (inFrames = 8, outFrames = 8) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const o = Math.max(1, Math.min(outFrames, Math.floor(d / 3)));
  return interpolate(f, [0, inFrames, d - o, d], [0, 1, 1, 0], CL);
};

export const Illustration: React.FC<P> = ({ l, L, accent, palette }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const C = ILLUSTRATIONS[l.asset || ''];
  const env = useEnvelope(6, 8);
  if (!C) return null;
  const t = OUT(Math.min(1, f / (0.9 * fps)));
  const size = Math.min(L.w, L.h) * (l.w ?? 0.3);
  const cx = (l.x ?? 0.8) * L.w, cy = (l.y ?? 0.2) * L.h;
  const tilt = l.tilt ?? (cx < L.w / 2 ? -4 : 4);
  const bob = Math.sin(f / 24) * 5 * L.u * Math.min(1, t * 2);
  const b = makeBuild(t);
  const acc2 = palette[1] || '#7c3aed';
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{ position: 'absolute', left: cx - size, top: cy - size, width: size * 2, height: size * 2, background: `radial-gradient(circle, ${accent}30 0%, transparent 62%)`, opacity: t }} />
      <div style={{
        position: 'absolute', left: cx - size / 2, top: cy - size / 2 + bob, width: size, height: size, transform: `rotate(${tilt * (1 - 0.35 * t)}deg) scale(${0.94 + 0.06 * t})`,
        filter: `drop-shadow(0 ${14 * L.u}px ${28 * L.u}px rgba(0,0,0,0.5))`,
      }}>
        <C b={b} acc={accent} acc2={acc2} id={`ill-${l.id}`} />
      </div>
    </AbsoluteFill>
  );
};

export const AssetPng: React.FC<P> = ({ l, L, accent, pid }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnvelope(6, 8);
  if (!l.src) return null;
  const s = spring({ frame: f, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const size = Math.min(L.w, L.h) * (l.w ?? 0.4);
  const cx = (l.x ?? 0.78) * L.w, cy = (l.y ?? 0.24) * L.h;
  const bob = Math.sin(f / 26) * 6 * L.u * Math.min(1, s);
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{ position: 'absolute', left: cx - size, top: cy - size, width: size * 2, height: size * 2, background: `radial-gradient(circle, ${accent}38 0%, transparent 60%)`, opacity: s }} />
      <Img src={url(l.src, pid)} style={{
        position: 'absolute', left: cx - size / 2, top: cy - size / 2 + bob + (1 - s) * 26 * L.u, width: size, height: size, objectFit: 'contain',
        transform: `scale(${0.82 + 0.18 * s}) rotate(${(1 - s) * -4}deg)`, filter: `drop-shadow(0 ${18 * L.u}px ${30 * L.u}px rgba(0,0,0,0.5))`,
      }} />
    </AbsoluteFill>
  );
};

export const CornerText: React.FC<P> = ({ l, L, accent, palette, font }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnvelope(4, 8);
  const text = (l.text || '').slice(0, 18);
  if (!text) return null;
  const side = l.side || 'tl';
  const right = side.endsWith('r'), bottom = side.startsWith('b');
  const size = Math.min(L.w * 0.16, (L.w * 0.78) / (0.6 * Math.max(3, text.length)), L.h * 0.09);
  const tilt = l.tilt ?? (right ? 3 : -3);
  const reveal = OUT(Math.min(1, f / (0.45 * fps)));
  const bar = OUT(Math.min(1, Math.max(0, f - 0.2 * fps) / (0.5 * fps)));
  const acc2 = palette[1] || '#7c3aed';
  const y = (l.y ?? (bottom ? 0.72 : 0.12)) * L.h;
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{ position: 'absolute', [right ? 'right' : 'left']: L.w * 0.07, top: y, transform: `rotate(${tilt}deg)`, transformOrigin: right ? '100% 50%' : '0% 50%', textAlign: right ? 'right' : 'left' }}>
        <div style={{ overflow: 'hidden', paddingBottom: size * 0.08 }}>
          <div style={{
            fontFamily: fam(font), fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -size * 0.02, whiteSpace: 'nowrap',
            transform: `translateY(${(1 - reveal) * 105}%)`, background: `linear-gradient(120deg, #ffffff 10%, ${accent} 70%, ${acc2})`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
            filter: `drop-shadow(0 ${5 * L.u}px ${18 * L.u}px rgba(0,0,0,0.55))`,
          }}>{text}</div>
        </div>
        <div style={{ height: Math.max(3, size * 0.07), width: `${bar * 62}%`, marginLeft: right ? 'auto' : 0, borderRadius: 99, background: `linear-gradient(90deg, ${accent}, ${acc2})` }} />
      </div>
    </AbsoluteFill>
  );
};

// the icon keys the director uses -> Lucide names, first one that exists wins (Lucide renames icons between versions)
const LUCIDE: Record<string, string[]> = {
  coin: ['Coins', 'CircleDollarSign'], warn: ['TriangleAlert', 'AlertTriangle'], bolt: ['Zap'], shield: ['ShieldCheck', 'Shield'], heart: ['Heart'],
  bulb: ['Lightbulb'], check: ['CircleCheck', 'CheckCircle2', 'Check'], fire: ['Flame'], star: ['Star'],
};
const pascal = (s: string) => s.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
const lucideFor = (key?: string): React.ComponentType<Record<string, unknown>> | null => {
  const ns = Lucide as unknown as Record<string, React.ComponentType<Record<string, unknown>> | undefined>;
  for (const n of [...(LUCIDE[key || ''] || []), pascal(key || 'star'), 'Star']) if (ns[n]) return ns[n] as React.ComponentType<Record<string, unknown>>;
  return null;
};

export const GlyphChip: React.FC<P> = ({ l, L, accent, palette }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const env = useEnvelope(6, 8);
  const pop = spring({ frame: f, fps, config: { damping: 11, stiffness: 130, mass: 0.7 } });
  const Icon = lucideFor(l.icon);
  const acc2 = palette[1] || '#7c3aed';
  const size = Math.min(L.w, L.h) * (l.w ?? 0.26);
  const gid = `gc-${l.id}`;
  const bob = Math.sin(f / 10) * 5 * L.u;
  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{
        position: 'absolute', left: (l.x ?? 0.5) * L.w - size / 2, top: (l.y ?? 0.24) * L.h - size / 2 + bob, width: size, height: size, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.16), rgba(255,255,255,0.04) 60%)`, border: `${Math.max(2, 3 * L.u)}px solid transparent`,
        backgroundClip: 'padding-box', boxShadow: `0 0 0 ${Math.max(2, 3 * L.u)}px ${accent}66, 0 ${12 * L.u}px ${50 * L.u}px ${accent}66`,
        transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width={0} height={0} style={{ position: 'absolute' }}><defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="0.55" stopColor={accent} /><stop offset="1" stopColor={acc2} /></linearGradient></defs></svg>
        {Icon ? <Icon size={size * 0.58} strokeWidth={1.9} stroke={`url(#${gid})`} color={`url(#${gid})`} style={{ filter: `drop-shadow(0 0 ${10 * L.u}px ${accent}aa)` }} /> : null}
      </div>
    </AbsoluteFill>
  );
};
