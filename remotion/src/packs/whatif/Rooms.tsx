// What If pack: three rooms. World units: y = 0 is the floor line where Pip stands, x = 0 is the middle of the frame.
// Each room is drawn wider and taller than the screen so the camera can push in and move without showing an edge.
import React from 'react';
import { Palette } from './tokens';

export type RoomName = 'desk' | 'kitchen' | 'street';
export const ROOM_NAMES: RoomName[] = ['desk', 'kitchen', 'street'];

type RoomProps = { P: Palette; glow: number; t: number };

const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

const Defs: React.FC<{ P: Palette; glow: number; id: string }> = ({ P, glow, id }) => (
  <defs>
    <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={P.skyTop} /><stop offset="0.55" stopColor={P.skyMid} /><stop offset="1" stopColor={P.skyLow} />
    </linearGradient>
    <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor={P.lamp} stopOpacity={Math.min(0.9, 0.6 * glow)} /><stop offset="1" stopColor={P.lamp} stopOpacity="0" />
    </radialGradient>
    <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={P.floor2} /><stop offset="1" stopColor={P.floor} />
    </linearGradient>
  </defs>
);

const Floor: React.FC<{ P: Palette; id: string; planks?: boolean }> = ({ P, id, planks }) => (
  <g>
    <rect x={-1000} y={0} width={2000} height={1600} fill={`url(#${id}-floor)`} />
    {planks ? [60, 150, 260, 400, 580, 800].map((y) => <line key={y} x1={-1000} y1={y} x2={1000} y2={y} stroke={P.shadow} strokeOpacity={0.35} strokeWidth={3} />) : null}
    <rect x={-1000} y={-18} width={2000} height={18} fill={P.wall2} />
  </g>
);

const Window: React.FC<{ P: Palette; id: string; x: number; y: number; w: number; h: number }> = ({ P, id, x, y, w, h }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={10} fill={`url(#${id}-sky)`} stroke={P.rim} strokeWidth={7} />
    <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={P.rim} strokeWidth={5} />
    <line x1={x} y1={y + h * 0.5} x2={x + w} y2={y + h * 0.5} stroke={P.rim} strokeWidth={5} />
    <rect x={x - 12} y={y + h} width={w + 24} height={16} rx={4} fill={P.rim} opacity={0.85} />
  </g>
);

export const DeskRoom: React.FC<RoomProps> = ({ P, glow }) => (
  <g>
    <Defs P={P} glow={glow} id="dk" />
    <rect x={-1000} y={-1400} width={2000} height={1400} fill={P.wall} />
    {/* soft wall panel line for depth */}
    <rect x={-1000} y={-260} width={2000} height={242} fill={P.wall2} opacity={0.55} />
    <Window P={P} id="dk" x={-420} y={-760} w={330} h={430} />
    {/* framed picture */}
    <rect x={150} y={-700} width={150} height={190} rx={6} fill={P.wall2} stroke={P.ink} strokeOpacity={0.5} strokeWidth={5} />
    <circle cx={225} cy={-630} r={30} fill={P.rim} opacity={0.7} />
    <Floor P={P} id="dk" planks />
    {/* rug under Pip */}
    <ellipse cx={-40} cy={90} rx={330} ry={46} fill={P.wall} opacity={0.9} />
    <ellipse cx={-40} cy={90} rx={330} ry={46} fill="none" stroke={P.rim} strokeOpacity={0.35} strokeWidth={4} />
    {/* desk with a lamp: the lamp sits ON the desk and throws the glow */}
    <circle cx={330} cy={-250} r={380} fill="url(#dk-glow)" />
    <rect x={190} y={-170} width={360} height={26} rx={6} fill={P.wood} />
    <rect x={210} y={-144} width={22} height={150} fill={P.wood} />
    <rect x={508} y={-144} width={22} height={150} fill={P.wood} />
    <path d="M400 -170 L400 -270 L350 -330" stroke={P.ink} strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M300 -350 L368 -362 L350 -300 Z" fill={P.lamp} />
    <rect x={375} y={-176} width={50} height={10} rx={5} fill={P.ink} />
  </g>
);

