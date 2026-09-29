import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleLogger, redact, silentLogger } from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function spyConsole() {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
}

describe('createConsoleLogger', () => {
  it('prefixes messages and routes them by level', () => {
    const spies = spyConsole();
    const logger = createConsoleLogger({ debug: true });
    logger.debug('sending');
    logger.info('recorded 3 results');
    logger.warn('retrying');
    logger.error('gave up');
    expect(spies.debug).toHaveBeenCalledWith('[probara] sending');
    expect(spies.log).toHaveBeenCalledWith('[probara] recorded 3 results');
    expect(spies.warn).toHaveBeenCalledWith('[probara] retrying');
    expect(spies.error).toHaveBeenCalledWith('[probara] gave up');
  });

  it('drops debug messages unless debug is on', () => {
    const spies = spyConsole();
    const logger = createConsoleLogger({ debug: false });
    logger.debug('sending');
    logger.info('done');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.log).not.toHaveBeenCalledWith('[probara] sending');
    expect(spies.log).toHaveBeenCalledWith('[probara] done');
  });
});

describe('silentLogger', () => {
  it('writes nothing', () => {
    const spies = spyConsole();
    silentLogger.debug('a');
    silentLogger.info('b');
    silentLogger.warn('c');
    silentLogger.error('d');
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });
});

describe('redact', () => {
  it('replaces every occurrence of every secret', () => {
    expect(redact('token probara_abc in probara_abc and key k9', ['probara_abc', 'k9'])).toBe(
      'token [redacted] in [redacted] and key [redacted]',
    );
  });

  it('ignores empty secrets and leaves other text alone', () => {
    expect(redact('nothing secret', ['', 'absent'])).toBe('nothing secret');
  });
});
