/**
 * `probara.*`, the helpers of a Vitest test in Node (V-D11): `import { probara } from '@probara/vitest-reporter'`.
 * The steps nest through an AsyncLocalStorage, shared by every copy of the helpers in the process, and
 * the clock is `performance` of Node. The helpers themselves are in `probara-helpers.ts`. This module
 * never imports Vitest: the reporter process loads it too.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { stageFile } from './attachment-files.js';
import { currentTestSlot } from './current-test-slot.js';
import { filesDirOf } from './files-slot.js';
import { createProbaraHelpers, type Probara, type StepScope } from './probara-helpers.js';

export type {
  Probara,
  ProbaraAttachment,
  ProbaraStepOptions,
  ProbaraValues,
} from './probara-helpers.js';

/** The key of the step context on Node's `AsyncLocalStorage` class: one storage per process. */
const STEPS_KEY = Symbol.for('@probara/vitest-reporter/steps/v1');

/** The step context of this process, created by the first copy of the helpers that needs it. */
function stepStorage(): AsyncLocalStorage<StepScope> {
  const holder = AsyncLocalStorage as unknown as Record<symbol, unknown>;
  const shared = holder[STEPS_KEY];
  if (shared instanceof AsyncLocalStorage) return shared as AsyncLocalStorage<StepScope>;
  const created = new AsyncLocalStorage<StepScope>();
  try {
    Object.defineProperty(holder, STEPS_KEY, { value: created });
  } catch {
    // A frozen class: this copy keeps its own.
  }
  return created;
}

const steps = stepStorage();

/** The helpers of the running test: `import { probara } from '@probara/vitest-reporter'`. */
export const probara: Probara = createProbaraHelpers({
  active: () => currentTestSlot() !== undefined,
  current: () => currentTestSlot()?.current(),
  steps: {
    get: () => steps.getStore(),
    run: (scope, body) => steps.run(scope, body),
  },
  now: () => performance.now(),
  newId: () => randomUUID(),
  stage: (input) => {
    const dir = filesDirOf();
    return dir === undefined ? undefined : stageFile(dir, input);
  },
});