export const KitchenRoom: React.FC<RoomProps> = ({ P, glow }) => (
  <g>
    <Defs P={P} glow={glow} id="kt" />
    <rect x={-1000} y={-1400} width={2000} height={1400} fill={P.wall} />
    {/* tile grid */}
    {Array.from({ length: 14 }).map((_, i) => <line key={`v${i}`} x1={-700 + i * 100} y1={-440} x2={-700 + i * 100} y2={-18} stroke={P.wall2} strokeWidth={3} />)}
    {[-340, -240, -140].map((y) => <line key={y} x1={-1000} y1={y} x2={1000} y2={y} stroke={P.wall2} strokeWidth={3} />)}
    <Window P={P} id="kt" x={-120} y={-780} w={250} h={300} />
    {/* fridge on the left */}
    <rect x={-560} y={-640} width={190} height={622} rx={14} fill={P.wall2} stroke={P.ink} strokeOpacity={0.45} strokeWidth={5} />
    <line x1={-560} y1={-400} x2={-370} y2={-400} stroke={P.ink} strokeOpacity={0.45} strokeWidth={5} />
    <rect x={-390} y={-560} width={8} height={90} rx={4} fill={P.ink} opacity={0.7} />
    <Floor P={P} id="kt" />
    {/* counter and cabinets on the right */}
    <circle cx={330} cy={-420} r={420} fill="url(#kt-glow)" />
    <rect x={160} y={-300} width={440} height={282} fill={P.wood} />
    <line x1={380} y1={-300} x2={380} y2={-18} stroke={P.shadow} strokeOpacity={0.5} strokeWidth={4} />
    <rect x={150} y={-326} width={460} height={28} rx={6} fill={P.ink} opacity={0.85} />
    {/* pendant lamp */}
    <line x1={330} y1={-1400} x2={330} y2={-720} stroke={P.ink} strokeWidth={4} />
    <path d="M270 -720 Q330 -790 390 -720 Z" fill={P.lamp} />
  </g>
);

export const StreetRoom: React.FC<RoomProps> = ({ P, glow }) => {
  const buildings: React.ReactElement[] = [];
  let x = -900;
  let i = 0;
  while (x < 900) {
    const w = 110 + hash(i) * 130;
    const h = 260 + hash(i + 9) * 520;
    buildings.push(<rect key={`b${i}`} x={x} y={-h} width={w} height={h} fill={P.wall2} />);
    for (let wy = -h + 40; wy < -50; wy += 56) {
      for (let wx = x + 18; wx < x + w - 30; wx += 40) {
        const on = hash(i * 31 + wx * 0.37 + wy * 0.11) > 0.62;
        buildings.push(<rect key={`w${i}-${wx}-${wy}`} x={wx} y={wy} width={20} height={28} fill={on ? P.lamp : P.wall} opacity={on ? 0.85 : 0.6} />);
      }
    }
    x += w + 8;
    i += 1;
  }
  return (
    <g>
      <Defs P={P} glow={glow} id="st" />
      <rect x={-1000} y={-1500} width={2000} height={1500} fill="url(#st-sky)" />
      {/* a few stars high up */}
      {Array.from({ length: 14 }).map((_, k) => <circle key={k} cx={-520 + hash(k) * 1040} cy={-1150 + hash(k + 40) * 380} r={2 + hash(k + 7) * 2.5} fill={P.ink} opacity={0.7} />)}
      <circle cx={-250} cy={-640} r={46} fill={P.ink} opacity={0.9} />
      {buildings}
      {/* sidewalk, curb and street */}
      <rect x={-1000} y={0} width={2000} height={1600} fill={P.floor} />
      <rect x={-1000} y={0} width={2000} height={150} fill={P.floor2} />
      <rect x={-1000} y={148} width={2000} height={10} fill={P.rim} opacity={0.45} />
      {[-600, -200, 200, 600].map((cx) => <line key={cx} x1={cx - 70} y1={420} x2={cx + 70} y2={420} stroke={P.ink} strokeOpacity={0.35} strokeWidth={10} strokeLinecap="round" />)}
      {/* street lamp throws the glow */}
      <circle cx={300} cy={-520} r={460} fill="url(#st-glow)" />
      <line x1={330} y1={30} x2={330} y2={-560} stroke={P.ink} strokeWidth={12} strokeLinecap="round" />
      <path d="M330 -560 Q330 -610 270 -610" stroke={P.ink} strokeWidth={10} fill="none" strokeLinecap="round" />
      <ellipse cx={262} cy={-600} rx={36} ry={14} fill={P.lamp} />
    </g>
  );
};

export const Room: React.FC<RoomProps & { room: RoomName }> = ({ room, ...rest }) => {
  if (room === 'kitchen') return <KitchenRoom {...rest} />;
  if (room === 'street') return <StreetRoom {...rest} />;
  return <DeskRoom {...rest} />;
};

// Where the main light is and where things worth looking at sit in each room (world coords), used by the camera focus options.
export const ROOM_FOCUS: Record<RoomName, { window: [number, number]; light: [number, number] }> = {
  desk: { window: [-255, -545], light: [330, -300] },
  kitchen: { window: [5, -630], light: [330, -740] },
  street: { window: [-250, -640], light: [270, -600] },
};
