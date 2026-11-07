// What If pack, stage 2: code-drawn scenes, deterministic from the frame number.
// A scene clip is { kind: 'scene', scene: { pack: 'whatif', scene: 'title' | 'demo' | 'fact', shot, room, ...props } }.
// Everything here is SVG drawn in code: no image generation, no asset to repaint when an edit lands.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { CLAMP, MONO, Mood, PALETTES, Palette, SANS } from './tokens';
import { Pip, POSES, PoseName, mixPose, armPoints } from './Pip';
import { Room, ROOM_FOCUS, RoomName } from './Rooms';
import { Prop } from './Props';

export type ShotSize = 'wide' | 'medium' | 'close' | 'insert';

export type SceneSpec = {
  pack?: string;
  scene: string;                 // 'title' | 'demo' | 'fact'
  shot?: ShotSize;               // camera size
  room?: RoomName;               // demo: 'desk' | 'kitchen' | 'street'
  mood?: Mood;                   // demo: 'dusk' (default) | 'night'
  pose?: PoseName;               // demo: the pose Pip ends in
  from?: PoseName;               // demo: the pose Pip starts in (default 'idle')
  prop?: string;                 // demo: what Pip holds: cookie, laptop, cup, phone, bulb, clock, box, coin
  action?: string;               // demo: short label shown as a small mono readout
  x?: number;                    // demo: where Pip stands (default -80)
  x_to?: number;                 // demo: if set, Pip walks from x to x_to
  focus?: 'pip' | 'prop' | 'window' | 'light' | [number, number]; // demo: what the camera looks at
  title?: string[];              // title: lines of the title card
  rule?: string;                 // title: the one rule under the title
  number?: string;               // fact: the big number
  label?: string;                // fact: what the number is
  seed?: number;
};

// What the director may pick from (stage 3 reads this list).
export const WHATIF_CATALOG = {
  scenes: ['title', 'demo', 'fact'],
  shots: ['wide', 'medium', 'close', 'insert'],
  rooms: ['desk', 'kitchen', 'street'],
  moods: ['dusk', 'night'],
  poses: ['idle', 'reach', 'hold', 'point', 'shock', 'think', 'wave', 'walk'],
  props: ['cookie', 'laptop', 'cup', 'phone', 'bulb', 'clock', 'box', 'coin'],
};

const PIP_SCALE = 1.3;
const PIP_Y = 70;
// Camera: scale per shot size. The focus point is chosen per shot (see focusFor).
const SHOT_SCALE: Record<string, number> = { wide: 1.2, medium: 1.9, close: 3.1, insert: 4.6 };

