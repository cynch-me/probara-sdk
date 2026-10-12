/**
 * What a test writes to the console, in real Vitest: stdout and stderr of a test, of its hooks, and of each attempt
 * of a retried test; output written while the file loads, which no test owns, is not attached. Vitest prints it all.
 */
import { afterEach, beforeEach, describe, it } from 'vitest';

console.log('written while the file loads: no test is running');

describe('a test', () => {
  it('writes to stdout and to stderr', () => {
    console.log('hello stdout');
    console.info('info line');
    console.debug('debug line');
    console.warn('careful');
    console.error('boom');
  });
});

describe('the hooks of a test', () => {
  beforeEach(() => {
    console.log('before each');
  });

  afterEach(() => {
    console.warn('after each');
  });

  it('keeps the output of its hooks too', () => {
    console.log('in the body');
  });
});

let attempt = 0;

it('keeps the output of each attempt of a retried test', { retry: 1 }, () => {
  attempt += 1;
  console.log(`attempt ${attempt} writes`);
  if (attempt === 1) throw new Error('the first attempt fails');
});

it('writes nothing', () => {});

// Concurrent tests share one worker: Vitest attributes each write to the test that is current, which is not always
// the one that wrote it. Their output is left out, as the Jest reporter leaves it out (V-D9).
describe.concurrent('concurrent tests', () => {
  it('writes while another one runs', async () => {
    console.log('first concurrent writes');
    await new Promise((resolve) => setTimeout(resolve, 30));
    console.log('first concurrent ends');
  });

  it('writes too', async () => {
    console.log('second concurrent writes');
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

it.concurrent('a concurrent test on its own', async () => {
  console.log('alone and concurrent');
  await new Promise((resolve) => setTimeout(resolve, 10));
});
