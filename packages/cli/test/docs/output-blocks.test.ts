/**
 * `<!-- output: <scenario> -->` blocks equal the real output of their `$ ` command in that
 * scenario, and `<!-- dry-run -->` blocks equal the dry run of the XML example right before them.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeProbara, type FakeProbara } from '../support/fake-probara.js';
import { TOKEN } from '../support/run-cli.js';
import { baseEnv, createWorkspace, normalize, runProbara } from './harness.js';
import { fencedBlocks, read, shown, userDocs, type FencedBlock } from './markdown.js';
import { SCENARIOS } from './scenarios.js';
import { parseLine, probaraArgs, splitAssignments } from './shell.js';

interface Example {
  where: string;
  block: FencedBlock;
  /** The XML block a dry-run block belongs to. */
  xml?: FencedBlock;
}

const outputs: Example[] = [];
const dryRuns: Example[] = [];
for (const file of userDocs()) {
  const blocks = fencedBlocks(read(file));
  blocks.forEach((block, index) => {
    const where = `${shown(file)}:${block.line}`;
    if (block.marker?.startsWith('output:') === true) outputs.push({ where, block });
    if (block.marker === 'dry-run' || block.marker?.startsWith('dry-run:') === true) {
      const previous = blocks[index - 1];
      dryRuns.push({ where, block, ...(previous?.lang === 'xml' ? { xml: previous } : {}) });
    }
  });
}

let workspace: string;
let fake: FakeProbara;

beforeAll(async () => {
  workspace = await createWorkspace();
  await mkdir(join(workspace, 'examples'));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

describe('output blocks of the docs', () => {
  it('exist', () => {
    expect(outputs.length).toBeGreaterThan(5);
    expect(dryRuns.length).toBeGreaterThan(3);
  });

  it.each(outputs.map((example) => [example.where, example] as const))(
    '%s is the real output',
    async (_where, { block }) => {
      const id = (block.marker ?? '').slice('output:'.length).trim();
      const scenario = SCENARIOS[id];
      expect(scenario, `unknown scenario "${id}"`).toBeDefined();
      const [first = '', ...expected] = block.content.split('\n');
      expect(first.startsWith('$ '), 'the block starts with the "$ " command').toBe(true);

      const env = { ...baseEnv(), ...scenario?.env };
      const { assignments, command } = splitAssignments(
        (await parseLine(first.slice(2), env, () => Promise.resolve(''))).words,
      );
      const args = probaraArgs(command);
      expect(args, 'the command runs probara').toBeDefined();
      scenario?.setup?.(fake);
      const result = await runProbara(args ?? [], {
        env: { ...env, ...Object.fromEntries(assignments) },
        cwd: workspace,
        fake,
      });
      const shownOutput = result[scenario?.stream ?? 'combined'];

      expect(normalize(expected.join('\n'))).toBe(normalize(shownOutput.trimEnd(), fake));
    },
  );

  it.each(dryRuns.map((example) => [example.where, example] as const))(
    '%s is the dry run of the XML example before it',
    async (where, { block, xml }) => {
      expect(xml, 'an xml block comes right before the dry-run block').toBeDefined();
      const extra = (block.marker ?? '').replace(/^dry-run:?/, '').trim();
      const path = join('examples', `${basename(where).replace(/[^\w.-]/g, '_')}.xml`);
      await writeFile(join(workspace, path), `${xml?.content ?? ''}\n`);
      const args = [
        'import',
        'junit',
        path,
        '--dry-run',
        ...(extra === '' ? [] : extra.split(/\s+/)),
      ];

      const result = await runProbara(args, {
        env: { PROBARA_PROJECT: 'SHOP' },
        cwd: workspace,
        fake,
      });

      expect(result.exitCode).toBe(0);
      expect(normalize(block.content)).toBe(normalize(result.stdout.trimEnd()));
    },
  );
});
