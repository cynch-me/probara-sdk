import { describe, expect, it } from 'vitest';
import { readPage, unusedProblems, type PageRules } from './examples.js';

/** Rules that place `js` blocks, but not a `js` block that says `skip`. */
const RULES: PageRules = {
  languages: new Set(['js']),
  place: (block) =>
    block.content.includes('skip') ? undefined : { path: 'a.test.js', content: block.content },
  isTestFile: (path) => path.endsWith('.test.js'),
};

describe('readPage', () => {
  it('lists the blocks it does not use, with their marker, so a harness can refuse them', () => {
    const text = [
      '```bash',
      'npx jest',
      '```',
      '',
      '<!-- project: a -->',
      '',
      '```text',
      '$ npx jest',
      '```',
      '',
      '```js',
      '// skip',
      '```',
      '',
      '```js',
      "test('a', () => {});",
      '```',
      '',
      '<!-- output: default -->',
      '',
      '```text',
      '$ npx jest',
      '```',
    ].join('\n');

    const page = readPage('x.md', text, RULES);

    expect(page.unused).toEqual([
      { where: 'x.md:1', lang: 'bash', marker: undefined },
      { where: 'x.md:7', lang: 'text', marker: 'project' },
      { where: 'x.md:11', lang: 'js', marker: undefined },
    ]);
    expect(page.projects).toHaveLength(1);
    expect(page.outputs).toHaveLength(1);
    expect(page.problems).toEqual([]);
  });

  it.each([
    [
      'a text block with a misspelled output marker',
      '<!-- ouptut: default -->\n\n```text\n$ npx jest\n```\n',
    ],
    [
      'a text block with a misspelled files marker',
      '<!-- flies: default -->\n\n```text\na.txt text/plain\n```\n',
    ],
    ['a json block with a misspelled sent marker', '<!-- snet: default -->\n\n```json\n[]\n```\n'],
    [
      'a bash block with a misspelled output marker',
      '<!-- ouptut: default -->\n\n```bash\nnpx jest\n```\n',
    ],
    [
      'a js block with a misspelled project marker, which would split its project',
      "<!-- projcet: a -->\n\n```js\ntest('a', () => {});\n```\n",
    ],
  ])('refuses %s, naming the markers it knows', (_what, text) => {
    const page = readPage('x.md', text, RULES);

    expect(page.problems).toEqual([
      expect.stringMatching(
        /^x\.md:\d+: an? \w+ block with the marker "\w+" the docs tests do not know: project, output, sent, files, not-run$/,
      ),
    ]);
    expect(page.projects).toEqual([]);
    expect(page.unused).toEqual([]);
  });
});

describe('unusedProblems', () => {
  const problemsOf = (text: string) => unusedProblems(readPage('x.md', text, RULES), RULES);

  it('lets a command block without a marker through: the command-line tests run it', () => {
    expect(
      problemsOf('```bash\nnpx jest\n```\n\n```yaml\nsteps:\n  - run: npx jest\n```\n'),
    ).toEqual([]);
  });

  it.each([
    [
      'a block with a detached marker',
      '<!-- output: default -->\n\nIt logs:\n\n```text\n$ npx jest\n```\n',
      'x.md:5: a text block the docs tests do not run: write it in a language they run (js, bash, sh, shell, yaml, yml, groovy), or mark it (output, sent, files)',
    ],
    [
      'a jsx block',
      "```jsx\ntest('a', () => {});\n```\n",
      'x.md:1: a jsx block the docs tests do not run: write it in a language they run (js, bash, sh, shell, yaml, yml, groovy), or mark it (output, sent, files)',
    ],
    [
      'a block without a language',
      '```\n$ npx jest\n```\n',
      'x.md:1: a plain block the docs tests do not run: write it in a language they run (js, bash, sh, shell, yaml, yml, groovy), or mark it (output, sent, files)',
    ],
    [
      'a block the rules leave out',
      '```js\n// skip\n```\n',
      'x.md:1: a js block the docs tests do not run: start it with a path comment (// <file>.js), or mark it (output, sent, files)',
    ],
    [
      'a command block after a project marker',
      '<!-- project: a -->\n\n```bash\nnpx jest\n```\n',
      'x.md:3: a bash block after a project marker: a project holds js files; drop the marker (the command-line tests run the block)',
    ],
  ])('refuses %s, saying what to do', (_what, text, problem) => {
    expect(problemsOf(text)).toEqual([problem]);
  });
});
