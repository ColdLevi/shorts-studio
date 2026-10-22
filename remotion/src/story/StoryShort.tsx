// Generic, data-driven vertical short. The Telegram bot sends a spec, tools/build_short.py turns it
// into props (voice, word timings, one image per beat) and this composition renders it.
import React from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing, CalculateMetadataFunction,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';
import { Graphic, GraphicBeat } from './graphics';

const { fontFamily } = loadFont('normal', { weights: ['800', '900'], subsets: ['latin'] });

export type Word = { word: string; start: number; end: number };
export type Beat = { image: string; start: number; end: number; text?: string; video?: string; videoDuration?: number; pixel?: boolean; graphic?: Graphic };
export type StoryProps = {
  title: string;
  audio: string;
  music?: string;
  musicVolume?: number;
  accent?: string;
  duration: number;
  beats: Beat[];
  words: Word[];
};

export const defaultStoryProps: StoryProps = {
  title: 'Preview', audio: '', duration: 5, beats: [], words: [],
};

export const calculateStoryMetadata: CalculateMetadataFunction<StoryProps> = ({ props }) => ({
  durationInFrames: Math.max(30, Math.ceil((props.duration || 5) * 30)),
  fps: 30, width: 1080, height: 1920,
});

const FADE = 0.35;

// The closest beat that has a real picture: blurred behind a graphic beat for continuity.
const nearImage = (beats: Beat[], i: number) => {
  for (let d = 1; d < beats.length; d++) {
    for (const j of [i - d, i + d]) if (beats[j] && !beats[j].graphic && beats[j].image) return beats[j].image;
  }
  return undefined;
};

const BeatImage: React.FC<{ beat: Beat; index: number; len: number }> = ({ beat, index, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const p = Math.min(1, t / Math.max(0.5, len));
  const zoomIn = index % 2 === 0;
  const scale = zoomIn ? 1.04 + 0.14 * p : 1.18 - 0.14 * p;
  const dir = index % 4 < 2 ? 1 : -1;
  const x = dir * interpolate(p, [0, 1], [-30, 30]);
  const opacity = interpolate(t, [0, FADE], [0, 1], { extrapolateRight: 'clamp' });
  if (beat.video) {
    // Motion clip from Higgsfield: slow it slightly if it is shorter than the beat, never speed it up.
    const rate = Math.max(0.6, Math.min(1, (beat.videoDuration || len) / Math.max(0.5, len)));
    return (
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo src={staticFile(beat.video)} muted playbackRate={rate}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.02 + 0.04 * p})` }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={staticFile(beat.image)} style={{ imageRendering: beat.pixel ? 'pixelated' : 'auto',
        width: '100%', height: '100%', objectFit: 'cover',
        transform: `scale(${scale}) translateX(${x}px)`,
      }} />
    </AbsoluteFill>
  );
};

function groupWords(words: Word[]): Word[][] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    const punct = /[.,!?;:]$/.test(w.word);
    if (cur.length >= 3 || punct) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const Captions: React.FC<{ words: Word[]; accent: string }> = ({ words, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const groups = React.useMemo(() => groupWords(words), [words]);
  const g = groups.find((gr, i) => {
    const next = groups[i + 1];
    return t >= gr[0].start - 0.05 && t < (next ? next[0].start - 0.05 : gr[gr.length - 1].end + 0.6);
  });
  if (!g) return null;
  const startF = Math.round((g[0].start - 0.05) * fps);
  const pop = spring({ frame: frame - startF, fps, config: { damping: 14, stiffness: 220 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', top: '60%' }}>
      <div style={{
        transform: `scale(${0.85 + 0.15 * pop})`, textAlign: 'center', padding: '0 70px',
        fontFamily, fontWeight: 900, fontSize: 92, lineHeight: 1.08, letterSpacing: -1,
        textTransform: 'uppercase', color: 'white',
        textShadow: '0 6px 0 rgba(0,0,0,0.85), 0 0 24px rgba(0,0,0,0.7)',
        WebkitTextStroke: '3px black', paintOrder: 'stroke fill',
      }}>
        {g.map((w, i) => {
          const active = t >= w.start - 0.03 && t < w.end + 0.08;
          return (
            <span key={i} style={{ color: active ? accent : 'white', marginRight: 22, display: 'inline-block' }}>
              {w.word.replace(/[.,;:]$/, '')}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ title: string; accent: string }> = ({ title, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inP = spring({ frame, fps, config: { damping: 16 } });
  const out = interpolate(frame, [2.4 * fps, 2.9 * fps], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', top: 210, opacity: out }}>
      <div style={{
        transform: `translateY(${(1 - inP) * -60}px)`, background: accent, color: '#111',
        fontFamily, fontWeight: 900, fontSize: 64, lineHeight: 1.1, textAlign: 'center',
        padding: '22px 36px', borderRadius: 18, maxWidth: 920, textTransform: 'uppercase',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      }}>{title}</div>
    </AbsoluteFill>
  );
};

const Progress: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 0, left: 0, height: 10, background: accent,
        width: `${(frame / durationInFrames) * 100}%`, opacity: 0.9 }} />
    </AbsoluteFill>
  );
};

export const StoryShort: React.FC<StoryProps> = (p) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const accent = p.accent || '#FFD43B';
  const musicVol = p.musicVolume ?? 0.1;
  const fadeOut = interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad),
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0b0f' }}>
      {p.beats.map((b, i) => {
        const from = Math.max(0, Math.round((i === 0 ? 0 : b.start - FADE) * fps));
        const next = p.beats[i + 1];
        const to = next ? Math.round(next.start * fps) + 2 : durationInFrames;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, to - from)}>
            {b.graphic
              ? <GraphicBeat g={b.graphic} accent={accent} len={(to - from) / fps} image={nearImage(p.beats, i)} />
              : <BeatImage beat={b} index={i} len={(to - from) / fps} />}
          </Sequence>
        );
      })}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.65) 100%)' }} />
      <Captions words={p.words} accent={accent} />
      <Sequence durationInFrames={Math.round(3 * fps)}><TitleCard title={p.title} accent={accent} /></Sequence>
      <Progress accent={accent} />
      {p.audio ? <Audio src={staticFile(p.audio)} /> : null}
      {p.music ? <Audio src={staticFile(p.music)} loop volume={musicVol * fadeOut} /> : null}
    </AbsoluteFill>
  );
};
