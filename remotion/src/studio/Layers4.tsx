// Layers4.tsx: screen-scene kit. A fake browser window plays a scripted sequence.
// Steps: move{to:'bar'|'button'}, click{to}, type{text}, enter, spinner, bubble{side,text}
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';
import { planSteps } from './screen-plan';
import { url } from './assets';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; pid: string; palette: string[]; font?: string; grade?: string };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// pointer menus: every field is chosen by the director per move; without any field the old look renders unchanged
const EASES: Record<string, (x: number) => number> = {
  'in-out': IN_OUT, out: OUT,
  'out-cubic': Easing.bezier(0.33, 1, 0.68, 1), 'out-quint': Easing.bezier(0.22, 1, 0.36, 1),
  soft: Easing.bezier(0.4, 0, 0.2, 1), snap: Easing.bezier(0.76, 0, 0.24, 1),
  'back-soft': Easing.bezier(0.34, 1.3, 0.64, 1), linear: (x: number) => x,
};
const easeFn = (e: unknown): ((x: number) => number) =>
  Array.isArray(e) && e.length === 4 && e.every((n) => typeof n === 'number') ? Easing.bezier(e[0], e[1], e[2], e[3]) : EASES[String(e)] || IN_OUT;
const ptrStart = (v: unknown, W: number, H: number, u: number): [number, number] => {
  if (Array.isArray(v) && v.length === 2) return [W * Number(v[0]), H * Number(v[1])];
  switch (v) {
    case 'left': return [-0.1 * W, 0.45 * H];
    case 'right': return [1.1 * W, 0.45 * H];
    case 'top': return [0.55 * W, -0.12 * H];
    case 'bottom': return [0.5 * W, 1.12 * H];
    case 'center': return [0.5 * W, 0.5 * H];
    case 'bar': return [W * 0.38, 116 * u];
    default: return [W * 0.8, H * 0.75];
  }
};
const pathPt = (a: [number, number], b: [number, number], p: number, kind: unknown): [number, number] => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.hypot(dx, dy) || 1;
  let nx = -dy / dist;
  let ny = dx / dist;
  if (ny > 0) { nx = -nx; ny = -ny; }
  let off = 0;
  if (kind === 'arc-up') off = 0.18 * dist * Math.sin(Math.PI * p);
  else if (kind === 'arc-down') off = -0.18 * dist * Math.sin(Math.PI * p);
  else if (kind === 'wobble') off = 0.035 * dist * Math.sin(Math.PI * 3 * p) * (1 - p);
  return [a[0] + dx * p + nx * off, a[1] + dy * p + ny * off];
};

