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
  | 'smooth' | 'back-out';

export type MotionProperty =
  | 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY'
  | 'rotation' | 'opacity' | 'width' | 'height'
  | 'blur' | 'brightness' | 'saturation';

export type MotionKeyframe = {
  /** Seconds from the start of the layer. */
  t: number;
  /** Numeric property values at this time. */
  values: Partial<Record<MotionProperty, number>>;
  /** Easing from this keyframe to the next. */
  ease?: EaseName;
};

export type MotionTransform = Partial<Record<MotionProperty, number>>;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function applyEase(t: number, ease: EaseName = 'linear'): number {
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
    default: return x;
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
): { transform?: string; opacity?: number; filter?: string; width?: string; height?: string } {
  const v = { ...base, ...animated };
  const tx = v.x ?? 0;
  const ty = v.y ?? 0;
  const sx = v.scaleX ?? v.scale ?? 1;
  const sy = v.scaleY ?? v.scale ?? 1;
  const rotation = v.rotation ?? 0;
  const transform = `translate(${tx}%, ${ty}%) scale(${sx}, ${sy}) rotate(${rotation}deg)`;
  const filters: string[] = [];
  if (v.blur !== undefined && v.blur > 0) filters.push(`blur(${v.blur}px)`);
  if (v.brightness !== undefined) filters.push(`brightness(${v.brightness})`);
  if (v.saturation !== undefined) filters.push(`saturate(${v.saturation})`);
  return {
    transform,
    opacity: v.opacity === undefined ? undefined : clamp01(v.opacity),
    filter: filters.length ? filters.join(' ') : undefined,
    width: v.width === undefined ? undefined : `${v.width}%`,
    height: v.height === undefined ? undefined : `${v.height}%`,
  };
}
