// graphics3.tsx (fix1): scenes that SHOW a claim instead of decorating it.
// network (hub | peer), cap, printing, shrink, crack. Self-contained: only depends on remotion.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Graphic4Beat } from './graphics4';

export const GRAPHIC3_TYPES = ['network', 'cap', 'printing', 'shrink', 'crack'];

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const FONT = 'Montserrat, Inter, system-ui, sans-serif';
const RED = '#ef5f6b';
const GREY = '#8b96a5';
const GREEN = '#9ccc65';
const WHITE = '#ffffff';

const st = (size: number, fill: string = WHITE, weight = 800): React.CSSProperties =>
  ({ fontFamily: FONT, fontWeight: weight, fontSize: size, fill, letterSpacing: -0.5 } as React.CSSProperties);

const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { frame, fps };
};
const pop = (frame: number, fps: number, at: number) => spring({ frame: Math.max(0, frame - at), fps, config: { damping: 14, stiffness: 120 } });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const Stage: React.FC<{ title?: string; children?: React.ReactNode }> = ({ title, children }) => (
  <AbsoluteFill>
    {title ? (
      <div style={{ position: 'absolute', top: 170, left: 40, right: 40, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: 64, color: WHITE, textShadow: '0 4px 18px rgba(0,0,0,0.55)' }}>{title}</div>
    ) : null}
    <div style={{ position: 'absolute', top: 300, left: 40, right: 40, height: 790 }}>
      <svg viewBox="0 0 1000 790" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
        {children}
      </svg>
    </div>
  </AbsoluteFill>
);

// ---- network: hub = everything routes through one centre; peer = no centre, centre crossed out
const Network: React.FC<{ g: any; accent: string; len: number }> = ({ g, accent }) => {
  const { frame, fps } = useT();
  const nodes: string[] = (g.nodes || []).slice(0, 6);
  const n = Math.max(2, nodes.length);
  const hub = g.mode !== 'peer';
  const cx = 500, cy = 395, R = 270;
  const pos = nodes.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + R * Math.cos(a), y: cy + R * 0.9 * Math.sin(a) };
  });
  const links: Array<[number, number]> = [];
  if (hub) pos.forEach((_, i) => links.push([i, -1]));
  else {
    pos.forEach((_, i) => links.push([i, (i + 1) % n]));
    if (n >= 5) pos.forEach((_, i) => links.push([i, (i + 2) % n]));
  }
  const pt = (k: number) => (k < 0 || !pos[k] ? { x: cx, y: cy } : pos[k]);
  const linkAt = interpolate(frame, [0.5 * fps, 1.1 * fps], [0, 1], CLAMP);
  const dotsOn = interpolate(frame, [1.0 * fps, 1.3 * fps], [0, 1], CLAMP);
  const xk = interpolate(frame, [1.6 * fps, 2.0 * fps], [0, 1], CLAMP);
  const dots = pos.map((_, i) => {
    const t = ((frame / fps) * 0.55 + i / n) % 1;
    const a = pos[i], b = pos[(i + 1) % n], c = { x: cx, y: cy };
    const [from, to, k] = hub ? (t < 0.5 ? [a, c, t * 2] : [c, b, (t - 0.5) * 2]) : [a, b, t];
    return { x: lerp((from as any).x, (to as any).x, k as number), y: lerp((from as any).y, (to as any).y, k as number) };
  });
  const lineColor = hub ? accent : GREEN;
  const center = String(g.center || 'Bank');
  return (
    <Stage title={g.title}>
      {links.map(([i, j], k) => (
        <line key={k} x1={pt(i).x} y1={pt(i).y} x2={pt(j).x} y2={pt(j).y} stroke={lineColor} strokeWidth={5} strokeOpacity={0.55 * linkAt} />
      ))}
      <g opacity={hub ? 1 : 0.35}>
        <rect x={cx - 120} y={cy - 55} width={240} height={110} rx={26} fill={hub ? accent + '33' : 'rgba(255,255,255,0.08)'} stroke={hub ? accent : GREY} strokeWidth={5} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central" style={st(Math.min(40, 210 / (center.length * 0.62)), hub ? WHITE : GREY)}>{center}</text>
      </g>
      {!hub ? (
        <g opacity={xk}>
          <line x1={cx - 110} y1={cy - 55} x2={cx - 110 + 220 * xk} y2={cy - 55 + 110 * xk} stroke={RED} strokeWidth={11} strokeLinecap="round" />
          <line x1={cx + 110} y1={cy - 55} x2={cx + 110 - 220 * xk} y2={cy - 55 + 110 * xk} stroke={RED} strokeWidth={11} strokeLinecap="round" />
        </g>
      ) : null}
      {nodes.map((label, i) => {
        const s = pop(frame, fps, (0.1 + i * 0.12) * fps);
        return (
          <g key={i} transform={`translate(${pos[i].x},${pos[i].y}) scale(${0.6 + 0.4 * s})`} opacity={s}>
            <rect x={-95} y={-37} width={190} height={74} rx={22} fill="rgba(255,255,255,0.09)" stroke="rgba(255,255,255,0.35)" strokeWidth={3} />
            <text textAnchor="middle" dominantBaseline="central" y={2} style={st(Math.min(28, 170 / (label.length * 0.62)))}>{label}</text>
          </g>
        );
      })}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={11} fill={lineColor} opacity={dotsOn} />
      ))}
    </Stage>
  );
};

