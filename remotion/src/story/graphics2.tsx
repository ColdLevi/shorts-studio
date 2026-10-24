// Motion template pack 2: 14 more code-drawn scene types for Shorts Studio (versus, percent ring, pie,
// timeline, flow, quote, stat tiles, myth vs fact, people grid, chat, kinetic words, gauge, map, icons).
// Same contract as graphics.tsx: drawn on a 1080x1920 design canvas inside the zone y 300..1090, every
// value comes from the spec, so what is drawn is what was fact-checked.
import React from 'react';
import { AbsoluteFill, Audio as RAudio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';
import { icons } from 'lucide-react';
import { WORLD } from '../lib/geo/world';
import { makeMapScale, countryPath, centroid } from '../lib/map';

const { fontFamily } = loadFont('normal', { weights: ['600', '800', '900'], subsets: ['latin'] });

type Num = { value: number; prefix?: string; suffix?: string; label?: string };
export type Graphic2 =
  | { type: 'versus'; title?: string; prefix?: string; suffix?: string; left: { label: string; value?: number; sub?: string }; right: { label: string; value?: number; sub?: string } }
  | { type: 'percent'; value: number; label?: string }
  | { type: 'pie'; title?: string; suffix?: string; items: { label: string; value: number }[] }
  | { type: 'timeline'; title?: string; events: { date: string; label: string }[] }
  | { type: 'flow'; title?: string; steps: string[] }
  | { type: 'quote'; text: string; by?: string }
  | { type: 'stats'; title?: string; items: Num[] }
  | { type: 'myth'; myth: string; fact: string }
  | { type: 'people'; value: number; total?: number; label?: string }
  | { type: 'chat'; title?: string; messages: { from: 'me' | 'them'; text: string }[] }
  | { type: 'kinetic'; words: string[] }
  | { type: 'gauge'; value: number; min?: number; max?: number; label?: string; suffix?: string }
  | { type: 'map'; title?: string; countries: string[]; label?: string }
  | { type: 'icons'; title?: string; items: { icon: string; label: string }[] };

export const GRAPHIC2_TYPES = ['versus', 'percent', 'pie', 'timeline', 'flow', 'quote', 'stats', 'myth', 'people', 'chat', 'kinetic', 'gauge', 'map', 'icons'];

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const EASE = Easing.bezier(0.33, 1, 0.68, 1);
const TOP = 300, BOTTOM = 1090, H = BOTTOM - TOP;
const PALETTE = ['#4fc3f7', '#ef5f6b', '#9ccc65', '#ba68c8', '#ffb74d', '#8b96a5'];
const SFX = (n: string) => staticFile(`library/sfx/clips/${n}.mp3`);
export const Sfx2Context = React.createContext(true);
const Audio: React.FC<React.ComponentProps<typeof RAudio>> = (p) => (React.useContext(Sfx2Context) ? <RAudio {...p} /> : null);
const Pop: React.FC<{ at: number; name?: string; volume?: number }> = ({ at, name = 'pop-reveal', volume = 0.2 }) => (
  <Sequence from={Math.max(0, Math.round(at))}><Audio src={SFX(name)} volume={volume} /></Sequence>
);

const txt = (size: number, color = 'white', weight = 800): React.CSSProperties => ({
  fontFamily, fontWeight: weight, fontSize: size, color, letterSpacing: -0.5, lineHeight: 1.12, textShadow: '0 4px 18px rgba(0,0,0,0.55)',
});
const fmt = (v: number, prefix = '', suffix = '') => {
  const a = Math.abs(v);
  const body = a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e7 ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`
    : a.toLocaleString('en-US', { maximumFractionDigits: a < 10 && a % 1 ? 1 : 0 });
  return `${v < 0 ? '-' : ''}${prefix}${body}${suffix}`;
};
const useT = () => { const frame = useCurrentFrame(); const { fps } = useVideoConfig(); return { frame, fps }; };
const springAt = (frame: number, fps: number, at: number, damping = 14) => spring({ frame: frame - at, fps, config: { damping } });

const Heading: React.FC<{ text?: string; accent: string }> = ({ text, accent }) => {
  const { frame, fps } = useT();
  if (!text) return null;
  const s = springAt(frame, fps, 0, 18);
  return (
    <div style={{ position: 'absolute', top: TOP, left: 70, right: 70, textAlign: 'center', opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
      <div style={{ ...txt(52, 'white', 900), textTransform: 'uppercase' }}>{text}</div>
      <div style={{ margin: '16px auto 0', height: 8, width: 140 * s, background: accent, borderRadius: 4 }} />
    </div>
  );
};
const Zone: React.FC<{ title?: boolean; children: React.ReactNode; style?: React.CSSProperties }> = ({ title, children, style }) => (
  <div style={{ position: 'absolute', left: 70, right: 70, top: TOP + (title ? 150 : 0), height: H - (title ? 150 : 0), display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>{children}</div>
);

// ---------- versus: two sides face off ----------
const Versus: React.FC<{ g: Extract<Graphic2, { type: 'versus' }>; accent: string; len: number }> = ({ g, accent }) => {
  const { frame, fps } = useT();
  const a = springAt(frame, fps, 0.15 * fps), b = springAt(frame, fps, 0.45 * fps), vs = springAt(frame, fps, 0.8 * fps, 8);
  const count = interpolate(frame, [0.6 * fps, 1.8 * fps], [0, 1], { ...CLAMP, easing: EASE });
  const side = (s: typeof g.left, p: number, color: string, dir: number) => (
    <div style={{ flex: 1, height: 520, borderRadius: 32, background: `linear-gradient(160deg, ${color}40, ${color}10)`, border: `3px solid ${color}aa`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18,
      transform: `translateX(${dir * (1 - p) * 420}px) rotate(${dir * (1 - p) * 8}deg)`, opacity: p }}>
      <div style={{ ...txt(50, 'white', 900), textAlign: 'center', textTransform: 'uppercase' }}>{s.label}</div>
      {typeof s.value === 'number' ? <div style={{ ...txt(92, color, 900), fontVariantNumeric: 'tabular-nums' }}>{fmt(s.value * count, g.prefix, g.suffix)}</div> : null}
      {s.sub ? <div style={{ ...txt(32, '#d7dbe2', 600), textAlign: 'center' }}>{s.sub}</div> : null}
    </div>
  );
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <Zone title={!!g.title} style={{ gap: 40 }}>
        {side(g.left, a, PALETTE[0], -1)}
        {side(g.right, b, accent, 1)}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%,-50%) scale(${vs})`, width: 150, height: 150, borderRadius: 75,
          background: '#0b0d12', border: `5px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...txt(58, accent, 900) }}>VS</div>
      </Zone>
      <Pop at={0.15 * fps} name="whoosh-soft" /><Pop at={0.45 * fps} name="whoosh-soft" /><Pop at={0.8 * fps} name="impact-soft" volume={0.3} />
    </AbsoluteFill>
  );
};

// ---------- percent: a ring fills to the value ----------
const Ring: React.FC<{ p: number; color: string; size: number; width: number; track?: string }> = ({ p, color, size, width, track = 'rgba(255,255,255,0.1)' }) => {
  const r = (size - width) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={width} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round"
        strokeDasharray={`${c * p} ${c}`} style={{ filter: `drop-shadow(0 0 18px ${color}88)` }} />
    </svg>
  );
};
const Percent: React.FC<{ g: Extract<Graphic2, { type: 'percent' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const v = Math.max(0, Math.min(100, g.value));
  const p = interpolate(frame, [0.2 * fps, (0.2 + Math.min(2.2, len * 0.6)) * fps], [0, 1], { ...CLAMP, easing: EASE });
  const lab = springAt(frame, fps, 0.4 * fps);
  return (
    <AbsoluteFill>
      <Zone style={{ flexDirection: 'column', gap: 30 }}>
        <div style={{ position: 'relative', width: 560, height: 560 }}>
          <Ring p={(v / 100) * p} color={accent} size={560} width={46} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...txt(150, 'white', 900), fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(v * p)}%
          </div>
        </div>
        {g.label ? <div style={{ ...txt(54, 'white', 800), textAlign: 'center', textTransform: 'uppercase', opacity: lab, transform: `translateY(${(1 - lab) * 20}px)` }}>{g.label}</div> : null}
      </Zone>
      <Audio src={SFX('riser-soft')} volume={0.16} />
    </AbsoluteFill>
  );
};

// ---------- pie: donut segments sweep in ----------
const Pie: React.FC<{ g: Extract<Graphic2, { type: 'pie' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const items = g.items.slice(0, 5);
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1;
  const p = interpolate(frame, [0.2 * fps, (0.2 + Math.min(1.8, len * 0.5)) * fps], [0, 1], { ...CLAMP, easing: EASE });
  const size = 470, w = 90, r = (size - w) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  const colors = items.map((_, i) => (i === 0 ? accent : PALETTE[(i - 1) % PALETTE.length]));
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <Zone title={!!g.title} style={{ flexDirection: 'column', gap: 36 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {items.map((it, i) => {
            const frac = Math.max(0, it.value) / total;
            const start = acc; acc += frac;
            const shown = Math.max(0, Math.min(frac, p - start));
            return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors[i]} strokeWidth={w}
              strokeDasharray={`${c * shown} ${c}`} strokeDashoffset={-c * start} />;
          })}
        </svg>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '14px 34px' }}>
          {items.map((it, i) => {
            const s = springAt(frame, fps, (0.4 + i * 0.2) * fps);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: s }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: colors[i] }} />
                <span style={txt(38, 'white', 700)}>{it.label}</span>
                <span style={txt(38, colors[i], 900)}>{fmt(it.value, '', g.suffix ?? '%')}</span>
              </div>
            );
          })}
        </div>
      </Zone>
    </AbsoluteFill>
  );
};

// ---------- timeline: dates drop onto a line ----------
const Timeline: React.FC<{ g: Extract<Graphic2, { type: 'timeline' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const ev = g.events.slice(0, 6);
  const gap = Math.min(0.7, (len * 0.7) / ev.length);
  const line = interpolate(frame, [0.1 * fps, (0.1 + gap * ev.length) * fps], [0, 1], { ...CLAMP, easing: EASE });
  const top = TOP + (g.title ? 170 : 40), h = H - (g.title ? 210 : 80);
  const row = h / ev.length;
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <div style={{ position: 'absolute', left: 250, top, width: 8, height: h * line, background: `linear-gradient(${accent}, ${accent}55)`, borderRadius: 4 }} />
      {ev.map((e, i) => {
        const at = (0.2 + i * gap) * fps;
        const s = springAt(frame, fps, at);
        const y = top + row * i + row / 2;
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: 254 - 26 * s, top: y - 26 * s, width: 52 * s, height: 52 * s, borderRadius: 30, background: accent, boxShadow: `0 0 24px ${accent}` }} />
            <div style={{ position: 'absolute', right: 1080 - 210, top: y - 30, textAlign: 'right', opacity: s, transform: `translateX(${(1 - s) * -40}px)`, ...txt(46, accent, 900) }}>{e.date}</div>
            <div style={{ position: 'absolute', left: 310, right: 70, top: y - 30, opacity: s, transform: `translateX(${(1 - s) * 60}px)`, ...txt(42, 'white', 700) }}>{e.label}</div>
            <Pop at={at} />
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------- flow: steps joined by arrows ----------
const Flow: React.FC<{ g: Extract<Graphic2, { type: 'flow' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const st = g.steps.slice(0, 5);
  const gap = Math.min(0.8, (len * 0.75) / st.length);
  const top = TOP + (g.title ? 160 : 20), h = H - (g.title ? 180 : 40);
  const box = Math.min(120, (h - (st.length - 1) * 50) / st.length);
  const step = box + 50;
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      {st.map((t, i) => {
        const at = (0.15 + i * gap) * fps;
        const s = springAt(frame, fps, at, 13);
        const y = top + (h - (step * st.length - 50)) / 2 + i * step;
        const arrow = interpolate(frame, [at + 0.3 * fps, at + 0.6 * fps], [0, 1], CLAMP);
        const last = i === st.length - 1;
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: 120, right: 120, top: y, height: box, borderRadius: 26, display: 'flex', alignItems: 'center', gap: 22, padding: '0 30px',
              background: last ? `${accent}33` : 'rgba(255,255,255,0.07)', border: `3px solid ${last ? accent : 'rgba(255,255,255,0.18)'}`,
              transform: `scale(${0.8 + 0.2 * s})`, opacity: s }}>
              <div style={{ width: 64, height: 64, flex: '0 0 64px', borderRadius: 32, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', ...txt(36, '#111', 900), textShadow: 'none' }}>{i + 1}</div>
              <div style={txt(Math.min(44, box * 0.4), 'white', 800)}>{t}</div>
            </div>
            {!last ? <div style={{ position: 'absolute', left: 535, top: y + box + 6, width: 10, height: 38 * arrow, background: accent, borderRadius: 5 }} /> : null}
            <Pop at={at} />
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------- quote: big quote, words fade in ----------
const Quote: React.FC<{ g: Extract<Graphic2, { type: 'quote' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const words = g.text.split(/\s+/).filter(Boolean);
  const per = Math.min(0.18, (len * 0.6) / Math.max(1, words.length));
  const mark = springAt(frame, fps, 0, 12);
  const by = springAt(frame, fps, (0.3 + per * words.length) * fps);
  const size = words.length > 22 ? 50 : words.length > 12 ? 60 : 72;
  return (
    <AbsoluteFill>
      <Zone style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <div style={{ ...txt(260, accent, 900), lineHeight: 0.6, height: 120, transform: `scale(${mark})`, transformOrigin: 'left top' }}>“</div>
        <div style={{ ...txt(size, 'white', 800), lineHeight: 1.25 }}>
          {words.map((w, i) => {
            const o = interpolate(frame, [(0.25 + i * per) * fps, (0.25 + i * per) * fps + 6], [0, 1], CLAMP);
            return <span key={i} style={{ opacity: o, display: 'inline-block', marginRight: '0.28em', transform: `translateY(${(1 - o) * 14}px)` }}>{w}</span>;
          })}
        </div>
        {g.by ? <div style={{ ...txt(40, accent, 700), marginTop: 36, opacity: by }}>— {g.by}</div> : null}
      </Zone>
    </AbsoluteFill>
  );
};

// ---------- stats: 2 to 4 tiles counting up ----------
const Stats: React.FC<{ g: Extract<Graphic2, { type: 'stats' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const items = g.items.slice(0, 4);
  const two = items.length > 2;
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <Zone title={!!g.title} style={{ flexWrap: 'wrap', gap: 30, alignContent: 'center' }}>
        {items.map((it, i) => {
          const at = (0.15 + i * 0.25) * fps;
          const s = springAt(frame, fps, at);
          const p = interpolate(frame, [at, at + Math.min(1.6, len * 0.5) * fps], [0, 1], { ...CLAMP, easing: EASE });
          const color = i === 0 ? accent : PALETTE[(i - 1) % PALETTE.length];
          return (
            <div key={i} style={{ width: two ? 440 : 900, height: two ? 290 : 250, borderRadius: 28, background: 'rgba(255,255,255,0.06)', border: `2px solid ${color}66`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: s, transform: `translateY(${(1 - s) * 50}px)` }}>
              <div style={{ ...txt(two ? 92 : 110, color, 900), fontVariantNumeric: 'tabular-nums' }}>{fmt(it.value * p, it.prefix, it.suffix)}</div>
              {it.label ? <div style={{ ...txt(34, 'white', 700), textAlign: 'center', padding: '0 20px', textTransform: 'uppercase' }}>{it.label}</div> : null}
              <Pop at={at} />
            </div>
          );
        })}
      </Zone>
    </AbsoluteFill>
  );
};

// ---------- myth vs fact: the myth gets struck out, the fact lands ----------
const Myth: React.FC<{ g: Extract<Graphic2, { type: 'myth' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const a = springAt(frame, fps, 0.1 * fps);
  const strike = interpolate(frame, [len * 0.32 * fps, len * 0.42 * fps], [0, 1], { ...CLAMP, easing: EASE });
  const b = springAt(frame, fps, len * 0.45 * fps, 11);
  const card = (tag: string, text: string, color: string, s: number, struck = 0) => (
    <div style={{ width: '100%', borderRadius: 28, padding: '30px 36px', background: `${color}1f`, border: `3px solid ${color}`, opacity: s, transform: `scale(${0.85 + 0.15 * s})` }}>
      <div style={{ ...txt(34, color, 900), letterSpacing: 4, marginBottom: 12 }}>{tag}</div>
      <div style={{ position: 'relative', ...txt(50, struck ? '#c9ccd3' : 'white', 800) }}>
        {text}
        {struck ? <div style={{ position: 'absolute', left: 0, top: '50%', height: 8, width: `${struck * 100}%`, background: color, borderRadius: 4 }} /> : null}
      </div>
    </div>
  );
  return (
    <AbsoluteFill>
      <Zone style={{ flexDirection: 'column', gap: 50 }}>
        {card('MYTH', g.myth, '#ef5f6b', a, strike)}
        {card('FACT', g.fact, accent, b)}
      </Zone>
      <Pop at={len * 0.32 * fps} name="whoosh-soft" /><Pop at={len * 0.45 * fps} name="impact-soft" volume={0.3} />
    </AbsoluteFill>
  );
};

// ---------- people: an icon grid, N of total lit ----------
const Person: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="6.5" r="4" fill={color} /><path d="M4 22c0-5 3.6-8.5 8-8.5s8 3.5 8 8.5z" fill={color} /></svg>
);
const People: React.FC<{ g: Extract<Graphic2, { type: 'people' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const total = Math.max(2, Math.min(100, Math.round(g.total || 10)));
  const lit = Math.max(0, Math.min(total, Math.round(g.value)));
  const cols = total <= 10 ? 5 : 10;
  const size = total <= 10 ? 150 : 82;
  const per = Math.min(0.12, (len * 0.6) / total);
  const lab = springAt(frame, fps, (0.3 + per * total) * fps);
  return (
    <AbsoluteFill>
      <Zone style={{ flexDirection: 'column', gap: 40 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap: total <= 10 ? 18 : 6 }}>
          {Array.from({ length: total }).map((_, i) => {
            const on = interpolate(frame, [(0.2 + i * per) * fps, (0.2 + i * per) * fps + 5], [0, 1], CLAMP);
            return <div key={i} style={{ opacity: 0.25 + 0.75 * on, transform: `scale(${0.6 + 0.4 * on})` }}><Person size={size} color={i < lit ? accent : 'rgba(255,255,255,0.35)'} /></div>;
          })}
        </div>
        <div style={{ ...txt(64, 'white', 900), opacity: lab, textAlign: 'center' }}>
          <span style={{ color: accent }}>{lit} in {total}</span>{g.label ? <div style={txt(42, 'white', 700)}>{g.label}</div> : null}
        </div>
      </Zone>
    </AbsoluteFill>
  );
};

// ---------- chat: message bubbles pop in ----------
const Chat: React.FC<{ g: Extract<Graphic2, { type: 'chat' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const msgs = g.messages.slice(0, 6);
  const gap = Math.min(0.9, (len * 0.8) / msgs.length);
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <Zone title={!!g.title} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 22 }}>
        {msgs.map((m, i) => {
          const at = (0.15 + i * gap) * fps;
          const s = springAt(frame, fps, at, 13);
          const me = m.from === 'me';
          if (frame < at) return null;
          return (
            <div key={i} style={{ alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: 760, padding: '24px 32px', borderRadius: 36,
              borderBottomRightRadius: me ? 8 : 36, borderBottomLeftRadius: me ? 36 : 8, background: me ? accent : '#2a2f3a',
              transform: `scale(${s})`, transformOrigin: me ? 'right bottom' : 'left bottom', ...txt(42, me ? '#111' : 'white', 700), textShadow: 'none' }}>
              {m.text}
              <Pop at={at} />
            </div>
          );
        })}
      </Zone>
    </AbsoluteFill>
  );
};

// ---------- kinetic: words slam in one by one, full screen typography ----------
const Kinetic: React.FC<{ g: Extract<Graphic2, { type: 'kinetic' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const words = g.words.slice(0, 8);
  const per = (len * 0.85) / words.length;
  return (
    <AbsoluteFill>
      <Zone style={{ flexDirection: 'column', gap: 6 }}>
        {words.map((w, i) => {
          const at = (0.1 + i * per) * fps;
          if (frame < at) return null;
          const s = springAt(frame, fps, at, 9);
          const big = w.length <= 6;
          const color = i % 3 === 1 ? accent : 'white';
          return (
            <div key={i} style={{ ...txt(big ? 170 : Math.max(80, 1500 / Math.max(6, w.length)), color, 900), textTransform: 'uppercase', lineHeight: 0.95,
              transform: `scale(${1.6 - 0.6 * s}) rotate(${(i % 2 ? 1 : -1) * 3 * (1 - s)}deg)`, opacity: Math.min(1, s * 1.5) }}>
              {w}
              <Pop at={at} name="impact-soft" volume={0.22} />
            </div>
          );
        })}
      </Zone>
    </AbsoluteFill>
  );
};

// ---------- gauge: a speedometer needle swings to the value ----------
const Gauge: React.FC<{ g: Extract<Graphic2, { type: 'gauge' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const min = g.min ?? 0, max = g.max ?? 100;
  const t = Math.max(0, Math.min(1, (g.value - min) / ((max - min) || 1)));
  const p = spring({ frame: frame - 0.25 * fps, fps, config: { damping: 9, stiffness: 60 } });
  const ang = -120 + 240 * t * p;
  const R = 330, cx = 400, cy = 420;
  const arc = (a0: number, a1: number) => {
    const pt = (a: number) => [cx + R * Math.sin((a * Math.PI) / 180), cy - R * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M${x0} ${y0} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  return (
    <AbsoluteFill>
      <Zone style={{ flexDirection: 'column' }}>
        <svg width={800} height={560}>
          <path d={arc(-120, 120)} stroke="rgba(255,255,255,0.12)" strokeWidth={48} fill="none" strokeLinecap="round" />
          <path d={arc(-120, Math.max(-119.9, ang))} stroke={accent} strokeWidth={48} fill="none" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 16px ${accent}99)` }} />
          <g transform={`rotate(${ang} ${cx} ${cy})`}><path d={`M${cx - 14} ${cy} L${cx} ${cy - R + 50} L${cx + 14} ${cy} Z`} fill="white" /></g>
          <circle cx={cx} cy={cy} r={30} fill="white" />
        </svg>
        <div style={{ ...txt(110, 'white', 900), marginTop: -60, fontVariantNumeric: 'tabular-nums' }}>{fmt(min + (g.value - min) * Math.min(1, p), '', g.suffix || '')}</div>
        {g.label ? <div style={{ ...txt(46, accent, 800), textTransform: 'uppercase', textAlign: 'center' }}>{g.label}</div> : null}
      </Zone>
      <Pop at={0.25 * fps} name="whoosh-soft" />
    </AbsoluteFill>
  );
};

