/**
 * Shorts Studio Motion Engine — deterministic keyframe evaluator.
 *
 * Timeline time is expressed in seconds. Keyframe times are relative to the
 * beginning of their layer. Values are numeric and are interpolated with a
 * named easing curve. This module is intentionally pure: identical project
 * data and frame numbers always produce identical results.
 */

export type EaseName =
  | 'linear' | 'hold'
  | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'smooth' | 'back-out'
  | 'out-cubic' | 'out-quint' | 'in-cubic' | 'in-out-cubic'
  | 'out-back-soft' | 'bounce-out' | 'bounce-soft';
/** A named curve, or a custom cubic-bezier [x1, y1, x2, y2]. */
export type Ease = EaseName | [number, number, number, number];

export type MotionProperty =
  | 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY'
  | 'rotation' | 'opacity' | 'width' | 'height'
  | 'blur' | 'brightness' | 'saturation'
  | 'rotateX' | 'rotateY' | 'glow';

export type MotionKeyframe = {
  /** Seconds from the start of the layer. */
  t: number;
  /** Numeric property values at this time. */
  values: Partial<Record<MotionProperty, number>>;
  /** Easing from this keyframe to the next. */
  ease?: Ease;
};

export type MotionTransform = Partial<Record<MotionProperty, number>>;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const bez = (x1: number, y1: number, x2: number, y2: number) => (x: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 30; i++) {
    const bx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (Math.abs(bx - x) < 1e-5) break;
    if (bx < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
};
const NAMED: Record<string, number[]> = {
  'out-cubic': [0.33, 1, 0.68, 1],
  'out-quint': [0.22, 1, 0.36, 1],
  'in-cubic': [0.32, 0, 0.67, 0],
  'in-out-cubic': [0.65, 0, 0.35, 1],
  'out-back-soft': [0.34, 1.25, 0.64, 1],
};
const bounceOut = (x: number): number => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }
  if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; }
  x -= 2.625 / d;
  return n * x * x + 0.984375;
};

export function applyEase(t: number, ease: Ease = 'linear'): number {
  if (Array.isArray(ease)) return bez(ease[0], ease[1], ease[2], ease[3])(clamp01(t));
  const x = clamp01(t);
  switch (ease) {
    case 'hold': return 0;
    case 'ease-in': return x * x;
    case 'ease-out': return 1 - (1 - x) * (1 - x);
    case 'ease-in-out': return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case 'smooth': return x * x * (3 - 2 * x);
    case 'back-out': {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case 'bounce-out': return bounceOut(x);
    case 'bounce-soft': return 0.6 * bez(0.33, 1, 0.68, 1)(x) + 0.4 * bounceOut(x);
    default: { const c = NAMED[ease as string]; return c ? bez(c[0], c[1], c[2], c[3])(x) : x; }
  }
}

function validKeyframes(frames: MotionKeyframe[]): MotionKeyframe[] {
  return (Array.isArray(frames) ? frames : [])
    .filter((k) => Number.isFinite(k?.t) && k.t >= 0 && k.values && typeof k.values === 'object')
    .map((k) => ({ ...k, values: { ...k.values } }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Evaluate all animated properties at a layer-local time.
 * Missing properties are left undefined so callers can preserve static values.
 */
export function evaluateKeyframes(
  keyframes: MotionKeyframe[] | undefined,
  seconds: number,
): MotionTransform {
  const frames = validKeyframes(keyframes || []);
  if (!frames.length || !Number.isFinite(seconds)) return {};

  const properties = new Set<MotionProperty>();
  for (const frame of frames) {
    for (const key of Object.keys(frame.values) as MotionProperty[]) properties.add(key);
  }

  const result: MotionTransform = {};
  for (const property of properties) {
    const points = frames
      .filter((k) => Number.isFinite(k.values[property]))
      .map((k) => ({ t: k.t, value: k.values[property] as number, ease: k.ease }));

    if (!points.length) continue;
    if (seconds <= points[0].t) {
      result[property] = points[0].value;
      continue;
    }
    const last = points[points.length - 1];
    if (seconds >= last.t) {
      result[property] = last.value;
      continue;
    }

    let i = 0;
    while (i < points.length - 1 && seconds > points[i + 1].t) i++;
    const a = points[i], b = points[i + 1];
    const span = b.t - a.t;
    const raw = span <= 0 ? 1 : (seconds - a.t) / span;
    const p = applyEase(raw, a.ease || 'linear');
    result[property] = a.value + (b.value - a.value) * p;
  }
  return result;
}

/** Compose an evaluated transform with static layer values. */
export function motionStyle(
  animated: MotionTransform,
  base: MotionTransform = {},
  opts: { glowColor?: string; perspective?: number } = {},
): { transform?: string; opacity?: number; filter?: string; width?: string; height?: string } {
  const v = { ...base, ...animated };
  const tx = v.x ?? 0;
  const ty = v.y ?? 0;
  const sx = v.scaleX ?? v.scale ?? 1;
  const sy = v.scaleY ?? v.scale ?? 1;
  const rotation = v.rotation ?? 0;
  const rx = v.rotateX ?? 0;
  const ry = v.rotateY ?? 0;
  const flat = `translate(${tx}%, ${ty}%) scale(${sx}, ${sy}) rotate(${rotation}deg)`;
  const transform = rx || ry
    ? `perspective(${opts.perspective ?? 1200}px) ${flat} rotateX(${rx}deg) rotateY(${ry}deg)`
    : flat;
  const filters: string[] = [];
  if (v.blur !== undefined && v.blur > 0) filters.push(`blur(${v.blur}px)`);
  if (v.brightness !== undefined) filters.push(`brightness(${v.brightness})`);
  if (v.saturation !== undefined) filters.push(`saturate(${v.saturation})`);
  if (v.glow !== undefined && v.glow > 0) {
    const gc = opts.glowColor || '#ffffff';
    filters.push(`drop-shadow(0 0 ${v.glow}px ${gc})`, `drop-shadow(0 0 ${v.glow * 2.5}px ${gc})`);
  }
  return {
    transform,
    opacity: v.opacity === undefined ? undefined : clamp01(v.opacity),
    filter: filters.length ? filters.join(' ') : undefined,
    width: v.width === undefined ? undefined : `${v.width}%`,
    height: v.height === undefined ? undefined : `${v.height}%`,
  };
}
