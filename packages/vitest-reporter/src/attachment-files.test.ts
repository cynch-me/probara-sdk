import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageFile } from './attachment-files.js';

// Only the copy is replaced, and only where a test says so: a file that grows between its check and its copy.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) };
});

const MIB = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let work: string;
let dir: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'probara-stage-work-'));
  dir = mkdtempSync(join(tmpdir(), 'probara-stage-dir-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

/** The content of the copy a staged file names, as the transport's `files/` folder holds it. */
function copyOf(copy: string): Buffer {
  return readFileSync(join(dir, 'files', copy));
}

describe('stageFile', () => {
  it('copies a file under a UUID name when it is called, so a file removed right after is still staged', () => {
    const path = join(work, 'receipt.txt');
    writeFileSync(path, 'Total: 25.00');
    const outcome = stageFile(dir, { path });
    rmSync(path);
    if (!('staged' in outcome)) throw new Error(outcome.problem);
    expect(outcome.staged.copy).toMatch(UUID);
    expect(outcome.staged.source).toBe('receipt.txt');
    expect(outcome.staged.body).toBeUndefined();
    expect(copyOf(outcome.staged.copy).toString()).toBe('Total: 25.00');
  });

  it('writes a string body as text and a byte body as bytes, with their exact content', () => {
    const text = stageFile(dir, { body: 'paid in 1.2 s' });
    const bytes = stageFile(dir, { body: new Uint8Array([0, 1, 254, 255]) });
    if (!('staged' in text)) throw new Error(text.problem);
    if (!('staged' in bytes)) throw new Error(bytes.problem);
    expect(text.staged).toMatchObject({ body: 'text' });
    expect(copyOf(text.staged.copy).toString()).toBe('paid in 1.2 s');
    expect(bytes.staged).toMatchObject({ body: 'bytes' });
    expect([...copyOf(bytes.staged.copy)]).toEqual([0, 1, 254, 255]);
  });

  it('leaves out a file that does not exist, with the reason', () => {
    const outcome = stageFile(dir, { path: join(work, 'missing.txt') });
    if (!('problem' in outcome)) throw new Error('a missing file was staged');
    expect(outcome.problem).toBe('it does not exist');
  });

  it('leaves out a directory: only a file can be attached', () => {
    const outcome = stageFile(dir, { path: work });
    expect(outcome).toEqual({ problem: 'it is not a file' });
  });

  it('keeps a file of 32 MiB, and leaves out a larger one before it is copied', () => {
    const at = join(work, 'at-limit.bin');
    writeFileSync(at, '');
    truncateSync(at, 32 * MIB);
    expect('staged' in stageFile(dir, { path: at })).toBe(true);
    const over = join(work, 'over-limit.bin');
    writeFileSync(over, '');
    truncateSync(over, 32 * MIB + 1);
    expect(stageFile(dir, { path: over })).toEqual({ problem: 'it is larger than 32 MiB' });
  });

  it('leaves out a copy that grew past 32 MiB after its check, and removes it', () => {
    const grows = join(work, 'grows.bin');
    writeFileSync(grows, 'small when it is checked');
    vi.mocked(copyFileSync).mockImplementationOnce((_source, target) => {
      writeFileSync(target, '');
      truncateSync(target, 32 * MIB + 1);
    });
    expect(stageFile(dir, { path: grows })).toEqual({ problem: 'it is larger than 32 MiB' });
    expect(readdirSync(join(dir, 'files'))).toEqual([]);
  });

  it('leaves out a body over 32 MiB, with the same reason', () => {
    expect(stageFile(dir, { body: Buffer.alloc(32 * MIB + 1) })).toEqual({
      problem: 'it is larger than 32 MiB',
    });
  });
});
