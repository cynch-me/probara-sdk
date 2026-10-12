import type { ChannelLine } from '@probara/core';
import { describe, expect, it } from 'vitest';
import {
  beginAttempt,
  endAttempt,
  executionsOf,
  type EndedTest,
  type ProbaraTaskMeta,
  type RecordedAttempt,
  type UserAnnotation,
} from './attempts.js';

describe('beginAttempt', () => {
  it('records the first attempt of a test from its start, before any error', () => {
    const meta: ProbaraTaskMeta = {};
    beginAttempt(meta, { errors: [] }, { epochMs: 1_000, perfMs: 10 });
    expect(meta.attempts).toEqual([
      { repeat: 0, retry: 0, startedAt: 1_000, startedMs: 10, errorsFrom: 0 },
    ]);
  });

  it('closes the attempt before with its own errors, and opens the next one after them', () => {
    const meta: ProbaraTaskMeta = {};
    const result = {
      repeatCount: 0,
      errors: [] as { message?: unknown; stack?: unknown; expected?: unknown }[],
    };
    beginAttempt(meta, result, { epochMs: 1_000, perfMs: 10 });
    // Vitest's own error objects carry more than the message and the stack: only those are kept.
    result.errors.push({ message: 'first failure', stack: 'at first', expected: 2 });
    beginAttempt(meta, result, { epochMs: 2_000, perfMs: 30 });
    expect(meta.attempts).toEqual([
      {
        repeat: 0,
        retry: 0,
        startedAt: 1_000,
        startedMs: 10,
        errorsFrom: 0,
        errors: [{ message: 'first failure', stack: 'at first' }],
      },
      { repeat: 0, retry: 1, startedAt: 2_000, startedMs: 30, errorsFrom: 1 },
    ]);
  });

  it('restarts the retry count in every repeat, and numbers the repeats', () => {
    const meta: ProbaraTaskMeta = {};
    const result = { repeatCount: 0, errors: [] };
    beginAttempt(meta, result, { epochMs: 1, perfMs: 1 });
    beginAttempt(meta, result, { epochMs: 2, perfMs: 2 });
    result.repeatCount = 1;
    beginAttempt(meta, result, { epochMs: 3, perfMs: 3 });
    expect(meta.attempts?.map(({ repeat, retry }) => [repeat, retry])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });
});

describe('endAttempt', () => {
  it('measures the current attempt from its start, and leaves the attempts before it as they were', () => {
    const meta: ProbaraTaskMeta = {};
    beginAttempt(meta, { errors: [] }, { epochMs: 1_000, perfMs: 10 });
    endAttempt(meta, { perfMs: 25 });
    beginAttempt(meta, { errors: [] }, { epochMs: 2_000, perfMs: 40 });
    endAttempt(meta, { perfMs: 41 });
    expect(meta.attempts?.map((attempt) => attempt.durationMs)).toEqual([15, 1]);
  });

  it('does nothing before the first attempt', () => {
    const meta: ProbaraTaskMeta = {};
    endAttempt(meta, { perfMs: 5 });
    expect(meta).toEqual({});
  });
});

describe('executionsOf', () => {
  /** A test as Vitest reports it once it ended: passed, with no error, unless the test says otherwise. */
  const ended = (overrides: Partial<EndedTest> = {}): EndedTest => ({
    state: 'passed',
    errors: [],
    retryCount: 0,
    repeatCount: 0,
    durationMs: 9,
    startedAt: 500,
    ...overrides,
  });

  it('is one execution, the result the test ended with, when no attempt was recorded', () => {
    expect(
      executionsOf(undefined, ended({ state: 'failed', errors: [{ message: 'boom' }] })),
    ).toEqual({
      executions: [
        {
          repeat: 0,
          retry: 0,
          state: 'failed',
          errors: [{ message: 'boom' }],
          durationMs: 9,
          startedAt: 500,
          files: [],
        },
      ],
      unrecorded: false,
      dropped: 0,
      droppedOutput: 0,
    });
  });

  it('flags a test that was retried or repeated when none of its attempts was recorded', () => {
    expect(executionsOf(undefined, ended({ retryCount: 1 })).unrecorded).toBe(true);
    expect(executionsOf(undefined, ended({ repeatCount: 2 })).unrecorded).toBe(true);
  });

  it('keeps the helper lines of an unrecorded test only when they were written in its final try', () => {
    const lines: ChannelLine[] = [{ type: 'warning', message: 'written in the final try' }];
    const finalTry = executionsOf(
      undefined,
      ended({ retryCount: 1, lines, linesTry: { repeat: 0, retry: 1 } }),
    );
    expect(finalTry.executions[0]?.lines).toEqual(lines);
    // A failed first try's lines are not the final execution's: a passing retry never carries them.
    const earlierTry = executionsOf(
      undefined,
      ended({ retryCount: 1, lines, linesTry: { repeat: 0, retry: 0 } }),
    );
    expect(earlierTry.executions[0]?.lines).toBeUndefined();
  });

  it('gives each attempt before the last one a result of its own, failed when it ended with errors', () => {
    const recorded: RecordedAttempt[] = [
      {
        repeat: 0,
        retry: 0,
        startedAt: 100,
        startedMs: 0,
        durationMs: 4,
        errorsFrom: 0,
        errors: [{ message: 'first' }],
      },
      { repeat: 0, retry: 1, startedAt: 200, startedMs: 0, durationMs: 6, errorsFrom: 1 },
    ];
    expect(
      executionsOf(recorded, ended({ retryCount: 1, errors: [{ message: 'first' }] })),
    ).toEqual({
      executions: [
        {
          repeat: 0,
          retry: 0,
          state: 'failed',
          errors: [{ message: 'first' }],
          durationMs: 4,
          startedAt: 100,
          files: [],
        },
        {
          repeat: 0,
          retry: 1,
          state: 'passed',
          errors: [],
          durationMs: 6,
          startedAt: 200,
          files: [],
        },
      ],
      unrecorded: false,
      dropped: 0,
      droppedOutput: 0,
    });
  });

  it('gives the last attempt its own errors, not those of the attempts before it', () => {
    const recorded: RecordedAttempt[] = [
      {
        repeat: 0,
        retry: 0,
        startedAt: 1,
        startedMs: 0,
        durationMs: 1,
        errorsFrom: 0,
        errors: [{ message: 'first' }],
      },
      { repeat: 0, retry: 1, startedAt: 2, startedMs: 0, durationMs: 2, errorsFrom: 1 },
    ];
    const { executions } = executionsOf(
      recorded,
      ended({
        state: 'failed',
        errors: [{ message: 'first' }, { message: 'second' }],
        retryCount: 1,
      }),
    );
    expect(executions.map((execution) => [execution.state, execution.errors])).toEqual([
      ['failed', [{ message: 'first' }]],
      ['failed', [{ message: 'second' }]],
    ]);
  });

  it('keeps the state and the note of a last attempt that was skipped', () => {
    const recorded: RecordedAttempt[] = [
      { repeat: 0, retry: 0, startedAt: 1, startedMs: 0, errorsFrom: 0 },
    ];
    const { executions } = executionsOf(
      recorded,
      ended({ state: 'skipped', note: 'Skipped: later', errors: [] }),
    );
    expect(executions).toEqual([
      {
        repeat: 0,
        retry: 0,
        state: 'skipped',
        note: 'Skipped: later',
        errors: [],
        durationMs: 9,
        startedAt: 500,
        files: [],
      },
    ]);
  });

  it('keeps the start and the duration Vitest reports for a test with one recorded attempt, not the setup file clocks', () => {
    const recorded: RecordedAttempt[] = [
      { repeat: 0, retry: 0, startedAt: 1, startedMs: 0, durationMs: 3, errorsFrom: 0 },
    ];
    const { executions } = executionsOf(recorded, ended({ durationMs: 40, startedAt: 700 }));
    expect(executions.map((execution) => [execution.startedAt, execution.durationMs])).toEqual([
      [700, 40],
    ]);
  });

  it('reports no start and no duration for a test with one recorded attempt when Vitest gives none', () => {
    const recorded: RecordedAttempt[] = [
      { repeat: 0, retry: 0, startedAt: 1, startedMs: 0, durationMs: 3, errorsFrom: 0 },
    ];
    const { executions } = executionsOf(
      recorded,
      ended({ durationMs: undefined, startedAt: undefined }),
    );
    expect(executions.map((execution) => [execution.startedAt, execution.durationMs])).toEqual([
      [undefined, undefined],
    ]);
  });

  it('gives a repeat that passed its own outcome, even though the test as a whole failed', () => {
    const recorded: RecordedAttempt[] = [
      {
        repeat: 0,
        retry: 0,
        startedAt: 1,
        startedMs: 0,
        durationMs: 1,
        errorsFrom: 0,
        errors: [{ message: 'repeat one' }],
      },
      { repeat: 1, retry: 0, startedAt: 2, startedMs: 0, durationMs: 2, errorsFrom: 1 },
    ];
    const { executions } = executionsOf(
      recorded,
      ended({ state: 'failed', errors: [{ message: 'repeat one' }], repeatCount: 1 }),
    );
    expect(executions.map((execution) => [execution.repeat, execution.state])).toEqual([
      [0, 'failed'],
      [1, 'passed'],
    ]);
  });
});

describe('executionsOf, for the files of the annotate calls', () => {
  const ended = (overrides: Partial<EndedTest> = {}): EndedTest => ({
    state: 'passed',
    errors: [],
    retryCount: 0,
    repeatCount: 0,
    ...overrides,
  });
  const fileAnnotation = (message: string, path: string): UserAnnotation => ({
    message,
    file: { path },
  });

  it('gives each recorded attempt the files its own annotate calls made, by the annotations it started after', () => {
    const recorded: RecordedAttempt[] = [
      { repeat: 0, retry: 0, startedAt: 1, startedMs: 1, errorsFrom: 0, annotations: 0 },
      { repeat: 0, retry: 1, startedAt: 2, startedMs: 2, errorsFrom: 0, annotations: 1 },
    ];
    const annotations = [fileAnnotation('first', '/a.txt'), fileAnnotation('second', '/b.txt')];
    const result = executionsOf(recorded, ended({ retryCount: 1, annotations }));
    expect(result.executions.map((execution) => execution.files.map((file) => file.name))).toEqual([
      ['first'],
      ['second'],
    ]);
    expect(result.dropped).toBe(0);
  });

  it('leaves out the files of a retried test whose attempts are not recorded, and counts them', () => {
    const result = executionsOf(
      undefined,
      ended({ retryCount: 1, annotations: [fileAnnotation('note', '/n.txt')] }),
    );
    expect(result.executions[0]?.files).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it('counts as left out the files of an attempt whose annotation count was not read', () => {
    const recorded: RecordedAttempt[] = [
      { repeat: 0, retry: 0, startedAt: 1, startedMs: 1, errorsFrom: 0 },
      { repeat: 0, retry: 1, startedAt: 2, startedMs: 2, errorsFrom: 0, annotations: 1 },
    ];
    const annotations = [fileAnnotation('first', '/a.txt'), fileAnnotation('second', '/b.txt')];
    const result = executionsOf(recorded, ended({ retryCount: 1, annotations }));
    expect(result.executions.map((execution) => execution.files.map((file) => file.name))).toEqual([
      [],
      ['second'],
    ]);
    expect(result.dropped).toBe(1);
  });

  it('gives each execution the output written within its attempt, from the start of each attempt on', () => {
    const recorded: RecordedAttempt[] = [
      { repeat: 0, retry: 0, startedAt: 1_000, startedMs: 1, errorsFrom: 0, annotations: 0 },
      { repeat: 0, retry: 1, startedAt: 2_000, startedMs: 2, errorsFrom: 0, annotations: 0 },
    ];
    const before = { type: 'stdout' as const, content: 'written while loading', time: 900 };
    const first = { type: 'stdout' as const, content: 'attempt one', time: 1_500 };
    const second = { type: 'stderr' as const, content: 'attempt two', time: 2_500 };
    const result = executionsOf(recorded, ended({ retryCount: 1, logs: [before, first, second] }));
    expect(result.executions.map((execution) => execution.logs)).toEqual([
      [before, first],
      [second],
    ]);
    expect(result.droppedOutput).toBe(0);
  });

  it('leaves out the output of a retried test whose attempts are not recorded, and counts it', () => {
    const result = executionsOf(
      undefined,
      ended({ retryCount: 1, logs: [{ type: 'stdout', content: 'x', time: 1 }] }),
    );
    expect(result.executions[0]?.logs ?? []).toEqual([]);
    expect(result.droppedOutput).toBe(1);
  });

  it('keeps the output of a test that ran once without recorded attempts', () => {
    const logs = [{ type: 'stdout' as const, content: 'x', time: 1 }];
    const result = executionsOf(undefined, ended({ logs }));
    expect(result.executions[0]?.logs).toEqual(logs);
    expect(result.droppedOutput).toBe(0);
  });

  it('keeps every file of a test that ran once without recorded attempts', () => {
    const result = executionsOf(
      undefined,
      ended({ annotations: [fileAnnotation('note', '/n.txt'), { message: 'a plain note' }] }),
    );
    expect(result.executions[0]?.files).toEqual([{ name: 'note', path: '/n.txt' }]);
    expect(result.dropped).toBe(0);
  });
});
