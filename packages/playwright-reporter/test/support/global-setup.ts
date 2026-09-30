/**
 * Builds `@probara/core`, `@probara/cli` and the reporter once before the tests: the end-to-end
 * tests run the real `playwright test`, which loads the built reporter (and core through it), and
 * the key compatibility test runs the built `probara` bin. CI runs `pnpm test` before `pnpm build`
 * on a fresh clone.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');

function build(packageDir: URL): void {
  execFileSync(process.execPath, [TSC, '-p', 'tsconfig.build.json'], {
    cwd: fileURLToPath(packageDir),
    stdio: 'inherit',
  });
}

export default function setup(): void {
  build(new URL('../../../core/', import.meta.url));
  build(new URL('../../../cli/', import.meta.url));
  build(new URL('../../', import.meta.url));
}
