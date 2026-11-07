// Pip: one code-drawn stick-figure rig. The same function draws the hero in every shot, so nothing drifts between cuts.
// Origin (0,0) is the point between the feet on the floor; the figure is about 400 units tall.
import React from 'react';
import { Palette } from './tokens';

export type Face = 'smile' | 'grin' | 'shock' | 'think' | 'flat';
export type PoseName = 'idle' | 'reach' | 'hold' | 'point' | 'shock' | 'think' | 'wave' | 'walk';

// Arms: [shoulder angle, elbow bend]. Angle 0 = hanging straight down, 90 = straight out sideways, 180 = straight up.
// The right arm swings toward +x (screen right), the left arm mirrors it.
type Pose = { r: [number, number]; l: [number, number]; face: Face; lean: number; tilt: number };

export const POSES: Record<PoseName, Pose> = {
  idle: { r: [14, 10], l: [14, 10], face: 'smile', lean: 0, tilt: 0 },
  reach: { r: [100, 6], l: [16, 10], face: 'smile', lean: 3, tilt: 0 },
  hold: { r: [42, 100], l: [14, 10], face: 'grin', lean: 0, tilt: 0 },
  point: { r: [96, 0], l: [14, 10], face: 'grin', lean: 3, tilt: -2 },
  shock: { r: [150, 18], l: [150, 18], face: 'shock', lean: -3, tilt: 0 },
  think: { r: [42, 138], l: [14, 10], face: 'think', lean: 0, tilt: 6 },
  wave: { r: [150, 28], l: [14, 10], face: 'grin', lean: 0, tilt: 3 },
  walk: { r: [22, 10], l: [22, 10], face: 'smile', lean: 2, tilt: 0 },
};

export const mixPose = (a: Pose, b: Pose, k: number): Pose => ({
  r: [a.r[0] + (b.r[0] - a.r[0]) * k, a.r[1] + (b.r[1] - a.r[1]) * k],
  l: [a.l[0] + (b.l[0] - a.l[0]) * k, a.l[1] + (b.l[1] - a.l[1]) * k],
  face: k < 0.5 ? a.face : b.face,
  lean: a.lean + (b.lean - a.lean) * k,
  tilt: a.tilt + (b.tilt - a.tilt) * k,
});

const HIP = { x: 0, y: -150 };
const SHOULDER_Y = -290;
const SHOULDER_X = 20;
const UPPER = 78;
const FORE = 72;
const HEAD_Y = -352;
const HEAD_R = 52;
const rad = (d: number) => (d * Math.PI) / 180;

// Forward kinematics for one arm. side = +1 for the right arm, -1 for the left.
export const armPoints = (side: 1 | -1, a: [number, number]) => {
  const sx = side * SHOULDER_X;
  const ex = sx + side * UPPER * Math.sin(rad(a[0]));
  const ey = SHOULDER_Y + UPPER * Math.cos(rad(a[0]));
  const fa = a[0] + a[1];
  const hx = ex + side * FORE * Math.sin(rad(fa));
  const hy = ey + FORE * Math.cos(rad(fa));
  return { sx, ex, ey, hx, hy };
};

// Where the right hand is, in Pip's own coordinates (used to put a prop in the hand).
export const rightHand = (pose: Pose) => {
  const p = armPoints(1, pose.r);
  return { x: p.hx, y: p.hy };
};

const Eyes: React.FC<{ face: Face; blink: boolean; P: Palette }> = ({ face, blink, P }) => {
  const y = HEAD_Y - 6;
  if (face === 'shock') {
    return (
      <g>
        <circle cx={-18} cy={y} r={11} fill={P.ink} stroke="none" /><circle cx={18} cy={y} r={11} fill={P.ink} stroke="none" />
        <circle cx={-18} cy={y} r={4} fill={P.head} stroke="none" /><circle cx={18} cy={y} r={4} fill={P.head} stroke="none" />
      </g>
    );
  }
  if (blink) {
    return (<g><line x1={-26} y1={y} x2={-10} y2={y} strokeWidth={5} /><line x1={10} y1={y} x2={26} y2={y} strokeWidth={5} /></g>);
  }
  return (<g><circle cx={-18} cy={y} r={6} fill={P.ink} stroke="none" /><circle cx={18} cy={y} r={6} fill={P.ink} stroke="none" /></g>);
};

const Brows: React.FC<{ face: Face }> = ({ face }) => {
  const y = HEAD_Y - 28;
  if (face === 'shock') return (<g><line x1={-28} y1={y - 8} x2={-8} y2={y - 12} strokeWidth={5} /><line x1={8} y1={y - 12} x2={28} y2={y - 8} strokeWidth={5} /></g>);
  if (face === 'think') return (<g><line x1={-28} y1={y} x2={-8} y2={y - 2} strokeWidth={5} /><line x1={8} y1={y - 12} x2={28} y2={y - 6} strokeWidth={5} /></g>);
  if (face === 'grin') return (<g><line x1={-28} y1={y - 2} x2={-8} y2={y - 6} strokeWidth={5} /><line x1={8} y1={y - 6} x2={28} y2={y - 2} strokeWidth={5} /></g>);
  return null;
};

