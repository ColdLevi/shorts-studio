// "Studio": the universal composition. It renders any project timeline (types.ts) at any canvas size:
// visuals with transitions, captions with style presets, overlays, voice, music (ducked) and SFX.
import React from 'react';
import { AbsoluteFill, Audio, Sequence, CalculateMetadataFunction, useVideoConfig } from 'remotion';
import { Captions } from './Captions';
import { layout } from './layout';
import { Overlay, Progress } from './Overlays';
import { url } from './assets';
import { nearestImage, transitionLen, VisualLayer } from './Visuals';
import { Backdrop, Finish, Held } from './StyleFX';
import type { AudioClip, Timeline, Word } from './types';

export const defaultTimeline: Timeline = {
  schema: 'shorts-studio/timeline@1', id: 'preview', title: 'Preview', duration: 4,
  canvas: { width: 1080, height: 1920, fps: 30 },
  style: { accent: '#FFD43B', caption: { preset: 'bold-pop' } },
  tracks: {
    visuals: [
      { id: 'v1', kind: 'graphic', start: 0, end: 4, graphic: { type: 'title', text: 'Shorts Studio timeline', sub: 'Any canvas, any style' } },
    ],
    captions: { words: [{ word: 'Any', start: 0.3, end: 0.6 }, { word: 'canvas,', start: 0.6, end: 1.1 }, { word: 'any', start: 1.3, end: 1.6 }, { word: 'style.', start: 1.6, end: 2.2 }] },
  },
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function timelineDuration(t: Timeline): number {
  const ends = [t.duration || 0, ...t.tracks.visuals.map((c) => c.end)];
  return Math.max(0.5, ...ends.filter((x) => Number.isFinite(x)));
}

export const calculateStudioMetadata: CalculateMetadataFunction<Timeline> = ({ props }) => {
  const c = props.canvas || { width: 1080, height: 1920, fps: 30 };
  const fps = c.fps || 30;
  return { width: even(c.width || 1080), height: even(c.height || 1920), fps, durationInFrames: Math.max(1, Math.ceil(timelineDuration(props) * fps)) };
};

// Music sits lower under speech and lifts a little in the gaps.
function speechDistance(words: Word[], t: number): number {
  let lo = 0, hi = words.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (words[m].end + 0.3 < t) lo = m + 1;
    else if (words[m].start - 0.15 > t) hi = m - 1;
    else return 0;
  }
  const a = words[hi], b = words[lo];
  return Math.min(a ? t - (a.end + 0.3) : 9, b ? b.start - 0.15 - t : 9);
}

const AudioTrack: React.FC<{ a: AudioClip; pid: string; total: number; words?: Word[]; master?: number }> = ({ a, pid, total, words, master = 1 }) => {
  const { fps } = useVideoConfig();
  const start = a.start || 0;
  const end = Math.min(total, a.end ?? total);
  if (end <= start || !a.src) return null;
  const base = a.volume ?? 1;
  const fin = a.fade_in ?? 0, fout = a.fade_out ?? 0;
  const vol = (f: number) => {
    const t = start + f / fps;
    let v = base * master;
    if (fin > 0) v *= Math.min(1, (t - start) / fin);
    if (fout > 0) v *= Math.min(1, Math.max(0, (end - t) / fout));
    if (a.duck && words?.length) v *= 1 + 0.8 * Math.min(1, speechDistance(words, t) / 0.35);
    return Math.max(0, Math.min(1, v));
  };
  return (
    <Sequence from={Math.round(start * fps)} durationInFrames={Math.max(1, Math.round((end - start) * fps))}>
      <Audio src={url(a.src, pid)} loop={a.loop} volume={vol} trimBefore={a.trim ? Math.round(a.trim * fps) : undefined} />
    </Sequence>
  );
};