// ---- cap: a count climbs and stops at a hard wall
const Cap: React.FC<{ g: any; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const run = Math.min(3.4, Math.max(1.6, len * 0.6));
  const t = interpolate(frame, [0.3 * fps, (0.3 + run) * fps], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const pre = g.prefix || '', suf = g.suffix || '';
  const shown = `${pre}${Math.round(g.value * t).toLocaleString('en-US')}${suf}`;
  const full = `${pre}${Math.round(g.value).toLocaleString('en-US')}${suf}`;
  const size = Math.min(130, 900 / (full.length * 0.62));
  const hitAt = (0.3 + run) * fps;
  const hp = pop(frame, fps, hitAt);
  const note = interpolate(frame, [hitAt, hitAt + 0.4 * fps], [0, 1], CLAMP);
  return (
    <Stage>
      {g.label ? <text x={500} y={170} textAnchor="middle" style={st(46, GREY, 700)}>{g.label}</text> : null}
      <text x={500} y={330} textAnchor="middle" style={st(size, WHITE, 900)}>{shown}</text>
      <rect x={100} y={430} width={800} height={46} rx={23} fill="rgba(255,255,255,0.1)" />
      <rect x={100} y={430} width={Math.max(1, 800 * t)} height={46} rx={23} fill={accent} />
      <rect x={892} y={380 - 20 * hp} width={18} height={146 + 40 * hp} rx={6} fill={RED} />
      {g.note ? <text x={500} y={620} textAnchor="middle" opacity={note} style={st(56)}>{g.note}</text> : null}
    </Stage>
  );
};

// ---- printing: banknotes stack up, no ceiling
const Printing: React.FC<{ g: any; accent: string; len: number }> = ({ g, accent }) => {
  const { frame, fps } = useT();
  const count = Math.min(14, Math.floor(frame / fps / 0.16));
  const notes = Array.from({ length: count }, (_, i) => i);
  return (
    <Stage>
      {notes.map((i) => {
        const s = pop(frame, fps, i * 0.16 * fps);
        const y = 500 - i * 34;
        const x = 330 + (i % 2 ? 18 : -18);
        return (
          <g key={i} transform={`translate(${x},${y}) scale(${0.85 + 0.15 * s})`} opacity={s}>
            <rect width={340} height={150} rx={14} fill="#2e7d4f" stroke={GREEN} strokeWidth={4} />
            <circle cx={170} cy={75} r={38} fill="none" stroke={GREEN} strokeWidth={5} />
            <rect x={20} y={20} width={50} height={14} rx={7} fill={GREEN} opacity={0.7} />
            <rect x={270} y={116} width={50} height={14} rx={7} fill={GREEN} opacity={0.7} />
          </g>
        );
      })}
      <polygon points="860,120 905,200 875,200 875,420 845,420 845,200 815,200" fill={accent} opacity={interpolate(frame, [0.6 * fps, 1.2 * fps], [0, 0.9], CLAMP)} />
      {g.label ? <text x={500} y={735} textAnchor="middle" style={st(70, WHITE, 900)}>{g.label}</text> : null}
      {g.caption ? <text x={500} y={780} textAnchor="middle" style={st(32, GREY, 700)}>{g.caption}</text> : null}
    </Stage>
  );
};

// ---- shrink: the price goes up while the same note shrinks
const Shrink: React.FC<{ g: any; accent: string; len: number }> = ({ g, accent, len }) => {
  const { frame, fps } = useT();
  const run = Math.min(3, Math.max(1.4, len * 0.6));
  const t = interpolate(frame, [0.5 * fps, (0.5 + run) * fps], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
  const hasNum = typeof g.from === 'number' && typeof g.to === 'number';
  const dec = hasNum && (g.from % 1 !== 0 || g.to % 1 !== 0) ? 2 : 0;
  const val = hasNum ? lerp(g.from, g.to, t).toFixed(dec) : '';
  const scale = lerp(1, 0.45, t);
  const note = interpolate(frame, [(0.5 + run * 0.6) * fps, (0.5 + run) * fps], [0, 1], CLAMP);
  return (
    <Stage>
      <g transform="translate(270,340)">
        <polygon points="-130,-90 70,-90 140,0 70,90 -130,90" fill={accent + '22'} stroke={accent} strokeWidth={5} />
        <circle cx={-95} cy={0} r={14} fill="rgba(0,0,0,0.6)" />
        {hasNum ? (
          <text x={-5} y={2} textAnchor="middle" dominantBaseline="central" style={st(70, WHITE, 900)}>{`${g.prefix || ''}${val}`}</text>
        ) : (
          <polygon points="-5,-55 40,10 12,10 12,55 -22,55 -22,10 -50,10" fill={RED} />
        )}
      </g>
      {g.item ? <text x={270} y={480} textAnchor="middle" style={st(38, GREY, 700)}>{g.item}</text> : null}
      <g transform={`translate(730,340) scale(${scale})`}>
        <rect x={-150} y={-70} width={300} height={140} rx={14} fill="#2e7d4f" stroke={GREEN} strokeWidth={4} />
        <circle cx={0} cy={0} r={34} fill="none" stroke={GREEN} strokeWidth={5} />
      </g>
      {g.note ? <text x={500} y={650} textAnchor="middle" opacity={note} style={st(48)}>{g.note}</text> : null}
    </Stage>
  );
};

// ---- crack: a bank facade cracks while a line falls
const Crack: React.FC<{ g: any; accent: string; len: number }> = ({ g, accent }) => {
  const { frame, fps } = useT();
  const inT = pop(frame, fps, 0.1 * fps);
  const crack = interpolate(frame, [0.8 * fps, 2.0 * fps], [0, 1], CLAMP);
  const line = interpolate(frame, [0.8 * fps, 2.4 * fps], [0, 1], CLAMP);
  const shake = crack > 0 && crack < 1 ? Math.sin(frame * 2.2) * 3 : 0;
  const lab = interpolate(frame, [2.0 * fps, 2.5 * fps], [0, 1], CLAMP);
  const soft = 'rgba(255,255,255,0.14)';
  const edge = 'rgba(255,255,255,0.38)';
  return (
    <Stage>
      {g.title ? <text x={500} y={110} textAnchor="middle" style={st(110, accent, 900)}>{g.title}</text> : null}
      <g transform={`translate(${shake},0)`} opacity={inT}>
        <polygon points="130,260 380,150 630,260" fill={soft} stroke={edge} strokeWidth={4} />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={160 + i * 95} y={280} width={50} height={280} rx={6} fill={soft} stroke={edge} strokeWidth={3} />
        ))}
        <rect x={110} y={560} width={540} height={40} fill={soft} stroke={edge} strokeWidth={3} />
        <rect x={80} y={600} width={600} height={40} fill={soft} stroke={edge} strokeWidth={3} />
        <path d="M 380 160 L 355 250 L 400 330 L 360 420 L 405 500 L 370 640" fill="none" stroke={RED} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - crack} />
      </g>
      <line x1={700} y1={220} x2={700} y2={680} stroke="rgba(255,255,255,0.25)" strokeWidth={3} />
      <line x1={700} y1={680} x2={960} y2={680} stroke="rgba(255,255,255,0.25)" strokeWidth={3} />
      <path d="M 710 260 L 770 250 L 820 330 L 870 410 L 910 560 L 950 660" fill="none" stroke={RED} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - line} />
      {g.label ? <text x={500} y={750} textAnchor="middle" opacity={lab} style={st(52)}>{g.label}</text> : null}
    </Stage>
  );
};

export const Graphic3Beat: React.FC<{ g: any; accent: string; len: number }> = ({ g, accent, len }) => {
  switch (g && g.type) {
    case 'network': return <Network g={g} accent={accent} len={len} />;
    case 'cap': return <Cap g={g} accent={accent} len={len} />;
    case 'printing': return <Printing g={g} accent={accent} len={len} />;
    case 'shrink': return <Shrink g={g} accent={accent} len={len} />;
    case 'crack': return <Crack g={g} accent={accent} len={len} />;
    default: return <Graphic4Beat g={g} accent={accent} len={len} />;
  }
};