const Mouth: React.FC<{ face: Face; P: Palette }> = ({ face, P }) => {
  const y = HEAD_Y + 22;
  if (face === 'shock') return <ellipse cx={0} cy={y + 4} rx={11} ry={15} fill={P.ink} stroke="none" />;
  if (face === 'grin') return <path d={`M-22 ${y - 6} Q0 ${y + 24} 22 ${y - 6} Z`} fill={P.ink} stroke="none" />;
  if (face === 'think') return <path d={`M-14 ${y + 2} Q0 ${y - 4} 16 ${y - 2}`} strokeWidth={5} />;
  if (face === 'flat') return <line x1={-14} y1={y} x2={14} y2={y} strokeWidth={5} />;
  return <path d={`M-18 ${y - 4} Q0 ${y + 14} 18 ${y - 4}`} strokeWidth={5} />;
};

// Body (no head) as strokes only, so it can be drawn twice: once in the warm rim color (offset), once in ink on top.
const Body: React.FC<{ pose: Pose; legs: number; P: Palette }> = ({ pose, legs, P }) => {
  const R = armPoints(1, pose.r);
  const L = armPoints(-1, pose.l);
  const fl = 30 + legs; // left foot x (magnitude)
  const fr = 30 - legs;
  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      {/* legs with a small foot each */}
      <line x1={HIP.x} y1={HIP.y} x2={-fl} y2={-6} />
      <line x1={HIP.x} y1={HIP.y} x2={fr} y2={-6} />
      <line x1={-fl} y1={-6} x2={-fl - 20} y2={-6} />
      <line x1={fr} y1={-6} x2={fr + 20} y2={-6} />
      {/* torso and neck */}
      <line x1={0} y1={HIP.y} x2={0} y2={SHOULDER_Y} />
      <line x1={0} y1={SHOULDER_Y} x2={0} y2={HEAD_Y + HEAD_R - 2} />
      {/* arms: shoulder, elbow, hand; each arm ends in a visible hand */}
      <polyline points={`${L.sx},${SHOULDER_Y} ${L.ex},${L.ey} ${L.hx},${L.hy}`} />
      <polyline points={`${R.sx},${SHOULDER_Y} ${R.ex},${R.ey} ${R.hx},${R.hy}`} />
      <circle cx={L.hx} cy={L.hy} r={9} fill={P.ink} stroke="none" />
      <circle cx={R.hx} cy={R.hy} r={9} fill={P.ink} stroke="none" />
    </g>
  );
};

const Head: React.FC<{ pose: Pose; blink: boolean; P: Palette; face: boolean }> = ({ pose, blink, P, face }) => (
  <g transform={`rotate(${pose.tilt} 0 ${HEAD_Y + 44})`} strokeLinecap="round" fill="none">
    <circle cx={0} cy={HEAD_Y} r={HEAD_R} fill={P.head} />
    {face ? (
      <g>
        <Eyes face={pose.face} blink={blink} P={P} />
        <Brows face={pose.face} />
        <Mouth face={pose.face} P={P} />
      </g>
    ) : null}
  </g>
);

export const Pip: React.FC<{ pose: Pose; t: number; seed: number; P: Palette; walk?: boolean; blink?: boolean; waveT?: number }> = ({ pose, t, seed, P, walk, blink, waveT }) => {
  const breathe = Math.sin(t * 2 + seed) * 2.5;
  const swing = walk ? Math.sin(t * 8) : 0;
  let p = pose;
  if (walk) p = { ...pose, r: [22 + swing * 22, 10], l: [22 - swing * 22, 10] };
  if (waveT !== undefined) p = { ...p, r: [p.r[0], p.r[1] + Math.sin(waveT * 9) * 22] };
  const legs = walk ? swing * 22 : 0;
  const bob = walk ? Math.abs(Math.sin(t * 8)) * -6 : breathe;
  const sw = 10;
  return (
    <g transform={`translate(0 ${bob}) rotate(${p.lean} 0 -150)`}>
      {/* rim light: the same figure again in the warm color, nudged toward the lamp, behind the ink */}
      <g transform="translate(5 -1)" stroke={P.rim} strokeWidth={sw + 3} opacity={0.9}>
        <Body pose={p} legs={legs} P={P} />
        <Head pose={p} blink={!!blink} P={P} face={false} />
      </g>
      <g stroke={P.ink} strokeWidth={sw}>
        <Body pose={p} legs={legs} P={P} />
        <Head pose={p} blink={!!blink} P={P} face />
      </g>
    </g>
  );
};
