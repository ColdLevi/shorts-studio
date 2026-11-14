// graphics4.tsx (fix4): story scenes that show the exact thing the sentence names.
// date, post, profile, pin, jump, tally. Self-contained: only depends on remotion.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const GRAPHIC4_TYPES = ['date', 'post', 'profile', 'pin', 'jump', 'tally'];

const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const FONT = 'Montserrat, Inter, system-ui, sans-serif';
const INK = '#1b1b2f';
const CREAM = '#fff6e0';
const PAPER = '#ffffff';
const YEL = '#ffc933';
const RED = '#e8452c';
const BLUE = '#3f6fa8';
const GREEN = '#2fb36d';
const SOFT = '#e9edf5';

const st = (size: number, fill: string = INK, weight = 900): React.CSSProperties =>
  ({ fontFamily: FONT, fontWeight: weight, fontSize: size, fill, letterSpacing: -0.5 } as React.CSSProperties);

const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { frame, fps };
};
const pop = (frame: number, fps: number, at: number) =>
  spring({ frame: Math.max(0, frame - at), fps, config: { damping: 13, stiffness: 140 } });
const ease = (frame: number, a: number, b: number) =>
  interpolate(frame, [a, b], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });

const Stage: React.FC<{ title?: string; children?: React.ReactNode }> = ({ title, children }) => (
  <AbsoluteFill>
    {title ? (
      <div style={{ position: 'absolute', top: 170, left: 40, right: 40, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: 60, color: '#fff', textShadow: '0 4px 18px rgba(0,0,0,0.55)' }}>{title}</div>
    ) : null}
    <div style={{ position: 'absolute', top: 300, left: 40, right: 40, height: 790 }}>
      <svg viewBox="0 0 1000 790" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
        {children}
      </svg>
    </div>
  </AbsoluteFill>
);

// thick-outline "sticker" card with a hard offset shadow
const Card: React.FC<{ x: number; y: number; w: number; h: number; fill?: string; r?: number }> = ({ x, y, w, h, fill = PAPER, r = 28 }) => (
  <g>
    <rect x={x + 12} y={y + 14} width={w} height={h} rx={r} fill={INK} opacity={0.9} />
    <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke={INK} strokeWidth={7} />
  </g>
);

const Chip: React.FC<{ cx: number; cy: number; text: string; fill?: string; color?: string; size?: number; scale?: number }> = ({ cx, cy, text, fill = YEL, color = INK, size = 40, scale = 1 }) => {
  const w = Math.max(160, text.length * size * 0.62 + 60);
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} opacity={Math.min(1, scale * 1.4)}>
      <rect x={-w / 2 + 6} y={-34 + 8} width={w} height={68} rx={34} fill={INK} />
      <rect x={-w / 2} y={-34} width={w} height={68} rx={34} fill={fill} stroke={INK} strokeWidth={6} />
      <text x={0} y={size * 0.36} textAnchor="middle" style={st(size, color)}>{text}</text>
    </g>
  );
};

// ---- date: a calendar page drops in, the day number slams down
const DateScene: React.FC<{ g: any }> = ({ g }) => {
  const { frame, fps } = useT();
  const drop = interpolate(frame, [0, 12], [-420, 0], { ...CLAMP, easing: Easing.out(Easing.back(1.5)) });
  const tilt = interpolate(frame, [0, 14, 22], [-12, 3, 0], CLAMP);
  const day = pop(frame, fps, 9);
  const lab = pop(frame, fps, 20);
  return (
    <Stage title={g.title}>
      <g transform={`translate(500 ${360 + drop}) rotate(${tilt})`}>
        <Card x={-250} y={-290} w={500} h={580} fill={CREAM} />
        <path d="M -250 -262 a 28 28 0 0 1 28 -28 h 444 a 28 28 0 0 1 28 28 v 112 h -500 z" fill={RED} stroke={INK} strokeWidth={7} />
        <circle cx={-130} cy={-290} r={16} fill={INK} />
        <circle cx={130} cy={-290} r={16} fill={INK} />
        <text x={0} y={-188} textAnchor="middle" style={st(86, '#fff')}>{String(g.month || '').toUpperCase()}</text>
        <g transform={`translate(0 70) scale(${0.3 + 0.7 * day})`} opacity={Math.min(1, day * 1.5)}>
          <text x={0} y={0} textAnchor="middle" style={st(270)}>{g.day}</text>
        </g>
        <text x={0} y={200} textAnchor="middle" style={st(78, INK, 800)}>{g.year}</text>
      </g>
      {g.label ? <Chip cx={500} cy={720} text={String(g.label)} scale={lab} /> : null}
    </Stage>
  );
};

