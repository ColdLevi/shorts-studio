// illustrations.tsx: the ILLUSTRATION tier. Full-colour flat illustrations, code-drawn SVG, one locked palette, so a
// house is the same house in every video. They assemble themselves part by part (build progress t, 0..1).
// Registry glyphs (Lucide) are chrome; this tier is what plays the noun on screen. Palette idea: motion-graphics skill 5.24.
import React from 'react';

export const ILL = {
  body: '#313D55', bodyDark: '#28324A', shade: '#1E2839', roof: '#1A2233', light: '#FFD98A', lightGlow: 'rgba(255,217,138,0.45)',
  foliage: '#2A4A3E', foliageDark: '#223D33', towerA: '#2A3550', towerB: '#212B42', paper: '#E8ECF4', paperDark: '#C5CCDC',
  metal: '#9AA7C0', metalDark: '#6C7893', gold: '#F5C451', goldDark: '#C9962B', red: '#FF6B6B', cold: '#7CC8FF', green: '#46D39A',
} as const;

export type Build = (i: number, n: number, o?: { dy?: number; s?: number }) => React.CSSProperties;
export const makeBuild = (t: number): Build => (i, n, o = {}) => {
  const raw = Math.min(1, Math.max(0, (t * (n + 1) - i) / 1.6));
  const e = 1 - Math.pow(1 - raw, 3);
  return { opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * (o.dy ?? 14)}px) scale(${1 - (1 - e) * (o.s ?? 0.12)})`, transformBox: 'fill-box', transformOrigin: '50% 100%' };
};

type IP = { b: Build; acc: string; acc2: string; id: string };
const Svg: React.FC<{ children: React.ReactNode }> = ({ children }) => <svg viewBox="0 0 512 512" width="100%" height="100%">{children}</svg>;
const Lin: React.FC<{ id: string; a: string; c: string; h?: boolean }> = ({ id, a, c, h }) => (
  <linearGradient id={id} x1="0" y1="0" x2={h ? 1 : 0} y2={h ? 0 : 1}><stop offset="0" stopColor={a} /><stop offset="1" stopColor={c} /></linearGradient>
);
const Glow: React.FC<{ id: string }> = ({ id }) => (
  <radialGradient id={id} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor={ILL.lightGlow} /><stop offset="1" stopColor="rgba(255,217,138,0)" /></radialGradient>
);
const Ground: React.FC<{ cx?: number; rx?: number; b: Build }> = ({ cx = 256, rx = 170, b }) => (
  <ellipse cx={cx} cy={448} rx={rx} ry={16} fill="rgba(0,0,0,0.38)" style={b(0, 1, { dy: 0, s: 0 })} />
);

const House: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><Lin id={id + 'b'} a={ILL.body} c={ILL.bodyDark} /><Glow id={id + 'g'} /></defs>
    <Ground b={b} />
    <g style={b(1, 8)}><rect x={300} y={296} width={148} height={134} rx={4} fill={ILL.shade} /><rect x={294} y={284} width={160} height={16} rx={3} fill={ILL.roof} />
      <rect x={330} y={330} width={88} height={100} rx={6} fill={ILL.bodyDark} stroke={ILL.roof} strokeWidth={3} /><path d="M330 380 h88 M374 330 v100" stroke={ILL.roof} strokeWidth={3} /></g>
    <g style={b(2, 8)}><rect x={276} y={198} width={28} height={54} rx={3} fill={ILL.roof} /></g>
    <g style={b(3, 8)}><rect x={122} y={262} width={198} height={168} rx={4} fill={`url(#${id}b)`} /></g>
    <g style={b(4, 8)}><polygon points="100,264 221,178 342,264" fill={ILL.roof} /><polygon points="100,264 342,264 342,272 100,272" fill={ILL.shade} />
      <circle cx={221} cy={236} r={15} fill={ILL.light} /><circle cx={221} cy={236} r={26} fill={`url(#${id}g)`} opacity={0.5} /><path d="M206 236 h30 M221 221 v30" stroke={ILL.roof} strokeWidth={3} /></g>
    <g style={b(5, 8)}><rect x={148} y={296} width={46} height={46} rx={4} fill={ILL.light} /><rect x={148} y={296} width={46} height={46} rx={4} fill={`url(#${id}g)`} opacity={0.35} /><path d="M171 296 v46 M148 319 h46" stroke={ILL.roof} strokeWidth={3} />
      <rect x={238} y={296} width={46} height={46} rx={4} fill={ILL.shade} /><path d="M261 296 v46 M238 319 h46" stroke={ILL.roof} strokeWidth={3} /></g>
    <g style={b(6, 8)}><rect x={196} y={344} width={50} height={86} rx={10} fill={acc} /><rect x={196} y={344} width={50} height={86} rx={10} fill={`url(#${id}g)`} opacity={0.25} /><circle cx={236} cy={388} r={4} fill={ILL.light} /><rect x={190} y={430} width={62} height={10} rx={3} fill={ILL.roof} /></g>
    <g style={b(7, 8)}><circle cx={112} cy={428} r={22} fill={ILL.foliage} /><circle cx={132} cy={434} r={16} fill={ILL.foliageDark} /><circle cx={382} cy={432} r={24} fill={ILL.foliage} /><circle cx={362} cy={438} r={15} fill={ILL.foliageDark} /></g>
  </Svg>
);