export const ScreenScene: React.FC<P> = ({ l, L, accent, font, pid }) => {
  const f = useCurrentFrame();
  const { fps, durationInFrames: d } = useVideoConfig();
  const ft = f / fps;
  const edge = Math.max(1, Math.min(8, Math.floor(d / 3)));
  const env = interpolate(f, [0, edge, d - edge, d], [0, 1, 1, 0], CL);
  const plan = planSteps(l.steps);
  const W = L.w * 0.88;
  const H = L.h * 0.44;
  const u = L.u;

  const typeStep = [...plan].reverse().find((s) => s.type === 'type' && s.start <= ft);
  const typed = typeStep
    ? Math.floor(clamp01((ft - typeStep.start) / Math.max(0.1, typeStep.end - typeStep.start)) * (typeStep.text || '').length)
    : 0;
  const typing = !!typeStep && ft < typeStep.end;
  const caretOn = typing || Math.floor(f / (fps / 2)) % 2 === 0;

  const enterStep = plan.find((s) => s.type === 'enter' && s.start <= ft);
  const enterPress = enterStep ? 1 - clamp01((ft - enterStep.start) / 0.25) : 0;
  const clicks = plan.filter((s) => s.type === 'click');
  const btnClick = clicks.find((s) => s.to === 'button' && s.start <= ft && ft < s.start + 0.35);
  const btnPress = btnClick ? 1 - clamp01((ft - btnClick.start) / 0.3) : 0;
  const press = Math.max(enterPress, btnPress);
  const focused = typing || !!typeStep || clicks.some((s) => (s.to || 'bar') === 'bar' && s.start <= ft);

  const spin = plan.find((s) => s.type === 'spinner' && s.start <= ft && ft < s.end);
  const bubbles = plan.filter((s) => s.type === 'bubble');
  const chatOn = bubbles.some((b) => b.start <= ft);
  const shown = bubbles.filter((b) => b.start + b.dots <= ft).slice(-5);
  const dotsNow = bubbles.find((b) => b.start <= ft && ft < b.start + b.dots);
  const appear = OUT(clamp01(f / (0.45 * fps)));

  // pointer: glides between targets, window-relative
  const targets: Record<string, [number, number]> = { bar: [W * 0.38, 116 * u], button: [W - 70 * u, 116 * u] };
  const moves = plan.filter((s) => s.type === 'move');
  let from: [number, number] = ptrStart((moves[0] as any)?.from ?? (l as any).ptr?.from, W, H, u);
  let cur: [number, number] = from;
  for (const m of moves) {
    if (ft < m.start) break;
    const to = targets[m.to || 'bar'] || targets.bar;
    const p = easeFn((m as any).ease ?? (l as any).ptr?.ease)(clamp01((ft - m.start) / Math.max(0.1, m.end - m.start)));
    cur = pathPt(from, to, p, (m as any).path ?? (l as any).ptr?.path);
    from = to;
  }
  const lastClick = [...clicks].reverse().find((s) => s.start <= ft && ft < s.start + 0.5);
  const ck = lastClick ? clamp01((ft - lastClick.start) / 0.5) : 0;
  const dip = lastClick ? 1 - 0.18 * Math.sin(Math.PI * clamp01((ft - lastClick.start) / 0.3)) : 1;
  const showCursor = moves.length > 0 && !chatOn;

  // camera plan: chosen by the director (follow-out, focus-pull, push-reply, static)
  const plan0 = l.cam || 'static';
  let camScale = 1;
  let camOrigin = '50% 50%';
  let camBlur: string | undefined;
  if (plan0 === 'follow-out') {
    const endT = (typeStep ? typeStep.end : 3) + 0.4;
    const k = IN_OUT(clamp01((ft - 0.2) / Math.max(0.5, endT - 0.2)));
    camScale = 1 + 0.6 * (1 - k);
    camOrigin = `${(W * 0.55).toFixed(1)}px ${(116 * u).toFixed(1)}px`;
  } else if (plan0 === 'push-reply' && bubbles.length) {
    camScale = 1 + 0.1 * IN_OUT(clamp01((ft - bubbles[0].start) / 2.2));
    camOrigin = '50% 100%';
  } else if (plan0 === 'focus-pull') {
    const b = 8 * u * (1 - OUT(clamp01(ft / 0.9)));
    camBlur = b > 0.2 ? `blur(${b.toFixed(2)}px)` : undefined;
  }
  const cs = l.cursor;
  const csz = (cs?.size ?? 48) * u;

  const bubble = (side: string | undefined, key: string, body: React.ReactNode, a: number) => (
    <div key={key} style={{ display: 'flex', justifyContent: side === 'right' ? 'flex-end' : 'flex-start', opacity: a, transform: `translateY(${(1 - a) * 18 * u}px)` }}>
      <div style={{
        maxWidth: '78%', padding: `${14 * u}px ${20 * u}px`, borderRadius: 22 * u, fontFamily: fam(font), fontWeight: 600, fontSize: 34 * u, lineHeight: 1.25,
        background: side === 'right' ? accent : 'rgba(255,255,255,0.12)', color: '#fff',
        borderBottomRightRadius: side === 'right' ? 6 * u : 22 * u, borderBottomLeftRadius: side === 'right' ? 22 * u : 6 * u,
      }}>{body}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: env }}>
      <div style={{
        position: 'absolute', left: (L.w - W) / 2, top: L.h * 0.24, width: W, height: H, boxSizing: 'border-box', overflow: 'hidden',
        background: 'linear-gradient(160deg, rgba(20,26,42,0.96), rgba(10,13,24,0.95))', border: `${Math.max(1, u)}px solid rgba(255,255,255,0.1)`,
        borderRadius: 26 * u, boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5)`, opacity: appear, transform: `translateY(${(1 - appear) * 30 * u}px) scale(${camScale.toFixed(4)})`, transformOrigin: camOrigin, filter: camBlur,
      }}>
        <div style={{ display: 'flex', gap: 9 * u, alignItems: 'center', padding: `${16 * u}px ${20 * u}px`, borderBottom: `${Math.max(1, u)}px solid rgba(255,255,255,0.07)` }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 14 * u, height: 14 * u, borderRadius: '50%', background: c }} />)}
        </div>
        {!chatOn ? (
          <div style={{ padding: 28 * u }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 84 * u, padding: `0 ${10 * u}px 0 ${28 * u}px`, borderRadius: 42 * u,
              background: 'rgba(255,255,255,0.08)', border: `${2 * u}px solid ${focused || press > 0 ? accent : 'rgba(255,255,255,0.14)'}`,
              boxShadow: press > 0 ? `0 0 ${24 * u * press}px ${accent}` : undefined, fontFamily: fam(font), fontSize: 38 * u, color: '#fff',
            }}>
              <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <span>{(typeStep?.text || '').slice(0, typed)}</span>
                <span style={{ display: 'inline-block', width: 3 * u, height: 44 * u, marginLeft: 3 * u, verticalAlign: 'middle', background: focused && caretOn ? '#fff' : 'transparent' }} />
              </div>
              <div style={{
                width: 64 * u, height: 64 * u, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: press > 0 ? accent : 'rgba(255,255,255,0.12)', transform: `scale(${1 - 0.12 * press})`,
              }}>
                <svg width={34 * u} height={34 * u} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round">
                  <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
                </svg>
              </div>
            </div>
            {spin ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 56 * u }}>
                <div style={{ width: 80 * u, height: 80 * u, borderRadius: '50%', border: `${8 * u}px solid rgba(255,255,255,0.14)`, borderTopColor: accent, transform: `rotate(${f * 14}deg)` }} />
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 58 * u, padding: 24 * u, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 14 * u }}>
            {shown.map((b, i) => bubble(b.side, 'b' + b.start + '-' + i, (b.text || '').slice(0, 80), OUT(clamp01((ft - (b.start + b.dots)) / 0.35))))}
            {dotsNow ? bubble(dotsNow.side, 'dots', (
              <span style={{ display: 'inline-flex', gap: 8 * u }}>
                {[0, 1, 2].map((k) => <span key={k} style={{ width: 12 * u, height: 12 * u, borderRadius: '50%', background: '#fff', opacity: 0.35 + 0.65 * Math.abs(Math.sin(ft * 7 - k * 0.8)) }} />)}
              </span>
            ), 1) : null}
          </div>
        )}
        {showCursor ? (
          <>
            {lastClick ? <div style={{ position: 'absolute', left: cur[0] - 40 * u * (0.3 + ck), top: cur[1] - 40 * u * (0.3 + ck), width: 80 * u * (0.3 + ck), height: 80 * u * (0.3 + ck), borderRadius: '50%', border: `${3 * u}px solid ${accent}`, opacity: 1 - ck }} /> : null}
            {cs?.src ? <img src={url(cs.src, pid)} style={{ position: 'absolute', left: cur[0] - (cs.tipX ?? 0) * csz, top: cur[1] - (cs.tipY ?? 0) * csz, width: csz, height: csz, transform: `scale(${dip})`, transformOrigin: `${(cs.tipX ?? 0) * 100}% ${(cs.tipY ?? 0) * 100}%` }} /> : null}
            <svg width={34 * u} height={44 * u} viewBox="0 0 17 26" style={{ display: cs?.src ? 'none' : undefined, position: 'absolute', left: cur[0] - 2 * u, top: cur[1] - 2 * u, transform: `scale(${dip})`, transformOrigin: '2px 2px', filter: `drop-shadow(0 ${3 * u}px ${6 * u}px rgba(0,0,0,0.6))` }}>
              <path d="M0 0 L0 22 L6 17 L10 26 L13 24.5 L9 16 L17 16 Z" fill="#fff" stroke="#111" strokeWidth={1.2} strokeLinejoin="round" />
            </svg>
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
