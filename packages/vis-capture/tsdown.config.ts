import { defineConfig } from 'tsdown';

// The builds, all for browsers:
// - `dist/index.js` and `dist/replay.js`, with their types: the ES modules npm users import.
//   `replay.js` is the `./replay` entry, the only one that imports rrweb's recorder
//   (`@rrweb/record`), so a page that records no replay never loads it; the recorder stays a
//   dependency there, resolved by the user's bundler;
// - `dist/vis-capture.iife.js`: one minified file for a script tag, which sets the global
//   `ProbaraVisCapture`;
// - `dist/vis-capture-replay.iife.js`: the replay entry with the recorder bundled in, which sets the
//   global `ProbaraVisCaptureReplay`. It opens with a banner naming what it bundles; the licence
//   notices are in THIRD_PARTY_NOTICES.md, which the package publishes.

/** The banner of the replay script: the third-party code it bundles and where its notices are. */
const REPLAY_BANNER =
  '/*! @probara/vis-capture replay script (Apache-2.0). Bundles the recorder of rrweb (MIT, ' +
  'Copyright (c) 2018 Contributors and SmartX Inc.) with base64-arraybuffer (MIT). Their licence ' +
  'notices are in THIRD_PARTY_NOTICES.md of the @probara/vis-capture package. */';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', replay: 'src/replay.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: true,
    outDir: 'dist',
    clean: true,
  },
  {
    entry: { 'vis-capture': 'src/index.ts' },
    format: 'iife',
    globalName: 'ProbaraVisCapture',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: false,
    minify: true,
    sourcemap: true,
    outDir: 'dist',
    clean: false,
  },
  {
    entry: { 'vis-capture-replay': 'src/replay.ts' },
    format: 'iife',
    globalName: 'ProbaraVisCaptureReplay',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: false,
    minify: true,
    sourcemap: true,
    outDir: 'dist',
    clean: false,
    banner: REPLAY_BANNER,
    deps: {
      alwaysBundle: ['@rrweb/record', '@rrweb/types'],
      onlyBundle: ['@rrweb/record', '@rrweb/types'],
    },
  },
]);
