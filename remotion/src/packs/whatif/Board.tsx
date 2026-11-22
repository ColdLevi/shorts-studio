// Board.tsx: the "directed graphics" for a scene. Each board draws one scripted visual (price cards, order book, lanes, triangle, ...)
// in a 960x960 box centred on (0,0). Everything is SVG, deterministic from the frame number, timed as fractions of the scene length.
import React from 'react';
import { interpolate, spring, Easing } from 'remotion';
import { ACCENT, CLAMP, INK, MONO, SANS } from './theme';

const GREEN = '#7ee0a8';
const RED = '#ff6b6b';
const AMBER = '#ffb347';
const CARD = '#2b2140';
const LINE = '#6a4ad8';

type B = { frame: number; fps: number; dur: number };

const at = (b: B, frac: number) => Math.round(frac * b.dur);
const pop = (b: B, frac: number, damping = 12, stiffness = 150) =>
  spring({ frame: b.frame - at(b, frac), fps: b.fps, config: { damping, stiffness } });
const ramp = (b: B, a: number, z: number) => interpolate(b.frame, [at(b, a), at(b, z)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
const lerp = (a: number, z: number, p: number) => a + (z - a) * p;
const mn = (v: number) => Math.min(1, Math.max(0, v));

const Txt: React.FC<{ x: number; y: number; size: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; op?: number; font?: string; children: React.ReactNode }> = ({ x, y, size, fill = INK, anchor = 'middle', bold, op = 1, font = MONO, children }) => (
  <text x={x} y={y} textAnchor={anchor} fontFamily={font} fontWeight={bold ? 'bold' : 'normal'} fontSize={size} fill={fill} opacity={op}>{children}</text>
);

const PriceCard: React.FC<{ x: number; y: number; name: string; price: string; sc?: number; op?: number }> = ({ x, y, name, price, sc = 1, op = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${sc})`} opacity={op}>
    <rect x="-200" y="-120" width="400" height="240" rx="26" fill={CARD} stroke={INK} strokeWidth="4" />
    <Txt x={0} y={-62} size={30} fill={ACCENT} bold>{name}</Txt>
    <Txt x={0} y={22} size={66} bold>{price}</Txt>
    <Txt x={0} y={80} size={28} fill="#b9a9d9">BTC</Txt>
  </g>
);

// 1. two price cards from opposite edges, a green gap badge, then a red stamp slams on
export const Cards: React.FC<B> = (b) => {
  const pa = pop(b, 0.06, 15, 110), pb = pop(b, 0.14, 15, 110);
  const badge = pop(b, 0.34, 9, 170);
  const stamp = pop(b, 0.62, 10, 260);
  const since = b.frame - at(b, 0.62);
  const shake = since > 0 && since < 12 ? Math.sin(since * 2.6) * (12 - since) * 1.4 : 0;
  return (
    <g transform={`translate(${shake} 0)`}>
      <PriceCard x={lerp(-1000, -230, mn(pa))} y={-20} name="EXCHANGE A" price="$64,100" />
      <PriceCard x={lerp(1000, 230, mn(pb))} y={-20} name="EXCHANGE B" price="$64,340" />
      <g transform={`translate(0 -250) scale(${Math.max(0, badge)})`}>
        <rect x="-190" y="-48" width="380" height="96" rx="48" fill={GREEN} stroke={INK} strokeWidth="4" />
        <Txt x={0} y={20} size={50} fill="#0f2a1f" bold>+$240 GAP</Txt>
      </g>
      <g transform={`translate(0 120) rotate(-7) scale(${stamp > 0 ? lerp(2.8, 1, mn(stamp)) : 0})`} opacity={mn(stamp * 2)}>
        <rect x="-430" y="-62" width="860" height="124" rx="14" fill="rgba(60,0,0,0.55)" stroke={RED} strokeWidth="9" />
        <Txt x={0} y={14} size={44} fill={RED} bold>FEES + SLIPPAGE + LATENCY</Txt>
      </g>
    </g>
  );
};

// 2. order-book pulse, millisecond timer, gap narrows, map shrinks to the corner
export const Book: React.FC<B> = (b) => {
  const f = b.frame / b.dur;
  const prog = mn((f - 0.15) / 0.6);
  const ms = Math.round(800 * (1 - prog));
  const gap = Math.round(240 - 228 * prog);
  const shrink = ramp(b, 0.8, 0.97);
  const sc = lerp(1, 0.34, shrink), tx = lerp(0, 330, shrink), ty = lerp(0, -380, shrink);
  const rows = (x: number, widths: number[], name: string, tag: string) => (
    <g transform={`translate(${x} 0)`}>
      <Txt x={0} y={-250} size={34} fill={ACCENT} bold>{name}</Txt>
      <Txt x={0} y={-212} size={24} fill="#b9a9d9">{tag}</Txt>
      {widths.map((w, i) => (
        <rect key={i} x={-w / 2} y={-170 + i * 46} width={w * 1.6} height="34" rx="6" transform={`translate(${-w * 0.3} 0)`} fill={i < 3 ? GREEN : RED} opacity={0.35 + 0.1 * (6 - i) * 0.6} />
      ))}
    </g>
  );
  const rings = [0, 1, 2].map((i) => {
    const p = ((f * 3.2 + i / 3) % 1);
    return <circle key={i} cx={lerp(-250, 250, p)} cy={20} r={20 + 70 * p} fill="none" stroke={ACCENT} strokeWidth="5" opacity={(1 - p) * 0.8 * (f > 0.04 && f < 0.82 ? 1 : 0)} />;
  });
  return (
    <g transform={`translate(${tx} ${ty}) scale(${sc})`}>
      <rect x="-460" y="-300" width="920" height="560" rx="28" fill="#1c1233" stroke={INK} strokeWidth="4" opacity={0.95} />
      {rows(-250, [150, 130, 110, 90, 70, 50], 'EXCHANGE A', 'DEEP BOOK')}
      {rows(250, [70, 55, 40, 30, 20, 12], 'EXCHANGE B', 'THIN BOOK')}
      {rings}
      <Txt x={0} y={320} size={64} fill={ms < 200 ? RED : ACCENT} bold>{ms} ms</Txt>
      <Txt x={0} y={372} size={32} fill={INK}>{`GAP  $${gap}`}</Txt>
      <rect x="-300" y="396" width={600 * (gap / 240)} height="14" rx="7" fill={GREEN} transform="translate(0 0)" />
    </g>
  );
};

const Lane: React.FC<{ y: number; label: string; color: string }> = ({ y, label, color }) => (
  <g>
    <rect x="-470" y={y - 110} width="940" height="230" rx="22" fill="#1c1233" stroke={color} strokeWidth="4" />
    <Txt x={-440} y={y - 76} size={30} fill={color} anchor="start" bold>{label}</Txt>
  </g>
);

// 3. naive transfer gets stuck on a pending clock, pre-funded inventory fills both legs at once
export const Lanes: React.FC<B> = (b) => {
  const f = b.frame / b.dur;
  const steps = ['BUY', 'WITHDRAW', 'NETWORK WAIT', 'SELL'];
  const xs = [-345, -115, 115, 345];
  const mv = ramp(b, 0.1, 0.4);
  const mx = lerp(xs[0], xs[2], mv);
  const stuck = f > 0.42;
  const gap = Math.round(240 * (1 - ramp(b, 0.45, 0.66)));
  const fill = ramp(b, 0.62, 0.78);
  const check = pop(b, 0.8, 11, 190);
  const spin = (b.frame / b.fps) * 240;
  return (
    <g>
      <Lane y={-250} label="NAIVE TRANSFER" color={AMBER} />
      {steps.map((s, i) => {
        const o = pop(b, 0.04 + i * 0.03);
        return (
          <g key={s} transform={`translate(${xs[i]} -230) scale(${mn(o)})`}>
            <rect x="-100" y="-44" width="200" height="88" rx="14" fill={CARD} stroke={i >= 2 && stuck ? RED : INK} strokeWidth="3" />
            <Txt x={0} y={8} size={s.length > 8 ? 25 : 30} bold>{s}</Txt>
          </g>
        );
      })}
      <circle cx={mx} cy={-160} r="13" fill={ACCENT} />
      {stuck ? (
        <g transform="translate(115 -126)">
          <circle r="22" fill="#120a22" stroke={RED} strokeWidth="4" />
          <line x1="0" y1="0" x2="0" y2="-14" stroke={RED} strokeWidth="4" strokeLinecap="round" transform={`rotate(${spin})`} />
          <Txt x={0} y={52} size={28} fill={RED} bold>PENDING WITHDRAWAL</Txt>
        </g>
      ) : null}
      <Txt x={0} y={-12} size={34} fill={gap > 0 ? ACCENT : RED} bold>{`GAP  $${gap}`}</Txt>
      <Lane y={190} label="PRE-FUNDED INVENTORY" color={GREEN} />
      {['BUY  A', 'SELL  B'].map((s, i) => (
        <g key={s} transform={`translate(${i === 0 ? -170 : 170} 215)`}>
          <rect x="-130" y="-48" width="260" height="96" rx="14" fill={CARD} stroke={INK} strokeWidth="3" />
          <rect x="-130" y="-48" width={260 * fill} height="96" rx="14" fill={GREEN} opacity="0.85" />
          <Txt x={0} y={9} size={30} fill={fill > 0.6 ? '#0f2a1f' : INK} bold>{s}</Txt>
        </g>
      ))}
      <g transform={`translate(390 215) scale(${Math.max(0, check)})`}>
        <circle r="36" fill={GREEN} />
        <polyline points="-17,2 -5,15 18,-14" fill="none" stroke="#0f2a1f" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
};

const lineBetween = (a: [number, number], z: [number, number], r: number) => {
  const dx = z[0] - a[0], dy = z[1] - a[1], d = Math.hypot(dx, dy);
  const ux = dx / d, uy = dy / d;
  return { x1: a[0] + ux * r, y1: a[1] + uy * r, x2: z[0] - ux * r, y2: z[1] - uy * r, len: d - 2 * r };
};

// 4. three-node triangle, arrows trace each leg, loop ratio, then it collapses to the centre
export const Triangle: React.FC<B> = (b) => {
  const f = b.frame / b.dur;
  const N: Record<string, [number, number]> = { USDT: [0, -250], BTC: [-290, 190], ETH: [290, 190] };
  const order = ['USDT', 'BTC', 'ETH', 'USDT'];
  const col = (b2: number) => (b2 > 0 ? GREEN : INK);
  const collapse = ramp(b, 0.86, 0.99);
  const sc = lerp(1, 0.02, collapse);
  const ratio = pop(b, 0.62, 12, 150);
  return (
    <g transform={`translate(0 -20) scale(${sc})`} opacity={1 - collapse * 0.7}>
      {[0, 1, 2].map((i) => {
        const L = lineBetween(N[order[i]], N[order[i + 1]], 84);
        const p = ramp(b, 0.14 + i * 0.15, 0.27 + i * 0.15);
        const ex = L.x1 + (L.x2 - L.x1) * p, ey = L.y1 + (L.y2 - L.y1) * p;
        return (
          <g key={i}>
            <line x1={L.x1} y1={L.y1} x2={L.x2} y2={L.y2} stroke={INK} strokeWidth="3" opacity="0.18" />
            <line x1={L.x1} y1={L.y1} x2={ex} y2={ey} stroke={ACCENT} strokeWidth="16" strokeLinecap="round" opacity="0.25" />
            <line x1={L.x1} y1={L.y1} x2={ex} y2={ey} stroke={ACCENT} strokeWidth="6" strokeLinecap="round" />
            {p > 0 ? <circle cx={ex} cy={ey} r="12" fill={ACCENT} /> : null}
            <Txt x={(L.x1 + L.x2) / 2 + (i === 0 ? -70 : i === 1 ? 0 : 70)} y={(L.y1 + L.y2) / 2 + (i === 1 ? 46 : 0)} size={24} fill="#b9a9d9" op={mn(p * 2)}>{`LEG ${i + 1}`}</Txt>
          </g>
        );
      })}
      {Object.keys(N).map((k, i) => {
        const o = pop(b, 0.03 + i * 0.04, 13, 160);
        return (
          <g key={k} transform={`translate(${N[k][0]} ${N[k][1]}) scale(${Math.max(0, o)})`}>
            <circle r="84" fill={CARD} stroke={LINE} strokeWidth="6" />
            <Txt x={0} y={11} size={k.length > 3 ? 30 : 34} bold>{k}</Txt>
          </g>
        );
      })}
      <g transform={`translate(0 345) scale(${Math.max(0, ratio)})`}>
        <rect x="-210" y="-70" width="420" height="140" rx="22" fill="#150c26" stroke={GREEN} strokeWidth="4" />
        <Txt x={0} y={14} size={72} fill={col(1)} bold>1.0018x</Txt>
        <Txt x={0} y={52} size={24} fill="#b9a9d9">LOOP RATIO, BEFORE FEES</Txt>
      </g>
    </g>
  );
};

// 5. spot long + perp short boxes, net stays near zero, funding payouts drip in, boxes slide off right
export const Funding: React.FC<B> = (b) => {
  const f = b.frame / b.dur;
  const t = b.frame / b.fps;
  const off = ramp(b, 0.88, 1) * 1300;
  const boxes: [number, string, string, number][] = [[-250, 'SPOT LONG', GREEN, 0], [250, 'PERP SHORT', RED, 1]];
  const payouts = [0.3, 0.5, 0.7];
  const paid = payouts.filter((p) => f > p + 0.06).length;
  return (
    <g>
      <g transform={`translate(${off} 0)`}>
        {boxes.map(([x, name, c, i]) => {
          const o = pop(b, 0.05 + i * 0.07, 14, 130);
          const price = 64000 + Math.round(60 * Math.sin(t * 2.6 + i * 3.14)) * (i ? -1 : 1) + (i ? 0 : 0);
          return (
            <g key={name} transform={`translate(${x} -150) scale(${Math.max(0, o)})`}>
              <rect x="-210" y="-120" width="420" height="240" rx="24" fill={CARD} stroke={c} strokeWidth="6" />
              <Txt x={0} y={-56} size={34} fill={c} bold>{name}</Txt>
              <Txt x={0} y={30} size={58} bold>{'$' + price.toLocaleString('en-US')}</Txt>
              <Txt x={0} y={88} size={24} fill="#b9a9d9">equal size</Txt>
            </g>
          );
        })}
        <g transform="translate(0 70)">
          <rect x="-360" y="-12" width="720" height="24" rx="12" fill="#1c1233" stroke={INK} strokeWidth="3" />
          <line x1="0" y1="-26" x2="0" y2="26" stroke={INK} strokeWidth="3" />
          <rect x={Math.sin(t * 2.2) * 14 - 10} y="-18" width="20" height="36" rx="6" fill={ACCENT} />
          <Txt x={0} y={64} size={30} fill={ACCENT} bold>NET  ≈  $0</Txt>
        </g>
        <g transform="translate(0 250)">
          <rect x="-300" y="-40" width="600" height="190" rx="22" fill="#1c1233" stroke={GREEN} strokeWidth="3" />
          <Txt x={0} y={4} size={28} fill={GREEN} bold>FUNDING PAYOUT</Txt>
          <Txt x={0} y={86} size={60} fill={GREEN} bold>{'+$' + paid * 12}</Txt>
          {payouts.map((p, i) => {
            const k = (f - p) / 0.06;
            if (k < 0 || k > 1.2) return null;
            return <circle key={i} cx={-200 + i * 200} cy={-80 + k * 120} r="20" fill={ACCENT} stroke={INK} strokeWidth="3" opacity={mn(1.2 - k)} />;
          })}
        </g>
      </g>
    </g>
  );
};

// 6. gross spread bar eaten by fees and slippage until the net turns red
export const Bars: React.FC<B> = (b) => {
  const W = 700;
  const g = pop(b, 0.06, 15, 120);
  const fees = ramp(b, 0.28, 0.5);
  const slip = ramp(b, 0.5, 0.86);
  const eaten = 320 * fees + 384.083 * slip;
  const net = 240 * (1 - eaten / W);
  const neg = net < 0;
  const gw = W * mn(g);
  return (
    <g>
      <Txt x={0} y={-330} size={34} fill={GREEN} bold>GROSS SPREAD</Txt>
      <g transform="translate(-350 -280)">
        <rect x="0" y="0" width={gw} height="120" rx="16" fill={GREEN} />
        <Txt x={20} y={76} size={52} fill="#0f2a1f" anchor="start" bold op={mn(g) * (1 - mn(fees * 2))}>+$240</Txt>
        {[0, 1].map((i) => {
          const w = 160 * fees;
          return w > 1 ? <rect key={i} x={W - 160 * (i + 1) * fees} y="0" width={160 * fees} height="120" fill={RED} stroke="#150c26" strokeWidth="3" /> : null;
        })}
        {slip > 0 ? (() => {
          const sx = W - 320 * fees - 384.083 * slip;
          return <rect x={Math.max(0, sx)} y="0" width={sx < 0 ? 384.083 * slip + sx : 384.083 * slip} height="120" fill="#c0392b" stroke="#150c26" strokeWidth="3" />;
        })() : null}
      </g>
      <Txt x={-350} y={-130} size={26} fill={RED} anchor="start" bold op={fees > 0.1 ? 1 : 0}>TAKER FEES x2</Txt>
      <Txt x={350} y={-130} size={26} fill="#ff9b8b" anchor="end" bold op={slip > 0.05 ? 1 : 0}>SLIPPAGE</Txt>
      <g transform="translate(-350 -60)" opacity={slip > 0.02 ? 1 : 0}>
        <Txt x={0} y={0} size={24} fill="#b9a9d9" anchor="start">ORDER SIZE</Txt>
        <rect x="0" y="14" width={W} height="14" rx="7" fill="#1c1233" />
        <rect x="0" y="14" width={W * slip} height="14" rx="7" fill={AMBER} />
      </g>
      <g transform="translate(0 150)" opacity={fees > 0.02 ? 1 : 0}>
        <rect x="-300" y="-90" width="600" height="220" rx="26" fill="#1c1233" stroke={neg ? RED : GREEN} strokeWidth="7" />
        <Txt x={0} y={-30} size={30} fill="#b9a9d9">NET</Txt>
        <Txt x={0} y={70} size={96} fill={neg ? RED : GREEN} bold>{(neg ? '-$' : '+$') + Math.abs(net).toFixed(2)}</Txt>
      </g>
    </g>
  );
};

// 7. buy leg filled, sell leg rejected, amber flash, three warning tags one by one
export const Leg: React.FC<B> = (b) => {
  const f = b.frame / b.dur;
  const pa = pop(b, 0.06, 9, 170), pb = pop(b, 0.24, 9, 170);
  const amber = f > 0.45 ? 0.5 + 0.5 * Math.sin((b.frame / b.fps) * 9) : 0;
  const tags = ['API / RATE LIMITS', 'WITHDRAWAL PAUSED', 'COUNTERPARTY RISK'];
  return (
    <g>
      <g transform={`translate(0 -250) scale(${Math.max(0, pa)})`}>
        <rect x="-400" y="-90" width="800" height="180" rx="24" fill={CARD} stroke={f > 0.45 ? AMBER : GREEN} strokeWidth={6 + amber * 6} />
        <rect x="-400" y="-90" width="800" height="180" rx="24" fill={AMBER} opacity={amber * 0.22} />
        <Txt x={-350} y={-14} size={44} anchor="start" bold>BUY LEG</Txt>
        <Txt x={-350} y={44} size={34} fill={f > 0.45 ? AMBER : GREEN} anchor="start" bold>{f > 0.45 ? 'FILLED  (UNHEDGED)' : 'FILLED'}</Txt>
        <circle cx="330" cy="0" r="44" fill={GREEN} />
        <polyline points="310,2 325,18 352,-16" fill="none" stroke="#0f2a1f" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform={`translate(0 -30) scale(${Math.max(0, pb)})`}>
        <rect x="-400" y="-90" width="800" height="180" rx="24" fill={CARD} stroke={RED} strokeWidth="6" />
        <Txt x={-350} y={-14} size={44} anchor="start" bold>SELL LEG</Txt>
        <Txt x={-350} y={44} size={34} fill={RED} anchor="start" bold>REJECTED / STALE QUOTE</Txt>
        <circle cx="330" cy="0" r="44" fill={RED} />
        <line x1="312" y1="-18" x2="348" y2="18" stroke="#2a0a0a" strokeWidth="10" strokeLinecap="round" />
        <line x1="348" y1="-18" x2="312" y2="18" stroke="#2a0a0a" strokeWidth="10" strokeLinecap="round" />
      </g>
      {tags.map((t, i) => {
        const o = pop(b, 0.55 + i * 0.14, 12, 190);
        return (
          <g key={t} transform={`translate(0 ${150 + i * 90}) scale(${Math.max(0, o)})`}>
            <rect x="-290" y="-34" width="580" height="68" rx="34" fill="#3a1d12" stroke={AMBER} strokeWidth="5" />
            <Txt x={0} y={12} size={32} fill={AMBER} bold>{'⚠  ' + t}</Txt>
          </g>
        );
      })}
    </g>
  );
};

// 8. three checks slide in from the left and tick as they are spoken
export const Check: React.FC<B> = (b) => {
  const items = ['NET SPREAD AFTER ALL FEES + SLIPPAGE', 'ORDER BOOK DEPTH > ORDER SIZE', 'STRICT LEG + API RISK LIMITS'];
  const ticks = [0.32, 0.58, 0.84];
  return (
    <g>
      <Txt x={0} y={-340} size={44} fill={ACCENT} bold>3 CHECKS</Txt>
      {items.map((s, i) => {
        const sl = ramp(b, 0.05 + i * 0.07, 0.17 + i * 0.07);
        const tk = pop(b, ticks[i], 10, 200);
        return (
          <g key={s} transform={`translate(${lerp(-1100, 0, sl)} ${-190 + i * 190})`}>
            <rect x="-450" y="-70" width="900" height="140" rx="24" fill={CARD} stroke={INK} strokeWidth="4" />
            <circle cx="-370" cy="0" r="40" fill="#1c1233" stroke={GREEN} strokeWidth="5" />
            <g transform={`translate(-370 0) scale(${Math.max(0, tk)})`}>
              <circle r="40" fill={GREEN} />
              <polyline points="-18,2 -6,15 18,-14" fill="none" stroke="#0f2a1f" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <Txt x={-300} y={11} size={s.length > 32 ? 28 : 32} anchor="start" bold>{s}</Txt>
          </g>
        );
      })}
    </g>
  );
};

// 9. the two opening cards come back small with the net tag, an end-screen box animates in, hold, fade to black (the fade is drawn by the wrapper)
export const Close: React.FC<B> = (b) => {
  const a = pop(b, 0.05, 13, 130), z = pop(b, 0.12, 13, 130);
  const tag = pop(b, 0.3, 10, 180);
  const box = pop(b, 0.5, 14, 120);
  return (
    <g>
      <PriceCard x={-250} y={-300} name="EXCHANGE A" price="$64,100" sc={0.8 * mn(a)} />
      <PriceCard x={250} y={-300} name="EXCHANGE B" price="$64,340" sc={0.8 * mn(z)} />
      <g transform={`translate(0 -140) scale(${Math.max(0, tag)})`}>
        <rect x="-330" y="-46" width="660" height="92" rx="46" fill="rgba(60,0,0,0.6)" stroke={RED} strokeWidth="6" />
        <Txt x={0} y={16} size={42} fill={RED} bold>NET AFTER FEES  -$1.40</Txt>
      </g>
      <g transform={`translate(0 190) scale(${lerp(0.7, 1, mn(box))})`} opacity={mn(box)}>
        <rect x="-330" y="-170" width="660" height="340" rx="28" fill={CARD} stroke={ACCENT} strokeWidth="6" />
        <polygon points="-40,-70 -40,10 30,-30" fill={ACCENT} transform="translate(0 -20)" />
        <Txt x={0} y={80} size={40} bold>NEXT VIDEO</Txt>
        <rect x="-130" y="108" width="260" height="46" rx="23" fill={RED} />
        <Txt x={0} y={142} size={26} bold>SUBSCRIBE</Txt>
      </g>
    </g>
  );
};

// the boards are drawn on a 960 box; each is scaled (and nudged down) so it fills it and reads on a phone
const big = (C: React.FC<B>, k: number, cy = 0): React.FC<B> => (p) => (
  <g transform={`translate(0 ${cy}) scale(${k})`}><C {...p} /></g>
);
export const BOARDS: Record<string, React.FC<B>> = {
  cards: big(Cards, 1.06, 40), book: big(Book, 1, 0), lanes: big(Lanes, 1, 0), triangle: big(Triangle, 1.1, -30),
  funding: big(Funding, 1.12, -10), bars: big(Bars, 1.3, 90), leg: big(Leg, 1.18, 10), check: big(Check, 1.04, 40), close: big(Close, 1.1, 0),
};
export const BoardNames = Object.keys(BOARDS);
void SANS;
