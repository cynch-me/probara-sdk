import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The README shows the example files verbatim, so the code readers copy is the code `pnpm
// typecheck` checks.
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

/** The code of every fenced block of `language` in `markdown`. */
function codeBlocks(markdown: string, language: string): string[] {
  const fence = new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, 'gm');
  return [...markdown.matchAll(fence)].map((match) => match[1] ?? '');
}

describe('README examples', () => {
  it('shows the type-checked Playwright reporter example as is', () => {
    const example = read('./playwright-reporter.ts');

    expect(codeBlocks(read('../README.md'), 'ts')).toContain(example);
    expect(example).toContain("from '@probara/core'");
    expect(example).toContain('attachments: result.attachments');
  });
});
