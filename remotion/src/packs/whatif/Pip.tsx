import React from 'react';
import { INK, DARK, PS } from './theme';
import { Joints, HEAD_RADIUS, Eyes, Mouth, P2 } from './rig';

const ln = (a: P2, b: P2) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;

const Face: React.FC<{ eyes: Eyes; mouth: Mouth; blink: boolean }> = ({ eyes, mouth, blink }) => {
  const e = blink && eyes === 'open' ? 'closed' : eyes;
  const eye = (x: number) => {
    if (e === 'closed') return <path key={x} d={`M${x - 9} -4 L${x + 9} -4`} stroke={INK} strokeWidth="5" strokeLinecap="round" />;
    if (e === 'happy') return <path key={x} d={`M${x - 9} 0 Q${x} -12 ${x + 9} 0`} stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />;
    if (e === 'wide') return <g key={x}><circle cx={x} cy={-4} r="10" fill="none" stroke={INK} strokeWidth="4" /><circle cx={x} cy={-4} r="4" fill={INK} /></g>;
    return <circle key={x} cx={x} cy={-4} r="5.5" fill={INK} />;
  };
  const brows = e === 'wide'
    ? <g stroke={INK} strokeWidth="4" strokeLinecap="round"><path d="M-27 -24 L-9 -28" /><path d="M9 -28 L27 -24" /></g> : null;
  const m: Record<Mouth, React.ReactNode> = {
    smile: <path d="M-13 17 Q0 28 13 17" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />,
    flat: <path d="M-11 20 L11 20" stroke={INK} strokeWidth="5" strokeLinecap="round" />,
    o: <ellipse cx="0" cy="21" rx="6.5" ry="8" fill="none" stroke={INK} strokeWidth="4.5" />,
    open: <path d="M-12 16 Q0 36 12 16 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />,
    grin: <path d="M-17 14 Q0 40 17 14 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />,
  };
  return <g>{eye(-17)}{eye(17)}{brows}{m[mouth]}</g>;
};

export const Pip: React.FC<{ j: Joints; eyes: Eyes; mouth: Mouth; blink: boolean; rimSide: number; rim: string; x: number; lw?: number }> = ({ j, eyes, mouth, blink, rimSide, rim, x, lw = 1 }) => {
  const sw = 10.5 * lw;
  const side = rimSide >= 0 ? 1 : -1;
  const rimArm = side > 0 ? [j.rSh, j.rEl, j.rHand] : [j.lSh, j.lEl, j.lHand];
  return (
    <g transform={`translate(${x}, 0) scale(${PS})`} stroke={INK} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {/* legs and feet */}
      <path d={`${ln(j.hip, j.lKnee)} ${ln(j.lKnee, j.lFoot)} ${ln(j.hip, j.rKnee)} ${ln(j.rKnee, j.rFoot)}`} />
      <path d={`${ln(j.lFoot, [j.lFoot[0] + 14, j.lFoot[1]])} ${ln(j.rFoot, [j.rFoot[0] + 14, j.rFoot[1]])}`} strokeWidth={sw - 1} />
      {/* torso and shoulders */}
      <path d={`${ln(j.hip, j.neck)} ${ln(j.lSh, j.rSh)}`} />
      {/* arms */}
      <path d={`${ln(j.lSh, j.lEl)} ${ln(j.lEl, j.lHand)} ${ln(j.rSh, j.rEl)} ${ln(j.rEl, j.rHand)}`} />
      {/* rim light on the arm nearest the light */}
      <path d={`${ln(rimArm[0], rimArm[1])} ${ln(rimArm[1], rimArm[2])}`} stroke={rim} strokeWidth="3" opacity="0.55" transform={`translate(${side * 3}, -2)`} />
      {/* hands */}
      <circle cx={j.lHand[0]} cy={j.lHand[1]} r="6.5" fill={INK} stroke="none" />
      <circle cx={j.rHand[0]} cy={j.rHand[1]} r="6.5" fill={INK} stroke="none" />
      {/* head */}
      <g transform={`translate(${j.head[0].toFixed(1)} ${j.head[1].toFixed(1)}) rotate(${j.headAngle.toFixed(1)})`}>
        <circle r={HEAD_RADIUS} fill={DARK} strokeWidth={9.5 * lw} />
        <path d={side > 0 ? 'M35 -30 A46 46 0 0 1 35 30' : 'M-35 -30 A46 46 0 0 0 -35 30'} stroke={rim} strokeWidth="6" opacity="0.9" />
        <Face eyes={eyes} mouth={mouth} blink={blink} />
      </g>
    </g>
  );
};
