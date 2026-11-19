// Layers7.tsx: terminal-typing kit. A fake terminal window where commands are typed and output lines appear one by one.
// Steps: cmd{text} typed after a $ prompt, out{text} an output line, hold{dur}. Colours come from the theme.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; font?: string; theme?: any };
type Step = { type: string; text?: string; dur?: number };
type Planned = Step & { start: number; end: number };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const CPS = 22;
const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Consolas, monospace";
const hex = (c: any, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);

function planTerm(steps: Step[] | undefined): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 10)) {
    let d = 0;
    if (s.type === 'cmd') d = 0.3 + (s.text || '').length / CPS;
    else if (s.type === 'out') d = 0.35;
    else if (s.type === 'hold') d = s.dur ?? 0.6;
    else continue;
    out.push({ ...s, start: t, end: t + d });
    t += d + 0.15;
  }
  return out;
}

export const TerminalTyping: React.FC<P> = ({ l, L, accent, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = l as any;
  const t = frame / fps;
  const plan = planTerm(a.steps);
  if (!plan.length) return null;
  const len = Math.max(14, Math.round((Number(a.end) - Number(a.start)) * fps));
  const surface = hex(theme && theme.surface, '#0d1117');
  const ink = hex(theme && theme.text, '#e6edf3');
  const acc = hex(accent, '#4ade80');
  const u = L.u;
  const fs = 30 * u;
  const w = L.w * 0.88;
  const cy = (typeof a.y === 'number' ? a.y : 0.5) * L.h;
  const pop = OUT(interpolate(frame, [0, 10], [0, 1], CL));
  const fade = interpolate(frame, [len - 6, len], [1, 0], CL);
  const blink = Math.floor(t * 2.2) % 2 === 0;
  const rows: Array<{ kind: string; text: string; op: number; cursor: boolean }> = [];
  for (const s of plan) {
    if (t < s.start || s.type === 'hold') continue;
    const full = s.text || '';
    if (s.type === 'cmd') {
      const n = Math.max(0, Math.min(full.length, Math.floor((t - s.start - 0.15) * CPS)));
      rows.push({ kind: 'cmd', text: full.slice(0, n), op: 1, cursor: true });
    } else {
      rows.push({ kind: 'out', text: full, op: 0.78 * interpolate(t, [s.start, s.start + 0.2], [0, 1], CL), cursor: false });
    }
  }
  const shown = rows.slice(-10);
  const lastIdx = shown.length - 1;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{
        position: 'absolute', left: (L.w - w) / 2, top: cy, width: w, transform: `translateY(-50%) scale(${0.94 + 0.06 * pop})`, opacity: pop,
        borderRadius: 22 * u, overflow: 'hidden', background: surface, border: `${1.5 * u}px solid ${acc}55`,
        boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.55)`,
      }}>
        <div style={{ display: 'flex', gap: 10 * u, alignItems: 'center', padding: `${16 * u}px ${22 * u}px`, background: `${ink}14` }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: '50%', background: c }} />)}
        </div>
        <div style={{ padding: `${26 * u}px ${30 * u}px`, minHeight: 360 * u, fontFamily: MONO, fontSize: fs, lineHeight: 1.5, color: ink }}>
          {shown.map((r, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: r.op }}>
              {r.kind === 'cmd' ? <span style={{ color: acc }}>{'$ '}</span> : null}
              {r.text}
              {r.cursor && i === lastIdx ? <span style={{ display: 'inline-block', width: 0.6 * fs, height: fs, marginLeft: 4 * u, verticalAlign: 'text-bottom', background: acc, opacity: blink ? 1 : 0 }} /> : null}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
