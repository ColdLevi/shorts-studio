// What If pack, stage 1: a few code-drawn scenes, deterministic from the frame number.
// A scene clip is { kind: 'scene', scene: { pack: 'whatif', scene: 'title' | 'demo' | 'fact', shot, ...props } }.
// Everything here is SVG drawn in code: no image generation, no asset to repaint when an edit lands.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

export type SceneSpec = {
  pack?: string;
  scene: string;
  shot?: 'wide' | 'medium' | 'close' | 'insert';
  title?: string[];        // title scene: lines of the title card
  rule?: string;           // title scene: the one rule under the title
  prop?: string;           // demo scene: what Pip is holding, e.g. 'cookie'
  action?: string;         // demo scene: short label shown as a small mono readout
  number?: string;         // fact scene: the big number
  label?: string;          // fact scene: what the number is
  seed?: number;
};

const PALETTE = {
  skyTop: '#2b1b4a', skyMid: '#7a3b6e', skyLow: '#f08a4b',
  wall: '#3a2554', floor: '#1d1230', lamp: '#ffd9a0', ink: '#f6efe6', rim: '#ffb36b', accent: '#ffd43b',
};
const MONO = "'DejaVu Sans Mono', 'Courier New', monospace";
const SANS = "'Montserrat', 'DejaVu Sans', Arial, sans-serif";
const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

// Camera: shot size changes by scale and focus point, so every cut reads as a different shot.
const SHOTS: Record<string, { s: number; x: number; y: number }> = {
  wide: { s: 1.0, x: 0, y: 0 },
  medium: { s: 1.55, x: 0, y: 40 },
  close: { s: 2.4, x: 0, y: 150 },
  insert: { s: 3.4, x: -60, y: 230 },
};

const Room: React.FC<{ glow: number }> = ({ glow }) => (
  <g>
    <defs>
      <linearGradient id="wf-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={PALETTE.skyTop} /><stop offset="0.55" stopColor={PALETTE.skyMid} /><stop offset="1" stopColor={PALETTE.skyLow} />
      </linearGradient>
      <radialGradient id="wf-lamp" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={PALETTE.lamp} stopOpacity={0.55 * glow} /><stop offset="1" stopColor={PALETTE.lamp} stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect x="-600" y="-900" width="1800" height="1800" fill={PALETTE.wall} />
    {/* window with the dusk sky: a light source you can see */}
    <rect x="-330" y="-520" width="360" height="420" rx="10" fill="url(#wf-sky)" stroke={PALETTE.rim} strokeWidth="6" />
    <line x1="-150" y1="-520" x2="-150" y2="-100" stroke={PALETTE.rim} strokeWidth="5" />
    <line x1="-330" y1="-310" x2="30" y2="-310" stroke={PALETTE.rim} strokeWidth="5" />
    {/* desk lamp */}
    <circle cx="300" cy="-120" r="260" fill="url(#wf-lamp)" />
    <path d="M300 60 L300 -60 L260 -120" stroke={PALETTE.ink} strokeWidth="8" fill="none" strokeLinecap="round" />
    <path d="M230 -140 L290 -150 L275 -100 Z" fill={PALETTE.lamp} />
    <rect x="-600" y="120" width="1800" height="800" fill={PALETTE.floor} />
    <rect x="180" y="40" width="300" height="24" rx="4" fill="#5b3a2e" />
  </g>
);

// Pip: one rig, the same function draws the hero in every shot, so nothing drifts between cuts.
const Pip: React.FC<{ t: number; reach: number; blink: boolean; seed: number }> = ({ t, reach, blink, seed }) => {
  const breathe = Math.sin(t * 2 + seed) * 3;
  const armX = 40 + reach * 110;
  const armY = -10 - reach * 40;
  return (
    <g transform={`translate(0, ${breathe})`} stroke={PALETTE.ink} strokeWidth="10" strokeLinecap="round" fill="none">
      <line x1="0" y1="-40" x2="0" y2="80" />
      <line x1="0" y1="80" x2="-45" y2="190" />
      <line x1="0" y1="80" x2="45" y2="190" />
      <line x1="0" y1="-10" x2="-50" y2="60" />
      <line x1="0" y1="-10" x2={armX} y2={armY} />
      <circle cx="0" cy="-95" r="52" fill="#2b1b4a" />
      {/* warm rim light on the lamp side */}
      <path d="M32 -125 A52 52 0 0 1 32 -65" stroke={PALETTE.rim} strokeWidth="7" />
      {blink ? <line x1="-22" y1="-100" x2="-8" y2="-100" strokeWidth="5" /> : <circle cx="-15" cy="-100" r="5" fill={PALETTE.ink} stroke="none" />}
      {blink ? <line x1="8" y1="-100" x2="22" y2="-100" strokeWidth="5" /> : <circle cx="15" cy="-100" r="5" fill={PALETTE.ink} stroke="none" />}
      <path d="M-14 -72 Q0 -62 14 -72" strokeWidth="5" />
    </g>
  );
};

