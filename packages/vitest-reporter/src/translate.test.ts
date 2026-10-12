import type { TestResultInput } from '@probara/core';
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
    repeat: 0,
    retry: 0,
    ...overrides,
  };
}

/** The result of an execution the test expects to be reported: `toResultInput` leaves none out here. */
function resultOf(test: ReportedTest, ctx: TranslationContext): TestResultInput {
  const input = toResultInput(test, ctx);
  if (input === undefined) throw new Error('the execution was left out');
  return input;
}

describe('toResultInput, for an execution of a retried or repeated test', () => {
  it('names the attempt from the second one on, and the repeat from the second repeat on', () => {
    expect(resultOf(reported({ retry: 1 }), context).parameters).toEqual({ attempt: '2' });
    expect(resultOf(reported({ repeat: 1, retry: 1 }), context).parameters).toEqual({
      repeat: '2',
      attempt: '2',
    });
    expect(resultOf(reported({ repeat: 2 }), context).parameters).toEqual({ repeat: '3' });
  });

  it('sends no attempt parameter for the first execution, which is the test as it always was', () => {
    expect(resultOf(reported(), context)).not.toHaveProperty('parameters');
  });
});

describe('toResultInput', () => {
  it('sends a passed test as passed, keyed by its file, its describes and its title, with when and how long it ran', () => {
    const input = resultOf(reported({ durationMs: 12.4, startedAt: 1_700_000_000_000 }), context);
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
    const input = resultOf(
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
    const skipped = resultOf(reported({ state: 'skipped' }), context);
    expect(skipped.status).toBe('skipped');
    expect(skipped.notes).toBeUndefined();
    const todo = resultOf(reported({ state: 'skipped', todo: true }), context);
    expect(todo.status).toBe('skipped');
    expect(todo.notes).toBe('Todo');
  });

  it('keeps the note of a test skipped at runtime as Skipped: its note, and Vitest abort note as it is', () => {
    expect(
      resultOf(reported({ state: 'skipped', note: 'needs the staging data' }), context).notes,
    ).toBe('Skipped: needs the staging data');
    expect(
      resultOf(
        reported({ state: 'skipped', note: 'The test run was aborted by the user.' }),
        context,
      ).notes,
    ).toBe('The test run was aborted by the user.');
  });

  it('sends a test the run never finished as skipped, with the note that says so', () => {
    const input = resultOf(reported({ state: 'pending' }), context);
    expect(input.status).toBe('skipped');
    expect(input.notes).toBe('Not run: the test run was interrupted');
  });

  it('sends no error for a passed test, as the JUnit output writes none for a passed retry', () => {
    const input = resultOf(
      reported({ state: 'passed', errors: [{ message: 'failed attempt' }] }),
      context,
    );
    expect(input.error).toBeUndefined();
  });

  it('links the case ids of its describes and title, and takes them out of the title path', () => {
    const input = resultOf(
      reported({ ancestors: ['PRB-7 checkout'], title: 'PRB-12 rejects a coupon' }),
      context,
    );
    expect(input.identity.titlePath).toEqual(['checkout', 'rejects a coupon']);
    expect(input.caseDisplayIds).toEqual(['PRB-7', 'PRB-12']);
  });

  it('leaves the file out of the identity without keyIncludesFile', () => {
    const input = resultOf(reported(), { ...context, keyIncludesFile: false });
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

describe('toResultInput, for the files of probara.attach()', () => {
  const COPY = '0b6f1c2e-6f3a-4c1e-9d55-5a1f0c2b7e10';

  it('sends the files of the execution, read from the folder the run provides', () => {
    const test = reported({
      lines: [
        {
          type: 'attachment',
          file: FILE,
          test: 'checkout rejects a wrong coupon',
          attempt: 0,
          name: 'receipt',
          copy: COPY,
          source: 'receipt.txt',
        },
      ],
    });
    expect(resultOf(test, { ...context, filesDir: '/run/probara' }).attachments).toEqual([
      expect.objectContaining({
        name: 'receipt',
        fileName: 'receipt.txt',
        contentType: 'text/plain',
        path: `/run/probara/files/${COPY}`,
        temporary: true,
      }),
    ]);
  });

  it('sends no file for an execution that attached none', () => {
    expect(resultOf(reported(), context).attachments).toBeUndefined();
  });
});

describe('toResultInput, for a blob merged elsewhere', () => {
  it('reads the files from the folder the test recorded, not from the one of the merge run', () => {
    const test = reported({
      filesDir: '/shard/attachments/probara',
      lines: [
        {
          type: 'attachment',
          file: FILE,
          test: 'checkout rejects a wrong coupon',
          attempt: 0,
          name: 'receipt',
          copy: '0b6f1c2e-6f3a-4c1e-9d55-5a1f0c2b7e10',
          source: 'receipt.txt',
        },
      ],
    });
    expect(
      resultOf(test, { ...context, filesDir: '/merge/attachments/probara' }).attachments,
    ).toEqual([
      expect.objectContaining({
        path: '/shard/attachments/probara/files/0b6f1c2e-6f3a-4c1e-9d55-5a1f0c2b7e10',
      }),
    ]);
  });
});

describe('toResultInput, for the files of the annotate calls', () => {
  it('sends a file under its message: a path as Vitest copied it, a text body as text, bytes as bytes', () => {
    const test = reported({
      files: [
        { name: 'annotated note', path: '/run/annotated-1.txt', contentType: 'text/plain' },
        { name: 'annotated body', body: 'the cart total is 25', bodyEncoding: 'utf-8' },
        {
          name: 'bytes',
          body: Buffer.from([0, 1, 254]).toString('base64'),
          bodyEncoding: 'base64',
        },
      ],
    });
    expect(resultOf(test, context).attachments).toEqual([
      {
        name: 'annotated note',
        fileName: 'annotated note.txt',
        path: '/run/annotated-1.txt',
        contentType: 'text/plain',
      },
      {
        name: 'annotated body',
        body: Buffer.from('the cart total is 25'),
        contentType: 'text/plain',
      },
      { name: 'bytes', body: Buffer.from([0, 1, 254]) },
    ]);
  });
});

describe('toResultInput, for the bytes of an annotate body on Vitest 3 (no bodyEncoding label)', () => {
  // Vitest 3 keeps the bytes of a Uint8Array body as base64 text, with no label that says so.
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10]);

  it('sends the bytes when the content type is binary, as they were before the base64 encoding', () => {
    const test = reported({
      files: [{ name: 'screen', body: PNG.toString('base64'), contentType: 'image/png' }],
    });
    expect(resultOf(test, context).attachments).toEqual([
      { name: 'screen', body: PNG, contentType: 'image/png' },
    ]);
  });

  it('keeps a text body as text: a text content type, or none', () => {
    const test = reported({
      files: [
        { name: 'order', body: '{"id":1042}', contentType: 'application/json' },
        { name: 'note', body: 'paid in 1.2 s' },
        { name: 'diagram', body: '<svg/>', contentType: 'image/svg+xml' },
        { name: 'token', body: 'aGVsbG8=', contentType: 'text/plain' },
      ],
    });
    expect(resultOf(test, context).attachments).toEqual([
      { name: 'order', body: Buffer.from('{"id":1042}'), contentType: 'application/json' },
      { name: 'note', body: Buffer.from('paid in 1.2 s'), contentType: 'text/plain' },
      { name: 'diagram', body: Buffer.from('<svg/>'), contentType: 'image/svg+xml' },
      { name: 'token', body: Buffer.from('aGVsbG8='), contentType: 'text/plain' },
    ]);
  });

  it('keeps base64 text with no content type as the text Vitest holds, which it cannot tell from bytes', () => {
    const test = reported({ files: [{ name: 'bytes', body: PNG.toString('base64') }] });
    expect(resultOf(test, context).attachments).toEqual([
      { name: 'bytes', body: Buffer.from(PNG.toString('base64')), contentType: 'text/plain' },
    ]);
  });

  it('sends text, typed as text, when a binary content type comes with a body that is not base64', () => {
    const test = reported({
      files: [{ name: 'shot', body: 'not an image', contentType: 'image/png' }],
    });
    expect(resultOf(test, context).attachments).toEqual([
      { name: 'shot', body: Buffer.from('not an image'), contentType: 'text/plain' },
    ]);
  });
  it('leaves out a binary body whose bytes Vitest 3 lost, with a warning, and never sends it corrupted', () => {
    // The base64 of a PNG signature, as Vitest 3 writes it: the `+` and `/` sextets became the word `undefined`.
    const warnings: string[] = [];
    const test = reported({
      files: [{ name: 'screen', body: 'iVBORw0KGgoAundefinedxA=', contentType: 'image/png' }],
    });
    const result = toResultInput(test, { ...context, warn: (message) => warnings.push(message) });
    expect(result?.attachments).toBeUndefined();
    expect(warnings).toEqual([
      'Skipped an annotate file "screen": Vitest 3 loses some bytes of a binary body, so it cannot be sent intact; attach the file with a path instead',
    ]);
  });
});