// ---- post: a forum / chat post that types itself out
const wrapText = (t: string, max: number) => {
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
};
const PostScene: React.FC<{ g: any }> = ({ g }) => {
  const { frame, fps } = useT();
  const enter = pop(frame, fps, 0);
  const text = String(g.text || '');
  const lines = wrapText(text, 23).slice(0, 7);
  const total = lines.join(' ').length;
  const typed = Math.floor(interpolate(frame, [12, 12 + Math.max(24, total * 1.5)], [0, total], CLAMP));
  let left = typed;
  const caret = frame % 18 < 10;
  return (
    <Stage title={g.title}>
      <g transform={`translate(0 ${(1 - enter) * 120})`} opacity={Math.min(1, enter * 1.6)}>
        <Card x={20} y={60} w={940} h={Math.max(480, 330 + lines.length * 56)} fill={PAPER} r={30} />
        <path d="M 20 90 a 30 30 0 0 1 30 -30 h 880 a 30 30 0 0 1 30 30 v 70 h -940 z" fill={BLUE} stroke={INK} strokeWidth={7} />
        <text x={60} y={128} style={st(44, '#fff')}>{g.site || 'Forum'}</text>
        {g.date ? <text x={920} y={126} textAnchor="end" style={st(34, '#dfe9f7', 700)}>{g.date}</text> : null}
        {g.subject ? <text x={60} y={216} style={st(42, INK, 900)}>{g.subject}</text> : null}
        <rect x={60} y={250} width={150} height={150} rx={26} fill={SOFT} stroke={INK} strokeWidth={6} />
        <circle cx={135} cy={310} r={32} fill={BLUE} />
        <path d="M 85 392 q 0 -50 50 -50 q 50 0 50 50 z" fill={BLUE} />
        <text x={135} y={430} textAnchor="middle" style={st(30, INK, 800)}>{g.user}</text>
        {lines.map((ln, i) => {
          const show = Math.max(0, Math.min(ln.length, left));
          left -= ln.length + 1;
          const isLast = show > 0 && show < ln.length;
          return (
            <text key={i} x={240} y={300 + i * 56} style={st(44, INK, 700)}>
              {ln.slice(0, show)}{isLast && caret ? '|' : ''}
            </text>
          );
        })}
      </g>
    </Stage>
  );
};

// ---- profile: a person card with avatar and age badge
const ProfileScene: React.FC<{ g: any }> = ({ g }) => {
  const { frame, fps } = useT();
  const enter = pop(frame, fps, 0);
  const av = pop(frame, fps, 8);
  const badge = pop(frame, fps, 18);
  const initial = String(g.name || '?').trim().charAt(0).toUpperCase();
  return (
    <Stage title={g.title}>
      <g transform={`translate(${(1 - enter) * 600} 0)`}>
        <Card x={60} y={170} w={880} h={460} fill={CREAM} />
        <g transform={`translate(260 400) scale(${0.2 + 0.8 * av})`}>
          <circle r={120} fill={BLUE} stroke={INK} strokeWidth={7} />
          <text x={0} y={42} textAnchor="middle" style={st(130, '#fff')}>{initial}</text>
        </g>
        <text x={430} y={330} style={st(36, '#6b7280', 800)}>{g.role || 'NAME'}</text>
        <text x={430} y={420} style={st(g.name && String(g.name).length > 9 ? 74 : 92)}>{g.name}</text>
        {g.handle ? <text x={430} y={490} style={st(42, BLUE, 800)}>@{g.handle}</text> : null}
        {g.age ? (
          <g transform={`translate(780 215) scale(${badge})`}>
            <circle r={78} fill={YEL} stroke={INK} strokeWidth={7} />
            <text x={0} y={-6} textAnchor="middle" style={st(26, INK, 800)}>AGE</text>
            <text x={0} y={52} textAnchor="middle" style={st(68)}>{g.age}</text>
          </g>
        ) : null}
      </g>
    </Stage>
  );
};