// ---------- map: real country outlines, the named ones light up ----------
const MapScene: React.FC<{ g: Extract<Graphic2, { type: 'map' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const names = g.countries.map((n) => n.toLowerCase());
  const hits = WORLD.filter((c) => names.includes(c.name.toLowerCase()));
  let lon: [number, number] = [-170, 190], lat: [number, number] = [-56, 78];
  if (hits.length) {
    const pts = hits.flatMap((c) => c.rings.flat());
    const lo0 = Math.min(...pts.map((p) => p[0])), lo1 = Math.max(...pts.map((p) => p[0]));
    const la0 = Math.min(...pts.map((p) => p[1])), la1 = Math.max(...pts.map((p) => p[1]));
    const padLon = Math.max(12, (lo1 - lo0) * 0.6), padLat = Math.max(8, (la1 - la0) * 0.5);
    lon = [Math.max(-180, lo0 - padLon), Math.min(190, lo1 + padLon)];
    lat = [Math.max(-58, la0 - padLat), Math.min(80, la1 + padLat)];
  }
  const zoom = interpolate(frame, [0, len * fps], [1, 1.08], CLAMP);
  const top = TOP + (g.title ? 150 : 0);
  const boxH = H - (g.title ? 150 : 0) - (g.label ? 90 : 0);
  let sc = makeMapScale(lon, lat, { x: 0, y: 0, w: 1000 });
  if (sc.box.h > boxH) sc = makeMapScale(lon, lat, { x: 0, y: 0, w: 1000 * (boxH / sc.box.h) });
  const ox = (1080 - sc.box.w) / 2, oy = top + (boxH - sc.box.h) / 2;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, width: 1080, top, height: boxH, overflow: 'hidden', borderRadius: 24 }}>
      <svg width={1080} height={1920} style={{ position: 'absolute', left: 0, top: -top, transform: `scale(${zoom})`, transformOrigin: `540px ${oy + sc.box.h / 2}px` }}>
        <g transform={`translate(${ox} ${oy})`}>
          {WORLD.filter((c) => c.cont !== 'Antarctica').map((c) => <path key={c.name} d={countryPath(sc, c)} fill="#1f2a38" stroke="#33465e" strokeWidth={1.2} />)}
          {hits.map((c, i) => {
            const on = interpolate(frame, [(0.3 + i * 0.35) * fps, (0.6 + i * 0.35) * fps], [0, 1], CLAMP);
            return <path key={c.name} d={countryPath(sc, c)} fill={accent} fillOpacity={0.85 * on} stroke={accent} strokeWidth={2.5} style={{ filter: `drop-shadow(0 0 ${14 * on}px ${accent})` }} />;
          })}
        </g>
      </svg>
      </div>
      <Heading text={g.title} accent={accent} />
      {hits.map((c, i) => {
        const [x, y] = sc.px(...centroid(c));
        const s = springAt(frame, fps, (0.5 + i * 0.35) * fps);
        return <div key={c.name} style={{ position: 'absolute', left: ox + x, top: oy + y, transform: `translate(-50%,-50%) scale(${s})`, padding: '8px 18px', borderRadius: 14,
          background: 'rgba(10,13,18,0.85)', border: `2px solid ${accent}`, whiteSpace: 'nowrap', ...txt(30, 'white', 800) }}>{c.name}</div>;
      })}
      {g.label ? <div style={{ position: 'absolute', left: 70, right: 70, top: BOTTOM - 80, textAlign: 'center', ...txt(46, 'white', 800), opacity: springAt(frame, fps, 0.8 * fps) }}>{g.label}</div> : null}
    </AbsoluteFill>
  );
};

