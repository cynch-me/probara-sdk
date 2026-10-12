import { describe, expect, it } from 'vitest';
import {
  failureToResultInput,
  toResultInput,
  type ReportedFailure,
  type ReportedTest,
  type TranslationContext,
} from './translate.js';

const ROOT = '/work/shop';
const FILE = `${ROOT}/tests/checkout.test.ts`;
const context: TranslationContext = { projectCodes: ['PRB'], keyIncludesFile: true, rootDir: ROOT };

/** A test as the tree walk reports it: passed unless the test says otherwise. */
function reported(overrides: Partial<ReportedTest> = {}): ReportedTest {
  return {
    file: FILE,
    ancestors: ['checkout'],
    title: 'rejects a wrong coupon',
    state: 'passed',
    todo: false,
    errors: [],
    ...overrides,
  };
}

describe('toResultInput', () => {
  it('sends a passed test as passed, keyed by its file, its describes and its title, with when and how long it ran', () => {
    const input = toResultInput(
      reported({ durationMs: 12.4, startedAt: 1_700_000_000_000 }),
      context,
    );
    expect(input.status).toBe('passed');
    expect(input.identity).toEqual({
      file: FILE,
      titlePath: ['checkout', 'rejects a wrong coupon'],
    });
    expect(input.durationMs).toBe(12.4);
    expect(input.startedAt).toEqual(new Date(1_700_000_000_000));
    expect(input.error).toBeUndefined();
  });

  it('sends a failed test as failed with every error of the attempt, in order, with its message and stack', () => {
    const input = toResultInput(
      reported({
        state: 'failed',
        errors: [
          {
            message: 'expected 1 to be 2',
            stack: 'AssertionError: expected 1 to be 2\n    at a.ts:3',
          },
          { message: 'soft one' },
        ],
      }),
      context,
    );
    expect(input.status).toBe('failed');
    expect(input.error).toEqual([
      { message: 'expected 1 to be 2', stack: 'AssertionError: expected 1 to be 2\n    at a.ts:3' },
      { message: 'soft one' },
    ]);
  });

  it('sends a skipped test as skipped without a note, and a todo as skipped with the note Todo', () => {
    const skipped = toResultInput(reported({ state: 'skipped' }), context);
    expect(skipped.status).toBe('skipped');
    expect(skipped.notes).toBeUndefined();
    const todo = toResultInput(reported({ state: 'skipped', todo: true }), context);
    expect(todo.status).toBe('skipped');
    expect(todo.notes).toBe('Todo');
  });

  it('keeps the note of a test skipped at runtime as Skipped: its note, and Vitest abort note as it is', () => {
    expect(
      toResultInput(reported({ state: 'skipped', note: 'needs the staging data' }), context).notes,
    ).toBe('Skipped: needs the staging data');
    expect(
      toResultInput(
        reported({ state: 'skipped', note: 'The test run was aborted by the user.' }),
        context,
      ).notes,
    ).toBe('The test run was aborted by the user.');
  });

  it('sends a test the run never finished as skipped, with the note that says so', () => {
    const input = toResultInput(reported({ state: 'pending' }), context);
    expect(input.status).toBe('skipped');
    expect(input.notes).toBe('Not run: the test run was interrupted');
  });

  it('sends no error for a passed test, as the JUnit output writes none for a passed retry', () => {
    const input = toResultInput(
      reported({ state: 'passed', errors: [{ message: 'failed attempt' }] }),
      context,
    );
    expect(input.error).toBeUndefined();
  });

  it('links the case ids of its describes and title, and takes them out of the title path', () => {
    const input = toResultInput(
      reported({ ancestors: ['PRB-7 checkout'], title: 'PRB-12 rejects a coupon' }),
      context,
    );
    expect(input.identity.titlePath).toEqual(['checkout', 'rejects a coupon']);
    expect(input.caseDisplayIds).toEqual(['PRB-7', 'PRB-12']);
  });

  it('leaves the file out of the identity without keyIncludesFile', () => {
    const input = toResultInput(reported(), { ...context, keyIncludesFile: false });
    expect(input.identity).toEqual({ titlePath: ['checkout', 'rejects a wrong coupon'] });
  });
});

describe('failureToResultInput', () => {
  it('sends a suite whose beforeAll or afterAll hook threw as failed, named as the JUnit writer names it: the suite', () => {
    const failure: ReportedFailure = {
      file: FILE,
      name: 'session',
      errors: [{ message: 'hook timed out' }],
    };
    const input = failureToResultInput(failure, context);
    expect(input.status).toBe('failed');
    expect(input.identity).toEqual({ file: FILE, titlePath: ['session'] });
    expect(input.error).toEqual([{ message: 'hook timed out' }]);
  });

  it('sends a file that failed to import as failed, named by the file, as the JUnit writer names it', () => {
    const failure: ReportedFailure = {
      file: `${ROOT}/tests/broken.test.ts`,
      name: 'tests/broken.test.ts',
      errors: [{ message: 'SyntaxError: Unexpected token' }],
    };
    const input = failureToResultInput(failure, context);
    expect(input.identity.titlePath).toEqual(['tests/broken.test.ts']);
    expect(input.error).toEqual([{ message: 'SyntaxError: Unexpected token' }]);
  });
});