export const StudioVideo: React.FC<Timeline> = (t) => {
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const L0 = layout(width, height);
  // Cinema bars (style.fx.letterbox) on a wide canvas: keep graphics inside the picture area.
  const lb = L0.shape === 'wide' ? Math.max(0, Math.min(0.15, t.style?.fx?.letterbox || 0)) * height : 0;
  const L = lb ? { ...L0, graphic: { ...L0.graphic, y: Math.max(L0.graphic.y, lb + 8), h: L0.graphic.h - Math.max(0, lb + 8 - L0.graphic.y) } } : L0;
  const pid = t.id || 'job';
  const st = t.style || {};
  const accent = st.accent || '#FFD43B';
  const total = durationInFrames / fps;
  const vis = [...(t.tracks.visuals || [])].sort((a, b) => a.start - b.start);
  const words = t.tracks.captions?.words || [];
  const defT = st.transition ?? { type: 'fade' as const, duration: 0.35 };
  // Variety: a recipe can list transitions to cycle through instead of one fade everywhere.
  const cycle = (st.transitions || []).filter(Boolean);
  const trFor = (i: number) => (cycle.length ? { type: cycle[i % cycle.length], duration: cycle[i % cycle.length] === 'cut' ? 0 : (defT.duration ?? 0.35) } : defT);
  const shared = !!st.backdrop && st.backdrop !== 'none';
  const overlays = t.tracks.overlays ?? (st.title?.show !== false && t.title
    ? [{ id: 'title', kind: 'title' as const, start: 0, end: st.title?.duration ?? 3, text: t.title, position: st.title?.position }] : []);
  const byId = Object.fromEntries(vis.map((c) => [c.id, c]));
  return (
    <AbsoluteFill style={{ backgroundColor: t.canvas?.background || '#0b0b0f' }}>
      {shared ? <Backdrop kind={st.backdrop} accent={accent} palette={st.palette} L={L} /> : null}
      <Held fx={st.fx} L={L}>
      {vis.map((c, i) => {
        const tr = i === 0 ? (c.transition ?? { type: 'fade' as const, duration: 0.35 }) : (c.transition ?? trFor(i));
        const lead = i === 0 ? 0 : transitionLen(tr);
        const from = Math.max(0, Math.round((c.start - lead) * fps));
        const next = vis[i + 1];
        // A clip holds until the next one has fully come in (gaps never show black).
        const capped = next ? Math.round(next.start * fps) + 2 : durationInFrames;
        return (
          <Sequence key={c.id || i} from={from} durationInFrames={Math.max(1, capped - from)}>
            <VisualLayer c={{ ...c, transition: tr }} index={i} len={(capped - from) / fps} L={L} pid={pid} accent={accent}
              motion={st.motion || 'kenburns'} grade={st.grade} nearImage={c.kind === 'graphic' ? nearestImage(vis, i, pid) : undefined}
              graphicSfx={(st as { graphic_sfx?: boolean }).graphic_sfx} sharedBackdrop={shared} />
          </Sequence>
        );
      })}
      </Held>
      <Finish fx={st.fx} L={L} />
      {st.vignette !== false ? (
        <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.65) 100%)' }} />
      ) : null}
      {t.tracks.captions?.enabled !== false ? (
        <Captions words={words} style={{ ...(st.caption || {}), ...(t.tracks.captions?.style || {}) }} accent={accent} L={L} />
      ) : null}
      {overlays.map((o) => (
        <Sequence key={o.id} from={Math.round(o.start * fps)} durationInFrames={Math.max(1, Math.round((o.end - o.start) * fps))}>
          <Overlay o={o} L={L} accent={accent} pid={pid} displayFont={st.title?.font || st.font} />
        </Sequence>
      ))}
      {st.progress_bar !== false ? <Progress accent={accent} L={L} /> : null}
      {(t.tracks.voice || []).map((a) => <AudioTrack key={a.id} a={a} pid={pid} total={total} />)}
      {(t.tracks.music || []).map((a) => (
        <AudioTrack key={a.id} a={{ fade_out: 1, ...a }} pid={pid} total={total} words={words} />
      ))}
      {(t.tracks.sfx || []).map((s) => {
        const at = s.anchor && byId[s.anchor] ? byId[s.anchor].start + (s.offset || 0) : s.at;
        if (!(at >= 0) || at >= total) return null;
        return (
          <Sequence key={s.id} from={Math.round(at * fps)}>
            <Audio src={url(s.src, pid)} volume={s.volume ?? 0.3} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
