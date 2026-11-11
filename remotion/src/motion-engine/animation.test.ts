import { applyEase, evaluateKeyframes, motionStyle } from './animation';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('Motion Engine test failed: ' + message);
}

check(applyEase(0.5, 'linear') === 0.5, 'linear easing');

const result = evaluateKeyframes([
  { t: 0, values: { x: 0, opacity: 0 } },
  { t: 2, values: { x: 100, opacity: 1 } },
], 1);

check(result.x === 50, 'midpoint interpolation');
check(result.opacity === 0.5, 'opacity interpolation');

const end = evaluateKeyframes([
  { t: 0, values: { rotation: 0 } },
  { t: 1, values: { rotation: 90 } },
], 2);

check(end.rotation === 90, 'final keyframe value');
check(motionStyle({ opacity: 2 }).opacity === 1, 'opacity clamping');

export {};
