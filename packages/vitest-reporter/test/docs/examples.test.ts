/**
 * How the docs harness reads the examples of a page: where each code block of a Vitest page goes, which command lines
 * the harness runs, what it refuses, and what a planted wrong page reports (every problem is counted, none is dropped).
 */
import { describe, expect, it } from 'vitest';
import { commandOf, mentionsTool, numberUlids, pageOf, unshownLines } from './examples.js';

describe('the examples of a Vitest page', () => {
  it('wraps config keys into the default vitest.config.mts, so they win over its own', () => {
    const page = pageOf(
      'docs/x.md',
      [
        '```ts',
        "reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],",
        '```',
      ].join('\n'),
    );
    const config = page.projects[0]?.files.get('vitest.config.mts') ?? '';
    expect(config).toContain("include: ['tests/**/*.test.ts']");
    expect(config).toContain(
      "reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],",
    );
    expect(page.problems).toEqual([]);
  });

  it('places a whole config, a test file and a file named by its path comment', () => {
    const page = pageOf(
      'docs/x.md',
      [
        '```ts',
        "import { defineConfig } from 'vitest/config';",
        'export default defineConfig({ test: { reporters: [] } });',
        '```',
        '',
        '```ts',
        "import { it } from 'vitest';",
        "it('adds', () => {});",
        '```',
        '',
        '```ts',
        '// tests/cart.test.ts',
        "import { it } from 'vitest';",
        "it('removes', () => {});",
        '```',
      ].join('\n'),
    );
    const [config, test, named] = page.projects;
    expect([...(config?.files.keys() ?? [])]).toEqual(['vitest.config.mts']);
    expect([...(test?.files.keys() ?? [])]).toEqual(['tests/example.test.ts']);
    expect([...(named?.files.keys() ?? [])]).toEqual(['tests/cart.test.ts']);
    expect(page.problems).toEqual([]);
  });

  it('names every block it cannot place, and counts each planted problem', () => {
    const page = pageOf(
      'docs/x.md',
      [
        '```ts',
        'const answer = 42;',
        '```',
        '',
        '```json',
        '{ "reporters": [] }',
        '```',
        '',
        '<!-- sent: default -->',
        '```json',
        'not json',
        '```',
        '',
        '<!-- prjoect: default -->',
        '```ts',
        "it('x', () => {});",
        '```',
      ].join('\n'),
    );
    // Four planted problems: the block that places nowhere, the JSON block without a path, the sent block that is not JSON, and the misspelled marker.
    expect(page.problems).toHaveLength(4);
    expect(page.problems.join('\n')).toMatch(/a ts block the harness cannot place/);
    expect(page.problems.join('\n')).toMatch(/a sent block is not JSON/);
    expect(page.problems.join('\n')).toMatch(/the marker "prjoect" the docs tests do not know/);
  });

  it('leaves a command block without a marker to the command-line tests, and flags a marked one', () => {
    const page = pageOf(
      'docs/x.md',
      [
        '```bash',
        'npx vitest run',
        '```',
        '',
        '<!-- project: default -->',
        '```bash',
        'npx vitest run',
        '```',
      ].join('\n'),
    );
    expect(page.unused.map((block) => block.lang)).toEqual(['bash', 'bash']);
    expect(page.problems).toHaveLength(1);
    expect(page.problems[0]).toMatch(/a bash block after a project marker/);
  });
});

describe('commandOf', () => {
  it('knows vitest as the docs run it, probara, installs and anything else', async () => {
    const env = {};
    expect((await commandOf('npx vitest run', env)).kind).toBe('vitest');
    expect((await commandOf('npx vitest@5 run --shard=1/2', env)).args).toEqual([
      'run',
      '--shard=1/2',
    ]);
    expect((await commandOf('pnpm exec vitest run', env)).kind).toBe('vitest');
    expect((await commandOf('npm test -- --reporter=dot', env)).args).toEqual([
      'run',
      '--reporter=dot',
    ]);
    expect((await commandOf('probara import junit reports/vitest.xml', env)).kind).toBe('probara');
    expect((await commandOf('npx @probara/cli run create', env)).kind).toBe('probara');
    expect((await commandOf('npm install @probara/vitest-reporter', env)).kind).toBe('install');
    expect((await commandOf('echo hello', env)).kind).toBe('other');
  });
});

describe('mentionsTool', () => {
  it('finds vitest, npm test and probara commands, not package or file names', () => {
    expect(mentionsTool('npx vitest run')).toBe(true);
    expect(mentionsTool('pnpm test')).toBe(true);
    expect(mentionsTool('echo "$(probara run create)"')).toBe(true);
    expect(mentionsTool('npm install @probara/vitest-reporter')).toBe(false);
    expect(mentionsTool('cat vitest.config.mts')).toBe(false);
  });
});

describe('unshownLines', () => {
  it('keeps the warnings no output block shows, and not the lines of a clean report', () => {
    const stderr = [
      '[probara] Sending 2 results of 2 tests to SHOP',
      '[probara] Recorded run 01J9Z3K4M5N6P7Q8R9S0T1V2W3',
      '[probara] Attached 1 file to results (0 skipped, 0 failed)',
      '[probara] runCasesOnly: could not read the cases',
    ].join('\n');
    expect(unshownLines(stderr, [], { baseUrl: 'http://x', dir: '/w' })).toEqual([
      '[probara] runCasesOnly: could not read the cases',
    ]);
  });
});

describe('numberUlids', () => {
  const R1 = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
  const R2 = '01J9Z3K4M5N6P7Q8R9S0T1V2W4';

  it('numbers distinct ULIDs in the order they first appear, whatever their values, and a repeat keeps its number', () => {
    const logged = `into ${R1}\nclose ${R1}\nmoved to ${R2}\nclose ${R2}`;
    expect(numberUlids(logged)).toBe(
      'into <ULID 1>\nclose <ULID 1>\nmoved to <ULID 2>\nclose <ULID 2>',
    );
    // The docs may show any ULIDs: only which lines share one counts.
    const shown = logged
      .replaceAll(R1, '01ARZ3NDEKTSV4RRFFQ69G5FAV')
      .replaceAll(R2, '01BX5ZZKBKACTAV9WEVGEMMVRZ');
    expect(numberUlids(shown)).toBe(numberUlids(logged));
    expect(numberUlids(`close ${R1}\nclose ${R1}`)).not.toBe(
      numberUlids(`close ${R1}\nclose ${R2}`),
    );
  });
});
