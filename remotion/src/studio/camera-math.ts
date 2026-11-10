// camera-math.ts: pure camera maths for the Studio composition (no React, no Remotion), so it can be tested in node.
// The virtual camera: a pose (x, y, zoom, roll, tilt) per moment, hard ceilings, edge safety, and camera-led transitions.
// Ceilings follow the motion-graphics skill (2.4): pan 8% of the frame, zoom +15%, roll 1.5 deg, tilt 3 deg.
export type CamMove = 'push-in' | 'pull-out' | 'drift' | 'truck' | 'orbit' | 'hold' | 'handheld';
export type Cam = { move: CamMove; amp?: number; dir?: 1 | -1; wobble?: number };
export type Pose = { x: number; y: number; zoom: number; rot: number; tilt: number };
type Sty = { opacity?: number; transform?: string; filter?: string };

export const CEIL = { pan: 0.08, zoom: 0.15, rot: 1.5, tilt: 3 };
export const CAMERA_TRANSITIONS = ['settle', 'push-through', 'carry-left', 'carry-right', 'whip-left', 'whip-right'];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// CSS-style cubic-bezier easing (same maths as Remotion's Easing.bezier).
export const bezier = (x1: number, y1: number, x2: number, y2: number) => (x: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const e = sx(t) - x;
    if (Math.abs(e) < 1e-5) return sy(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= e / d;
  }
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < 30; i++) {
    const e = sx(t) - x;
    if (Math.abs(e) < 1e-5) break;
    if (e > 0) hi = t; else lo = t;
    t = (lo + hi) / 2;
  }
  return sy(t);
};
export const OUT = bezier(0.16, 1, 0.3, 1);      // entrances: fast start, soft landing
export const IN_OUT = bezier(0.65, 0, 0.35, 1);  // moves inside a scene

export const wobbleAmt = (c: Cam) => (c.move === 'hold' ? 0 : c.wobble ?? (c.move === 'handheld' ? 1.6 : 1));

// The camera pose at progress p (0..1 across the clip). Deterministic: same frame, same pose.
export function pose(c: Cam, p: number, frame = 0, fps = 30, seed = 0): Pose {
  const a = clamp(c.amp ?? 0.6, 0, 1);
  const k = 0.5 + a;                 // 0.5 .. 1.5
  const d = c.dir ?? 1;
  const q = clamp(p, 0, 1);
  const o = OUT(q), e = IN_OUT(q);
  let x = 0, y = 0, zoom = 1, rot = 0, tilt = 0;
  switch (c.move) {
    case 'push-in': zoom = 1 + 0.05 * k * o; y = -0.004 * k * o; break;
    case 'pull-out': zoom = 1 + 0.07 * k * (1 - o); break;
    case 'drift': x = -d * 0.025 * k * e; y = -0.012 * k * e; zoom = 1 + 0.02 * k * e; break;
    case 'truck': x = d * (0.03 - 0.06 * e) * k; zoom = 1.02; break;
    case 'orbit': x = d * (0.02 - 0.04 * e) * k; tilt = d * (1 - 2 * e) * k; zoom = 1.03; break;
    default: break;                  // hold, handheld
  }
  const w = wobbleAmt(c);
  if (w) {
    const t = frame / fps;
    x += w * (Math.sin(t * 1.3 + seed) * 0.004 + Math.sin(t * 3.1 + seed * 2) * 0.0015);
    y += w * (Math.cos(t * 1.1 + seed) * 0.0035 + Math.sin(t * 2.7 + seed * 3) * 0.0012);
    rot += w * Math.sin(t * 0.9 + seed) * 0.15;
  }
  return {
    x: clamp(x, -CEIL.pan, CEIL.pan), y: clamp(y, -CEIL.pan, CEIL.pan),
    zoom: clamp(zoom, 1, 1 + CEIL.zoom), rot: clamp(rot, -CEIL.rot, CEIL.rot), tilt: clamp(tilt, -CEIL.tilt, CEIL.tilt),
  };
}

