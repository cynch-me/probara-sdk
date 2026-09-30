import {
  buildAutomationKey,
  readMetadataMessages,
  toReportEntry,
  type MetadataMessage,
} from '@probara/core';
import { describe, expect, it } from 'vitest';
import { fakeCaseResult, ROOT_DIR } from '../test/support/jest-fakes.js';
import type { AttemptDetails } from './channel-reader.js';
import { testIdOf, toResultInput, type TranslationContext } from './translate.js';

const FILE = `${ROOT_DIR}/src/login.test.js`;
const withFile: TranslationContext = {
  projectCodes: ['PRB'],
  keyIncludesFile: true,
  rootDir: ROOT_DIR,
};
const withoutFile: TranslationContext = { ...withFile, keyIncludesFile: false };

function keyOf(input: ReturnType<typeof toResultInput>): string {
  return buildAutomationKey(input.identity, { rootDir: ROOT_DIR });
}

describe('toResultInput identity', () => {
  it('keys a test like the JUnit import of jest-junit with its file attribute', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(29, { titles: ['login', 'session', 'refresh', 'renews the token'] }),
      withFile,
    );
    expect(input.identity).toEqual({
      file: FILE,
      titlePath: ['login session refresh renews the token'],
    });
    expect(keyOf(input)).toBe('src/login.test.js > login session refresh renews the token');
    expect(input.suitePath).toEqual(['src/login.test.js']);
  });

  it('keys a test like the JUnit import of jest-junit without the file, with keyIncludesFile false', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(30, { titles: ['cart', 'totals', 'adds taxes'] }),
      withoutFile,
    );
    expect(input.identity).toEqual({ titlePath: ['cart totals adds taxes'] });
    expect(keyOf(input)).toBe('cart totals adds taxes');
    // The test's own first describe: the JUnit import takes the first describe of the file's
    // first test (jest-junit's suite name) for every test of the file, so only the suite of a
    // created case can differ, never the key.
    expect(input.suitePath).toEqual(['cart']);
  });

  it("keys a top-level test by its title alone, with no suite without the file (the JUnit import puts it under the first describe of the file's first test)", () => {
    const top = fakeCaseResult(29, { titles: ['top-level test outside any describe'] });
    expect(keyOf(toResultInput(FILE, top, withFile))).toBe(
      'src/login.test.js > top-level test outside any describe',
    );
    const input = toResultInput(FILE, top, withoutFile);
    expect(input.identity.titlePath).toEqual(['top-level test outside any describe']);
    expect(input.suitePath).toEqual([]);
    expect(toReportEntry(input, { rootDir: ROOT_DIR }).entry).not.toHaveProperty('suitePath');
  });

  it('splits a title that holds the JUnit separator, as the JUnit import reads it', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(29, { titles: ['cart', 'adds › removes'] }),
      withoutFile,
    );
    expect(input.identity.titlePath).toEqual(['cart adds', 'removes']);
  });

  it('keeps the values of test.each in the title, never as key parameters', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(30, { titles: ['username', 'alice has length 5'] }),
      withFile,
    );
    expect(input.identity).not.toHaveProperty('parameters');
    expect(keyOf(input)).toBe('src/login.test.js > username alice has length 5');
  });

  it('keys a file relative to the root directory, whatever the working directory', () => {
    const input = toResultInput(
      '/work/app/packages/web/cart.test.js',
      fakeCaseResult(29, { titles: ['adds'] }),
      withFile,
    );
    expect(keyOf(input)).toBe('packages/web/cart.test.js > adds');
    expect(input.suitePath).toEqual(['packages/web/cart.test.js']);
  });

  it('names the suite of a created case with the file of its key, normalized alike', () => {
    // A decomposed "é" (macOS file names): the key's file is NFC, and so is the suite.
    const input = toResultInput(
      `${ROOT_DIR}/src/café.test.js`,
      fakeCaseResult(29, { titles: ['adds'] }),
      withFile,
    );
    expect(keyOf(input)).toBe('src/café.test.js > adds');
    expect(input.suitePath).toEqual(['src/café.test.js']);
  });
});

