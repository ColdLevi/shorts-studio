// Pip's skeleton: pure functions, no React. Feet stand on y = 0, up is negative y, units are rig units (x PS = world).
// Angles are degrees: 0 points down, +90 points to +x (screen right), 180 points up.
export type Eyes = 'open' | 'wide' | 'happy' | 'closed';
export type Mouth = 'smile' | 'o' | 'flat' | 'open' | 'grin';
export type Pose = {
  la: [number, number]; ra: [number, number];   // left (-x) and right (+x) arm: upper arm, forearm
  ll: [number, number]; rl: [number, number];   // left and right leg: thigh, shin
  lean: number; tilt: number; lift: number; sh: number;
  eyes: Eyes; mouth: Mouth; walk?: boolean;
};

export const POSES: Record<string, Pose> = {
  stand:   { la: [-12, -6],   ra: [12, 6],     ll: [10, 2], rl: [-10, -2], lean: 0,  tilt: 0,  lift: 0,   sh: 0,  eyes: 'open',  mouth: 'smile' },
  point:   { la: [-10, -6],   ra: [82, 88],    ll: [10, 2], rl: [-10, -2], lean: 4,  tilt: 0,  lift: 0,   sh: 0,  eyes: 'open',  mouth: 'smile' },
  hold:    { la: [-14, -8],   ra: [38, 128],   ll: [10, 2], rl: [-10, -2], lean: 2,  tilt: 3,  lift: 0,   sh: 0,  eyes: 'open',  mouth: 'smile' },
  present: { la: [-70, -98],  ra: [70, 98],    ll: [11, 2], rl: [-11, -2], lean: 0,  tilt: 0,  lift: 0,   sh: 0,  eyes: 'open',  mouth: 'open' },
  shrug:   { la: [-48, -16],  ra: [48, 16],    ll: [10, 2], rl: [-10, -2], lean: 0,  tilt: 9,  lift: 0,   sh: 12, eyes: 'open',  mouth: 'flat' },
  cheer:   { la: [-150, -168],ra: [150, 168],  ll: [10, 4], rl: [-10, -4], lean: 0, tilt: 0, lift: -16, sh: 0,  eyes: 'happy', mouth: 'grin' },
  react:   { la: [-38, -64],  ra: [38, 64],    ll: [12, 2], rl: [-12, -2], lean: -7, tilt: -4, lift: -4,  sh: 6,  eyes: 'wide',  mouth: 'o' },
  think:   { la: [-10, -6],   ra: [30, 162],   ll: [10, 2], rl: [-10, -2], lean: 2,  tilt: 11, lift: 0,   sh: 0,  eyes: 'open',  mouth: 'flat' },
  walk:    { la: [-10, -6],   ra: [10, 6],     ll: [0, 0],  rl: [0, 0],  lean: 3,  tilt: 0,  lift: 0,   sh: 0,  eyes: 'open',  mouth: 'smile', walk: true },
};

const lerp = (a: number, b: number, m: number) => a + (b - a) * m;
const lerp2 = (a: [number, number], b: [number, number], m: number): [number, number] => [lerp(a[0], b[0], m), lerp(a[1], b[1], m)];

// m may overshoot past 1 (a spring): the limbs swing past the target and settle, which is what makes it feel alive.
export function mixPose(a: Pose, b: Pose, m: number): Pose {
  const pick = m > 0.5 ? b : a;
  return {
    la: lerp2(a.la, b.la, m), ra: lerp2(a.ra, b.ra, m), ll: lerp2(a.ll, b.ll, m), rl: lerp2(a.rl, b.rl, m),
    lean: lerp(a.lean, b.lean, m), tilt: lerp(a.tilt, b.tilt, m), lift: lerp(a.lift, b.lift, m), sh: lerp(a.sh, b.sh, m),
    eyes: pick.eyes, mouth: pick.mouth, walk: pick.walk,
  };
}

export type P2 = [number, number];
export type Joints = {
  hip: P2; neck: P2; lSh: P2; rSh: P2; lEl: P2; lHand: P2; rEl: P2; rHand: P2;
  lKnee: P2; lFoot: P2; rKnee: P2; rFoot: P2; head: P2; headAngle: number; lean: number;
};

const HIP_Y = -128, TORSO = 108, UA = 56, FA = 52, TH = 62, SHN = 66, HEAD_R = 46;
const dir = (deg: number): P2 => { const r = (deg * Math.PI) / 180; return [Math.sin(r), Math.cos(r)]; };
const add = (p: P2, d: P2, len: number): P2 => [p[0] + d[0] * len, p[1] + d[1] * len];
const rot = (p: P2, deg: number, pv: P2): P2 => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), x = p[0] - pv[0], y = p[1] - pv[1];
  return [pv[0] + x * c - y * s, pv[1] + x * s + y * c];
};

export function rigAt(p: Pose, t: number): Joints {
  let { la, ra, ll, rl } = p;
  let bob = Math.sin(t * 2.2) * 2.5;
  if (p.walk) {
    const ph = t * 7, s = Math.sin(ph);
    ll = [28 * s, 28 * s * 0.2 - 14 * Math.max(0, Math.cos(ph))];
    rl = [-28 * s, -28 * s * 0.2 - 14 * Math.max(0, -Math.cos(ph))];
    la = [-10 - 26 * s, -6 - 26 * s]; ra = [10 - 26 * s, 6 - 26 * s];
    bob = -Math.abs(s) * 5;
  }
  const hip: P2 = [0, HIP_Y + p.lift + bob];
  const lean = p.lean;
  const shY = hip[1] - TORSO - p.sh;
  const neck = rot([0, shY], lean, hip);
  const lSh = rot([-16, shY + 8], lean, hip);
  const rSh = rot([16, shY + 8], lean, hip);
  const lEl = add(lSh, dir(la[0] + lean), UA), lHand = add(lEl, dir(la[1] + lean), FA);
  const rEl = add(rSh, dir(ra[0] + lean), UA), rHand = add(rEl, dir(ra[1] + lean), FA);
  const lKnee = add(hip, dir(ll[0]), TH), lFoot = add(lKnee, dir(ll[1]), SHN);
  const rKnee = add(hip, dir(rl[0]), TH), rFoot = add(rKnee, dir(rl[1]), SHN);
  const headAngle = lean + p.tilt;
  const head = rot([neck[0], neck[1] - HEAD_R - 8], headAngle, neck);
  return { hip, neck, lSh, rSh, lEl, lHand, rEl, rHand, lKnee, lFoot, rKnee, rFoot, head, headAngle, lean };
}
export const HEAD_RADIUS = HEAD_R;
