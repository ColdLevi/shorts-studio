// What If pack: small props. Each is drawn around (0,0) at roughly 70 units across, so one scale rule fits all of them.
import React from 'react';
import { Palette } from './tokens';

export type PropName = 'cookie' | 'laptop' | 'cup' | 'phone' | 'bulb' | 'clock' | 'box' | 'coin';
export const PROP_NAMES: PropName[] = ['cookie', 'laptop', 'cup', 'phone', 'bulb', 'clock', 'box', 'coin'];

export const Prop: React.FC<{ kind: string; P: Palette; scale?: number; spin?: number }> = ({ kind, P, scale = 1, spin = 0 }) => {
  const line = { stroke: P.ink, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  let art: React.ReactNode;
  switch (kind) {
    case 'cookie':
      art = (<g><circle r={36} fill="#c98a4b" {...line} /><circle cx={-11} cy={-9} r={5.5} fill="#4a2c1a" /><circle cx={13} cy={7} r={5.5} fill="#4a2c1a" /><circle cx={-4} cy={18} r={4.5} fill="#4a2c1a" /><circle cx={16} cy={-18} r={4} fill="#4a2c1a" /></g>);
      break;
    case 'laptop':
      art = (<g><rect x={-38} y={-28} width={76} height={50} rx={5} fill={P.head} {...line} /><rect x={-28} y={-20} width={56} height={34} rx={2} fill={P.accent} opacity={0.9} /><path d="M-48 28 L48 28 L38 22 L-38 22 Z" fill={P.ink} /></g>);
      break;
    case 'cup':
      art = (<g><path d="M-28 -26 L28 -26 L22 28 L-22 28 Z" fill={P.ink} /><path d="M28 -14 Q50 -10 44 8 Q40 18 24 16" fill="none" {...line} /><path d="M-10 -40 Q-4 -52 -10 -62 M8 -40 Q14 -52 8 -62" fill="none" stroke={P.ink} strokeOpacity={0.6} strokeWidth={4} strokeLinecap="round" /></g>);
      break;
    case 'phone':
      art = (<g><rect x={-22} y={-40} width={44} height={80} rx={8} fill={P.head} {...line} /><rect x={-16} y={-30} width={32} height={50} rx={3} fill={P.rim} opacity={0.9} /><circle cx={0} cy={30} r={3.5} fill={P.ink} /></g>);
      break;
    case 'bulb':
      art = (<g><circle cx={0} cy={-8} r={28} fill={P.accent} {...line} /><rect x={-14} y={18} width={28} height={20} rx={4} fill={P.ink} /><path d="M-10 -6 L0 6 L10 -6" fill="none" stroke={P.head} strokeWidth={4} strokeLinecap="round" /></g>);
      break;
    case 'clock':
      art = (<g><circle r={36} fill={P.ink} /><line x1={0} y1={0} x2={0} y2={-24} stroke={P.head} strokeWidth={5} strokeLinecap="round" /><line x1={0} y1={0} x2={18} y2={8} stroke={P.head} strokeWidth={5} strokeLinecap="round" /></g>);
      break;
    case 'coin':
      art = (<g><circle r={34} fill={P.accent} {...line} /><circle r={22} fill="none" stroke={P.wood} strokeWidth={4} /><text x={0} y={9} textAnchor="middle" fontSize={26} fontWeight={900} fill={P.wood}>$</text></g>);
      break;
    case 'box':
    default:
      art = (<g><rect x={-32} y={-32} width={64} height={64} rx={8} fill={P.accent} {...line} /><line x1={-32} y1={-8} x2={32} y2={-8} {...line} /></g>);
  }
  return <g transform={`scale(${scale}) rotate(${spin})`}>{art}</g>;
};