// ---- pin: a map with a route and a pin that drops and pulses
const PinScene: React.FC<{ g: any }> = ({ g }) => {
  const { frame, fps } = useT();
  const route = ease(frame, 4, 30);
  const drop = interpolate(frame, [26, 38], [-260, 0], { ...CLAMP, easing: Easing.out(Easing.bounce) });
  const lab = pop(frame, fps, 36);
  const pulse = (frame % 40) / 40;
  return (
    <Stage title={g.title}>
      <Card x={20} y={70} w={940} h={600} fill="#f4efe1" r={34} />
      <g opacity={0.9}>
        {[200, 340, 480, 600].map((y) => <line key={'h' + y} x1={40} x2={940} y1={y} y2={y} stroke="#dcd3bb" strokeWidth={26} />)}
        {[190, 400, 620, 830].map((x) => <line key={'v' + x} x1={x} x2={x} y1={90} y2={650} stroke="#dcd3bb" strokeWidth={26} />)}
        <rect x={430} y={360} width={170} height={110} rx={14} fill="#bfe3c4" />
      </g>
      <path d="M 100 600 L 100 340 L 400 340 L 400 200 L 620 200" fill="none" stroke={BLUE} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - route} />
      <circle cx={620} cy={200} r={20 + pulse * 70} fill="none" stroke={RED} strokeWidth={6} opacity={(1 - pulse) * (frame > 36 ? 1 : 0)} />
      <g transform={`translate(620 ${200 + drop})`}>
        <path d="M 0 0 C -70 -90 -64 -150 0 -150 C 64 -150 70 -90 0 0 Z" fill={RED} stroke={INK} strokeWidth={7} />
        <circle cx={0} cy={-100} r={22} fill="#fff" stroke={INK} strokeWidth={5} />
      </g>
      {g.place ? <Chip cx={500} cy={730} text={String(g.place)} fill="#fff" scale={lab} /> : null}
      {g.label ? <Chip cx={620} cy={20} text={String(g.label)} fill={YEL} size={34} scale={lab} /> : null}
    </Stage>
  );
};

