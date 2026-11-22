// desk.tsx: the workstation Pip sits at: chair, desk, keyboard, a monitor that fills with lines of text, and a calculator with real key presses.
import React from 'react';
import { interpolate } from 'remotion';
import { ACCENT, CLAMP, INK, MONO } from './theme';
import { calcView } from './desk-math';

export type ScreenSpec = { title?: string; lines?: string[]; tone?: string[] };

const KEYS = [['7', '8', '9', '/'], ['4', '5', '6', '*'], ['1', '2', '3', '-'], ['0', '.', '=', '+']];
const LABEL: Record<string, string> = { '*': 'x' };

const Calculator: React.FC<{ keys: string; f: number }> = ({ keys, f }) => {
  const v = calcView(keys, f);
  return (
    <g transform="translate(520 -500) rotate(-3)">
      <rect x="-110" y="0" width="220" height="300" rx="22" fill="#2b2140" stroke={INK} strokeWidth="4" />
      <rect x="-92" y="16" width="184" height="76" rx="8" fill="#0f2a1f" />
      <text x="84" y="38" textAnchor="end" fontFamily={MONO} fontSize="16" fill="#4fbf8a">{v.line.slice(-16)}</text>
      <text x="84" y="80" textAnchor="end" fontFamily={MONO} fontWeight="bold" fontSize={v.big.length > 9 ? 26 : 36} fill="#7ee0a8">{v.big.slice(0, 12)}</text>
      {KEYS.map((row, r) => row.map((k, c) => {
        const on = v.pressed === k;
        return (
          <g key={k} transform={`translate(${-92 + c * 48} ${108 + r * 44}) scale(${on ? 0.92 : 1})`}>
            <rect width="40" height="36" rx="8" fill={on ? ACCENT : k === '=' ? '#6a4ad8' : '#3d2f5c'} stroke={INK} strokeWidth="2" />
            <text x="20" y="25" textAnchor="middle" fontFamily={MONO} fontWeight="bold" fontSize="20" fill={on ? '#241437' : INK}>{LABEL[k] || k}</text>
          </g>
        );
      }))}
    </g>
  );
};

const Monitor: React.FC<{ screen: ScreenSpec; frame: number; dur: number }> = ({ screen, frame, dur }) => {
  const lines = screen.lines || [];
  const step = (dur * 0.7) / Math.max(1, lines.length);
  return (
    <g>
      <rect x="490" y="-232" width="20" height="44" fill="#3d2f5c" />
      <rect x="450" y="-196" width="100" height="8" rx="4" fill="#3d2f5c" />
      <rect x="330" y="-520" width="360" height="290" rx="14" fill="#120a22" stroke={INK} strokeWidth="4" />
      <rect x="342" y="-508" width="336" height="266" rx="6" fill="#1c1233" />
      {screen.title ? <text x="358" y="-478" fontFamily={MONO} fontWeight="bold" fontSize="22" fill={ACCENT}>{screen.title.slice(0, 28)}</text> : null}
      {lines.slice(0, 7).map((ln, i) => {
        const o = interpolate(frame, [dur * 0.08 + i * step, dur * 0.08 + i * step + 6], [0, 1], CLAMP);
        const tone = (screen.tone || [])[i];
        const fill = tone === 'ok' ? '#7ee0a8' : tone === 'bad' ? '#ff6b6b' : INK;
        return <text key={i} x="358" y={-440 + i * 32} fontFamily={MONO} fontSize="21" fill={fill} opacity={o}>{ln.slice(0, 30)}</text>;
      })}
    </g>
  );
};

export const Workstation: React.FC<{ frame: number; fps: number; dur: number; px: number; screen?: ScreenSpec; calc?: string }> = ({ frame, fps, dur, px, screen, calc }) => {
  const f = interpolate(frame, [dur * 0.12, dur * 0.72], [0, 1], CLAMP);
  const hot = Math.floor((frame / fps) * 13) % 12;
  return (
    <g>
      {/* chair */}
      <rect x={px - 82} y="-292" width="14" height="196" rx="7" fill="#5b3f7a" />
      <rect x={px - 76} y="-106" width="132" height="12" rx="6" fill="#5b3f7a" />
      <rect x={px - 18} y="-94" width="10" height="86" fill="#3d2f5c" />
      <rect x={px - 70} y="-10" width="120" height="10" rx="5" fill="#3d2f5c" />
      {/* desk */}
      <rect x="170" y="-192" width="560" height="26" rx="5" fill="#6b4630" />
      <rect x="200" y="-166" width="16" height="166" fill="#53382a" /><rect x="684" y="-166" width="16" height="166" fill="#53382a" />
      {/* keyboard */}
      <rect x="215" y="-206" width="144" height="14" rx="4" fill="#2b2140" stroke={INK} strokeWidth="2" />
      {Array.from({ length: 12 }).map((_, i) => <rect key={i} x={219 + i * 11.6} y="-203" width="9" height="8" rx="2" fill={i === hot ? ACCENT : '#4a3a6e'} />)}
      {calc ? <Calculator keys={calc} f={f} /> : <Monitor screen={screen || { lines: [] }} frame={frame} dur={dur} />}
    </g>
  );
};
