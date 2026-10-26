// Word-synced captions with style presets. Every preset adapts to the canvas through Layout
// (type scales with the short side, position follows the shape) and can be overridden token by token.
import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { font } from './fonts';
import { captionTop, Layout } from './layout';
import type { CaptionPreset, CaptionStyle, Word } from './types';

type Resolved = Required<Omit<CaptionStyle, 'size' | 'position'>> & { size: number; position: CaptionStyle['position'] };

// Preset defaults. size is px on a 1080 short side; tall/wide get their own size where it matters.
const PRESETS: Record<Exclude<CaptionPreset, 'none'>, Partial<Resolved> & { sizeWide?: number }> = {
  'bold-pop': { font: 'Montserrat', weight: 900, size: 92, sizeWide: 76, color: '#ffffff', stroke: '#000000', case: 'upper', words_per_group: 3, background: '' },
  'karaoke-box': { font: 'Poppins', weight: 800, size: 80, sizeWide: 66, color: '#ffffff', stroke: '', case: 'upper', words_per_group: 4, background: '' },
  clean: { font: 'Inter', weight: 700, size: 64, sizeWide: 54, color: '#ffffff', stroke: '', case: 'none', words_per_group: 6, background: '', position: 'auto' },
  subtitle: { font: 'Inter', weight: 500, size: 50, sizeWide: 44, color: '#ffffff', stroke: '', case: 'none', words_per_group: 9, background: 'rgba(0,0,0,0.62)', position: 'bottom' },
  neon: { font: 'Bebas Neue', weight: 400, size: 128, sizeWide: 104, color: '#ffffff', stroke: '', case: 'upper', words_per_group: 3, background: '' },
  'word-by-word': { font: 'Anton', weight: 400, size: 160, sizeWide: 130, color: '#ffffff', stroke: '#000000', case: 'upper', words_per_group: 1, background: '' },
};

export function resolveCaption(s: CaptionStyle | undefined, accent: string, L: Layout): Resolved & { preset: CaptionPreset } {
  const preset = (s?.preset || 'bold-pop') as CaptionPreset;
  const d = PRESETS[preset === 'none' ? 'bold-pop' : preset] || PRESETS['bold-pop'];
  const wide = L.shape === 'wide';
  const base = s?.size ?? (wide ? d.sizeWide ?? d.size! : L.shape === 'tall' ? d.size! : Math.round(((d.size! + (d.sizeWide ?? d.size!)) / 2)));
  return {
    preset,
    font: s?.font || d.font!, weight: s?.weight ?? d.weight!, size: base * L.u,
    color: s?.color || d.color!, highlight: s?.highlight || accent, stroke: s?.stroke ?? d.stroke!,
    background: s?.background ?? d.background!, case: s?.case || d.case!, position: s?.position ?? d.position ?? 'auto',
    words_per_group: s?.words_per_group ?? d.words_per_group!, max_width: s?.max_width ?? 0.88,
  };
}

