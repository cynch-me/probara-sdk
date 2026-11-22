import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { snapsOf } from './snap-collect.js';
import { SNAP_CONTENT_TYPE, SNAP_IMAGE_CONTENT_TYPE, SNAP_NAME } from './snap-transport.js';
import type { TestResultInput } from './result.js';

const scratch = mkdtempSync(join(tmpdir(), 'probara-core-snap-collect-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function staged(name: string, content: string): string {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
}

const base: TestResultInput = {
  identity: { file: 'tests/cart.test.ts', titlePath: ['cart', 'renders'] },
  status: 'passed',
  caseDisplayId: 'SHOP-7',
};

describe('snapsOf', () => {
  it('takes the screenshots out of the attachments of a result, each with its test, and leaves the other files', () => {
    const description = staged(
      'a.json',
      JSON.stringify({
        name: 'cart',
        viewport: { width: 414, height: 896 },
        colorMode: 'dark',
        threshold: 0.2,
      }),
    );
    const image = staged('a.png', 'png');
    const note = { name: 'note', path: staged('note.txt', 'kept'), contentType: 'text/plain' };

    const { input, screenshots } = snapsOf(
      {
        ...base,
        attachments: [
          note,
          { name: SNAP_NAME, path: description, contentType: SNAP_CONTENT_TYPE },
          { name: SNAP_NAME, path: image, contentType: SNAP_IMAGE_CONTENT_TYPE },
        ],
      },
      { retry: 1, rootDir: '/work/shop', browser: 'chromium' },
    );

    expect(input.attachments).toEqual([note]);
    expect(screenshots).toEqual([
      {
        name: 'cart',
        path: image,
        browser: 'chromium',
        viewport: { width: 414, height: 896 },
        colorMode: 'dark',
        threshold: 0.2,
        test: {
          automationKey: 'tests/cart.test.ts > cart > renders',
          caseDisplayIds: ['SHOP-7'],
          titlePath: ['cart', 'renders'],
          file: 'tests/cart.test.ts',
          retry: 1,
        },
      },
    ]);
  });

  it('leaves a result without screenshots as it is, and drops a description without its PNG', () => {
    expect(snapsOf(base, { retry: 0 })).toEqual({ input: base, screenshots: [] });

    const lonely = snapsOf(
      {
        ...base,
        attachments: [
          {
            name: SNAP_NAME,
            path: staged('b.json', JSON.stringify({ name: 'cart' })),
            contentType: SNAP_CONTENT_TYPE,
          },
        ],
      },
      { retry: 0 },
    );
    expect(lonely.screenshots).toEqual([]);
    expect(lonely.input).not.toHaveProperty('attachments');
  });
});
