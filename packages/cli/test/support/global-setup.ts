/**
 * Builds `@probara/core`, then the CLI, once before the tests: the smoke tests spawn the built bin,
 * and CI runs `pnpm test` before `pnpm build` on a fresh clone.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
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
  build(new URL('../../', import.meta.url));
  // What `postbuild` does after a real build.
  chmodSync(fileURLToPath(new URL('../../dist/cli.js', import.meta.url)), 0o755);
}
