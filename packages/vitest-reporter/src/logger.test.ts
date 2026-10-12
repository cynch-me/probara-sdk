import { describe, expect, it } from 'vitest';
import { probaraLogger } from './logger.js';

/** A sink that records each line with the channel it went to. */
function recorder() {
  const lines: { channel: 'warn' | 'error'; message: string }[] = [];
  return {
    lines,
    sink: {
      warn: (message: string) => lines.push({ channel: 'warn', message }),
      error: (message: string) => lines.push({ channel: 'error', message }),
    },
  };
}

describe('probaraLogger', () => {
  it('writes every line with the [probara] prefix on a stderr channel, errors on the error channel', () => {
    const { lines, sink } = recorder();
    const logger = probaraLogger(sink, false);
    logger.info('Sending 3 results');
    logger.warn('careful');
    logger.error('broken');
    expect(lines).toEqual([
      { channel: 'warn', message: '[probara] Sending 3 results' },
      { channel: 'warn', message: '[probara] careful' },
      { channel: 'error', message: '[probara] broken' },
    ]);
  });

  it('writes debug lines only when debug is on', () => {
    const quiet = recorder();
    probaraLogger(quiet.sink, false).debug('hidden');
    expect(quiet.lines).toEqual([]);
    const loud = recorder();
    probaraLogger(loud.sink, true).debug('shown');
    expect(loud.lines).toEqual([{ channel: 'warn', message: '[probara] shown' }]);
  });
});
