/** How the docs harness reads the examples of a page: code blocks into Jest projects, commands. */
import { describe, expect, it } from 'vitest';
import { commandOf, mentionsTool, pageOf, unshownLines } from './examples.js';

const PAGE = [
  '# Steps',
  '',
  '<!-- project: checkout -->',
  '',
  '```js',
  '// tests/checkout.test.js',
  "const { probara } = require('@probara/jest-reporter');",
  "test('pays', () => probara.tags('smoke'));",
  '```',
  '',
  '<!-- project: checkout, exit: 1 -->',
  '',
  '```js',
  "reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],",
  "setupFilesAfterEnv: ['@probara/jest-reporter/setup'],",
  '```',
  '',
  '```js',
  "module.exports = { reporters: ['default', '@probara/jest-reporter'] };",
  '```',
  '',
  '```js',
  "test('adds an item', () => {});",
  '```',
  '',
  '```json',
  '{ "status": "passed" }',
  '```',
  '',
  '<!-- project: esm -->',
  '',
  '```js',
  '// jest.config.mjs',
  "export default { reporters: ['default', '@probara/jest-reporter'] };",
  '```',
  '',
  '<!-- project: esm -->',
  '',
  '```json',
  '// package.json',
  '{ "private": true, "type": "module" }',
  '```',
  '',
].join('\n');

describe('the examples of a Jest page', () => {
  const page = pageOf('docs/steps.md', PAGE);
  const byId = (id: string) => page.projects.find((project) => project.id === id);

  it('wraps config keys into the default jest.config.js, after its own keys, so they win', () => {
    const checkout = byId('checkout');
    expect(checkout?.exit).toBe(1);
    expect(checkout?.ownTests).toBe(true);
    expect(checkout?.files.get('tests/checkout.test.js')).toContain("test('pays'");
    const config = checkout?.files.get('jest.config.js') ?? '';
    expect(config).toMatch(/^module\.exports = \{\n {2}testEnvironment: 'node',/);
    expect(config).toContain(
      "  reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],\n  setupFilesAfterEnv: ['@probara/jest-reporter/setup'],\n};",
    );
    expect(config.indexOf('captureOutput')).toBeGreaterThan(config.indexOf('testEnvironment'));
  });

  it('places a whole config, a test file and a file named by its path comment', () => {
    expect(byId('docs/steps.md:18')?.files.get('jest.config.js')).toBe(
      "module.exports = { reporters: ['default', '@probara/jest-reporter'] };\n",
    );
    expect(byId('docs/steps.md:18')?.ownTests).toBe(false);
    expect([...(byId('docs/steps.md:22')?.files ?? [])]).toEqual([
      ['tests/example.test.js', "test('adds an item', () => {});\n"],
    ]);
    expect(byId('docs/steps.md:22')?.ownTests).toBe(true);
    expect([...(byId('esm')?.files.keys() ?? [])]).toEqual(['jest.config.mjs', 'package.json']);
    expect(byId('esm')?.files.get('package.json')).toBe('{ "private": true, "type": "module" }\n');
  });

  it('names a block it cannot place, and a JSON block without a path', () => {
    expect(page.projects.map((project) => project.id)).toEqual([
      'checkout',
      'docs/steps.md:18',
      'docs/steps.md:22',
      'esm',
    ]);
    expect(page.problems).toEqual([
      'docs/steps.md:26: a json block the docs tests do not run: start it with a path comment (// package.json), or mark it (output, sent, files)',
    ]);
    expect(pageOf('docs/x.md', '```js\nconst total = 1 + 1;\n```\n').problems).toEqual([
      'docs/x.md:1: a js block the harness cannot place: start it with a path comment (// tests/<name>.test.js), or make it a whole config or test file',
    ]);
  });
});

describe('a block the docs tests would not run', () => {
  it.each([
    [
      'a text block with a misspelled output marker',
      '<!-- ouptut: default -->\n\n```text\n$ npx jest\n```\n',
    ],
    [
      'a text block with a misspelled files marker',
      '<!-- flies: default -->\n\n```text\nstdout.log text/plain\n```\n',
    ],
    [
      'a text block whose marker prose detached',
      '<!-- output: default -->\n\nIt logs:\n\n```text\n$ npx jest\n```\n',
    ],
    ['a json block with a misspelled sent marker', '<!-- snet: default -->\n\n```json\n[]\n```\n'],
    ['a jsx block', "```jsx\ntest('renders', () => {});\n```\n"],
    ['a tsx block', "```tsx\ntest('renders', () => {});\n```\n"],
    ['a block without a language', '```\n$ npx jest\n```\n'],
    [
      'a bash block with a marker the harness does not know',
      '<!-- ouptut: default -->\n\n```bash\nnpx jest\n```\n',
    ],
  ])('fails %s, naming where it is', (_what, text) => {
    const { problems } = pageOf('docs/x.md', text);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^docs\/x\.md:\d+: an? \w* ?block /);
  });

  it('lets a command block through: the command-line tests run it', () => {
    const text = '```bash\nnpx jest\n```\n\n```yaml\nsteps:\n  - run: npx jest\n```\n';

    expect(pageOf('docs/x.md', text).problems).toEqual([]);
  });
});

