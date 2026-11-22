// What If pack: scene dispatcher. A scene clip is { kind: 'scene', scene: SceneSpec } on the timeline.
// Everything is SVG drawn in code and deterministic from the frame number: no image generation, nothing to repaint on an edit.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { ACCENT, CLAMP, INK, MONO, PS, SANS } from './theme';
import { POSES, mixPose, rigAt } from './rig';
import { Pip } from './Pip';
import { Prop } from './props';
import { ROOMS, Room, RoomKind } from './rooms';

export type SceneSpec = {
  pack?: string;
  scene: string;                 // 'stage' | 'insert' | 'title' | 'fact' ('demo' = 'stage')
  shot?: 'wide' | 'medium' | 'close' | 'insert';
  room?: RoomKind;               // study | kitchen | rooftop | void
  pose?: string;                 // starting pose: stand point hold present shrug cheer react think walk
  pose2?: string;                // pose Pip moves into (with a springy overshoot) at `at`
  at?: number;                   // 0..1: when the change happens in the clip (default 0.4)
  prop?: string;                 // cookie phone coin bulb globe laptop box battery rocket
  fx?: 'none' | 'pop' | 'vanish' | 'multiply';
  count?: number;                // multiply: how many copies (default 3)
  x?: number; to?: number;       // Pip's x position; with `to` he walks there over the clip
  action?: string;               // small mono tag at the top, e.g. "copy"
  readout?: string;              // big mono number that pops in, e.g. "13 min"
  title?: string[]; rule?: string; number?: string; label?: string;
  seed?: number;
};

type XY = [number, number];
const ease = Easing.inOut(Easing.cubic);