describe("toResultInput with jest-junit's template quirks", () => {
  // jest-junit fills `{classname} {title}` with String.prototype.replace: `$` patterns of a title
  // expand, and a describe holding a template tag is filled too. The keys follow it exactly.
  const nameOf = (titles: readonly string[], displayName?: string) =>
    toResultInput(FILE, fakeCaseResult(30, { titles }), {
      ...withoutFile,
      ...(displayName === undefined ? {} : { displayName }),
    }).identity.titlePath.join(' › ');

  it('expands the $ patterns of a title like jest-junit', () => {
    expect(nameOf(['cart', 'costs $$5'])).toBe('cart costs $5');
    expect(nameOf(['cart', 'keeps $& as typed'])).toBe('cart keeps {title} as typed');
    expect(nameOf(['cart', 'puts $` first'])).toBe('cart puts cart  first');
    expect(nameOf(['cart', "puts $' last"])).toBe('cart puts  last');
    expect(nameOf(['cart', 'keeps $1 and $<name>'])).toBe('cart keeps $1 and $<name>');
  });

  it('expands the $ patterns of a describe like jest-junit', () => {
    expect(nameOf(['pays $$5', 'at once'])).toBe('pays $5 at once');
    expect(nameOf(['cart $&', 'adds'])).toBe('cart {classname} adds');
  });

  it('fills the template tags a describe or a title holds like jest-junit', () => {
    expect(nameOf(['cart {title}', 'adds'])).toBe('cart adds {title}');
    expect(nameOf(['cart', 'shows {displayName}'])).toBe('cart shows undefined');
    expect(nameOf(['cart', 'shows {displayName}'], 'dom')).toBe('cart shows dom');
    expect(nameOf(['cart', 'shows {filepath}'])).toBe('cart shows {filepath}');
  });
});

describe('toResultInput case links', () => {
  it('strips the ids of the configured project from the joined title and links them', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(29, { titles: ['[PRB-3] login', 'PRB-12 logs in (@PRB-13)'] }),
      withFile,
    );
    expect(input.identity.titlePath).toEqual(['login logs in']);
    expect(input.caseDisplayIds).toEqual(['PRB-3', 'PRB-12', 'PRB-13']);
    expect(input).not.toHaveProperty('caseDisplayId');
  });

  it('links one case as caseDisplayId, and keeps the ids of other projects in the title', () => {
    const one = toResultInput(
      FILE,
      fakeCaseResult(29, { titles: ['login', 'SHOP-4 PRB-12 logs in'] }),
      withFile,
    );
    expect(one.caseDisplayId).toBe('PRB-12');
    expect(one.identity.titlePath).toEqual(['login SHOP-4 logs in']);
    const none = toResultInput(FILE, fakeCaseResult(29, { titles: ['PRB-4 logs in'] }), {
      ...withFile,
      projectCodes: [],
    });
    expect(none.identity.titlePath).toEqual(['PRB-4 logs in']);
    expect(none).not.toHaveProperty('caseDisplayId');
    expect(none).not.toHaveProperty('caseDisplayIds');
  });
});

