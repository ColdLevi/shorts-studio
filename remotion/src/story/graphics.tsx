// Motion-graphic beats for StoryShort: scenes drawn in code (counters, bar races, line charts,
// kinetic titles, lists) instead of an AI still. The Studio script writer picks them for beats
// that carry real numbers; every value comes from the spec, so what is drawn is what was checked.
import React from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';

const { fontFamily } = loadFont('normal', { weights: ['600', '800', '900'], subsets: ['latin'] });

export type Graphic =
  | { type: 'counter'; value: number; from?: number; prefix?: string; suffix?: string; label?: string; decimals?: number }
  | { type: 'bars'; title?: string; prefix?: string; suffix?: string; items: { label: string; value: number }[]; highlight?: number }
  | { type: 'line'; title?: string; prefix?: string; suffix?: string; x_labels?: string[]; series: { label: string; values: number[] }[] }
  | { type: 'title'; text: string; sub?: string }
  | { type: 'list'; title?: string; items: string[] };

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const EASE = Easing.bezier(0.33, 1, 0.68, 1);
const EASE_INOUT = Easing.bezier(0.37, 0, 0.63, 1);
const SFX = (n: string) => staticFile(`library/sfx/clips/${n}.mp3`);
const PALETTE = ['#8b96a5', '#ef5f6b', '#4fc3f7', '#9ccc65', '#ba68c8'];

// Area the graphic lives in: clear of the title card at the top and the captions at 60%.
const TOP = 300;
const BOTTOM = 1090;

export const fmt = (v: number, prefix = '', suffix = '', decimals?: number) => {
  const abs = Math.abs(v);
  const d = decimals ?? (abs < 10 && abs % 1 !== 0 ? 1 : 0);
  const body = abs >= 1e9 && !decimals ? `${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`
    : abs >= 1e7 && !decimals ? `${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`
    : abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v < 0 ? '-' : ''}${prefix}${body}${suffix}`;
};

const label = (size: number, color = 'white', weight = 800): React.CSSProperties => ({
  fontFamily, fontWeight: weight, fontSize: size, color, letterSpacing: -0.5, lineHeight: 1.1,
  textShadow: '0 4px 18px rgba(0,0,0,0.55)',
});

// Dark, slowly breathing backdrop. Uses a neighbouring beat's image, blurred and dimmed, so a
// graphic beat still feels part of the same film.
export const GraphicBackdrop: React.FC<{ accent: string; image?: string; len: number }> = ({ accent, image, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.min(1, frame / Math.max(1, len * fps));
  const fade = interpolate(frame, [0, 0.35 * fps], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={{ opacity: fade, backgroundColor: '#07080c' }}>
      {image ? (
        <Img src={staticFile(image)} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.32,
          filter: 'blur(38px) saturate(1.2)', transform: `scale(${1.25 + 0.06 * p})` }} />
      ) : null}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 45% at 50% ${38 + 6 * p}%, ${accent}33 0%, transparent 70%)` }} />
      <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '90px 90px', backgroundPosition: `0 ${-p * 90}px`, opacity: 0.6 }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 110% 85% at 50% 45%, transparent 45%, rgba(0,0,0,0.75) 100%)' }} />
    </AbsoluteFill>
  );
};

const Heading: React.FC<{ text?: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text) return null;
  const s = spring({ frame, fps, config: { damping: 18 } });
  return (
    <div style={{ position: 'absolute', top: TOP, left: 80, right: 80, textAlign: 'center', opacity: s,
      transform: `translateY(${(1 - s) * 30}px)` }}>
      <div style={{ ...label(54, 'white', 900), textTransform: 'uppercase' }}>{text}</div>
      <div style={{ margin: '18px auto 0', height: 8, width: 140 * s, background: accent, borderRadius: 4 }} />
    </div>
  );
};

