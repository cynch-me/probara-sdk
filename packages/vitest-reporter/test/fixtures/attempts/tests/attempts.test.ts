import { expect, it } from 'vitest';

/**
 * A test body that throws on the calls `fails` names, with the test's own label in the message: each
 * test counts its own calls, so the attempts of one test never see the calls of another.
 */
function callsWhere(fails: (call: number) => boolean, label: string): () => void {
  let calls = 0;
  return () => {
    calls += 1;
    if (fails(calls)) throw new Error(`${label}: call ${String(calls)} fails`);
  };
}

it('plain passes', () => {
  expect(Reflect.get(globalThis, 'probaraUserSetup')).toBe(true);
});

it('passes on its second attempt', { retry: 1 }, callsWhere((call) => call === 1, 'passes on its second attempt'));

it('fails on every attempt', { retry: 2 }, callsWhere(() => true, 'fails on every attempt'));

// Each repeat runs its own retry loop: the first call of each repeat fails, the second passes.
it('repeats, and retries each repeat', { repeats: 2, retry: 1 }, callsWhere((call) => call % 2 === 1, 'repeats, and retries each repeat'));

it.concurrent('concurrent passes on its second attempt', { retry: 1 }, callsWhere((call) => call === 1, 'concurrent passes on its second attempt'));

it.concurrent('concurrent passes first', callsWhere(() => false, 'concurrent passes first'));

// A body that passes under `fails` fails the test, and Vitest does not retry it: one call on every
// major (probed on 3.2.7, 4.1.11 and 5.0.2), so the test has one execution, failed.
it.fails('is a known bug kept failing', () => {
  expect(1).toBe(1);
});