const Building: React.FC<IP> = ({ b, acc, id }) => {
  const cols = [218, 252, 286], rows = [140, 176, 212, 248, 284, 320, 356];
  return (
    <Svg>
      <defs><Lin id={id + 't'} a={ILL.towerA} c={ILL.towerB} h /><Glow id={id + 'g'} /></defs>
      <Ground cx={256} rx={120} b={b} />
      <g style={b(1, 11)}><rect x={196} y={88} width={120} height={342} rx={4} fill={`url(#${id}t)`} /><rect x={188} y={80} width={136} height={12} rx={3} fill={ILL.roof} /></g>
      {rows.map((y, r) => (
        <g key={r} style={b(2 + r, 11, { dy: 6 })}>
          {cols.map((x, c) => { const lit = (r * 3 + c) % 3 === 0, office = r === 0 && c === 1; return (
            <g key={c}>{lit ? <rect x={x - 6} y={y - 5} width={28} height={26} fill={`url(#${id}g)`} opacity={0.5} /> : null}
              <rect x={x} y={y} width={16} height={16} rx={2} fill={office ? acc : lit ? ILL.light : ILL.shade} /></g>); })}
        </g>
      ))}
      <g style={b(9, 11)}><rect x={232} y={394} width={48} height={36} rx={4} fill={ILL.shade} /><rect x={244} y={404} width={24} height={26} rx={3} fill={acc} /></g>
      <g style={b(10, 11)}><line x1={256} y1={86} x2={256} y2={34} stroke={ILL.roof} strokeWidth={7} /><circle cx={256} cy={30} r={6} fill={acc} /></g>
    </Svg>
  );
};

const Phone: React.FC<IP> = ({ b, acc, acc2, id }) => (
  <Svg>
    <defs><Lin id={id + 's'} a={acc} c={acc2} /><Lin id={id + 'b'} a={ILL.body} c={ILL.shade} /></defs>
    <Ground b={b} rx={120} />
    <g style={b(1, 5)}><rect x={164} y={56} width={184} height={380} rx={34} fill={`url(#${id}b)`} stroke={ILL.roof} strokeWidth={4} /></g>
    <g style={b(2, 5)}><rect x={178} y={74} width={156} height={344} rx={24} fill={`url(#${id}s)`} /><rect x={226} y={84} width={60} height={14} rx={7} fill={ILL.roof} /></g>
    <g style={b(3, 5)}>{[0, 1, 2].map((r) => [0, 1].map((c) => <rect key={r + '' + c} x={200 + c * 66} y={150 + r * 70} width={50} height={50} rx={14} fill="rgba(255,255,255,0.22)" />))}</g>
    <g style={b(4, 5)}><rect x={226} y={392} width={60} height={6} rx={3} fill="rgba(255,255,255,0.6)" /></g>
  </Svg>
);

const Coin: React.FC<IP> = ({ b, id }) => (
  <Svg>
    <defs><Lin id={id + 'c'} a="#FFE08A" c={ILL.goldDark} h /></defs>
    <Ground b={b} rx={130} />
    {[0, 1, 2].map((k) => (
      <g key={k} style={b(1 + k, 4)}><ellipse cx={256} cy={400 - k * 36} rx={124} ry={34} fill={ILL.goldDark} /><rect x={132} y={366 - k * 36} width={248} height={34} fill={ILL.goldDark} /><ellipse cx={256} cy={366 - k * 36} rx={124} ry={34} fill={`url(#${id}c)`} /></g>
    ))}
    <g style={b(4, 4)}><ellipse cx={256} cy={246} rx={104} ry={104} fill={`url(#${id}c)`} stroke={ILL.goldDark} strokeWidth={8} /><circle cx={256} cy={246} r={78} fill="none" stroke={ILL.goldDark} strokeWidth={5} opacity={0.6} />
      <text x={256} y={282} textAnchor="middle" fontSize={104} fontWeight={900} fontFamily="Inter, Arial, sans-serif" fill={ILL.goldDark}>$</text></g>
  </Svg>
);