const Prop: React.FC<{ kind: string; x: number; y: number; pop: number }> = ({ kind, x, y, pop }) => {
  const sc = Math.max(0.01, pop);
  return (
    <g transform={`translate(${x}, ${y}) scale(${sc})`}>
      {kind === 'cookie' ? (
        <g><circle r="34" fill="#c98a4b" stroke={PALETTE.ink} strokeWidth="4" /><circle cx="-10" cy="-8" r="5" fill="#4a2c1a" /><circle cx="12" cy="6" r="5" fill="#4a2c1a" /><circle cx="-4" cy="16" r="4" fill="#4a2c1a" /></g>
      ) : (
        <rect x="-30" y="-30" width="60" height="60" rx="8" fill={PALETTE.accent} stroke={PALETTE.ink} strokeWidth="4" />
      )}
    </g>
  );
};

const Stage: React.FC<{ shot: string; children: React.ReactNode }> = ({ shot, children }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const cam = SHOTS[shot] || SHOTS.wide;
  // a slow push-in on top of the shot size keeps every held shot alive
  const push = interpolate(frame, [0, durationInFrames], [1, 1.06], CLAMP);
  const unit = Math.min(width, height) / 1080;
  return (
    <AbsoluteFill style={{ background: PALETTE.wall, overflow: 'hidden' }}>
      <svg width={width} height={height} viewBox={`${-width / 2 / unit} ${-height / 2 / unit} ${width / unit} ${height / unit}`} style={{ position: 'absolute', inset: 0 }}>
        <g transform={`scale(${cam.s * push}) translate(${cam.x}, ${-cam.y})`}>{children}</g>
      </svg>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const lines = s.title && s.title.length ? s.title : ['WHAT IF YOU COULD', 'DO THE IMPOSSIBLE?'];
  const u = Math.min(width, height) / 1080;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${PALETTE.skyTop}, ${PALETTE.skyMid} 60%, ${PALETTE.skyLow})`, alignItems: 'center', justifyContent: 'center' }}>
      {lines.map((ln, i) => {
        const p = spring({ frame: frame - i * 6, fps, config: { damping: 14 } });
        return <div key={i} style={{ fontFamily: SANS, fontWeight: 900, fontSize: 92 * u, color: PALETTE.ink, textAlign: 'center', lineHeight: 1.1,
          transform: `scale(${0.7 + 0.3 * p})`, opacity: p, textShadow: '0 6px 0 rgba(0,0,0,0.25)', padding: `0 ${60 * u}px` }}>{ln}</div>;
      })}
      {s.rule ? <div style={{ marginTop: 56 * u, fontFamily: MONO, fontSize: 34 * u, color: PALETTE.accent, opacity: interpolate(frame, [18, 30], [0, 1], CLAMP) }}>{s.rule}</div> : null}
    </AbsoluteFill>
  );
};

const Demo: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const act = interpolate(frame, [durationInFrames * 0.25, durationInFrames * 0.55], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const pop = spring({ frame: frame - Math.round(durationInFrames * 0.5), fps, config: { damping: 12 } });
  const seed = s.seed || 0;
  const blink = Math.floor(t * 3 + seed) % 7 === 0 && frame % 10 < 3;
  const glow = 0.8 + 0.2 * Math.sin(t * 3);
  return (
    <Stage shot={s.shot || 'wide'}>
      <Room glow={glow} />
      <g transform="translate(-60, 40)"><Pip t={t} reach={act} blink={blink} seed={seed} /></g>
      {s.prop ? <Prop kind={s.prop} x={-60 + 40 + act * 110 + 26} y={30 - act * 40} pop={act > 0.9 ? pop : 0} /> : null}
      {s.action ? <text x="-330" y="-560" fontFamily={MONO} fontSize="30" fill={PALETTE.accent}>{`> ${s.action}`}</text> : null}
    </Stage>
  );
};

const Fact: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  const p = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: PALETTE.floor, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 150 * u, color: PALETTE.accent, transform: `scale(${0.8 + 0.2 * p})`, opacity: p, textAlign: 'center', padding: `0 ${50 * u}px` }}>{s.number || '?'}</div>
      <div style={{ marginTop: 30 * u, fontFamily: MONO, fontSize: 40 * u, color: PALETTE.ink, textAlign: 'center', padding: `0 ${70 * u}px`, opacity: interpolate(frame, [10, 22], [0, 1], CLAMP) }}>{s.label || ''}</div>
    </AbsoluteFill>
  );
};

export const SceneBeat: React.FC<{ spec: SceneSpec }> = ({ spec }) => {
  switch (spec.scene) {
    case 'title': return <TitleCard s={spec} />;
    case 'fact': return <Fact s={spec} />;
    case 'demo':
    default: return <Demo s={spec} />;
  }
};
