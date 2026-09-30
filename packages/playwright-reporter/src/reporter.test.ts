import type { Logger } from '@probara/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeConfig } from '../test/support/playwright-fakes.js';
import ProbaraPlaywrightReporter, { type ProbaraPlaywrightOptions } from './index.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

afterEach(() => {
  vi.restoreAllMocks();
});

function capturingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  return { logger, lines, above: () => lines.filter((line) => !line.startsWith('debug: ')) };
}

async function runEmpty(options: ProbaraPlaywrightOptions) {
  const reporter = new ProbaraPlaywrightReporter(options);
  reporter.onBegin(fakeConfig());
  return reporter.onEnd();
}

describe('ProbaraPlaywrightReporter lifecycle', () => {
  it('prints nothing of its own to stdio, so Playwright keeps its terminal reporter', () => {
    expect(new ProbaraPlaywrightReporter().printsToStdio()).toBe(false);
  });

  it('stays quiet when reporting is not configured', async () => {
    const log = capturingLogger();
    await expect(runEmpty({ env: {}, logger: log.logger })).resolves.toBeUndefined();
    expect(log.above()).toEqual([]);
  });

  it('logs each configuration problem on stderr, never on stdout, and never throws', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runEmpty({ env: { PROBARA_API_TOKEN: TOKEN } })).resolves.toBeUndefined();

    expect(stderr.mock.calls.flat()).toEqual([
      expect.stringMatching(/^\[probara\] Probara reporting is off: .*PROBARA_PROJECT/),
    ]);
    expect(stdout).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(TOKEN);
  });

  it('turns reporting off on a PROBARA_CAPTURE_OUTPUT that is not a boolean, naming it', async () => {
    const log = capturingLogger();
    await runEmpty({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_CAPTURE_OUTPUT: 'verbose' },
      logger: log.logger,
    });
    expect(log.above()).toEqual([
      'error: Probara reporting is off: PROBARA_CAPTURE_OUTPUT must be true or false',
    ]);
  });

  it('turns reporting off on a captureOutput option that is not a boolean', async () => {
    const log = capturingLogger();
    await runEmpty({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB' },
      captureOutput: 'yes' as unknown as boolean,
      logger: log.logger,
    });
    expect(log.above()).toEqual([
      'error: Probara reporting is off: captureOutput must be true or false',
    ]);
  });

  it('never throws into Playwright, even on options that are not an object', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = new ProbaraPlaywrightReporter(null as unknown as ProbaraPlaywrightOptions);
    expect(() => {
      reporter.onBegin(fakeConfig());
    }).not.toThrow();
    await expect(reporter.onEnd()).resolves.toBeUndefined();
  });

  it('ends quietly when Playwright never began the run', async () => {
    await expect(new ProbaraPlaywrightReporter().onEnd()).resolves.toBeUndefined();
  });
});