// ---- jump: a value before and after, the second one climbing
const compact = (v: number, prefix: string, suffix: string) => {
  let s: string;
  const a = Math.abs(v);
  if (a >= 1e12) s = (v / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  else if (a >= 1e9) s = (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  else if (a >= 1e6) s = (v / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  else if (a >= 1e4) s = Math.round(v).toLocaleString('en-US');
  else s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${prefix}${s}${suffix}`;
};
const JumpScene: React.FC<{ g: any }> = ({ g }) => {
  const { frame, fps } = useT();
  const a = pop(frame, fps, 0);
  const arrow = ease(frame, 16, 30);
  const b = pop(frame, fps, 24);
  const k = ease(frame, 30, 80);
  const val = (Number(g.to) || 0) * k;
  const line = ease(frame, 34, 90);
  return (
    <Stage title={g.title}>
      <g transform={`translate(500 130) scale(${a})`}>
        <Card x={-260} y={-110} w={520} h={220} fill={CREAM} />
        <text x={0} y={-30} textAnchor="middle" style={st(36, '#6b7280', 800)}>{g.fromLabel || 'THEN'}</text>
        <text x={0} y={62} textAnchor="middle" style={st(104)}>{compact(Number(g.from) || 0, g.prefix || '', g.suffix || '')}</text>
      </g>
      <path d="M 500 260 L 500 340" stroke={INK} strokeWidth={14} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - arrow} fill="none" />
      <path d="M 460 312 L 500 352 L 540 312" stroke={INK} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={arrow > 0.9 ? 1 : 0} />
      <g transform={`translate(500 520) scale(${b})`}>
        <Card x={-460} y={-130} w={920} h={290} fill={YEL} />
        <text x={0} y={-52} textAnchor="middle" style={st(38, INK, 800)}>{g.toLabel || 'NOW'}</text>
        <text x={0} y={70} textAnchor="middle" style={st(150)}>{compact(val, g.prefix || '', g.suffix || '')}</text>
        {g.note ? <text x={0} y={128} textAnchor="middle" style={st(32, INK, 800)} opacity={ease(frame, 60, 74)}>{g.note}</text> : null}
      </g>
      <path d="M 60 775 L 240 755 L 380 762 L 560 715 L 700 735 L 940 690" fill="none" stroke={GREEN} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - line} />
      
    </Stage>
  );
};

// ---- tally: N icons pop in one by one (pizza | coin | person | box)
const Icon: React.FC<{ kind: string }> = ({ kind }) => {
  if (kind === 'coin') {
    return (
      <g>
        <circle r={58} fill={YEL} stroke={INK} strokeWidth={7} />
        <circle r={40} fill="none" stroke="#c9961a" strokeWidth={5} />
        <text x={0} y={20} textAnchor="middle" style={st(58)}>B</text>
      </g>
    );
  }
  if (kind === 'person') {
    return (
      <g>
        <circle cx={0} cy={-40} r={28} fill={BLUE} stroke={INK} strokeWidth={6} />
        <path d="M -48 62 Q -48 0 0 0 Q 48 0 48 62 Z" fill={BLUE} stroke={INK} strokeWidth={6} />
      </g>
    );
  }
  if (kind === 'box') {
    return (
      <g>
        <rect x={-56} y={-26} width={112} height={82} rx={8} fill={RED} stroke={INK} strokeWidth={6} />
        <rect x={-64} y={-52} width={128} height={30} rx={8} fill="#f26b4f" stroke={INK} strokeWidth={6} />
      </g>
    );
  }
  return (
    <g>
      <polygon points="-56,-48 56,-48 0,70" fill={YEL} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <rect x={-62} y={-68} width={124} height={28} rx={14} fill="#e0a030" stroke={INK} strokeWidth={6} />
      <circle cx={-18} cy={-8} r={11} fill={RED} stroke={INK} strokeWidth={3} />
      <circle cx={20} cy={-14} r={11} fill={RED} stroke={INK} strokeWidth={3} />
      <circle cx={2} cy={26} r={11} fill={RED} stroke={INK} strokeWidth={3} />
    </g>
  );
};
const TallyScene: React.FC<{ g: any }> = ({ g }) => {
  const { frame, fps } = useT();
  const n = Math.max(1, Math.min(12, Math.round(Number(g.count) || 1)));
  const per = n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : 4;
  const rows = Math.ceil(n / per);
  const cell = Math.min(230, 900 / per);
  const lab = pop(frame, fps, 8 + n * 6);
  return (
    <Stage title={g.title}>
      {Array.from({ length: n }).map((_, i) => {
        const r = Math.floor(i / per);
        const c = i % per;
        const inRow = Math.min(per, n - r * per);
        const x = 500 + (c - (inRow - 1) / 2) * cell;
        const y = 330 + (r - (rows - 1) / 2) * cell * 0.95;
        const s = pop(frame, fps, 6 + i * 6);
        return (
          <g key={i} transform={`translate(${x} ${y - (1 - s) * 80}) scale(${s * (cell / 135)})`} opacity={Math.min(1, s * 1.6)}>
            <Icon kind={g.kind} />
          </g>
        );
      })}
      {g.label ? <Chip cx={500} cy={690} text={String(g.label)} scale={lab} /> : null}
    </Stage>
  );
};

export const Graphic4Beat: React.FC<{ g: any; accent: string; len: number }> = ({ g }) => {
  switch (g && g.type) {
    case 'date': return <DateScene g={g} />;
    case 'post': return <PostScene g={g} />;
    case 'profile': return <ProfileScene g={g} />;
    case 'pin': return <PinScene g={g} />;
    case 'jump': return <JumpScene g={g} />;
    case 'tally': return <TallyScene g={g} />;
    default: return null;
  }
};
