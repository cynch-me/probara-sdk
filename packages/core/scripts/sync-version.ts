/**
 * Writes `src/version.ts` from the `version` of `package.json`. Runs before every build
 * (`prebuild`); run it by hand with `pnpm --filter @probara/core sync-version` after a version
 * bump. `src/version.test.ts` fails when the committed file is out of sync.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderVersionModule } from './version-module.ts';

const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../src/version.ts', import.meta.url));

async function main(): Promise<void> {
  const { version } = JSON.parse(await readFile(MANIFEST, 'utf8')) as { version: unknown };
  const source = renderVersionModule(typeof version === 'string' ? version : '');
  const current = await readFile(OUTPUT, 'utf8').catch(() => undefined);
  if (current === source) return;
  await writeFile(OUTPUT, source);
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
