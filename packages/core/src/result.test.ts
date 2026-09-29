import { describe, expect, it } from 'vitest';
import type { ReportResultEntry } from './api.js';
import { toReportEntry, type TestResultInput } from './result.js';

const loginIdentity = {
  file: 'e2e/login.spec.ts',
  titlePath: ['Login', 'logs in'],
  parameters: { browser: 'chromium' },
};

function entryOf(input: TestResultInput): ReportResultEntry {
  return toReportEntry(input).entry;
}

describe('toReportEntry', () => {
  it('derives the key, title and suite path from the test identity', () => {
    expect(toReportEntry({ identity: loginIdentity, status: 'passed' })).toEqual({
      entry: {
        automationKey: 'e2e/login.spec.ts > Login > logs in [browser=chromium]',
        title: 'logs in [browser=chromium]',
        suitePath: ['e2e/login.spec.ts', 'Login'],
        status: 'passed',
      },
      warnings: [],
    });
    expect(entryOf({ identity: { titlePath: ['works'] }, status: 'failed' })).toEqual({
      automationKey: 'works',
      title: 'works',
      status: 'failed',
    });
  });

  it('makes the file of the key and the suite path relative to the root directory', () => {
    const entry = toReportEntry(
      { identity: { file: '/ci/repo/e2e/cart.spec.ts', titlePath: ['empties'] }, status: 'passed' },
      { rootDir: '/ci/repo' },
    ).entry;
    expect(entry.automationKey).toBe('e2e/cart.spec.ts > empties');
    expect(entry.suitePath).toEqual(['e2e/cart.spec.ts']);
  });

  it('accepts every contract status and rejects any other with a TypeError', () => {
    for (const status of ['passed', 'failed', 'skipped', 'blocked'] as const) {
      expect(entryOf({ identity: loginIdentity, status }).status).toBe(status);
    }
    const unknown = { identity: loginIdentity, status: 'timedOut' } as unknown as TestResultInput;
    expect(() => toReportEntry(unknown)).toThrow(TypeError);
    expect(() => toReportEntry(unknown)).toThrow('Unknown result status "timedOut"');
  });

  describe('automationKey override', () => {
    it('is normalized and replaces the built key', () => {
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'passed',
          automationKey: '  custom\u0000\tkey ',
        }).automationKey,
      ).toBe('custom key');
    });

    it('is truncated with a hash when too long', () => {
      const key = entryOf({
        identity: loginIdentity,
        status: 'passed',
        automationKey: 'z'.repeat(1500),
      }).automationKey;
      expect(key).toHaveLength(1024);
      expect(key).toMatch(/^z{1006} #[0-9a-f]{16}$/);
    });

    it('falls back to the built key with a warning when it is blank', () => {
      const { entry, warnings } = toReportEntry({
        identity: loginIdentity,
        status: 'passed',
        automationKey: ' \u0007 ',
      });
      expect(entry.automationKey).toBe('e2e/login.spec.ts > Login > logs in [browser=chromium]');
      expect(warnings).toEqual(['Ignored a blank automationKey; used the key built from the test']);
    });
  });

  describe('caseDisplayId', () => {
    it('is trimmed', () => {
      expect(
        entryOf({ identity: loginIdentity, status: 'passed', caseDisplayId: ' PRB-12 ' }),
      ).toMatchObject({ caseDisplayId: 'PRB-12' });
    });

    it('is dropped with a warning when blank or longer than 64', () => {
      const blank = toReportEntry({
        identity: loginIdentity,
        status: 'passed',
        caseDisplayId: '  ',
      });
      expect(blank.entry).not.toHaveProperty('caseDisplayId');
      expect(blank.warnings).toEqual(['Ignored a blank caseDisplayId']);

      const long = toReportEntry({
        identity: loginIdentity,
        status: 'passed',
        caseDisplayId: `PRB-${'1'.repeat(61)}`,
      });
      expect(long.entry).not.toHaveProperty('caseDisplayId');
      expect(long.warnings).toEqual(['Ignored a caseDisplayId longer than 64 characters']);
    });
  });

  describe('title', () => {
    it('is normalized and truncated to 400 with an ellipsis', () => {
      expect(
        entryOf({ identity: loginIdentity, status: 'passed', title: ' Custom \n title ' }).title,
      ).toBe('Custom title');
      const title = entryOf({
        identity: loginIdentity,
        status: 'passed',
        title: 't'.repeat(401),
      }).title;
      expect(title).toBe(`${'t'.repeat(399)}…`);
    });

    it('is omitted when the given title is blank', () => {
      expect(
        entryOf({ identity: loginIdentity, status: 'passed', title: ' \t ' }),
      ).not.toHaveProperty('title');
    });
  });

  describe('suitePath', () => {
    it('normalizes the given segments, truncates them to 255 and drops empty ones', () => {
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'passed',
          suitePath: [' Checkout ', '', 'Card\tpayments', 's'.repeat(300)],
        }).suitePath,
      ).toEqual(['Checkout', 'Card payments', `${'s'.repeat(254)}…`]);
      expect(
        entryOf({ identity: loginIdentity, status: 'passed', suitePath: [' '] }),
      ).not.toHaveProperty('suitePath');
    });

    it('merges the levels beyond 10 into the 10th', () => {
      const levels = Array.from({ length: 30 }, (_, index) => `L${index + 1}`);
      const suitePath = entryOf({
        identity: loginIdentity,
        status: 'passed',
        suitePath: levels,
      }).suitePath;
      expect(suitePath).toHaveLength(10);
      expect(suitePath?.slice(0, 9)).toEqual(levels.slice(0, 9));
      expect(suitePath?.[9]).toBe(levels.slice(9).join(' > '));
    });

    it('truncates a merged 10th level to 255', () => {
      const levels = Array.from({ length: 12 }, () => 'n'.repeat(200));
      const suitePath = entryOf({
        identity: loginIdentity,
        status: 'passed',
        suitePath: levels,
      }).suitePath;
      expect(suitePath?.[9]).toBe(`${'n'.repeat(200)} > ${'n'.repeat(51)}…`);
    });
  });

  it('rounds durationMs, clamps it at 0, and drops a non-finite one with a warning', () => {
    expect(
      entryOf({ identity: loginIdentity, status: 'passed', durationMs: 12.6 }).durationMs,
    ).toBe(13);
    expect(entryOf({ identity: loginIdentity, status: 'passed', durationMs: -5 }).durationMs).toBe(
      0,
    );
    const nan = toReportEntry({
      identity: loginIdentity,
      status: 'passed',
      durationMs: Number.NaN,
    });
    expect(nan.entry).not.toHaveProperty('durationMs');
    expect(nan.warnings).toEqual(['Ignored a durationMs that is not a finite number']);
  });

  describe('executedAt', () => {
    it('is the start time as an ISO timestamp with an offset', () => {
      const at = '2026-09-29T15:00:00.000Z';
      expect(
        entryOf({ identity: loginIdentity, status: 'passed', startedAt: new Date(at) }).executedAt,
      ).toBe(at);
      expect(
        entryOf({ identity: loginIdentity, status: 'passed', startedAt: Date.parse(at) })
          .executedAt,
      ).toBe(at);
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'passed',
          startedAt: '2026-09-29T10:00:00-05:00',
        }).executedAt,
      ).toBe(at);
    });

    it('is omitted with a warning when the start time is not a valid date', () => {
      for (const startedAt of ['not a date', 8.64e15, new Date(Number.NaN)]) {
        const { entry, warnings } = toReportEntry({
          identity: loginIdentity,
          status: 'passed',
          startedAt,
        });
        expect(entry).not.toHaveProperty('executedAt');
        expect(warnings).toEqual(['Ignored a startedAt that is not a valid date']);
      }
    });
  });

  describe('notes', () => {
    it('hold the error message without ANSI codes', () => {
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'failed',
          error: '\u001b[31mExpected 1\u001b[39m',
        }).notes,
      ).toBe('Expected 1');
    });

    it('add the stack after the message unless the stack already carries it', () => {
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'failed',
          error: { message: 'boom', stack: 'Error: boom\n    at run (a.ts:1:1)' },
        }).notes,
      ).toBe('Error: boom\n    at run (a.ts:1:1)');
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'failed',
          error: { message: 'Expected 1', stack: '    at run (a.ts:1:1)' },
          notes: 'retry 2\r\nof 3',
        }).notes,
      ).toBe('Expected 1\n\n    at run (a.ts:1:1)\n\nretry 2\nof 3');
    });

    it('are truncated to 4000 with a marker', () => {
      const notes = entryOf({
        identity: loginIdentity,
        status: 'failed',
        error: 'e'.repeat(5000),
      }).notes;
      expect(notes).toHaveLength(4000);
      expect(notes?.endsWith('e\n…[truncated]')).toBe(true);
    });

    it('are omitted when there is no text', () => {
      expect(
        entryOf({
          identity: loginIdentity,
          status: 'failed',
          error: { message: '\u001b[0m' },
          notes: ' ',
        }),
      ).not.toHaveProperty('notes');
    });
  });
});

