/**
 * The notices of a process (V-D122): a notice is logged once, whichever copy of the reporter asks for it, and a notice
 * asked for with no logger is kept for the next call that has one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noticeOnce } from './notices.js';

/** The key of the notices on `globalThis` (`notices.ts`). */
const NOTICES = Symbol.for('@probara/vitest-reporter/notices/v1');
const holder = globalThis as unknown as Record<symbol, unknown>;

/** A logger that records the warnings it is given, and ignores the rest. */
function recorder() {
  const warnings: string[] = [];
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
    warn: (message: string) => warnings.push(message),
  };
  return { warnings, logger };
}

const NOTICE =
  'Vite 5.0.0 has no isFileLoadingAllowed (it arrived in 5.4): the browser attach follows its isFileServingAllowed';

describe('noticeOnce', () => {
  beforeEach(() => {
    holder[NOTICES] = undefined;
  });

  afterEach(() => {
    holder[NOTICES] = undefined;
  });

  it('logs a notice once per process, however many runs ask for it', () => {
    const first = recorder();
    const second = recorder();
    noticeOnce(NOTICE, first.logger);
    noticeOnce(NOTICE, second.logger);
    expect(first.warnings).toEqual([NOTICE]);
    expect(second.warnings).toEqual([]);
  });

  it('keeps a notice asked for with no logger, so the next call that has one logs it', () => {
    const later = recorder();
    noticeOnce(NOTICE, undefined);
    noticeOnce(NOTICE, later.logger);
    expect(later.warnings).toEqual([NOTICE]);
  });
});
