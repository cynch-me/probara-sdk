/**
 * `probara.*` for a test that runs in a browser (the `browser` condition of the package's entry): the
 * same helpers, without any Node module. A browser test runs one test at a time, so the steps nest on
 * a stack of the running ones; a step started inside an async body that outlives its synchronous part
 * is not nested under its parent. Without a reporter's slot in the browser, every helper does nothing.
 * A file of `probara.attach()` is copied by the `probaraAttach` command, which the browser setup installs (V10).
 */
import { ATTACH_COMMAND, browserCommandOf, type BrowserAttachRequest } from './browser-commands.js';
import { currentTestSlot } from './current-test-slot.js';
import {
  createProbaraHelpers,
  type Probara,
  type StageInput,
  type StageOutcome,
  type StepScope,
} from './probara-helpers.js';
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

/** The bytes of a view as base64, in chunks, so a large file does not overflow the call stack. */
function base64Of(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** The request the `probaraAttach` command takes for a body: its text as it is, or its bytes in base64. */
function bodyRequestOf(body: string | ArrayBufferView): BrowserAttachRequest {
  return typeof body === 'string'
    ? { body, encoding: 'text' }
    : { body: base64Of(body), encoding: 'base64' };
}

/**
 * Copies a file, or sends a body, to the Node side: the `probaraAttach` command of this browser run. Without the browser
 * setup there is no command, and no folder: the helper says so, as it does for a run without an attachments folder.
 */
function stageInBrowser(input: StageInput): Promise<StageOutcome | undefined> {
  const attach = browserCommandOf(ATTACH_COMMAND);
  if (attach === undefined) return Promise.resolve(undefined);
  const request: BrowserAttachRequest =
    'path' in input ? { path: input.path } : bodyRequestOf(input.body);
  return attach(request).then((result) => (result === null ? undefined : (result as StageOutcome)));
}

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
  stage: stageInBrowser,
});
