import { describe, expect, it } from 'vitest';
import { readPage, type DocProject, type OutputExample, type PageRules } from './examples.js';
import { executionCache, projectOf, shownLines } from './executions.js';

const RULES: PageRules = {
  languages: new Set(['js']),
  place: (block) => ({ path: 'a.test.js', content: block.content }),
  isTestFile: (path) => path.endsWith('.test.js'),
};

/** A page with the project `checkout` and a sent block of it. */
function pageWith(file: string, body: string) {
  return readPage(
    file,
    [
      '<!-- project: checkout -->',
      '',
      '```js',
      body,
      '```',
      '',
      '<!-- sent: checkout -->',
      '',
      '```json',
      '[]',
      '```',
    ].join('\n'),
    RULES,
  );
}

describe('projectOf', () => {
  const first = pageWith('a.md', "test('a', () => {});");
  const second = pageWith('b.md', "test('b', () => {});");
  const pages = [first, second];

  it('finds the project of the page of the block, when two pages share an id', () => {
    expect(projectOf(pages, 'b.md:9', 'checkout')).toBe(second.projects[0]);
    expect(projectOf(pages, 'a.md:9', 'checkout')).toBe(first.projects[0]);
  });

  it('is the docs project itself for `default`', () => {
    expect(projectOf(pages, 'a.md:9', 'default')).toBeUndefined();
  });
});

describe('executionCache', () => {
  it('runs a project once per scenario, and projects of the same id apart', async () => {
    const calls: string[] = [];
    const executionOf = executionCache((project: DocProject | undefined, scenario: string) => {
      calls.push(`${project?.where ?? 'default'}|${scenario}`);
      return Promise.resolve(calls.length);
    });
    const project = (where: string): DocProject => ({
      id: 'checkout',
      where,
      files: new Map(),
      ownTests: false,
      exit: 0,
      reports: true,
    });

    expect(await executionOf(project('a.md:3'), '')).toBe(1);
    expect(await executionOf(project('a.md:3'), '')).toBe(1);
    expect(await executionOf(project('b.md:3'), '')).toBe(2);
    expect(await executionOf(project('a.md:3'), 'refused')).toBe(3);
    expect(await executionOf(undefined, '')).toBe(4);
    expect(calls).toEqual(['a.md:3|', 'b.md:3|', 'a.md:3|refused', 'default|']);
  });
});

describe('shownLines', () => {
  const example = (stream: 'stderr' | 'stdout'): OutputExample => ({
    where: 'a.md:1',
    project: 'default',
    scenario: '',
    stream,
    commands: [],
  });
  const run = { stdout: 'passed\tSHOP-1\tkey\n', stderr: 'PASS a.test.js\n[probara] Sent\n' };

  it('is the [probara] lines of stderr', () => {
    expect(shownLines(example('stderr'), 'probara', run)).toBe('[probara] Sent');
    expect(shownLines(example('stdout'), 'jest', run)).toBe('[probara] Sent');
  });

  it("is the CLI's stdout with stream: stdout", () => {
    expect(shownLines(example('stdout'), 'probara', run)).toBe('passed\tSHOP-1\tkey');
  });
});
