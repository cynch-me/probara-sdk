/**
 * `probara.attach()` in real Vitest: a file or a body while the test runs, after its body, a file removed
 * right after the call, a file over the limit, and a retried test whose attempts attach their own files.
 * The spec checks what reached the fake Probara, by name, type and content.
 */
import { rmSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { probara } from '@probara/vitest-reporter';
import { afterEach, describe, it, onTestFinished } from 'vitest';

const RECEIPT = fileURLToPath(new URL('../files/receipt.txt', import.meta.url));
const SCRATCH = fileURLToPath(new URL('../files/', import.meta.url));

it('attaches a file and two bodies while the test runs', () => {
  void probara.attach({ name: 'receipt', path: RECEIPT });
  void probara.attach({ name: 'order', body: '{"id":1042}', contentType: 'application/json' });
  void probara.attach({ name: 'log', body: 'paid in 1.2 s' });
});

describe('after the body', () => {
  afterEach(() => {
    void probara.attach({ name: 'after-each', body: 'written in afterEach' });
  });

  it('attaches in afterEach and in onTestFinished too', () => {
    onTestFinished(() => {
      void probara.attach({ name: 'on-finished', body: 'written in onTestFinished' });
    });
  });
});

it('keeps a file removed right after the call, with the content it had then', () => {
  const path = `${SCRATCH}vanishing.txt`;
  writeFileSync(path, 'gone before the reporter reads it');
  void probara.attach({ name: 'vanishing', path });
  unlinkSync(path);
});

it('leaves out a file over 32 MiB, with a warning, and passes', () => {
  const path = `${SCRATCH}huge.bin`;
  writeFileSync(path, '');
  truncateSync(path, 32 * 1024 * 1024 + 1);
  void probara.attach({ name: 'huge', path });
  rmSync(path);
});

let attempt = 0;

it('attaches each attempt of a retried test its own file', { retry: 1 }, () => {
  attempt += 1;
  void probara.attach({ name: `attempt-${attempt}`, body: `attempt ${attempt} of the test` });
  if (attempt === 1) throw new Error('the first attempt fails');
});
