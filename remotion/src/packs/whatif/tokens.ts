// What If pack: shared tokens. One place for colors, fonts and easing so every scene matches.
export type Mood = 'dusk' | 'night';

export type Palette = {
  skyTop: string; skyMid: string; skyLow: string;
  wall: string; wall2: string; floor: string; floor2: string;
  lamp: string; ink: string; rim: string; accent: string; wood: string; shadow: string; head: string;
};

export const PALETTES: Record<Mood, Palette> = {
  dusk: {
    skyTop: '#2b1b4a', skyMid: '#7a3b6e', skyLow: '#f08a4b',
    wall: '#3a2554', wall2: '#2f1d47', floor: '#1d1230', floor2: '#271740',
    lamp: '#ffd9a0', ink: '#f6efe6', rim: '#ffb36b', accent: '#ffd43b', wood: '#5b3a2e', shadow: '#0c0618', head: '#2b1b4a',
  },
  night: {
    skyTop: '#0b1030', skyMid: '#1b2a5c', skyLow: '#3b5aa8',
    wall: '#1e2442', wall2: '#171c36', floor: '#10142a', floor2: '#171c38',
    lamp: '#ffe2b0', ink: '#eef2ff', rim: '#7fa8ff', accent: '#ffd43b', wood: '#3d2b3a', shadow: '#05071a', head: '#141a3a',
  },
};

export const MONO = "'DejaVu Sans Mono', 'Courier New', monospace";
export const SANS = "'Montserrat', 'DejaVu Sans', Arial, sans-serif";
export const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
