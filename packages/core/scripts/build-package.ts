/** Builds `@probara/core` into a `dist` folder (run by `build.ts`, and by the tests of the build). */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

function compile(project: string, outDir: string): void {
  execFileSync(process.execPath, [TSC, '-p', project, '--outDir', outDir], {
    cwd: PACKAGE_DIR,
    stdio: 'inherit',
  });
}

/**
 * Compiles the sources into `outDir`: the ES modules and their declarations, and the same as
 * CommonJS in `outDir/cjs/`, which a `package.json` of its own marks as CommonJS (the package is
 * `"type": "module"`).
 */
export function buildPackage(outDir: string): void {
  compile('tsconfig.build.json', outDir);
  const cjs = join(outDir, 'cjs');
  compile('tsconfig.cjs.json', cjs);
  writeFileSync(join(cjs, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
}
