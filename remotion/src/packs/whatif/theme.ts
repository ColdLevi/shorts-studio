// What If pack: shared look. One palette, one type stack, so every scene reads as the same show.
export const INK = '#f6efe6';
export const ACCENT = '#ffd43b';
export const DARK = '#241437';
export const MONO = "'DejaVu Sans Mono', 'Courier New', monospace";
export const SANS = "'Montserrat', 'DejaVu Sans', Arial, sans-serif";
export const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
export const PS = 1.5; // Pip's draw scale in world units: he is ~510 tall on a 1920 canvas

export function rand(seed: number): number {
  // tiny deterministic noise, so frames never depend on Math.random
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