// ---------- icons: an explainer row/grid of icons with labels ----------
const pascal = (s: string) => String(s || '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
export const iconFor = (name: string) => {
  const map = icons as unknown as Record<string, React.FC<{ size?: number; color?: string; strokeWidth?: number }>>;
  return map[pascal(name)] || map[pascal(name.replace(/s$/, ''))] || map.Sparkles || map.Circle;
};
const IconsScene: React.FC<{ g: Extract<Graphic2, { type: 'icons' }>; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const items = g.items.slice(0, 6);
  const gap = Math.min(0.5, (len * 0.6) / items.length);
  const cols = items.length <= 3 ? items.length : items.length === 4 ? 2 : 3;
  const size = cols <= 2 ? 170 : 130;
  return (
    <AbsoluteFill>
      <Heading text={g.title} accent={accent} />
      <Zone title={!!g.title} style={{ flexWrap: 'wrap', gap: '40px 30px', alignContent: 'center' }}>
        {items.map((it, i) => {
          const at = (0.15 + i * gap) * fps;
          const s = springAt(frame, fps, at, 11);
          const Ico = iconFor(it.icon);
          const color = i % 2 ? PALETTE[(i >> 1) % PALETTE.length] : accent;
          const bob = Math.sin((frame - at) / 14) * 6 * s;
          return (
            <div key={i} style={{ width: (940 - (cols - 1) * 30) / cols, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, opacity: s, transform: `translateY(${(1 - s) * 60 + bob}px)` }}>
              <div style={{ width: size + 70, height: size + 70, borderRadius: 40, background: `${color}22`, border: `3px solid ${color}88`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${s})` }}>
                <Ico size={size} color={color} strokeWidth={1.8} />
              </div>
              <div style={{ ...txt(38, 'white', 800), textAlign: 'center' }}>{it.label}</div>
              <Pop at={at} />
            </div>
          );
        })}
      </Zone>
    </AbsoluteFill>
  );
};

export const Graphic2Beat: React.FC<{ g: Graphic2; accent: string; len: number }> = ({ g, accent, len }) => {
  switch (g.type) {
    case 'versus': return <Versus g={g} accent={accent} len={len} />;
    case 'percent': return <Percent g={g} accent={accent} len={len} />;
    case 'pie': return <Pie g={g} accent={accent} len={len} />;
    case 'timeline': return <Timeline g={g} accent={accent} len={len} />;
    case 'flow': return <Flow g={g} accent={accent} len={len} />;
    case 'quote': return <Quote g={g} accent={accent} len={len} />;
    case 'stats': return <Stats g={g} accent={accent} len={len} />;
    case 'myth': return <Myth g={g} accent={accent} len={len} />;
    case 'people': return <People g={g} accent={accent} len={len} />;
    case 'chat': return <Chat g={g} accent={accent} len={len} />;
    case 'kinetic': return <Kinetic g={g} accent={accent} len={len} />;
    case 'gauge': return <Gauge g={g} accent={accent} len={len} />;
    case 'map': return <MapScene g={g} accent={accent} len={len} />;
    case 'icons': return <IconsScene g={g} accent={accent} len={len} />;
    default: return null;
  }
};
