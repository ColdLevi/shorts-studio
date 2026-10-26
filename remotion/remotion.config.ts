import { Config } from '@remotion/cli/config';

// ../media is Remotion's public root: staticFile('library/logos/x') →
// ../media/library/x (reusable), staticFile('projects/<proj>/x') → ../media/projects/... (per-video).
Config.setPublicDir('../media');

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(null); // auto

// Remotion effects (@remotion/effects) are WebGL2: SwiftShader runs them on CPU-only machines like GitHub runners.
Config.setChromiumOpenGlRenderer('swangle');