// Every limit of a report entry: the server rejects the whole batch when one entry breaks one.
function expectWithinContract(entry: ReportResultEntry): void {
  const allowed = [
    'caseDisplayId',
    'automationKey',
    'title',
    'suitePath',
    'status',
    'durationMs',
    'notes',
    'executedAt',
  ];
  for (const key of Object.keys(entry)) expect(allowed).toContain(key);
  const wellFormed = (text: string): void => {
    expect(() => encodeURIComponent(text)).not.toThrow();
  };

  expect(entry.caseDisplayId ?? entry.automationKey).toBeDefined();
  if (entry.automationKey !== undefined) {
    expect(entry.automationKey.trim()).toBe(entry.automationKey);
    expect(entry.automationKey.length).toBeGreaterThanOrEqual(1);
    expect(entry.automationKey.length).toBeLessThanOrEqual(1024);
    // eslint-disable-next-line no-control-regex -- the control characters the server refuses
    expect(entry.automationKey).not.toMatch(/[\u0000-\u001f\u007f]/);
    wellFormed(entry.automationKey);
  }
  if (entry.caseDisplayId !== undefined) {
    expect(entry.caseDisplayId.trim()).toBe(entry.caseDisplayId);
    expect(entry.caseDisplayId.length).toBeGreaterThanOrEqual(1);
    expect(entry.caseDisplayId.length).toBeLessThanOrEqual(64);
  }
  if (entry.title !== undefined) {
    expect(entry.title.trim()).toBe(entry.title);
    expect(entry.title.length).toBeGreaterThanOrEqual(1);
    expect(entry.title.length).toBeLessThanOrEqual(400);
    wellFormed(entry.title);
  }
  if (entry.suitePath !== undefined) {
    expect(entry.suitePath.length).toBeLessThanOrEqual(10);
    for (const segment of entry.suitePath) {
      expect(segment.trim()).toBe(segment);
      expect(segment.length).toBeGreaterThanOrEqual(1);
      expect(segment.length).toBeLessThanOrEqual(255);
      wellFormed(segment);
    }
  }
  if (entry.notes !== undefined) {
    expect(entry.notes.length).toBeLessThanOrEqual(4000);
    wellFormed(entry.notes);
  }
  if (entry.durationMs !== undefined) {
    expect(Number.isInteger(entry.durationMs)).toBe(true);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  }
  if (entry.executedAt !== undefined) {
    expect(entry.executedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    );
  }
}

