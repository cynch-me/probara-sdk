/**
 * `probara.*` for a test that runs in a browser (the `browser` condition of the package's entry): the
 * same helpers, without any Node module. A browser test runs one test at a time, so the steps nest on
 * a stack of the running ones; a step started inside an async body that outlives its synchronous part
 * is not nested under its parent. Without a reporter's slot in the browser, every helper does nothing.
 */
import { currentTestSlot } from './current-test-slot.js';
import { createProbaraHelpers, type Probara, type StepScope } from './probara-helpers.js';

export type {
  Probara,
  ProbaraAttachment,
  ProbaraStepOptions,
  ProbaraValues,
} from './probara-helpers.js';

/** The steps running now, innermost last. */
const running: StepScope[] = [];

/** Ids unique within an attempt: a counter, since the browser has no UUID everywhere. */
let counter = 0;

/** The helpers of the running browser test. */
export const probara: Probara = createProbaraHelpers({
  active: () => currentTestSlot() !== undefined,
  current: () => currentTestSlot()?.current(),
  steps: {
    get: () => running.at(-1),
    run: (scope, body) => {
      running.push(scope);
      try {
        return body();
      } finally {
        running.pop();
      }
    },
  },
  now: () => performance.now(),
  newId: () => String((counter += 1)),
});