describe('commandOf', () => {
  it('knows jest as the docs run it, probara, installs and anything else', async () => {
    const env = { SHARD: '2' };
    expect(await commandOf('PROBARA_DEBUG=true npx jest --shard=$SHARD/4', env)).toEqual({
      kind: 'jest',
      args: ['--shard=2/4'],
      assignments: [['PROBARA_DEBUG', 'true']],
    });
    expect(await commandOf('pnpm exec jest --ci', env)).toMatchObject({
      kind: 'jest',
      args: ['--ci'],
    });
    expect(await commandOf('yarn jest', env)).toMatchObject({ kind: 'jest', args: [] });
    expect(await commandOf('npm test -- --shard=1/2', env)).toMatchObject({
      kind: 'jest',
      args: ['--shard=1/2'],
    });
    expect(await commandOf('npx @probara/cli run create', env)).toMatchObject({
      kind: 'probara',
      args: ['run', 'create'],
    });
    for (const install of ['npm i -D @probara/jest-reporter', 'npm ci', 'pnpm add -D jest']) {
      expect((await commandOf(install, env)).kind).toBe('install');
    }
    expect((await commandOf('echo done', env)).kind).toBe('other');
  });

  it.each([
    ['pnpm test -- --shard=1/2', ['--shard=1/2']],
    ['pnpm test', []],
    ['pnpm run test -- --ci', ['--ci']],
    ['yarn test --ci', ['--ci']],
    ['yarn run test', []],
    ['npx jest@30 --ci', ['--ci']],
    ['npx jest@30.2.0', []],
  ])("knows %s as the docs project's jest", async (line, args) => {
    expect(await commandOf(line, {})).toMatchObject({ kind: 'jest', args });
  });
});

describe('mentionsTool', () => {
  it('finds jest, npm test and probara commands, not package or file names', () => {
    expect(mentionsTool('npx jest --shard=1/2')).toBe(true);
    expect(mentionsTool('run: npm test -- --ci')).toBe(true);
    expect(mentionsTool('PROBARA_RUN_ULID=$(npx @probara/cli run create)')).toBe(true);
    expect(mentionsTool('npm i -D @probara/jest-reporter')).toBe(false);
    expect(mentionsTool('cat jest.config.js')).toBe(false);
    for (const line of ['pnpm test', 'run: yarn test --ci', 'pnpm run test', 'npx jest@30 --ci']) {
      expect(mentionsTool(line), line).toBe(true);
    }
  });
});

describe('unshownLines', () => {
  it('keeps the lines no output block shows, but those of a clean report', () => {
    const stderr = [
      '[probara] Ignored the unknown option "captureOutputs" of @probara/jest-reporter',
      '[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)',
      '[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://x/runs/R-1',
      '[probara] Attached 2 files to results (0 skipped, 0 failed)',
      '[probara] Attached 1 file to results (0 skipped, 1 failed)',
      'PASS tests/checkout.test.js',
    ].join('\n');

    expect(unshownLines(stderr, [], {})).toEqual([
      '[probara] Ignored the unknown option "captureOutputs" of @probara/jest-reporter',
      '[probara] Attached 1 file to results (0 skipped, 1 failed)',
    ]);
    expect(
      unshownLines(stderr, ['[probara] Attached 1 file to results (0 skipped, 1 failed)'], {}),
    ).toEqual(['[probara] Ignored the unknown option "captureOutputs" of @probara/jest-reporter']);
  });
});
