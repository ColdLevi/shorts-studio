// Layers4.tsx: screen-scene kit. A fake browser window plays a scripted sequence:
// typed search text, Enter, spinner, then chat bubbles from both sides with typing dots first.
// Steps: [{type:'type',text}, {type:'enter'}, {type:'spinner'}, {type:'bubble',side:'left'|'right',text}]
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layer } from './Layers';
import { planSteps } from './screen-plan';

type P = { l: Layer; L: { w: number; h: number; u: number }; accent: string; pid: string; palette: string[]; font?: string; grade?: string };
const CL = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const fam = (font?: string) => (font ? `'${font}', Inter, sans-serif` : 'Inter, sans-serif');
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const ScreenScene: React.FC<P> = ({ l, L, accent, font }) => {
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
  const press = enterStep ? 1 - clamp01((ft - enterStep.start) / 0.25) : 0;
  const spin = plan.find((s) => s.type === 'spinner' && s.start <= ft && ft < s.end);
  const bubbles = plan.filter((s) => s.type === 'bubble');
  const chatOn = bubbles.some((b) => b.start <= ft);
  const shown = bubbles.filter((b) => b.start + b.dots <= ft).slice(-5);
  const dotsNow = bubbles.find((b) => b.start <= ft && ft < b.start + b.dots);
  const appear = OUT(clamp01(f / (0.45 * fps)));

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
        borderRadius: 26 * u, boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5)`, opacity: appear, transform: `translateY(${(1 - appear) * 30 * u}px)`,
      }}>
        <div style={{ display: 'flex', gap: 9 * u, alignItems: 'center', padding: `${16 * u}px ${20 * u}px`, borderBottom: `${Math.max(1, u)}px solid rgba(255,255,255,0.07)` }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 14 * u, height: 14 * u, borderRadius: '50%', background: c }} />)}
        </div>
        {!chatOn ? (
          <div style={{ padding: 28 * u }}>
            <div style={{
              display: 'flex', alignItems: 'center', height: 84 * u, padding: `0 ${28 * u}px`, borderRadius: 42 * u, background: 'rgba(255,255,255,0.08)',
              border: `${2 * u}px solid ${press > 0 ? accent : 'rgba(255,255,255,0.14)'}`, boxShadow: press > 0 ? `0 0 ${24 * u * press}px ${accent}` : undefined,
              transform: `scale(${1 - 0.02 * press})`, fontFamily: fam(font), fontSize: 38 * u, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden',
            }}>
              <span>{(typeStep?.text || '').slice(0, typed)}</span>
              <span style={{ display: 'inline-block', width: 3 * u, height: 44 * u, marginLeft: 3 * u, background: caretOn ? '#fff' : 'transparent' }} />
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
      </div>
    </AbsoluteFill>
  );
};
