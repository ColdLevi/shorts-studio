import React from 'react';
import { INK, rand } from './theme';

// World space: Pip stands on y = 0, the wall meets the floor at y = -60, x = 0 is the middle of a 1080-wide frame.
// Every room has one visible light source, and tells Pip which side to put his rim light on.
export type RoomKind = 'study' | 'kitchen' | 'rooftop' | 'void';
export const ROOMS: Record<RoomKind, { rim: string; side: number }> = {
  study:   { rim: '#ffb36b', side: 1 },
  kitchen: { rim: '#ffd08a', side: 1 },
  rooftop: { rim: '#8fb8ff', side: -1 },
  void:    { rim: '#ff7ad9', side: 1 },
};
export const ROOM_NAMES = Object.keys(ROOMS) as RoomKind[];

const W = 1500, TOP = -1800, BOT = 1300, BASE = -60;

const Floor: React.FC<{ id: string; a: string; b: string; planks?: boolean }> = ({ id, a, b, planks }) => (
  <g>
    <defs><linearGradient id={`${id}-fl`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
    <rect x={-W} y={BASE} width={W * 2} height={BOT - BASE} fill={`url(#${id}-fl)`} />
    {planks ? [0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M${-W} ${BASE + 40 + i * i * 22} L${W} ${BASE + 40 + i * i * 22}`} stroke="#000" strokeOpacity="0.18" strokeWidth={2 + i} />) : null}
  </g>
);

const Study: React.FC<{ glow: number }> = ({ glow }) => (
  <g>
    <defs>
      <linearGradient id="st-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a1a48" /><stop offset="1" stopColor="#4a2f66" /></linearGradient>
      <linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b1b4a" /><stop offset="0.55" stopColor="#8a3f72" /><stop offset="1" stopColor="#f58f4d" /></linearGradient>
      <radialGradient id="st-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#ffd9a0" stopOpacity={0.6 * glow} /><stop offset="1" stopColor="#ffd9a0" stopOpacity="0" /></radialGradient>
    </defs>
    <rect x={-W} y={TOP} width={W * 2} height={BASE - TOP} fill="url(#st-wall)" />
    {/* window with a dusk sky */}
    <rect x="-450" y="-1060" width="320" height="420" rx="10" fill="url(#st-sky)" stroke="#ffb36b" strokeWidth="8" />
    <path d="M-290 -1060 L-290 -640 M-450 -850 L-130 -850" stroke="#ffb36b" strokeWidth="6" />
    <circle cx="-220" cy="-760" r="26" fill="#ffe7b8" opacity="0.85" />
    {/* shelf with books */}
    <rect x="150" y="-900" width="360" height="12" rx="3" fill="#6b4630" />
    {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={166 + i * 54} y={-900 - 60 - (i % 3) * 12} width="40" height={60 + (i % 3) * 12} rx="3" fill={['#e0654f', '#4f9de0', '#f5c542', '#7ed6a0', '#b07be0', '#ff9f5e'][i]} />)}
    {/* desk and lamp */}
    <circle cx="380" cy="-330" r="420" fill="url(#st-glow)" />
    <rect x="200" y="-190" width="360" height="26" rx="5" fill="#6b4630" /><rect x="236" y="-164" width="16" height="104" fill="#53382a" /><rect x="508" y="-164" width="16" height="104" fill="#53382a" />
    <path d="M440 -190 L440 -330 L390 -400" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
    <path d="M345 -410 L412 -424 L398 -372 Z" fill="#ffd9a0" />
    <Floor id="st" a="#1f1233" b="#150c26" planks />
  </g>
);

const Kitchen: React.FC<{ glow: number }> = ({ glow }) => (
  <g>
    <defs>
      <linearGradient id="kt-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b2430" /><stop offset="1" stopColor="#6a4034" /></linearGradient>
      <radialGradient id="kt-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#ffd9a0" stopOpacity={0.65 * glow} /><stop offset="1" stopColor="#ffd9a0" stopOpacity="0" /></radialGradient>
    </defs>
    <rect x={-W} y={TOP} width={W * 2} height={BASE - TOP} fill="url(#kt-wall)" />
    {/* tile backsplash */}
    {Array.from({ length: 9 }).map((_, r) => Array.from({ length: 12 }).map((__, c) => <rect key={`${r}-${c}`} x={-360 + c * 90} y={-620 + r * 62} width="84" height="56" rx="4" fill="#f1dfc9" opacity={0.12 + ((r + c) % 2) * 0.05} />))}
    {/* night window */}
    <rect x="-470" y="-1120" width="300" height="340" rx="10" fill="#10233f" stroke="#ffd08a" strokeWidth="8" />
    <circle cx="-330" cy="-990" r="30" fill="#f3efe0" /><path d="M-470 -950 L-170 -950" stroke="#ffd08a" strokeWidth="5" />
    {/* hanging pendant lamp */}
    <path d="M0 -1800 L0 -1010" stroke={INK} strokeWidth="5" />
    <circle cx="0" cy="-900" r="520" fill="url(#kt-glow)" />
    <path d="M-70 -1000 Q0 -1100 70 -1000 Z" fill="#ffd9a0" stroke={INK} strokeWidth="4" />
    {/* counter with cabinet doors */}
    <rect x="170" y="-260" width="420" height="24" rx="4" fill="#d9c7a8" />
    <rect x="190" y="-236" width="380" height="176" fill="#7b4f3c" />
    <path d="M380 -236 L380 -60" stroke="#00000044" strokeWidth="4" /><circle cx="360" cy="-150" r="7" fill={INK} /><circle cx="400" cy="-150" r="7" fill={INK} />
    <Floor id="kt" a="#2a1a22" b="#1a1018" />
  </g>
);

const Rooftop: React.FC<{ glow: number }> = ({ glow }) => (
  <g>
    <defs>
      <linearGradient id="rf-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1030" /><stop offset="0.6" stopColor="#2a2a6a" /><stop offset="1" stopColor="#8a5aa8" /></linearGradient>
      <radialGradient id="rf-moon" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#bcd4ff" stopOpacity={0.45 * glow} /><stop offset="1" stopColor="#bcd4ff" stopOpacity="0" /></radialGradient>
    </defs>
    <rect x={-W} y={TOP} width={W * 2} height={BASE - TOP + 40} fill="url(#rf-sky)" />
    {Array.from({ length: 46 }).map((_, i) => <circle key={i} cx={-W + rand(i + 1) * W * 2} cy={TOP + rand(i + 99) * 1500} r={1.5 + rand(i + 7) * 3} fill="#fff" opacity={0.35 + rand(i + 3) * 0.6} />)}
    <circle cx="-260" cy="-1000" r="330" fill="url(#rf-moon)" /><circle cx="-260" cy="-1000" r="86" fill="#eef3ff" />
    {/* skyline, two layers */}
    {Array.from({ length: 12 }).map((_, i) => { const h = 160 + rand(i + 20) * 340; return <rect key={`a${i}`} x={-W + i * 260} y={BASE - 60 - h} width="220" height={h + 60} fill="#1a1a45" />; })}
    {Array.from({ length: 16 }).map((_, i) => { const h = 90 + rand(i + 50) * 260; return <g key={`b${i}`}><rect x={-W + i * 190 + 40} y={BASE - h} width="150" height={h} fill="#0f0f2e" />{[0, 1, 2].map((k) => <rect key={k} x={-W + i * 190 + 62 + k * 40} y={BASE - h + 26 + ((i + k) % 3) * 34} width="14" height="18" fill="#ffd36b" opacity={rand(i * 5 + k) > 0.45 ? 0.9 : 0.15} />)}</g>; })}
    {/* roof edge */}
    <rect x={-W} y={BASE - 16} width={W * 2} height="22" fill="#2a2a50" />
    <Floor id="rf" a="#1d1c3d" b="#0e0d24" />
  </g>
);

const Void: React.FC<{ glow: number }> = ({ glow }) => (
  <g>
    <defs>
      <linearGradient id="vd-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d0820" /><stop offset="1" stopColor="#3a1856" /></linearGradient>
      <radialGradient id="vd-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#ff7ad9" stopOpacity={0.35 * glow} /><stop offset="1" stopColor="#ff7ad9" stopOpacity="0" /></radialGradient>
    </defs>
    <rect x={-W} y={TOP} width={W * 2} height={BASE - TOP + 40} fill="url(#vd-bg)" />
    <circle cx="300" cy="-700" r="520" fill="url(#vd-glow)" />
    {Array.from({ length: 30 }).map((_, i) => <circle key={i} cx={-700 + rand(i + 11) * 1400} cy={-1500 + rand(i + 31) * 1400} r={2 + rand(i + 5) * 5} fill="#ffd6f4" opacity={0.2 + rand(i) * 0.5} />)}
    <rect x={-W} y={BASE} width={W * 2} height={BOT - BASE} fill="#150a2a" />
    {/* perspective grid floor */}
    {Array.from({ length: 17 }).map((_, i) => <path key={`v${i}`} d={`M${(i - 8) * 60} ${BASE} L${(i - 8) * 340} ${BOT}`} stroke="#ff7ad9" strokeOpacity="0.28" strokeWidth="3" />)}
    {[0, 1, 2, 3, 4, 5].map((i) => <path key={`h${i}`} d={`M${-W} ${BASE + 30 + i * i * 34} L${W} ${BASE + 30 + i * i * 34}`} stroke="#ff7ad9" strokeOpacity="0.28" strokeWidth="3" />)}
  </g>
);

export const Room: React.FC<{ kind: RoomKind; glow: number }> = ({ kind, glow }) => {
  switch (kind) {
    case 'kitchen': return <Kitchen glow={glow} />;
    case 'rooftop': return <Rooftop glow={glow} />;
    case 'void': return <Void glow={glow} />;
    default: return <Study glow={glow} />;
  }
};