export function groupWords(words: Word[], per: number, maxChars: number): Word[][] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  let chars = 0;
  for (const w of words) {
    if (cur.length && chars + w.word.length > maxChars) { groups.push(cur); cur = []; chars = 0; }
    cur.push(w);
    chars += w.word.length + 1;
    if (cur.length >= per || /[.,!?;:]$/.test(w.word)) { groups.push(cur); cur = []; chars = 0; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export const Captions: React.FC<{ words: Word[]; style?: CaptionStyle; accent: string; L: Layout }> = ({ words, style, accent, L }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = resolveCaption(style, accent, L);
  const f = font(r.font);
  const maxW = L.w * r.max_width;
  // Rough line budget so a group never wraps past two lines at this size.
  const maxChars = Math.max(8, Math.floor((maxW / (r.size * 0.62)) * (r.words_per_group > 4 ? 2 : 1.6)));
  const groups = React.useMemo(() => groupWords(words, r.words_per_group, maxChars), [words, r.words_per_group, maxChars]);
  if (r.preset === 'none' || !words.length) return null;
  const t = frame / fps;
  const g = groups.find((gr, i) => {
    const next = groups[i + 1];
    return t >= gr[0].start - 0.05 && t < (next ? next[0].start - 0.05 : gr[gr.length - 1].end + 0.6);
  });
  if (!g) return null;
  const startF = Math.round((g[0].start - 0.05) * fps);
  const pop = spring({ frame: frame - startF, fps, config: { damping: 14, stiffness: 220 } });
  const lineH = r.size * 1.12;
  const top = captionTop(L, r.position, lineH * (r.words_per_group > 4 ? 2 : 1));
  const tx = (s: string) => (r.case === 'upper' ? s.toUpperCase() : r.case === 'lower' ? s.toLowerCase() : s);
  const strokeW = Math.max(2, Math.round(r.size / 30));
  const shared: React.CSSProperties = {
    fontFamily: f.family, fontWeight: f.weight(r.weight), fontSize: r.size, lineHeight: 1.1, textAlign: 'center',
    color: r.color, maxWidth: maxW, letterSpacing: r.preset === 'neon' || r.preset === 'word-by-word' ? 1 : -1,
  };
  const shadow = r.stroke ? `0 ${6 * L.u}px 0 rgba(0,0,0,0.85), 0 0 ${24 * L.u}px rgba(0,0,0,0.7)` : `0 ${3 * L.u}px ${14 * L.u}px rgba(0,0,0,0.75)`;
  const strokeCss: React.CSSProperties = r.stroke ? { WebkitTextStroke: `${strokeW}px ${r.stroke}`, paintOrder: 'stroke fill' } : {};

  let inner: React.ReactNode;
  if (r.preset === 'subtitle' || r.preset === 'clean') {
    inner = (
      <div style={{ ...shared, textShadow: r.background ? 'none' : shadow, background: r.background || undefined,
        padding: r.background ? `${0.25 * r.size}px ${0.5 * r.size}px` : 0, borderRadius: 0.22 * r.size, opacity: Math.min(1, pop * 1.4) }}>
        {g.map((w, i) => {
          const active = t >= w.start - 0.03 && t < w.end + 0.08;
          const color = r.preset === 'clean' ? (active ? r.color : `${r.color}`) : r.color;
          // inline-block: lets a long subtitle line wrap between words instead of running off the edge
          return <span key={i} style={{ display: 'inline-block', color, opacity: r.preset === 'clean' && !active ? 0.72 : 1, marginRight: 0.28 * r.size }}>{tx(w.word)}</span>;
        })}
      </div>
    );
  } else {
    inner = (
      <div style={{ ...shared, transform: `scale(${0.85 + 0.15 * pop})`, textShadow: r.preset === 'neon' ? 'none' : shadow, ...strokeCss }}>
        {g.map((w, i) => {
          const active = t >= w.start - 0.03 && t < w.end + 0.08;
          const word = tx(w.word.replace(/[.,;:]$/, ''));
          if (r.preset === 'karaoke-box') {
            return (
              <span key={i} style={{ display: 'inline-block', margin: `0 ${0.12 * r.size}px ${0.12 * r.size}px`, padding: `0 ${0.16 * r.size}px`,
                borderRadius: 0.16 * r.size, background: active ? r.highlight : 'transparent', color: active ? '#111' : r.color,
                textShadow: active ? 'none' : shadow }}>{word}</span>
            );
          }
          if (r.preset === 'neon') {
            const c = active ? r.highlight : r.color;
            return <span key={i} style={{ display: 'inline-block', marginRight: 0.22 * r.size, color: c,
              textShadow: `0 0 ${10 * L.u}px ${c}, 0 0 ${28 * L.u}px ${r.highlight}, 0 0 ${60 * L.u}px ${r.highlight}aa` }}>{word}</span>;
          }
          return <span key={i} style={{ color: active ? r.highlight : r.color, marginRight: 0.24 * r.size, display: 'inline-block' }}>{word}</span>;
        })}
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', top, height: 'auto' }}>
      {inner}
    </AbsoluteFill>
  );
};