const Bank: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><Lin id={id + 'p'} a={ILL.towerA} c={ILL.towerB} /></defs>
    <Ground b={b} rx={190} />
    <g style={b(1, 5)}><rect x={96} y={406} width={320} height={24} rx={4} fill={ILL.roof} /><rect x={116} y={386} width={280} height={22} rx={4} fill={ILL.shade} /></g>
    <g style={b(2, 5)}>{[0, 1, 2, 3].map((k) => <g key={k}><rect x={140 + k * 72} y={190} width={36} height={196} rx={4} fill={ILL.metal} /><rect x={134 + k * 72} y={180} width={48} height={14} rx={3} fill={ILL.metalDark} /><rect x={134 + k * 72} y={382} width={48} height={12} rx={3} fill={ILL.metalDark} /></g>)}</g>
    <g style={b(3, 5)}><polygon points="84,182 256,86 428,182" fill={`url(#${id}p)`} /><rect x={84} y={176} width={344} height={12} rx={3} fill={ILL.roof} /></g>
    <g style={b(4, 5)}><circle cx={256} cy={146} r={22} fill={acc} /><text x={256} y={156} textAnchor="middle" fontSize={28} fontWeight={900} fontFamily="Inter, Arial, sans-serif" fill="#fff">$</text></g>
  </Svg>
);

const ChartBars: React.FC<IP & { up: boolean }> = ({ b, acc, id, up }) => {
  const hs = up ? [90, 150, 210, 290] : [290, 210, 150, 90];
  const col = up ? acc : ILL.red;
  return (
    <Svg>
      <defs><Lin id={id + 'b'} a={col} c={up ? ILL.cold : '#FF9E7A'} /></defs>
      <g style={b(0, 6, { dy: 0 })}><rect x={60} y={420} width={392} height={8} rx={4} fill={ILL.metalDark} /></g>
      {hs.map((h, k) => <g key={k} style={b(1 + k, 6, { dy: 30, s: 0.02 })}><rect x={92 + k * 90} y={420 - h} width={64} height={h} rx={8} fill={`url(#${id}b)`} /></g>)}
      <g style={b(5, 6)}><path d={up ? 'M90 300 L200 240 L300 262 L430 130' : 'M90 130 L200 200 L300 190 L430 320'} fill="none" stroke="#fff" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
        <polygon points={up ? '430,100 466,150 410,150' : '436,352 470,300 410,306'} fill="#fff" /></g>
    </Svg>
  );
};

const Store: React.FC<IP> = ({ b, acc, acc2, id }) => (
  <Svg>
    <defs><Lin id={id + 'w'} a={ILL.body} c={ILL.bodyDark} /><Glow id={id + 'g'} /></defs>
    <Ground b={b} rx={190} />
    <g style={b(1, 5)}><rect x={86} y={196} width={340} height={234} rx={6} fill={`url(#${id}w)`} /></g>
    <g style={b(2, 5)}>{[0, 1, 2, 3, 4, 5].map((k) => <path key={k} d={`M${86 + k * 56.7} 150 h56.7 l${k % 2 ? -8 : 8} 60 h-56.7 z`} fill={k % 2 ? '#F4F6FB' : acc} />)}<rect x={80} y={140} width={352} height={14} rx={4} fill={ILL.roof} /></g>
    <g style={b(3, 5)}><rect x={118} y={246} width={150} height={124} rx={6} fill={ILL.light} /><rect x={118} y={246} width={150} height={124} rx={6} fill={`url(#${id}g)`} opacity={0.4} /><path d="M193 246 v124 M118 308 h150" stroke={ILL.roof} strokeWidth={4} /></g>
    <g style={b(4, 5)}><rect x={304} y={250} width={84} height={180} rx={8} fill={acc2} /><circle cx={374} cy={344} r={5} fill={ILL.light} /><rect x={150} y={394} width={86} height={20} rx={4} fill={ILL.shade} /></g>
  </Svg>
);