// ---------- counter: one big number counting up, with a label ----------
const Counter: React.FC<{ g: Extract<Graphic, { type: 'counter' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(0.8, Math.min(2.4, len * 0.6)) * fps;
  const p = interpolate(frame, [0.2 * fps, 0.2 * fps + dur], [0, 1], { ...CLAMP, easing: EASE });
  const v = (g.from ?? 0) + (g.value - (g.from ?? 0)) * p;
  const land = spring({ frame: frame - (0.2 * fps + dur), fps, config: { damping: 9, stiffness: 180 } });
  const text = fmt(v, g.prefix, g.suffix, g.decimals);
  const size = Math.min(230, Math.floor(1300 / Math.max(4, fmt(g.value, g.prefix, g.suffix, g.decimals).length)));
  const lIn = spring({ frame: frame - 6, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ top: TOP, height: BOTTOM - TOP, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...label(size, accent, 900), fontVariantNumeric: 'tabular-nums', transform: `scale(${p < 1 ? 0.92 + 0.08 * p : 1 + 0.1 * (1 - land)})`,
        filter: `drop-shadow(0 0 ${30 * p}px ${accent}66)` }}>{text}</div>
      {g.label ? (
        <div style={{ ...label(58, 'white', 800), marginTop: 26, textTransform: 'uppercase', textAlign: 'center', padding: '0 90px',
          opacity: lIn, transform: `translateY(${(1 - lIn) * 24}px)` }}>{g.label}</div>
      ) : null}
      <Audio src={SFX('riser-soft')} volume={0.18} />
      <Sequence from={Math.round(0.2 * fps + dur)}><Audio src={SFX('impact-soft')} volume={0.35} /></Sequence>
    </AbsoluteFill>
  );
};

