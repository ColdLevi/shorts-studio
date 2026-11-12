import React from 'react';
import { INK, ACCENT } from './theme';

// Every prop is drawn around (0,0), roughly 80 units across. Same outline weight as Pip so they belong together.
const S = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

export const PROP_NAMES = ['cookie', 'phone', 'coin', 'bulb', 'globe', 'laptop', 'box', 'battery', 'rocket'] as const;

export const Prop: React.FC<{ kind: string }> = ({ kind }) => {
  switch (kind) {
    case 'cookie':
      return <g {...S}><circle r="34" fill="#c98a4b" /><circle cx="-11" cy="-9" r="5" fill="#4a2c1a" stroke="none" /><circle cx="12" cy="5" r="5" fill="#4a2c1a" stroke="none" /><circle cx="-4" cy="17" r="4" fill="#4a2c1a" stroke="none" /><circle cx="10" cy="-18" r="3.5" fill="#4a2c1a" stroke="none" /></g>;
    case 'phone':
      return <g {...S}><rect x="-22" y="-38" width="44" height="76" rx="9" fill="#1b1030" /><rect x="-16" y="-30" width="32" height="54" rx="3" fill="#6ad0ff" stroke="none" /><circle cy="31" r="3" fill={INK} stroke="none" /></g>;
    case 'coin':
      return <g {...S}><circle r="33" fill="#f5c542" /><circle r="22" fill="none" strokeWidth="3" /><path d="M0 -12 L0 12 M-8 -5 L8 -5 M-8 5 L8 5" strokeWidth="3" /></g>;
    case 'bulb':
      return <g {...S}><circle cy="-8" r="26" fill="#ffe27a" /><rect x="-12" y="17" width="24" height="16" rx="4" fill="#9aa0ad" /><path d="M-6 -2 L0 12 L6 -2" fill="none" strokeWidth="3" /></g>;
    case 'globe':
      return <g {...S}><circle r="33" fill="#2d7fd6" /><path d="M-18 -14 Q-6 -24 6 -14 Q12 -4 0 4 Q-12 2 -18 -14 Z" fill="#4fbf6a" stroke="none" /><path d="M8 10 Q20 6 24 16 Q16 26 8 20 Z" fill="#4fbf6a" stroke="none" /><ellipse rx="14" ry="33" fill="none" strokeWidth="2.5" /></g>;
    case 'laptop':
      return <g {...S}><rect x="-34" y="-30" width="68" height="44" rx="5" fill="#1b1030" /><rect x="-28" y="-24" width="56" height="32" fill="#7ee0a8" stroke="none" /><path d="M-42 20 L42 20 L34 14 L-34 14 Z" fill="#9aa0ad" /></g>;
    case 'box':
      return <g {...S}><rect x="-32" y="-28" width="64" height="56" rx="4" fill="#c98a4b" /><path d="M-32 -12 L32 -12 M0 -28 L0 -12" fill="none" /></g>;
    case 'battery':
      return <g {...S}><rect x="-36" y="-20" width="66" height="40" rx="7" fill="#2b2140" /><rect x="30" y="-9" width="8" height="18" rx="2" fill={INK} /><path d="M-2 -14 L-14 2 L-2 2 L-6 14 L10 -4 L-2 -4 Z" fill={ACCENT} stroke="none" /></g>;
    case 'rocket':
      return <g {...S}><path d="M0 -42 Q22 -18 14 26 L-14 26 Q-22 -18 0 -42 Z" fill="#e6e9f2" /><circle cy="-10" r="8" fill="#6ad0ff" /><path d="M-14 12 L-28 30 L-14 26 Z M14 12 L28 30 L14 26 Z" fill="#ff6b5e" /><path d="M-8 30 Q0 52 8 30 Z" fill={ACCENT} stroke="none" /></g>;
    default:
      return <g {...S}><rect x="-26" y="-26" width="52" height="52" rx="8" fill={ACCENT} /></g>;
  }
};