const Car: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><Lin id={id + 'c'} a={acc} c={ILL.bodyDark} /></defs>
    <Ground b={b} rx={200} />
    <g style={b(1, 4)}><path d="M64 360 q0-60 44-70 l54-14 q34-52 86-52 h50 q40 0 66 46 l32 22 q36 8 36 56 v18 H64 z" fill={`url(#${id}c)`} /></g>
    <g style={b(2, 4)}><path d="M190 280 q22-36 58-36 h28 v56 H190 z M296 244 h22 q26 0 44 42 l4 14 H296 z" fill="#CFE6FF" opacity={0.9} /><rect x={400} y={332} width={34} height={14} rx={7} fill={ILL.light} /></g>
    <g style={b(3, 4)}><circle cx={152} cy={384} r={44} fill={ILL.roof} /><circle cx={152} cy={384} r={20} fill={ILL.metal} /><circle cx={374} cy={384} r={44} fill={ILL.roof} /><circle cx={374} cy={384} r={20} fill={ILL.metal} /></g>
    <g style={b(4, 4)}><rect x={64} y={356} width={372} height={10} rx={5} fill="rgba(0,0,0,0.25)" /></g>
  </Svg>
);

const Doc: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><Lin id={id + 'p'} a="#F5F7FC" c={ILL.paperDark} /></defs>
    <g style={b(1, 4)}><path d="M138 52 h172 l64 64 v344 H138 z" fill={`url(#${id}p)`} stroke={ILL.metalDark} strokeWidth={4} strokeLinejoin="round" /><path d="M310 52 v64 h64" fill={ILL.paperDark} stroke={ILL.metalDark} strokeWidth={4} strokeLinejoin="round" /></g>
    <g style={b(2, 4)}>{[0, 1, 2, 3, 4].map((k) => <rect key={k} x={174} y={152 + k * 42} width={k === 4 ? 100 : 164} height={14} rx={7} fill={k === 0 ? acc : ILL.metal} />)}</g>
    <g style={b(3, 4)}><circle cx={316} cy={392} r={40} fill={acc} /><path d="M298 392 l14 14 l26-30" fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" /></g>
    <g style={b(4, 4)}><rect x={174} y={92} width={92} height={18} rx={9} fill={ILL.metalDark} /></g>
  </Svg>
);

const Person: React.FC<IP> = ({ b, acc, acc2, id }) => (
  <Svg>
    <defs><Lin id={id + 's'} a={acc} c={acc2} /><Lin id={id + 'k'} a="#E2B896" c="#C99874" /></defs>
    <Ground b={b} rx={140} />
    <g style={b(1, 3)}><path d="M96 440 q0-120 96-140 h128 q96 20 96 140 z" fill={`url(#${id}s)`} /></g>
    <g style={b(2, 3)}><rect x={226} y={256} width={60} height={56} rx={22} fill={`url(#${id}k)`} /><path d="M226 300 l30 34 l30-34" fill="#fff" opacity={0.9} /></g>
    <g style={b(3, 3)}><ellipse cx={256} cy={190} rx={66} ry={78} fill={`url(#${id}k)`} /><path d="M190 180 q0-86 70-86 q70 0 66 86 q-30-34 -70-34 q-40 0 -66 34z" fill={ILL.roof} /></g>
  </Svg>
);

const Thermo: React.FC<IP> = ({ b, id }) => (
  <Svg>
    <defs><Lin id={id + 'm'} a={ILL.cold} c="#3A8DFF" /></defs>
    <g style={b(1, 4)}><rect x={216} y={50} width={80} height={310} rx={40} fill={ILL.paper} stroke={ILL.metalDark} strokeWidth={5} /><circle cx={256} cy={392} r={62} fill={ILL.paper} stroke={ILL.metalDark} strokeWidth={5} /></g>
    <g style={b(2, 4)}><circle cx={256} cy={392} r={44} fill={`url(#${id}m)`} /><rect x={240} y={210} width={32} height={190} rx={16} fill={`url(#${id}m)`} /></g>
    <g style={b(3, 4)}>{[0, 1, 2, 3, 4].map((k) => <rect key={k} x={308} y={84 + k * 50} width={k % 2 ? 24 : 40} height={7} rx={3.5} fill={ILL.metal} />)}</g>
    <g style={b(4, 4)}><path d="M120 120 l40 0 M140 100 v40 M126 106 l28 28 M154 106 l-28 28" stroke={ILL.cold} strokeWidth={6} strokeLinecap="round" /></g>
  </Svg>
);

