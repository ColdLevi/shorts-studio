// Project timeline v1: the single source of truth for a Shorts Studio video.
// One JSON per project (media/projects/<id>/timeline.json). The universal "Studio" composition
// renders any timeline at any canvas size; tools/timeline.py builds, patches and versions it.
// JSON Schema: timeline/timeline.schema.json. Times are in seconds from the start of the video.
import type { Graphic } from '../story/graphics';

export type Word = { word: string; start: number; end: number };

export type Canvas = { width: number; height: number; fps: number; background?: string };

export type TransitionType =
  | 'cut' | 'fade' | 'dissolve' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'zoom-in' | 'zoom-out' | 'wipe' | 'blur' | 'flash';
export type Transition = { type: TransitionType; duration?: number };

export type CaptionPreset = 'bold-pop' | 'karaoke-box' | 'clean' | 'subtitle' | 'neon' | 'word-by-word' | 'none';
export type CaptionStyle = {
  preset?: CaptionPreset;
  font?: string;            // a Google font from fonts.ts (Montserrat, Anton, Bebas Neue, Inter, Poppins, ...)
  weight?: number;
  size?: number;            // px at the canvas' short side = 1080; omitted = preset default
  color?: string;
  highlight?: string;       // active word colour (defaults to style.accent)
  stroke?: string;          // outline colour, '' for none
  background?: string;      // box/bar colour for karaoke-box and subtitle
  case?: 'upper' | 'lower' | 'none';
  position?: 'auto' | 'top' | 'middle' | 'bottom' | number; // number = 0..1 of the canvas height
  words_per_group?: number;
  max_width?: number;       // 0..1 of the canvas width
};

export type Style = {
  preset?: string;          // name of the style preset this came from (informational)
  accent?: string;
  palette?: string[];
  font?: string;            // display font for titles and graphics headings
  caption?: CaptionStyle;
  title?: { show?: boolean; duration?: number; font?: string; position?: 'top' | 'middle' };
  transition?: Transition;  // default between visual clips
  motion?: 'kenburns' | 'static' | 'parallax' | 'drift' | 'handheld';
  transitions?: TransitionType[]; // cycled between clips that set none (variety instead of one fade)
  fx?: { hold?: number; jitter?: number; texture?: 'paper' | 'grain' | 'film' | 'vhs' | 'none'; letterbox?: number; flicker?: boolean };
  backdrop?: 'none' | 'grid' | 'gradient' | 'paper' | 'blueprint' | 'dots'; // shared animated backdrop under graphics
  recipe?: string;          // style recipe name (stop-motion, documentary, motion-explainer, ...)
  progress_bar?: boolean;
  vignette?: boolean;
  grade?: string;           // CSS filter for every visual, e.g. "contrast(1.08) saturate(1.15)"
};

// How an asset was (or will be) made. Kept so a re-edit can remake only what changed.
export type Gen = { tool: string; prompt?: string; model?: string; still?: string; motion?: string; url?: string; [k: string]: unknown };

export type VisualKind = 'image' | 'ai_video' | 'graphic' | 'stock' | 'upload' | 'color';
export type VisualClip = {
  id: string;
  kind: VisualKind;
  start: number;
  end: number;
  src?: string;             // assets/x.jpg (project), library/..., projects/<id>/..., or https://
  w?: number; h?: number;   // source pixel size: lets 'auto' fit pick cover vs blur-fill
  fit?: 'auto' | 'cover' | 'contain' | 'blur-fill';
  focus?: { x: number; y: number }; // 0..1 point to keep in frame when cropping
  motion?: 'auto' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'static' | 'parallax' | 'handheld';
  transition?: Transition;  // entering this clip
  trim?: number;            // seconds into a video source
  duration?: number;        // length of a video source
  playbackRate?: number;
  loop?: boolean;
  volume?: number;          // video sound, 0 = muted (default)
  pixel?: boolean;
  color?: string;           // kind 'color'
  graphic?: Graphic;        // kind 'graphic'
  narration?: string;       // the words spoken over this clip (for re-timing after a voice change)
  gen?: Gen;
  hash?: string;
};

export type AudioClip = {
  id: string;
  src: string;
  start?: number;           // when it starts in the video
  end?: number;             // stop at (video time); omitted = its own length / end of video
  trim?: number;            // seconds into the source
  volume?: number;
  loop?: boolean;
  fade_in?: number;
  fade_out?: number;
  duck?: boolean;           // music: dip under the voice
  gen?: Gen;
  hash?: string;
};
export type SfxClip = { id: string; src: string; at: number; volume?: number; anchor?: string; offset?: number };

export type TextOverlay = {
  id: string;
  kind: 'title' | 'text' | 'lower-third' | 'image' | 'chapter';
  start: number;
  end: number;
  text?: string;
  sub?: string;
  src?: string;
  position?: 'top' | 'middle' | 'bottom' | { x: number; y: number; w?: number };
  font?: string;
  color?: string;
  background?: string;
};

export type Timeline = {
  schema: 'shorts-studio/timeline@1';
  id: string;
  rev?: number;
  title: string;
  duration: number;
  canvas: Canvas;
  style: Style;
  tracks: {
    visuals: VisualClip[];
    captions?: { enabled?: boolean; words: Word[]; style?: CaptionStyle };
    voice?: AudioClip[];
    music?: AudioClip[];
    sfx?: SfxClip[];
    overlays?: TextOverlay[];
  };
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};
