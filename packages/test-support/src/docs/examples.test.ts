import { describe, expect, it } from 'vitest';
import { readPage, type PageRules } from './examples.js';

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
      '<!-- ouptut: default -->',
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
      { where: 'x.md:7', lang: 'text', marker: 'ouptut' },
      { where: 'x.md:11', lang: 'js', marker: undefined },
    ]);
    expect(page.projects).toHaveLength(1);
    expect(page.outputs).toHaveLength(1);
  });
});
