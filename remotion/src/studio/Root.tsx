import React from 'react';
import { Composition } from 'remotion';
import { StudioVideo, defaultTimeline, calculateStudioMetadata } from './StudioVideo';
import { StoryShort, defaultStoryProps, calculateStoryMetadata, StoryProps } from '../story/StoryShort';
import type { Timeline } from './types';

// "Studio" renders project timelines (any canvas). "StoryShort" stays for old props.json files.
export const StudioRoot: React.FC = () => (
  <>
    <Composition
      id="Studio"
      component={StudioVideo as unknown as React.FC<Record<string, unknown>>}
      defaultProps={defaultTimeline as unknown as Record<string, unknown>}
      calculateMetadata={calculateStudioMetadata as never}
      durationInFrames={120}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="StoryShort"
      component={StoryShort as React.FC<StoryProps>}
      defaultProps={defaultStoryProps}
      calculateMetadata={calculateStoryMetadata}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
export type { Timeline };
