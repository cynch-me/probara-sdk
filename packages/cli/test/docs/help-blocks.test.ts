/** Every `<!-- help: <command> -->` block is the real `--help` output, byte for byte. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../support/run-cli.js';
import { fencedBlocks, PACKAGE_DIR, read, shown, userDocs } from './markdown.js';

/** `probara`, `import`, `run create`... as the arguments before `--help`. */
function commandOf(marker: string): string[] {
  return marker
    .slice('help:'.length)
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'probara');
}

const blocks = userDocs().flatMap((file) =>
  fencedBlocks(read(file))
    .filter((block) => block.marker?.startsWith('help:') === true)
    .map((block) => ({ file, block, command: commandOf(block.marker ?? '') })),
);

describe('help blocks of the docs', () => {
  it('show the help of probara, of each group and of each command in docs/commands.md', () => {
    const commands = fencedBlocks(read(join(PACKAGE_DIR, 'docs', 'commands.md')))
      .filter((block) => block.marker?.startsWith('help:') === true)
      .map((block) => commandOf(block.marker ?? '').join(' '));

    expect(commands.sort()).toEqual(
      ['', 'import', 'import junit', 'run', 'run close', 'run create'].sort(),
    );
  });

  it.each(
    blocks.map(
      ({ file, block, command }) => [`${shown(file)}:${block.line}`, command, block] as const,
    ),
  )('%s equals the output of --help', async (_where, command, block) => {
    const result = await runCli([...command, '--help']);

    expect(result.exitCode).toBe(0);
    expect(`${block.content}\n`).toBe(result.stdout);
  });
});
