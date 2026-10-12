import { describe, expect, it } from 'vitest';
import { keepsCopiesOf } from './run-reporters.js';

describe('keepsCopiesOf', () => {
  it('lets a run delete its attachment copies when every reporter is one Vitest ships and none writes a blob', () => {
    expect(keepsCopiesOf(['default', ['@probara/vitest-reporter', {}]])).toBe(false);
    expect(keepsCopiesOf(['verbose', 'junit', 'json', ['@probara/vitest-reporter', {}]])).toBe(
      false,
    );
  });

  it('keeps the copies when a reporter writes a blob, by its name alone or with options', () => {
    expect(keepsCopiesOf(['blob', ['@probara/vitest-reporter', {}]])).toBe(true);
    expect(keepsCopiesOf(['default', ['blob', { outputFile: 'shard.json' }]])).toBe(true);
  });

  it('keeps the copies for a reporter it cannot recognize: an instance, a module path or an unknown name', () => {
    expect(keepsCopiesOf(['default', { onTestRunEnd() {} }])).toBe(true);
    expect(keepsCopiesOf(['default', './reporters/custom.mjs'])).toBe(true);
    expect(keepsCopiesOf(['default', 'some-blob-writer'])).toBe(true);
  });

  it('keeps the copies when the reporters are not a list', () => {
    expect(keepsCopiesOf(undefined)).toBe(true);
    expect(keepsCopiesOf('default')).toBe(true);
  });
});