const Battery: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><Lin id={id + 'b'} a={ILL.body} c={ILL.shade} /></defs>
    <Ground b={b} rx={190} />
    <g style={b(1, 4)}><rect x={64} y={156} width={352} height={200} rx={34} fill={`url(#${id}b)`} stroke={ILL.metal} strokeWidth={8} /><rect x={420} y={226} width={34} height={60} rx={12} fill={ILL.metal} /></g>
    <g style={b(2, 4)}><rect x={90} y={182} width={76} height={148} rx={16} fill={ILL.red} /></g>
    <g style={b(3, 4)}>{[1, 2, 3].map((k) => <rect key={k} x={90 + k * 86} y={182} width={76} height={148} rx={16} fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" strokeWidth={3} />)}</g>
    <g style={b(4, 4)}><path d="M262 214 l-34 52 h30 l-14 52 l46-66 h-32 z" fill={acc} opacity={0.0} /></g>
  </Svg>
);

const Lock: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><Lin id={id + 'l'} a={ILL.gold} c={ILL.goldDark} /></defs>
    <Ground b={b} rx={130} />
    <g style={b(1, 3)}><path d="M170 232 v-62 a86 86 0 0 1 172 0 v62" fill="none" stroke={ILL.metal} strokeWidth={34} strokeLinecap="round" /></g>
    <g style={b(2, 3)}><rect x={118} y={226} width={276} height={206} rx={28} fill={`url(#${id}l)`} /></g>
    <g style={b(3, 3)}><circle cx={256} cy={308} r={28} fill={ILL.roof} /><rect x={244} y={316} width={24} height={64} rx={10} fill={ILL.roof} /></g>
  </Svg>
);

const Globe: React.FC<IP> = ({ b, acc, id }) => (
  <Svg>
    <defs><radialGradient id={id + 'g'} cx="0.38" cy="0.32" r="0.8"><stop offset="0" stopColor="#4C86D9" /><stop offset="1" stopColor="#1F3A73" /></radialGradient></defs>
    <Ground b={b} rx={150} />
    <g style={b(1, 3)}><circle cx={256} cy={246} r={176} fill={`url(#${id}g)`} /></g>
    <g style={b(2, 3)}><path d="M150 190 q40-50 90-30 q30 16 10 50 q-30 30-60 20 q-40-8-40-40z M270 280 q50-20 80 10 q16 34-20 64 q-40 18-56-10 q-20-34-4-64z M300 150 q36-20 60 10 q-6 30-40 26 q-30-6-20-36z" fill={ILL.green} opacity={0.85} /></g>
    <g style={b(3, 3)}><ellipse cx={256} cy={246} rx={176} ry={56} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={3} /><ellipse cx={256} cy={246} rx={72} ry={176} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={3} /><circle cx={256} cy={246} r={176} fill="none" stroke={acc} strokeWidth={6} opacity={0.8} /></g>
  </Svg>
);

const Bulb: React.FC<IP> = ({ b, id }) => (
  <Svg>
    <defs><radialGradient id={id + 'g'} cx="0.5" cy="0.45" r="0.55"><stop offset="0" stopColor="#FFF1B8" /><stop offset="1" stopColor={ILL.gold} /></radialGradient><Glow id={id + 'h'} /></defs>
    <g style={b(1, 4)}><circle cx={256} cy={206} r={190} fill={`url(#${id}h)`} opacity={0.6} /></g>
    <g style={b(2, 4)}><path d="M256 52 a124 124 0 0 0 -70 226 q16 14 16 40 h108 q0-26 16-40 a124 124 0 0 0 -70 -226z" fill={`url(#${id}g)`} stroke={ILL.goldDark} strokeWidth={5} /></g>
    <g style={b(3, 4)}><path d="M216 150 l30 100 l20-70 l30 70" fill="none" stroke={ILL.goldDark} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" /></g>
    <g style={b(4, 4)}><rect x={198} y={322} width={116} height={26} rx={10} fill={ILL.metal} /><rect x={206} y={352} width={100} height={26} rx={10} fill={ILL.metalDark} /><rect x={226} y={382} width={60} height={30} rx={14} fill={ILL.roof} /></g>
  </Svg>
);

export const ILLUSTRATIONS: Record<string, React.FC<IP>> = {
  house: House, building: Building, phone: Phone, coin: Coin, bank: Bank,
  'chart-up': (p) => <ChartBars {...p} up />, 'chart-down': (p) => <ChartBars {...p} up={false} />,
  store: Store, car: Car, document: Doc, person: Person, thermometer: Thermo, battery: Battery, lock: Lock, globe: Globe, bulb: Bulb,
};
export const ILLUSTRATION_IDS = Object.keys(ILLUSTRATIONS);
