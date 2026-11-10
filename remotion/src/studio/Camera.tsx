// Camera.tsx: the virtual camera rig for a picture. One layer, or two when the subject has a cutout (2.5D depth:
// the far picture moves a little less than the subject, so the frame has parallax). Poses come from camera-math.ts.
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { baseScale, pose, poseTransform } from './camera-math';
import type { Cam } from './camera-math';

export const CamStack: React.FC<{ cam: Cam; p: number; seed: number; W: number; H: number; u: number; fg?: React.ReactNode; children: React.ReactNode }> =
  ({ cam, p, seed, W, H, u, fg, children }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const po = pose(cam, p, frame, fps, seed);
    const base = baseScale(cam);
    return (
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <AbsoluteFill style={{ transform: poseTransform(po, base, W, H, fg ? 0.75 : 1, fg ? 0.8 : 1), transformOrigin: '50% 50%', filter: fg ? `blur(${(3 * u).toFixed(2)}px)` : undefined }}>
          {children}
        </AbsoluteFill>
        {fg ? <AbsoluteFill style={{ transform: poseTransform(po, base, W, H, 1, 1), transformOrigin: '50% 50%' }}>{fg}</AbsoluteFill> : null}
      </AbsoluteFill>
    );
  };