const wrapText = (lines: string[], maxChars: number): string[] => {
  const out: string[] = [];
  for (const ln of lines) {
    let cur = '';
    for (const w of ln.split(/\s+/).filter(Boolean)) {
      if ((cur + ' ' + w).trim().length > maxChars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) out.push(cur);
  }
  return out;
};

const useView = () => {
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const unit = Math.min(width, height) / 1080;
  return { width, height, fps, durationInFrames, unit, vw: width / unit, vh: height / unit, portrait: height > width };
};

const Frame: React.FC<{ children: React.ReactNode; vignette?: boolean }> = ({ children, vignette = true }) => {
  const { width, height, vw, vh } = useView();
  return (
    <AbsoluteFill style={{ background: '#150c26', overflow: 'hidden' }}>
      <svg width={width} height={height} viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`} style={{ position: 'absolute', inset: 0 }}>{children}</svg>
      {vignette ? <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)' }} /> : null}
    </AbsoluteFill>
  );
};

const Stage: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, vw, vh, portrait } = useView();
  const t = frame / fps;
  const room: RoomKind = (s.room && ROOMS[s.room] ? s.room : 'study');
  const rm = ROOMS[room];
  const shot = s.shot || 'wide';

  // pose: start pose, then a springy move into pose2
  const A = POSES[s.pose || 'stand'] || POSES.stand;
  const B = s.pose2 ? POSES[s.pose2] || A : undefined;
  const atF = Math.round((s.at ?? 0.4) * durationInFrames);
  const m = B ? spring({ frame: frame - atF, fps, config: { damping: 13, stiffness: 120, mass: 0.7 } }) : 0;
  const pose = B ? mixPose(A, B, m) : A;
  const J = rigAt(pose, t);

  // position: stand still, or walk from x to `to`
  const x0 = s.x ?? -90;
  const px = s.to !== undefined ? interpolate(frame, [0, durationInFrames], [x0, s.to], { ...CLAMP, easing: ease }) : x0;
  const W = (p: XY): XY => [px + p[0] * PS, p[1] * PS];
  const head = W(J.head), hand = W(J.rHand), chest = W(J.neck);

  // camera: shot size is a scale plus a focus point, with a slow push and a little drift so no shot is ever frozen
  const focus: Record<string, { f: XY; k: number }> = {
    wide: { f: [px * 0.3, -250], k: 1.4 },
    medium: { f: [px * 0.7 + 40, chest[1] + 40], k: 1.9 },
    close: { f: [head[0] * 0.9, head[1] + 60], k: 2.9 },
    insert: { f: hand, k: 3.4 },
  };
  const cam = focus[shot] || focus.wide;
  const push = 1 + 0.05 * (frame / Math.max(1, durationInFrames));
  const fx = cam.f[0] + Math.sin(t * 0.8) * 6, fy = cam.f[1] + Math.cos(t * 0.6) * 4;

  const blink = (frame + (s.seed || 0) * 17) % 96 < 4;
  const glow = 0.88 + 0.12 * Math.sin(t * 3);

  // prop and its effect
  const fxKind = s.fx || (s.prop ? 'none' : 'none');
  const popS = spring({ frame: frame - atF, fps, config: { damping: 10, stiffness: 150 } });
  let heldScale = 1;
  if (!s.prop) heldScale = 0;
  else if (fxKind === 'pop') heldScale = frame >= atF ? popS : 0;
  else if (fxKind === 'vanish') heldScale = frame >= atF ? Math.max(0, 1 - interpolate(frame, [atF, atF + 8], [0, 1], CLAMP)) : 1;
  const n = s.count ?? 3;
  const copies = fxKind === 'multiply' && s.prop
    ? Array.from({ length: n }).map((_, i) => spring({ frame: frame - atF - 6 - i * 5, fps, config: { damping: 11, stiffness: 150 } })) : [];

  const topY = -vh / 2 + (portrait ? 300 : 110);
  const readoutS = s.readout ? spring({ frame: frame - Math.round(0.5 * durationInFrames), fps, config: { damping: 12 } }) : 0;

  return (
    <Frame>
      <g transform={`scale(${cam.k * push}) translate(${-fx} ${-fy})`}>
        <Room kind={room} glow={glow} />
        <ellipse cx={px} cy="8" rx="120" ry="16" fill="#000" opacity="0.38" />
        <Pip j={J} eyes={pose.eyes} mouth={pose.mouth} blink={blink} rimSide={rm.side} rim={rm.rim} x={px} lw={1 / Math.pow(cam.k, 0.5)} />
        {s.prop && heldScale > 0.01 ? (
          <g transform={`translate(${hand[0] + 16 * PS * 0.6} ${hand[1] - 22 * PS * 0.6}) scale(${PS * heldScale * 0.9})`}><Prop kind={s.prop} /></g>
        ) : null}
        {s.prop ? copies.map((c, i) => c > 0.01 ? (
          <g key={i} transform={`translate(${190 + i * 105} ${-300 - (i % 2) * 28}) scale(${PS * 0.7 * c})`}><Prop kind={s.prop as string} /></g>
        ) : null) : null}
      </g>
      {s.action ? <text x={-vw / 2 + 70} y={topY} fontFamily={MONO} fontSize="34" fill={ACCENT}>{`> ${s.action}`}</text> : null}
      {s.readout ? (
        <text x="0" y={topY + 130} textAnchor="middle" fontFamily={MONO} fontWeight="bold" fontSize="110" fill={ACCENT}
          opacity={Math.min(1, readoutS)} transform={`translate(0 ${topY + 130}) scale(${0.6 + 0.4 * Math.min(1.1, readoutS)}) translate(0 ${-(topY + 130)})`}>{s.readout}</text>
      ) : null}
    </Frame>
  );
};

const Title: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, vw, vh } = useView();
  const raw = s.title && s.title.length ? s.title : ['WHAT IF YOU COULD', 'DO THE IMPOSSIBLE?'];
  // fit the author's own line breaks first; only re-wrap when that would make the text too small
  const longest = Math.max(...raw.map((l) => l.length), 1);
  const fitFs = Math.min(96, (vw * 0.86) / (longest * 0.68));
  const wrapFs = 72;
  const lines = fitFs >= 64 ? raw : wrapText(raw, Math.floor((vw * 0.86) / (wrapFs * 0.68)));
  const fs = fitFs >= 64 ? fitFs : wrapFs;
  const shift = interpolate(frame, [0, 120], [0, 40], CLAMP);
  return (
    <Frame vignette={false}>
      <defs>
        <linearGradient id="tt-bg" x1="0" y1="0" x2="0" y2="1" gradientTransform={`rotate(${shift * 0.2} 0.5 0.5)`}>
          <stop offset="0" stopColor="#2b1b4a" /><stop offset="0.6" stopColor="#7a3b6e" /><stop offset="1" stopColor="#f08a4b" />
        </linearGradient>
      </defs>
      <rect x={-vw / 2 - 5} y={-vh / 2 - 5} width={vw + 10} height={vh + 10} fill="url(#tt-bg)" />
      {lines.map((ln, i) => {
        const p = spring({ frame: frame - i * 6, fps, config: { damping: 14 } });
        const y = -((lines.length - 1) * fs * 0.55) + i * fs * 1.1 - 40;
        return <text key={i} x="0" y={y} textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize={fs} fill={INK} opacity={Math.min(1, p)}
          transform={`translate(0 ${y}) scale(${0.75 + 0.25 * Math.min(1.08, p)}) translate(0 ${-y})`}>{ln}</text>;
      })}
      <rect x={-90} y={lines.length * fs * 0.55 + 20} width={180 * interpolate(frame, [14, 30], [0, 1], CLAMP)} height="8" rx="4" fill={ACCENT} />
      {s.rule ? <text x="0" y={lines.length * fs * 0.55 + 100} textAnchor="middle" fontFamily={MONO} fontSize="34" fill={ACCENT} opacity={interpolate(frame, [20, 32], [0, 1], CLAMP)}>{s.rule}</text> : null}
    </Frame>
  );
};

const Fact: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, vw, vh } = useView();
  const raw = s.number || '?';
  const mt = raw.match(/^([\d.,]+)(.*)$/);
  const target = mt ? parseFloat(mt[1].replace(/,/g, '')) : NaN;
  const prog = interpolate(frame, [2, 26], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const shown = mt && !isNaN(target)
    ? (Number.isInteger(target) ? Math.round(target * prog).toLocaleString('en-US') : (target * prog).toFixed(1)) + mt[2]
    : raw;
  const p = spring({ frame, fps, config: { damping: 16 } });
  const fs = shown.length > 8 ? 120 : 150;
  const label = wrapText([s.label || ''], Math.floor((vw * 0.8) / 24));
  return (
    <Frame>
      <defs><radialGradient id="ft-bg" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stopColor="#3a1856" /><stop offset="1" stopColor="#150a2a" /></radialGradient></defs>
      <rect x={-vw / 2 - 5} y={-vh / 2 - 5} width={vw + 10} height={vh + 10} fill="url(#ft-bg)" />
      <text x="0" y="-20" textAnchor="middle" fontFamily={MONO} fontWeight="bold" fontSize={fs} fill={ACCENT} opacity={Math.min(1, p)}
        transform={`translate(0 -20) scale(${0.8 + 0.2 * Math.min(1.06, p)}) translate(0 20)`}>{shown}</text>
      <rect x={-200} y="30" width={400 * interpolate(frame, [8, 30], [0, 1], CLAMP)} height="8" rx="4" fill={ACCENT} />
      {label.map((ln, i) => <text key={i} x="0" y={110 + i * 52} textAnchor="middle" fontFamily={MONO} fontSize="40" fill={INK} opacity={interpolate(frame, [12, 24], [0, 1], CLAMP)}>{ln}</text>)}
    </Frame>
  );
};

export const SceneBeat: React.FC<{ spec: SceneSpec }> = ({ spec }) => {
  switch (spec.scene) {
    case 'title': return <Title s={spec} />;
    case 'fact': return <Fact s={spec} />;
    case 'insert': return <Stage s={{ shot: 'insert', pose: 'hold', ...spec }} />;
    case 'stage':
    case 'demo':
    default: return <Stage s={spec} />;
  }
};
