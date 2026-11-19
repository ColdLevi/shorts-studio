// Layers6.tsx: keyed-clip. The owner's green-screen clip, keyed to transparent (VP9 alpha WebM) by tools/user_assets.py.
// Layer fields: src, ar (width / height), x, y (centre, fractions of the frame), w (width as a fraction of the frame width).
import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';
import { url } from './assets';

type P = { l: Layer; L: { w: number; h: number; u: number }; pid: string };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

export const KeyedClip: React.FC<P> = ({ l, L, pid }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  if (!a.src) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const op = interpolate(f, [0, 6, len - 6, len], [0, 1, 1, 0], CL);
  const ar = Number(a.ar) > 0 ? Number(a.ar) : 1;
  const width = Math.min(L.w * Number(a.w), L.h * 0.92 * ar);
  const height = width / ar;
  return (
    <AbsoluteFill style={{ opacity: op }}>
      <OffthreadVideo src={url(a.src, pid)} transparent muted
        style={{ position: 'absolute', left: Number(a.x) * L.w - width / 2, top: Number(a.y) * L.h - height / 2, width, height }} />
    </AbsoluteFill>
  );
};