describe('toReportEntry with pathological input', () => {
  it('keeps an entry of huge strings, deep paths, control characters and ANSI within the contract', () => {
    const { entry, warnings } = toReportEntry(
      {
        identity: {
          file: `/repo/${'dir/'.repeat(500)}x.spec.ts`,
          titlePath: Array.from(
            { length: 30 },
            (_, index) => `\u001b[31mLevel\u0000\u009b ${index}\u007f${'y'.repeat(300)}`,
          ),
          parameters: { ['p\n'.repeat(100)]: 'v'.repeat(2000), flag: true },
        },
        status: 'failed',
        caseDisplayId: 'x'.repeat(100),
        durationMs: Number.NaN,
        startedAt: 'garbage',
        error: { message: `\u001b[31m${'m'.repeat(5000)}`, stack: '\u{1f600}'.repeat(3000) },
        notes: '\r\n'.repeat(100),
      },
      { rootDir: '/repo' },
    );

    expectWithinContract(entry);
    expect(entry.suitePath).toHaveLength(10);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('keeps an entry made of surrogate pairs and non-finite numbers within the contract', () => {
    const { entry } = toReportEntry({
      identity: { titlePath: ['\u{1f600}'.repeat(700), '\u{1f680}'.repeat(700)] },
      status: 'skipped',
      automationKey: `${'\u0000'.repeat(10)}${'\u{1f600}'.repeat(600)}`,
      caseDisplayId: '  ',
      title: '\u{1f600}'.repeat(300),
      suitePath: [
        '\u{1f600}'.repeat(200),
        ...Array.from({ length: 20 }, () => '\u{1f680}'.repeat(50)),
      ],
      durationMs: Number.NEGATIVE_INFINITY,
      startedAt: 8.64e15,
      error: 'e'.repeat(10000),
    });

    expectWithinContract(entry);
    expect(entry.automationKey?.length).toBeLessThanOrEqual(1024);
  });
});
