// screen-plan.ts: pure timing for the screen-scene kit. No React. Same steps in, same times out.
export type ScreenStep = { type: string; text?: string; side?: string; at?: number; dur?: number };
export type Planned = ScreenStep & { start: number; end: number; dots: number };

export function planSteps(steps: ScreenStep[] | undefined, cps = 18): Planned[] {
  const out: Planned[] = [];
  let t = 0.3;
  for (const s of (steps || []).slice(0, 12)) {
    const start = typeof s.at === 'number' && s.at >= 0 ? s.at : t;
    let dur = 0;
    let dots = 0;
    let gap = 0.1;
    if (s.type === 'type') dur = s.dur ?? Math.max(0.5, (s.text || '').length / cps);
    else if (s.type === 'enter') dur = 0.3;
    else if (s.type === 'spinner') dur = s.dur ?? 0.9;
    else if (s.type === 'bubble') { dots = 0.6; dur = dots + (s.dur ?? 0.7); gap = 0.25; }
    else continue;
    out.push({ ...s, start, end: start + dur, dots });
    t = start + dur + gap;
  }
  return out;
}
