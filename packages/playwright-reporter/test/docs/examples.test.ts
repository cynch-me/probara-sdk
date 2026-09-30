/** How the docs harness reads the examples of a page: code blocks into projects, outputs, sends. */
import { describe, expect, it } from 'vitest';
import {
  commandOf,
  expandArithmetic,
  expandCiExpressions,
  mentionsTool,
  normalize,
  pageOf,
  parseMarker,
  probaraLines,
} from './examples.js';

const PAGE = [
  '# Steps',
  '',
  '<!-- project: checkout -->',
  '',
  '```ts',
  '// tests/checkout.spec.ts',
  "import { test } from '@playwright/test';",
  "test('pays', async () => {});",
  '```',
  '',
  '<!-- project: checkout, exit: 1 -->',
  '',
  '```ts',
  "reporter: [['@probara/playwright-reporter', { captureOutput: true }]],",
  '```',
  '',
  '```ts',
  "import { defineConfig } from '@playwright/test';",
  'export default defineConfig({});',
  '```',
  '',
  '<!-- output: checkout, scenario: refused -->',
  '',
  '```text',
  '$ npx playwright test',
  '[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)',
  '```',
  '',
  '<!-- sent: checkout -->',
  '',
  '```json',
  '[{ "status": "passed" }]',
  '```',
  '',
  '<!-- files: checkout -->',
  '',
  '```text',
  'receipt.txt text/plain',
  '```',
  '',
  '```bash',
  'npx playwright test',
  '```',
  '',
].join('\n');

describe('the examples of a page', () => {
  const page = pageOf('docs/steps.md', PAGE);

  it('groups the code blocks of a project marker into one project, over the default files', () => {
    const checkout = page.projects.find((project) => project.id === 'checkout');
    expect(checkout?.exit).toBe(1);
    expect(checkout?.ownTests).toBe(true);
    expect(checkout?.files.get('tests/checkout.spec.ts')).toContain("test('pays'");
    // A fragment is wrapped into a whole config, after the defaults, so its keys win.
    const config = checkout?.files.get('playwright.config.ts') ?? '';
    expect(config).toMatch(/^import \{ defineConfig \} from '@playwright\/test';/);
    expect(config).toContain(
      "reporter: [['@probara/playwright-reporter', { captureOutput: true }]],",
    );
    expect(config.indexOf('captureOutput')).toBeGreaterThan(config.indexOf("testDir: './tests'"));
  });

  it('makes a project of each block without a marker, with the default tests when it has none', () => {
    const own = page.projects.filter((project) => project.id.startsWith('docs/steps.md:'));
    expect(own.map((project) => [project.id, project.exit, project.ownTests])).toEqual([
      ['docs/steps.md:17', 0, false],
    ]);
    expect(own[0]?.files.get('playwright.config.ts')).toBe(
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({});\n",
    );
  });

  it('reads the output and sent blocks with their project and scenario', () => {
    expect(page.outputs).toEqual([
      {
        where: 'docs/steps.md:24',
        project: 'checkout',
        scenario: 'refused',
        stream: 'stderr',
        commands: [
          {
            command: 'npx playwright test',
            expected: [
              '[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)',
            ],
          },
        ],
      },
    ]);
    expect(page.sent).toEqual([
      {
        where: 'docs/steps.md:31',
        project: 'checkout',
        scenario: '',
        entries: [{ status: 'passed' }],
      },
    ]);
    expect(page.files).toEqual([
      {
        where: 'docs/steps.md:37',
        project: 'checkout',
        scenario: '',
        files: ['receipt.txt text/plain'],
      },
    ]);
    expect(page.problems).toEqual([]);
  });

  it('names what it cannot run', () => {
    const broken = pageOf(
      'docs/x.md',
      [
        '```ts',
        'const total = 1 + 1;',
        '```',
        '',
        '<!-- output: nowhere -->',
        '',
        '```text',
        'no command',
        '```',
        '',
        '<!-- not-run: Qase code -->',
        '',
        '```ts',
        "import { qase } from 'playwright-qase-reporter';",
        '```',
      ].join('\n'),
    );
    expect(broken.problems).toEqual([
      'docs/x.md:1: a ts block the harness cannot place: start it with a path comment (// tests/<name>.spec.ts), or make it a whole config or test file',
      'docs/x.md:7: an output block starts with its "$ " command',
      'docs/x.md:7: output of the unknown project "nowhere"',
    ]);
    expect(broken.notRun).toEqual([{ where: 'docs/x.md:13', reason: 'Qase code' }]);
  });

  it.each([
    ['a tsx block', "```tsx\nimport { test } from '@playwright/test';\n```\n"],
    ['a json snippet', '```json\n{ "status": "passed" }\n```\n'],
    [
      'a text block with a misspelled files marker',
      '<!-- flies: x -->\n\n```text\na.txt text/plain\n```\n',
    ],
    [
      'a ts block with a misspelled project marker',
      "<!-- projcet: x -->\n\n```ts\nreporter: 'list',\n```\n",
    ],
  ])('fails %s: the docs tests would not run it', (_what, text) => {
    const { problems } = pageOf('docs/x.md', text);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^docs\/x\.md:\d+: an? \w+ block /);
  });

  it('lets a command block through: the command-line tests run it', () => {
    expect(pageOf('docs/x.md', '```bash\nnpx playwright test\n```\n').problems).toEqual([]);
  });
});

