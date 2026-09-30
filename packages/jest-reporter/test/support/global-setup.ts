/**
 * Builds `@probara/core` (both its ES module and CommonJS builds: Jest loads the reporter, and
 * core through it, with `require`), `@probara/cli` and the reporter once before the tests: the
 * end-to-end tests run the real `jest`, which loads the built reporter, and the key parity test
 * runs the built `probara` bin. CI runs `pnpm test` before `pnpm build` on a fresh clone.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const TSC = createRequire(__filename).resolve('typescript/bin/tsc');
const PACKAGES = join(__dirname, '..', '..', '..');

function run(packageDir: string, args: readonly string[]): void {
  execFileSync(process.execPath, args, { cwd: join(PACKAGES, packageDir), stdio: 'inherit' });
}

export default function setup(): void {
  run('core', ['--experimental-strip-types', '--no-warnings', 'scripts/build.ts']);
  run('cli', [TSC, '-p', 'tsconfig.build.json']);
  run('jest-reporter', [TSC, '-p', 'tsconfig.build.json']);
}
