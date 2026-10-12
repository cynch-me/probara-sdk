/**
 * The copies of the files `probara.attach()` attaches (V-D65, V-D66). A file is copied, and a body is
 * written, when the call happens, into the files folder the reporter provides: a file removed right after
 * the call is still attached, and a file over the limit is never copied. The transport names each copy
 * by its UUID, as core reads it (`files/` under the folder). Node only: the Node entry of the helpers is
 * its one user.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MAX_ATTACHMENT_BYTES } from '@probara/core';
import type { StageInput, StageOutcome } from './probara-helpers.js';

/** The folder of a transport that holds the copies its `attachment` lines name. */
const FILES_FOLDER = 'files';

/** The reason a file over the limit is left out: core's own wording for the same limit. */
const TOO_LARGE = `it is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB`;

/** The error code of a Node file error, when it has one. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Copies `path` into `dir` under a new UUID, or says why it is left out. */
function stagePath(dir: string, path: string): StageOutcome {
  let size: number;
  let file: boolean;
  try {
    const info = statSync(path);
    size = info.size;
    file = info.isFile();
  } catch (error) {
    return { problem: codeOf(error) === 'ENOENT' ? 'it does not exist' : 'it cannot be read' };
  }
  if (!file) return { problem: 'it is not a file' };
  if (size > MAX_ATTACHMENT_BYTES) return { problem: TOO_LARGE };
  const copy = randomUUID();
  try {
    mkdirSync(join(dir, FILES_FOLDER), { recursive: true });
    copyFileSync(path, join(dir, FILES_FOLDER, copy));
  } catch (error) {
    return { problem: `it cannot be copied (${codeOf(error) ?? 'an error'})` };
  }
  return { staged: { copy, source: basename(path) } };
}

/** Writes a body into `dir` under a new UUID: a string as text, anything else as bytes. */
function stageBody(dir: string, body: string | ArrayBufferView): StageOutcome {
  const text = typeof body === 'string';
  const bytes = text
    ? Buffer.from(body, 'utf8')
    : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { problem: TOO_LARGE };
  const copy = randomUUID();
  try {
    mkdirSync(join(dir, FILES_FOLDER), { recursive: true });
    writeFileSync(join(dir, FILES_FOLDER, copy), bytes);
  } catch (error) {
    return { problem: `it cannot be copied (${codeOf(error) ?? 'an error'})` };
  }
  return { staged: { copy, body: text ? 'text' : 'bytes' } };
}

/** Stages a file or a body of `probara.attach()` into the files folder `dir`. Never throws. */
export function stageFile(dir: string, input: StageInput): StageOutcome {
  return 'path' in input ? stagePath(dir, input.path) : stageBody(dir, input.body);
}