describe('toResultInput status', () => {
  it("maps Jest's statuses: passed, failed, and every kind of skip", () => {
    const statusOf = (status: string) =>
      toResultInput(FILE, fakeCaseResult(30, { status: status as 'passed' }), withFile).status;
    expect(['passed', 'failed', 'pending', 'skipped', 'disabled'].map(statusOf)).toEqual([
      'passed',
      'failed',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  it('keeps a test.todo as skipped with the note Todo', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(29, { status: 'todo', duration: null }),
      withFile,
    );
    expect(input).toMatchObject({ status: 'skipped', notes: 'Todo' });
    expect(input).not.toHaveProperty('durationMs');
    const plain = toResultInput(FILE, fakeCaseResult(29, { status: 'pending' }), withFile);
    expect(plain).not.toHaveProperty('notes');
  });
});

describe('toResultInput timing and errors', () => {
  it('sends the duration of the attempt and when it started', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(30, { duration: 42 }),
      withFile,
      1_790_000_000_000,
    );
    expect(input).toMatchObject({ durationMs: 42, startedAt: new Date(1_790_000_000_000) });
    const unknown = toResultInput(FILE, fakeCaseResult(29), withFile);
    expect(unknown).not.toHaveProperty('startedAt');
  });

  it('sends every failure message of the attempt as its errors, in order', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(29, {
        status: 'failed',
        failureMessages: [
          'Error: \u001b[31mexpected 1\u001b[39m\n    at login.test.js:3:7',
          'Error: second',
        ],
      }),
      withFile,
    );
    expect(input.error).toEqual([
      'Error: \u001b[31mexpected 1\u001b[39m\n    at login.test.js:3:7',
      'Error: second',
    ]);
    // Core writes them into the notes without the terminal colors.
    expect(toReportEntry(input, { rootDir: ROOT_DIR }).entry.notes).toBe(
      'Error: expected 1\n    at login.test.js:3:7\n\nError: second',
    );
    expect(toResultInput(FILE, fakeCaseResult(29), withFile)).not.toHaveProperty('error');
  });
});

describe('testIdOf', () => {
  it('tells the attempts of one test from another test of the same file', () => {
    const first = testIdOf(FILE, fakeCaseResult(29, { titles: ['a', 'b'], invocations: 1 }));
    expect(testIdOf(FILE, fakeCaseResult(29, { titles: ['a', 'b'], invocations: 2 }))).toBe(first);
    expect(testIdOf(FILE, fakeCaseResult(29, { titles: ['a b'] }))).not.toBe(first);
    expect(
      testIdOf(`${ROOT_DIR}/other.test.js`, fakeCaseResult(29, { titles: ['a', 'b'] })),
    ).not.toBe(first);
  });
});

describe('toResultInput with the probara.* details of the attempt', () => {
  function detailsWith(messages: readonly MetadataMessage[]): AttemptDetails {
    return {
      ...readMetadataMessages(messages),
      steps: [
        {
          action: 'Pay',
          status: 'failed',
          durationMs: 4,
          error: { message: 'declined' },
          attachments: [{ name: 'receipt', path: '/tmp/channel/files/1' }],
        },
      ],
      caseSteps: [{ action: 'Pay', expected: 'Paid' }],
      attachments: [{ name: 'log', fileName: 'log', contentType: 'text/plain', path: '/tmp/2' }],
    };
  }

  it('links the ids of probara.id() first, then those of the title, and takes the rest', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(30, { titles: ['cart', 'PRB-7 pays'] }),
      withFile,
      undefined,
      detailsWith([
        { type: 'id', value: ['PRB-9', 'PRB-7'] },
        { type: 'title', value: 'Pays by card' },
        { type: 'suite', value: ['Payments'] },
        { type: 'comment', value: 'visa' },
        { type: 'parameters', value: { card: 'visa' } },
        { type: 'tags', value: ['smoke'] },
      ]),
    );
    expect(input).toMatchObject({
      identity: { file: FILE, titlePath: ['cart pays'] },
      caseDisplayIds: ['PRB-9', 'PRB-7'],
      title: 'Pays by card',
      suitePath: ['Payments'],
      comment: 'visa',
      parameters: { card: 'visa' },
      case: { tags: ['smoke'], steps: [{ action: 'Pay', expected: 'Paid' }] },
      steps: [{ action: 'Pay', status: 'failed', attachments: [{ name: 'receipt' }] }],
      attachments: [{ name: 'log', path: '/tmp/2' }],
    });
  });

  it('keeps the suite of the key when probara.suite() says none', () => {
    const input = toResultInput(
      FILE,
      fakeCaseResult(29, { titles: ['cart', 'pays'] }),
      withoutFile,
      undefined,
      detailsWith([{ type: 'comment', value: 'visa' }]),
    );
    expect(input).toMatchObject({ suitePath: ['cart'], comment: 'visa' });
    expect(input).not.toHaveProperty('title');
    expect(input).not.toHaveProperty('caseDisplayId');
  });
});