// ---------- bars: horizontal bars racing to their values ----------
const Bars: React.FC<{ g: Extract<Graphic, { type: 'bars' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = g.items.slice(0, 5);
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const hi = g.highlight ?? items.reduce((b, it, i) => (Math.abs(it.value) > Math.abs(items[b].value) ? i : b), 0);
  const gap = Math.min(0.45, (len * 0.55) / items.length) * fps;
  const area = BOTTOM - TOP - (g.title ? 150 : 0);
  const rowH = Math.min(170, area / items.length);
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <div style={{ position: 'absolute', left: 80, right: 80, top: TOP + (g.title ? 150 : 0) + (area - rowH * items.length) / 2 }}>
        {items.map((it, i) => {
          const start = 0.25 * fps + i * gap;
          const p = interpolate(frame, [start, start + 0.9 * fps], [0, 1], { ...CLAMP, easing: EASE });
          const color = i === hi ? accent : PALETTE[i % PALETTE.length];
          return (
            <div key={i} style={{ height: rowH, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: interpolate(p, [0, 0.15], [0, 1], CLAMP) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <span style={{ ...label(44, 'white', 800) }}>{it.label}</span>
                <span style={{ ...label(52, color, 900), fontVariantNumeric: 'tabular-nums' }}>{fmt(it.value * p, g.prefix, g.suffix)}</span>
              </div>
              <div style={{ height: Math.min(54, rowH * 0.34), background: 'rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(Math.abs(it.value) / max) * 100 * p}%`, background: color, borderRadius: 14,
                  boxShadow: i === hi ? `0 0 30px ${accent}88` : 'none' }} />
              </div>
              <Sequence from={Math.round(start)}><Audio src={SFX('pop-reveal')} volume={0.22} /></Sequence>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- line: one or more series drawing themselves, with live end labels ----------
const Line: React.FC<{ g: Extract<Graphic, { type: 'line' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const series = g.series.filter((s) => s.values?.length >= 2).slice(0, 3);
  if (!series.length) return null;
  const n = Math.max(...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all), hi = Math.max(...all) * 1.08 || 1;
  const box = { x: 120, y: TOP + (g.title ? 190 : 60), w: 760, h: BOTTOM - TOP - (g.title ? 260 : 130) };
  const sx = (i: number) => box.x + (i / (n - 1)) * box.w;
  const sy = (v: number) => box.y + box.h - ((v - lo) / (hi - lo)) * box.h;
  const p = interpolate(frame, [0.3 * fps, 0.3 * fps + Math.max(1.2, len * 0.7) * fps], [0, 1], { ...CLAMP, easing: EASE_INOUT });
  const colors = series.map((_, i) => (i === 0 ? accent : PALETTE[(i) % PALETTE.length]));
  const at = (vals: number[], q: number) => {
    const f = q * (vals.length - 1), i = Math.floor(f), t = f - i;
    return { x: sx((i + t) * ((n - 1) / (vals.length - 1))), v: vals[i] + ((vals[Math.min(vals.length - 1, i + 1)] ?? vals[i]) - vals[i]) * t };
  };
  const path = (vals: number[]) => {
    const pts: string[] = [];
    const steps = 80;
    for (let k = 0; k <= steps * p; k++) {
      const q = k / steps; const a = at(vals, q);
      pts.push(`${k === 0 ? 'M' : 'L'}${a.x.toFixed(1)} ${sy(a.v).toFixed(1)}`);
    }
    const end = at(vals, p); pts.push(`L${end.x.toFixed(1)} ${sy(end.v).toFixed(1)}`);
    return pts.join(' ');
  };
  const axisIn = interpolate(frame, [0, 0.4 * fps], [0, 1], CLAMP);
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={box.x} x2={box.x + box.w} y1={box.y + box.h * t} y2={box.y + box.h * t}
            stroke="rgba(255,255,255,0.10)" strokeWidth={2} opacity={axisIn} />
        ))}
        <line x1={box.x} x2={box.x + box.w * axisIn} y1={box.y + box.h} y2={box.y + box.h} stroke="rgba(255,255,255,0.45)" strokeWidth={4} />
        {series.map((s, i) => (
          <g key={i}>
            {i === 0 ? <path d={`${path(s.values)} L${at(s.values, p).x} ${box.y + box.h} L${box.x} ${box.y + box.h} Z`} fill={`${accent}22`} /> : null}
            <path d={path(s.values)} fill="none" stroke={colors[i]} strokeWidth={i === 0 ? 12 : 9} strokeLinecap="round" strokeLinejoin="round"
              style={{ filter: i === 0 ? `drop-shadow(0 0 14px ${accent}99)` : 'none' }} />
            <circle cx={at(s.values, p).x} cy={sy(at(s.values, p).v)} r={16} fill={colors[i]} stroke="#07080c" strokeWidth={5} />
          </g>
        ))}
      </svg>
      {series.map((s, i) => {
        const e = at(s.values, p);
        const others = series.slice(0, i).map((o) => sy(at(o.values, p).v));
        const below = others.some((y) => Math.abs(y - sy(e.v)) < 150);
        return (
          <div key={i} style={{ position: 'absolute', left: Math.min(e.x - 40, 760), top: below ? sy(e.v) + 26 : sy(e.v) - 92, ...label(46, colors[i], 900),
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', opacity: interpolate(p, [0.05, 0.15], [0, 1], CLAMP) }}>
            {fmt(e.v, g.prefix, g.suffix)}
          </div>
        );
      })}
      {(g.x_labels || []).length >= 2 ? (
        <div style={{ position: 'absolute', top: box.y + box.h + 18, left: box.x - 40, width: box.w + 80, display: 'flex', justifyContent: 'space-between',
          ...label(34, 'rgba(255,255,255,0.7)', 600), opacity: axisIn }}>
          <span>{g.x_labels![0]}</span><span>{g.x_labels![g.x_labels!.length - 1]}</span>
        </div>
      ) : null}
      {series.length > 1 ? (
        <div style={{ position: 'absolute', top: box.y - 70, left: box.x, display: 'flex', gap: 36, ...label(34, 'white', 700), opacity: axisIn }}>
          {series.map((s, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 28, height: 10, borderRadius: 5, background: colors[i] }} />{s.label}
            </span>
          ))}
        </div>
      ) : null}
      <Audio src={SFX('whoosh-soft')} volume={0.25} />
    </AbsoluteFill>
  );
};

// ---------- title: kinetic words slamming in one by one ----------
const Title: React.FC<{ g: Extract<Graphic, { type: 'title' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = g.text.split(/\s+/).slice(0, 6);
  const step = Math.min(0.28, (len * 0.5) / words.length) * fps;
  const longest = Math.max(...words.map((w) => w.length));
  const size = Math.min(190, Math.floor(1180 / Math.max(5, longest)));
  const subIn = spring({ frame: frame - words.length * step - 4, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ top: TOP, height: BOTTOM - TOP, alignItems: 'center', justifyContent: 'center' }}>
      {words.map((w, i) => {
        const s = spring({ frame: frame - i * step, fps, config: { damping: 11, stiffness: 200 } });
        return (
          <div key={i} style={{ ...label(size, i === words.length - 1 ? accent : 'white', 900), textTransform: 'uppercase', lineHeight: 0.98,
            opacity: Math.min(1, s * 1.5), transform: `scale(${1.6 - 0.6 * s}) translateY(${(1 - s) * -20}px)` }}>{w}</div>
        );
      })}
      {g.sub ? (
        <div style={{ ...label(46, 'rgba(255,255,255,0.85)', 700), marginTop: 30, textAlign: 'center', padding: '0 100px',
          opacity: subIn, transform: `translateY(${(1 - subIn) * 20}px)` }}>{g.sub}</div>
      ) : null}
      {words.map((_, i) => (
        <Sequence key={i} from={Math.round(i * step)}><Audio src={SFX('stamp-hit')} volume={0.16} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ---------- list: numbered points revealed through the beat ----------
const List: React.FC<{ g: Extract<Graphic, { type: 'list' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = g.items.slice(0, 4);
  const step = ((len * 0.8) / items.length) * fps;
  const area = BOTTOM - TOP - (g.title ? 150 : 0);
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <div style={{ position: 'absolute', left: 90, right: 90, top: TOP + (g.title ? 150 : 0), height: area, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34 }}>
        {items.map((it, i) => {
          const s = spring({ frame: frame - (0.15 * fps + i * step), fps, config: { damping: 15 } });
          const now = frame >= 0.15 * fps + i * step && (i === items.length - 1 || frame < 0.15 * fps + (i + 1) * step);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: s * (now ? 1 : 0.55),
              transform: `translateX(${(1 - s) * 80}px)` }}>
              <div style={{ minWidth: 92, height: 92, borderRadius: 24, background: now ? accent : 'rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', ...label(52, now ? '#111' : 'white', 900), textShadow: 'none' }}>{i + 1}</div>
              <div style={{ ...label(50, 'white', 800) }}>{it}</div>
              <Sequence from={Math.round(0.15 * fps + i * step)}><Audio src={SFX('ui-click-soft')} volume={0.25} /></Sequence>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Landscape: the graphics are laid out on a 1080x1920 canvas; scale that canvas so its graphic zone
// (y 300 to 1090) sits centred in the top three quarters of a 1920x1080 frame, clear of the captions.
const WIDE_S = 0.9;
const Canvas: React.FC<{ wide?: boolean; children: React.ReactNode }> = ({ wide, children }) => wide ? (
  <div style={{ position: 'absolute', width: 1080, height: 1920, left: (1920 - 1080 * WIDE_S) / 2, top: 50 - TOP * WIDE_S,
    transform: `scale(${WIDE_S})`, transformOrigin: 'top left' }}>{children}</div>
) : <AbsoluteFill>{children}</AbsoluteFill>;

export const GraphicBeat: React.FC<{ g: Graphic; accent: string; len: number; image?: string; wide?: boolean }> = ({ g, accent, len, image, wide }) => (
  <AbsoluteFill>
    <GraphicBackdrop accent={accent} image={image} len={len} />
    <Canvas wide={wide}>
    {g.type === 'counter' ? <Counter g={g} accent={accent} len={len} />
      : g.type === 'bars' ? <Bars g={g} accent={accent} len={len} />
      : g.type === 'line' ? <Line g={g} accent={accent} len={len} />
      : g.type === 'title' ? <Title g={g} accent={accent} len={len} />
      : g.type === 'list' ? <List g={g} accent={accent} len={len} />
      : null}
    </Canvas>
  </AbsoluteFill>
);
