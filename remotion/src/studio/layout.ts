// Layout that adapts to the canvas: where captions, titles and graphics sit, and how big type is,
// for any width x height (9:16, 4:5, 1:1, 16:9, 21:9 or anything in between).
import type { CaptionStyle } from './types';

export type Shape = 'tall' | 'portrait' | 'square' | 'wide';
export type Box = { x: number; y: number; w: number; h: number };

export type Layout = {
  w: number; h: number; shape: Shape;
  u: number;                 // type scale: 1 at a 1080 px short side
  pad: number;               // safe side margin
  captionY: number;          // top of the caption block (px)
  captionMaxW: number;
  titleY: number;
  graphic: Box;              // where code-drawn graphics live, clear of title and captions
};

export function shapeOf(w: number, h: number): Shape {
  const a = w / h;
  if (a < 0.7) return 'tall';
  if (a < 0.9) return 'portrait';
  if (a < 1.25) return 'square';
  return 'wide';
}

export function layout(w: number, h: number): Layout {
  const shape = shapeOf(w, h);
  const u = Math.min(w, h) / 1080;
  const pad = Math.round(Math.min(w, h) * 0.065);
  // Fractions of the canvas height tuned per shape (tall matches the original StoryShort look).
  const F = {
    tall: { cap: 0.6, title: 0.11, gTop: 0.156, gBot: 0.568 },
    portrait: { cap: 0.7, title: 0.07, gTop: 0.12, gBot: 0.64 },
    square: { cap: 0.72, title: 0.06, gTop: 0.1, gBot: 0.66 },
    wide: { cap: 0.74, title: 0.06, gTop: 0.04, gBot: 0.7 },
  }[shape];
  const gy = h * F.gTop, gh = h * (F.gBot - F.gTop);
  return {
    w, h, shape, u, pad,
    captionY: h * F.cap, captionMaxW: w - pad * 2, titleY: h * F.title,
    graphic: { x: 0, y: gy, w, h: gh },
  };
}

/** Caption top (px) for a style position; 'auto' follows the shape. */
export function captionTop(L: Layout, pos: CaptionStyle['position'], blockH: number): number {
  if (typeof pos === 'number') return L.h * pos;
  if (pos === 'top') return L.h * (L.shape === 'wide' ? 0.08 : 0.16);
  if (pos === 'middle') return L.h / 2 - blockH / 2;
  if (pos === 'bottom') return L.h - L.pad * 1.6 - blockH;
  return L.captionY;
}

// The motion graphics (story/graphics.tsx) are drawn on a 1080x1920 design canvas inside the zone
// y 300..1090. Fit that zone into the layout's graphic box: same look at any canvas size.
export const G_ZONE = { top: 300, bottom: 1090, w: 1080 };
export function graphicFit(L: Layout): { left: number; top: number; scale: number } {
  const zh = G_ZONE.bottom - G_ZONE.top;
  const s = Math.min(L.graphic.w / G_ZONE.w, L.graphic.h / zh);
  return {
    scale: s,
    left: L.graphic.x + (L.graphic.w - G_ZONE.w * s) / 2,
    top: L.graphic.y + (L.graphic.h - zh * s) / 2 - G_ZONE.top * s,
  };
}
