import React from 'react';
import { Composition } from 'remotion';
import { StoryShort, defaultStoryProps, calculateStoryMetadata, StoryProps } from './StoryShort';

export const StoryRoot: React.FC = () => (
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
);
