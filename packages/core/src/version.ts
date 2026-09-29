import { createRequire } from 'node:module';

// `../package.json` resolves from both `src/` and `dist/`, and the manifest ships with the package.
const manifest = createRequire(import.meta.url)('../package.json') as { version: string };

/** The version of `@probara/core`, sent in the User-Agent. */
export const VERSION: string = manifest.version;