// The picture is drawn this much larger than the frame so a pan, roll or tilt never shows its edge.
export function baseScale(c: Cam): number {
  let pan = 0, rot = 0, tilt = 0;
  for (let i = 0; i <= 10; i++) {
    const q = pose({ ...c, wobble: 0 }, i / 10);
    pan = Math.max(pan, Math.abs(q.x), Math.abs(q.y));
    rot = Math.max(rot, Math.abs(q.rot));
    tilt = Math.max(tilt, Math.abs(q.tilt));
  }
  const w = wobbleAmt(c);
  pan += 0.006 * w;
  rot += 0.2 * w;
  return Math.max(1.06, 1 + 2 * pan + 0.021 * rot + 0.012 * tilt + 0.01);
}

// k scales the pan, tilt and roll (a far layer moves less); kz scales the zoom change.
export function poseTransform(po: Pose, base: number, W: number, H: number, k = 1, kz = k): string {
  const z = (1 + (po.zoom - 1) * kz) * base;
  return `perspective(1200px) translate3d(${(po.x * k * W).toFixed(2)}px, ${(po.y * k * H).toFixed(2)}px, 0) rotateX(${(po.tilt * k).toFixed(3)}deg) rotate(${(po.rot * k).toFixed(3)}deg) scale(${z.toFixed(4)})`;
}

const blurSin = (x: number, amp: number) => {
  const b = Math.sin(Math.PI * x) * amp;
  return b > 0.3 ? `blur(${b.toFixed(2)}px)` : undefined;
};

// Camera-led entrance: the incoming shot arrives in motion (never fully formed, never a slide).
export function enterStyle(type: string, p: number, W: number, u: number): Sty | null {
  const x = clamp(p, 0, 1);
  if (x >= 1) return null;
  switch (type) {
    case 'settle': {
      const q = 1 - OUT(x);
      return { opacity: clamp(x * 3.2, 0, 1), transform: `scale(${1 + 0.09 * q}) translateX(${q * 0.025 * W}px)` };
    }
    case 'push-through': {
      const q = 1 - OUT(x);
      return { opacity: clamp(x * 2.2, 0, 1), transform: `scale(${1 + 0.16 * q})`, filter: q > 0.02 ? `blur(${(q * 3 * u).toFixed(2)}px)` : undefined };
    }
    case 'carry-left': case 'carry-right': {
      const d = type === 'carry-left' ? 1 : -1;
      return { transform: `translateX(${(d * (1 - IN_OUT(x)) * 0.34 * W).toFixed(2)}px)`, filter: blurSin(x, 5 * u) };
    }
    case 'whip-left': case 'whip-right': {
      const d = type === 'whip-left' ? 1 : -1;
      return { transform: `translateX(${(d * (1 - IN_OUT(x)) * 0.46 * W).toFixed(2)}px)`, filter: blurSin(x, 8 * u) };
    }
    default: return null;
  }
}

// The outgoing shot leaves in motion too, at matched speed, so the camera carries the cut.
export function exitStyle(type: string, p: number, W: number, u: number): Sty | null {
  if (!(p > 0)) return null;
  const x = clamp(p, 0, 1);
  switch (type) {
    case 'push-through': {
      const e = IN_OUT(x);
      return { transform: `scale(${1 + 0.2 * e})`, filter: e > 0.05 ? `blur(${(e * 3 * u).toFixed(2)}px)` : undefined };
    }
    case 'carry-left': case 'carry-right': {
      const d = type === 'carry-left' ? 1 : -1;
      return { transform: `translateX(${(-d * IN_OUT(x) * 0.34 * W).toFixed(2)}px)`, filter: blurSin(x, 5 * u) };
    }
    case 'whip-left': case 'whip-right': {
      const d = type === 'whip-left' ? 1 : -1;
      return { transform: `translateX(${(-d * IN_OUT(x) * 0.46 * W).toFixed(2)}px)`, filter: blurSin(x, 8 * u) };
    }
    default: return null;
  }
}