const Stage: React.FC<{ shot: string; fx: number; fy: number; mood: Mood; children: React.ReactNode; action?: string }> = ({ shot, fx, fy, mood, children, action }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const P = PALETTES[mood];
  const unit = Math.min(width, height) / 1080;
  const base = SHOT_SCALE[shot] || SHOT_SCALE.wide;
  // a slow push-in plus a small drift keeps every held shot alive
  const push = interpolate(frame, [0, durationInFrames], [1, 1.07], CLAMP);
  const drift = interpolate(frame, [0, durationInFrames], [0, 14], CLAMP);
  const S = base * push;
  return (
    <AbsoluteFill style={{ background: P.wall, overflow: 'hidden' }}>
      <svg width={width} height={height} viewBox={`${-width / 2 / unit} ${-height / 2 / unit} ${width / unit} ${height / unit}`} style={{ position: 'absolute', left: 0, top: 0 }}>
        <g transform={`scale(${S}) translate(${-(fx + drift)} ${-fy})`}>{children}</g>
      </svg>
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 80% 38%, rgba(255,200,130,0.10), rgba(0,0,0,0) 55%)' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
      {action ? (
        <div style={{ position: 'absolute', left: 64 * unit, top: 330 * unit, fontFamily: MONO, fontSize: 34 * unit, color: P.accent, background: 'rgba(0,0,0,0.35)', padding: `${8 * unit}px ${18 * unit}px`, borderRadius: 10 * unit }}>{`> ${action}`}</div>
      ) : null}
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const P: Palette = PALETTES[s.mood || 'dusk'];
  const lines = s.title && s.title.length ? s.title : ['WHAT IF YOU COULD', 'DO THE IMPOSSIBLE?'];
  const u = Math.min(width, height) / 1080;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${P.skyTop}, ${P.skyMid} 60%, ${P.skyLow})`, alignItems: 'center', justifyContent: 'center' }}>
      {lines.map((ln, i) => {
        const p = spring({ frame: frame - i * 6, fps, config: { damping: 14 } });
        return <div key={i} style={{ fontFamily: SANS, fontWeight: 900, fontSize: 92 * u, color: P.ink, textAlign: 'center', lineHeight: 1.1,
          transform: `scale(${0.7 + 0.3 * p})`, opacity: p, textShadow: '0 6px 0 rgba(0,0,0,0.25)', padding: `0 ${60 * u}px` }}>{ln}</div>;
      })}
      {s.rule ? <div style={{ marginTop: 56 * u, fontFamily: MONO, fontSize: 34 * u, color: P.accent, opacity: interpolate(frame, [18, 30], [0, 1], CLAMP) }}>{s.rule}</div> : null}
    </AbsoluteFill>
  );
};

const Demo: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const mood: Mood = s.mood || 'dusk';
  const P = PALETTES[mood];
  const room: RoomName = s.room || 'desk';
  const shot = s.shot || 'wide';
  const seed = s.seed || 0;

  // acting: Pip moves from one pose to another between 20% and 55% of the clip
  const endPose: PoseName = s.pose || (s.prop ? 'reach' : 'idle');
  const startPose: PoseName = s.from || 'idle';
  const isInsert = shot === 'insert'; // inserts start already in their final pose, so the camera never chases the hand
  const act = isInsert ? 1 : interpolate(frame, [durationInFrames * 0.2, durationInFrames * 0.55], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const pose = mixPose(POSES[startPose], POSES[endPose], act);
  const walking = s.x_to !== undefined;
  const px = walking ? interpolate(frame, [0, durationInFrames], [s.x ?? -200, s.x_to as number], CLAMP) : (s.x ?? -80);
  const blink = Math.floor(t * 3 + seed) % 7 === 0 && frame % 10 < 3;
  const glow = 0.85 + 0.15 * Math.sin(t * 3 + seed);

  // the right hand in world coordinates; the prop rides in it
  const R = armPoints(1, pose.r);
  const dx = R.hx - R.ex;
  const dy = R.hy - R.ey;
  const dl = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const handWX = px + PIP_SCALE * (R.hx + (dx / dl) * 34);
  const handWY = PIP_Y + PIP_SCALE * (R.hy + (dy / dl) * 34);
  const popAt = Math.round(durationInFrames * (isInsert ? 0.1 : 0.45));
  const pop = spring({ frame: frame - popAt, fps, config: { damping: 12 } });
  const showProp = !!s.prop && frame >= popAt;

  // camera focus
  const headY = PIP_Y - 352 * PIP_SCALE;
  const chestY = PIP_Y - 230 * PIP_SCALE;
  let fx = 0;
  let fy = -200;
  const f = s.focus;
  if (Array.isArray(f)) { fx = f[0]; fy = f[1]; }
  else if (f === 'window') { fx = ROOM_FOCUS[room].window[0]; fy = ROOM_FOCUS[room].window[1]; }
  else if (f === 'light') { fx = ROOM_FOCUS[room].light[0]; fy = ROOM_FOCUS[room].light[1]; }
  else if (f === 'prop' || (!f && shot === 'insert')) { fx = handWX; fy = handWY; }
  else if (shot === 'medium') { fx = px + 50; fy = chestY; }
  else if (shot === 'close') { fx = px + 25; fy = headY + 10; }
  else if (shot === 'insert') { fx = handWX; fy = handWY; }
  else if (f === 'pip') { fx = px; fy = chestY; }

  return (
    <Stage shot={shot} fx={fx} fy={fy} mood={mood} action={s.action}>
      <Room room={room} P={P} glow={glow} t={t} />
      {/* contact shadow so Pip stands on the floor */}
      <ellipse cx={px} cy={PIP_Y + 4} rx={92} ry={14} fill={P.shadow} opacity={0.55} />
      <g transform={`translate(${px} ${PIP_Y}) scale(${PIP_SCALE})`}>
        <Pip pose={pose} t={t} seed={seed} P={P} walk={walking} blink={blink} waveT={endPose === 'wave' && act > 0.9 ? t : undefined} />
      </g>
      {showProp ? (
        <g transform={`translate(${handWX} ${handWY}) scale(${Math.max(0.01, pop)})`}>
          <Prop kind={s.prop as string} P={P} scale={1.25} spin={(1 - Math.min(1, pop)) * -40} />
        </g>
      ) : null}
    </Stage>
  );
};

const Fact: React.FC<{ s: SceneSpec }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const P = PALETTES[s.mood || 'dusk'];
  const u = Math.min(width, height) / 1080;
  const p = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: P.floor, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 150 * u, color: P.accent, transform: `scale(${0.8 + 0.2 * p})`, opacity: p, textAlign: 'center', padding: `0 ${50 * u}px` }}>{s.number || '?'}</div>
      <div style={{ marginTop: 30 * u, fontFamily: MONO, fontSize: 40 * u, color: P.ink, textAlign: 'center', padding: `0 ${70 * u}px`, opacity: interpolate(frame, [10, 22], [0, 1], CLAMP) }}>{s.label || ''}</div>
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
