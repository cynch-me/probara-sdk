/**
 * The pre-flight the end-to-end tests of this package run before a `cypress run`: the `cypress`
 * npm package is only the command line, and the app it drives is downloaded by an install script
 * of its own. A pnpm install that does not allow that script leaves the binary out, and every
 * `cypress run` then ends at once — which a suite of end-to-end tests sees as dozens of unrelated
 * failures instead of one reason.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CYPRESS_BIN, checkCypressBinary, probeBinary } from './cypress-binary.js';

/** What the real `cypress version` answers on a machine whose binary is installed. */
const INSTALLED = 'Cypress package version: 16.1.1\nCypress binary version: 16.1.1\n';
/** What it answers on one where it is not (measured, Cypress 16.1.1). */
const MISSING = 'Cypress package version: 16.1.1\nCypress binary version: not installed\n';

describe('the Cypress binary the end-to-end tests need', () => {
  it('says what to do when the binary is not installed', async () => {
    const problem = checkCypressBinary(() =>
      Promise.resolve({ exitCode: 0, stdout: MISSING, stderr: '' }),
    );

    // Both the setting that allows the install script and the command that gets the binary now:
    // a CI that cannot allow the script and a laptop that can both have to act.
    await expect(problem).rejects.toThrow(/onlyBuiltDependencies/);
    await expect(problem).rejects.toThrow(/cypress install/);
  });

  it('says nothing when Cypress answers with the binary it found', async () => {
    await expect(
      checkCypressBinary(() => Promise.resolve({ exitCode: 0, stdout: INSTALLED, stderr: '' })),
    ).resolves.toBeUndefined();
  });

  it('says what happened when the cypress command itself cannot be run', async () => {
    const problem = checkCypressBinary(() =>
      Promise.resolve({ exitCode: 1, stdout: '', stderr: 'spawn ENOENT' }),
    );

    await expect(problem).rejects.toThrow(/spawn ENOENT/);
  });

  it('asks Cypress itself, in the environment a run gets', async () => {
    // A cache folder of a fresh machine: Cypress looks for the app there and finds none. This is
    // the whole check, with the real command, and it needs nothing installed to say so.
    const cache = await mkdtemp(join(tmpdir(), 'probara-cypress-cache-'));
    try {
      const answer = await probeBinary({ CYPRESS_CACHE_FOLDER: cache });
      expect(answer.stdout).toContain('Cypress binary version: not installed');
      await expect(checkCypressBinary(() => Promise.resolve(answer))).rejects.toThrow(
        /The Cypress binary/,
      );
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it('is the cypress command this package is developed against', () => {
    expect(CYPRESS_BIN).toMatch(/cypress[/\\]bin[/\\]cypress$/);
  });
});