describe('parseMarker', () => {
  it('reads a name, its value and the settings after it', () => {
    expect(parseMarker('project: checkout, exit: 1')).toEqual({
      name: 'project',
      value: 'checkout',
      settings: { exit: '1' },
    });
    expect(parseMarker('options-table')).toEqual({
      name: 'options-table',
      value: '',
      settings: {},
    });
    expect(parseMarker(undefined)).toBeUndefined();
  });
});

describe('commandOf', () => {
  it('knows playwright, probara, installs and anything else', async () => {
    const env = { SHARD: '2' };
    expect(await commandOf('PROBARA_DEBUG=true npx playwright test --shard=$SHARD/4', env)).toEqual(
      {
        kind: 'playwright',
        args: ['test', '--shard=2/4'],
        assignments: [['PROBARA_DEBUG', 'true']],
      },
    );
    expect(await commandOf('npx @probara/cli run create', env)).toMatchObject({
      kind: 'probara',
      args: ['run', 'create'],
    });
    expect(
      await commandOf('pnpm exec playwright merge-reports ./all-blob-reports', env),
    ).toMatchObject({ kind: 'playwright', args: ['merge-reports', './all-blob-reports'] });
    for (const install of [
      'npm i -D @probara/playwright-reporter',
      'npm ci',
      'npx playwright install --with-deps',
      'pnpm add -D @probara/playwright-reporter',
    ]) {
      expect((await commandOf(install, env)).kind).toBe('install');
    }
    expect((await commandOf('echo done', env)).kind).toBe('other');
  });
});

describe('expandCiExpressions', () => {
  it('gives the matrix of a shard its first values, and leaves other expressions to fail', () => {
    expect(expandCiExpressions('--shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}')).toBe(
      '--shard=1/2',
    );
    expect(expandCiExpressions('--shard=${{ matrix.shard }}/4')).toBe('--shard=1/4');
    expect(() => expandCiExpressions('${{ secrets.PROBARA_API_TOKEN }}')).toThrow(
      'the docs tests cannot run ${{ secrets.PROBARA_API_TOKEN }} in a command line',
    );
  });
});

describe('expandArithmetic', () => {
  it('computes the shard number of CircleCI and Buildkite, from their 0-based index', () => {
    const env = { CIRCLE_NODE_INDEX: '0', BUILDKITE_PARALLEL_JOB: '3' };
    expect(expandArithmetic('--shard=$((CIRCLE_NODE_INDEX + 1))/2', env)).toBe('--shard=1/2');
    expect(expandArithmetic('SHARD="$((${BUILDKITE_PARALLEL_JOB}+1))"', env)).toBe('SHARD="4"');
    expect(() => expandArithmetic('$((UNSET + 1))', env)).toThrow('UNSET is not set');
  });
});

describe('mentionsTool', () => {
  it('finds playwright and probara commands, not package names', () => {
    expect(mentionsTool('npx playwright test --shard=1/2')).toBe(true);
    expect(mentionsTool('PROBARA_RUN_ULID=$(npx @probara/cli run create)')).toBe(true);
    expect(mentionsTool('probara run close')).toBe(true);
    expect(mentionsTool('npm i -D @probara/playwright-reporter @playwright/test')).toBe(false);
    expect(mentionsTool('uses: actions/upload-artifact@v4')).toBe(false);
  });
});

describe('probaraLines and normalize', () => {
  it('keep the reporter lines of stderr, without what varies from run to run', () => {
    const stderr = [
      'Warning: something from Node',
      '[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): http://127.0.0.1:4321/projects/SHOP/runs/R-1',
      '[probara] Wrote 1 result to /tmp/probara-docs-1/probara-results.json',
      '',
    ].join('\n');
    expect(
      probaraLines(stderr).map((line) =>
        normalize(line, { baseUrl: 'http://127.0.0.1:4321', dir: '/tmp/probara-docs-1' }),
      ),
    ).toEqual([
      '[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1',
      '[probara] Wrote 1 result to /work/shop/probara-results.json',
    ]);
    expect(
      normalize('Automated run 2026-09-30 01:37 UTC after 1043 ms: 01J9Z3K4M5N6P7Q8R9S0T1V2W3'),
    ).toBe('Automated run <DATE> UTC after <N> ms: <ULID>');
  });
});
