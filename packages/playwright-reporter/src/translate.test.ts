import { buildAutomationKey } from '@probara/core';
import { describe, expect, it } from 'vitest';
import { fakeResult, fakeTest } from '../test/support/playwright-fakes.js';
import { toResultInput } from './translate.js';

const context = { projectCode: 'PRB', captureOutput: false };

describe('toResultInput identity', () => {
  it('keys a test like the JUnit import: the file, the describes and the title, then the project', () => {
    const input = toResultInput(
      fakeTest({ file: 'auth/login.spec.ts', titles: ['login', 'session', 'renews the token'] }),
      fakeResult(),
      context,
    );
    expect(input.identity).toEqual({
      file: 'auth/login.spec.ts',
      titlePath: ['login', 'session', 'renews the token'],
      parameters: { project: 'chromium' },
    });
    expect(buildAutomationKey(input.identity)).toBe(
      'auth/login.spec.ts > login > session > renews the token [project=chromium]',
    );
  });

  it('adds no project parameter for an unnamed or blank project', () => {
    for (const project of ['', '  ']) {
      const input = toResultInput(
        fakeTest({ project, titles: ['top-level test'] }),
        fakeResult(),
        context,
      );
      expect(input.identity).toEqual({ file: 'login.spec.ts', titlePath: ['top-level test'] });
    }
  });

  it('trims the project name like the JUnit import does', () => {
    const input = toResultInput(fakeTest({ project: ' firefox ' }), fakeResult(), context);
    expect(input.identity.parameters).toEqual({ project: 'firefox' });
  });

  it('splits a title that holds the JUnit separator, as the JUnit import reads it', () => {
    const input = toResultInput(
      fakeTest({ titles: ['cart', 'adds › removes'] }),
      fakeResult(),
      context,
    );
    expect(input.identity.titlePath).toEqual(['cart', 'adds', 'removes']);
  });
});

describe('toResultInput case links', () => {
  it('strips the ids of the configured project from the titles and links them', () => {
    const input = toResultInput(
      fakeTest({ titles: ['[PRB-3] login', 'PRB-12 logs in (@PRB-13)'] }),
      fakeResult(),
      context,
    );
    expect(input.identity.titlePath).toEqual(['login', 'logs in']);
    expect(input.caseDisplayIds).toEqual(['PRB-3', 'PRB-12', 'PRB-13']);
    expect(input).not.toHaveProperty('caseDisplayId');
  });

  it("keeps another project's ids in the title, and reads none without a project code", () => {
    const other = toResultInput(fakeTest({ titles: ['SHOP-4 logs in'] }), fakeResult(), context);
    expect(other.identity.titlePath).toEqual(['SHOP-4 logs in']);
    expect(other).not.toHaveProperty('caseDisplayId');

    const none = toResultInput(fakeTest({ titles: ['PRB-4 logs in'] }), fakeResult(), {
      projectCode: undefined,
      captureOutput: false,
    });
    expect(none.identity.titlePath).toEqual(['PRB-4 logs in']);
    expect(none).not.toHaveProperty('caseDisplayId');
  });

  it('links one case as caseDisplayId', () => {
    const input = toResultInput(fakeTest({ titles: ['PRB-12 logs in'] }), fakeResult(), context);
    expect(input.caseDisplayId).toBe('PRB-12');
    expect(input).not.toHaveProperty('caseDisplayIds');
  });

  it('links probara_case annotations (comma lists, any project) before the title ids, once each', () => {
    const input = toResultInput(
      fakeTest({
        titles: ['PRB-12 logs in'],
        annotations: [{ type: 'issue', description: 'https://example.com/42' }],
      }),
      fakeResult({
        annotations: [
          { type: 'probara_case', description: ' WEB-3, PRB-12 ' },
          { type: 'probara_case', description: 'PRB-14' },
          { type: 'probara_case' },
        ],
      }),
      context,
    );
    expect(input.caseDisplayIds).toEqual(['WEB-3', 'PRB-12', 'PRB-14']);
  });

  it("falls back to the test's annotations when the attempt carries none (Playwright before 1.52)", () => {
    const result = fakeResult();
    const legacy = { ...result, annotations: undefined } as unknown as typeof result;
    const input = toResultInput(
      fakeTest({ annotations: [{ type: 'probara_case', description: 'PRB-20' }] }),
      legacy,
      context,
    );
    expect(input.caseDisplayId).toBe('PRB-20');
  });
});

describe('toResultInput status', () => {
  it('maps what each attempt did', () => {
    const statusOf = (status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped') =>
      toResultInput(fakeTest(), fakeResult({ status }), context).status;
    expect(statusOf('passed')).toBe('passed');
    expect(statusOf('failed')).toBe('failed');
    expect(statusOf('timedOut')).toBe('failed');
    expect(statusOf('interrupted')).toBe('failed');
    expect(statusOf('skipped')).toBe('skipped');
  });

  it('passes an expected failure (test.fail) and fails an unexpected pass', () => {
    const failing = fakeTest({ expectedStatus: 'failed' });
    expect(toResultInput(failing, fakeResult({ status: 'failed' }), context).status).toBe('passed');
    expect(toResultInput(failing, fakeResult({ status: 'passed' }), context).status).toBe('failed');
    expect(toResultInput(failing, fakeResult({ status: 'timedOut' }), context).status).toBe(
      'failed',
    );
  });

  it('keeps a skipped test (test.skip, test.fixme) skipped', () => {
    const skipped = fakeTest({ expectedStatus: 'skipped' });
    expect(toResultInput(skipped, fakeResult({ status: 'skipped' }), context).status).toBe(
      'skipped',
    );
  });
});

describe('toResultInput timing and errors', () => {
  it('sends the duration and the start of the attempt', () => {
    const startTime = new Date('2026-09-29T14:05:07.250Z');
    const input = toResultInput(fakeTest(), fakeResult({ duration: 1534, startTime }), context);
    expect(input.durationMs).toBe(1534);
    expect(input.startedAt).toEqual(startTime);
  });

  it('sends every error of the attempt, message and stack, in order', () => {
    const input = toResultInput(
      fakeTest(),
      fakeResult({
        status: 'failed',
        errors: [
          {
            message: 'expect(received).toBe(expected)',
            stack: 'Error: expect(received)...\n    at a.ts:1',
          },
          { message: 'afterEach hook failed' },
          { value: "'a thrown string'" },
        ],
      }),
      context,
    );
    expect(input.error).toEqual([
      {
        message: 'expect(received).toBe(expected)',
        stack: 'Error: expect(received)...\n    at a.ts:1',
      },
      { message: 'afterEach hook failed' },
      { message: "'a thrown string'" },
    ]);
  });

  it('sends no error for an attempt without errors', () => {
    expect(toResultInput(fakeTest(), fakeResult(), context)).not.toHaveProperty('error');
  });
});
