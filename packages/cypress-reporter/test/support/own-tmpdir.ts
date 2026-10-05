/**
 * A temporary directory of its own for every test file, set before the file loads.
 *
 * The plugin side of a run finds its session directory through its parent's pid
 * (`sessionDir(process.ppid)`, in the system's temporary directory). Every test file runs in a
 * worker whose parent is the same Vitest process, so without this the test files that run at the
 * same time share one session directory: one file reads what another handed over, and the
 * `after:run` of one removes the directory another is still writing to. `os.tmpdir()` reads these
 * variables on every call, so pointing them at a directory of this file's own is enough.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const own = mkdtempSync(join(tmpdir(), 'probara-cypress-test-'));
for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = own;

afterAll(() => {
  rmSync(own, { recursive: true, force: true });
});
