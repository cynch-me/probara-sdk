/**
 * The reporter's side of the channel (see `channel.ts`): it creates the channel directory, reads
 * the lines the test processes appended since it last looked, and assembles each attempt's
 * metadata, step tree and files for its result.
 */
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  hasFileExtension,
  readMetadataMessages,
  type AttachmentInput,
  type AttemptMetadata,
  type CaseStep,
  type TestStepInput,
} from '@probara/core';
import {
  attemptKey,
  FILES_FOLDER,
  LINES_EXTENSION,
  SELECTION_FAILURES,
  type ChannelLine,
  type SelectionFailure,
} from './channel.js';
import { testIdOf } from './translate.js';

/** A warning a test process wrote: a wrong argument, or a call while no test ran. */
export interface ChannelWarning {
  message: string;
  /** The test file and the test it was given in, when a test ran. */
  file?: string;
  test?: string;
}

/** What the helpers said about one attempt, ready for its result. */
export interface AttemptDetails {
  metadata: AttemptMetadata;
  /** Malformed metadata that was left out. */
  problems: string[];
  /** The steps of `probara.step()`, nested as they ran, with the files attached inside each. */
  steps: TestStepInput[];
  /** The outermost steps, in the order they started: the steps of the case a report creates. */
  caseSteps: CaseStep[];
  /** The files attached outside any step. */
  attachments: AttachmentInput[];
}

export interface Channel {
  /** The directory the test processes write to. */
  readonly dir: string;
  /**
   * The details of every attempt of the test file `file` the test processes wrote so far, by
   * `attemptKey`; they are handed out once. Never throws.
   */
  take(file: string): Map<string, AttemptDetails>;
  /** Whether the setup file ran in the test file `file` so far. Never throws. */
  hasSetup(file: string): boolean;
  /**
   * The tests of `file` the setup file skipped as they match no case of the run (`runCasesOnly`),
   * each as `testIdOf` names it. Never throws.
   */
  deselected(file: string): Set<string>;
  /**
   * Why the setup file could not skip the tests of `file` that match no case of the run
   * (`runCasesOnly`), when it could not: every test of it then ran. Never throws.
   */
  selectionFailure(file: string): SelectionFailure | undefined;
  /**
   * Removes the channel, the copies of attached files too: a results file keeps its own copies
   * (they are `temporary`). Never throws.
   */
  close(): void;
}

const UNFINISHED = 'The step had not finished when the test ended';
/** The name every copy gets: a UUID, never a path. */
const COPY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The content type of an attached file without one, from its extension, as Playwright infers it. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

type TestLine = Exclude<
  ChannelLine,
  { type: 'warning' } | { type: 'setup' } | { type: 'selection' }
>;
type AttachmentLine = Extract<ChannelLine, { type: 'attachment' }>;

interface StepNode {
  action: string;
  expected?: string;
  data?: string;
  status?: 'passed' | 'failed';
  durationMs?: number;
  error?: { message?: string; stack?: string };
  children: StepNode[];
  files: AttachmentInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTestLine(line: Record<string, unknown>): line is Record<string, unknown> & TestLine {
  return (
    typeof line.file === 'string' &&
    typeof line.test === 'string' &&
    typeof line.attempt === 'number' &&
    typeof line.type === 'string'
  );
}

function optional(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A file of the channel as core uploads it, named and typed like Playwright names its files. */
function attachmentOf(line: AttachmentLine, dir: string): AttachmentInput | undefined {
  if (typeof line.copy !== 'string' || !COPY_NAME.test(line.copy)) return undefined;
  if (typeof line.name !== 'string') return undefined;
  const source = optional(line.source);
  const extension = source === undefined ? '' : extname(source);
  const given = line.name.trim();
  const fileName =
    source === undefined
      ? line.name
      : given === ''
        ? source
        : hasFileExtension(given)
          ? given
          : `${given}${extension}`;
  const contentType =
    optional(line.contentType) ??
    (source !== undefined
      ? CONTENT_TYPES[extension.toLowerCase()]
      : line.body === 'text'
        ? 'text/plain'
        : undefined);
  return {
    name: line.name,
    fileName,
    ...(contentType === undefined ? {} : { contentType }),
    path: join(dir, FILES_FOLDER, line.copy),
    // Removed with the channel: a results file keeps a copy next to it.
    temporary: true,
  };
}

function stepOf(node: StepNode): TestStepInput {
  const finished = node.status !== undefined;
  const error = finished ? node.error : { message: UNFINISHED };
  return {
    action: node.action,
    status: node.status ?? 'failed',
    ...(node.durationMs === undefined ? {} : { durationMs: node.durationMs }),
    ...(error === undefined ? {} : { error }),
    ...(node.expected === undefined ? {} : { expected: node.expected }),
    ...(node.data === undefined ? {} : { data: node.data }),
    ...(node.children.length === 0 ? {} : { steps: node.children.map(stepOf) }),
    ...(node.files.length === 0 ? {} : { attachments: node.files }),
  };
}

/** The details of one attempt from its lines, in the order they were written. */
export function detailsOf(lines: readonly TestLine[], dir: string): AttemptDetails {
  const messages: unknown[] = [];
  const nodes = new Map<string, StepNode>();
  const roots: StepNode[] = [];
  const attachments: AttachmentInput[] = [];
  for (const line of lines) {
    switch (line.type) {
      case 'message':
        messages.push(line.message);
        break;
      case 'step-start': {
        if (typeof line.step !== 'string' || typeof line.action !== 'string') break;
        const node: StepNode = {
          action: line.action,
          ...(typeof line.expected === 'string' ? { expected: line.expected } : {}),
          ...(typeof line.data === 'string' ? { data: line.data } : {}),
          children: [],
          files: [],
        };
        nodes.set(line.step, node);
        const parent = line.parent === undefined ? undefined : nodes.get(line.parent);
        (parent?.children ?? roots).push(node);
        break;
      }
      case 'step-end': {
        const node = nodes.get(line.step);
        const status: unknown = line.status;
        if (node === undefined || (status !== 'passed' && status !== 'failed')) break;
        node.status = status;
        if (typeof line.durationMs === 'number') node.durationMs = line.durationMs;
        if (isRecord(line.error)) {
          node.error = {
            ...(typeof line.error.message === 'string' ? { message: line.error.message } : {}),
            ...(typeof line.error.stack === 'string' ? { stack: line.error.stack } : {}),
          };
        }
        break;
      }
      case 'attachment': {
        const file = attachmentOf(line, dir);
        if (file === undefined) break;
        const node = line.step === undefined ? undefined : nodes.get(line.step);
        (node?.files ?? attachments).push(file);
        break;
      }
      default:
        break;
    }
  }
  const { metadata, problems } = readMetadataMessages(messages);
  return {
    metadata,
    problems,
    steps: roots.map(stepOf),
    caseSteps: roots.map(({ action, expected, data }) => ({
      action,
      ...(expected === undefined ? {} : { expected }),
      ...(data === undefined ? {} : { data }),
    })),
    attachments,
  };
}

function plural(count: number, one: string): string {
  return `${String(count)} ${one}${count === 1 ? '' : 's'}`;
}

/** The prefix of every channel directory's name. */
const CHANNEL_PREFIX = 'probara-jest-channel-';

/**
 * How long a channel left in the temporary directory goes untouched before a new run removes it: a
 * run that writes nothing into its channel for a day and whose reporter is gone uses it no more.
 */
const STALE_CHANNEL_MS = 24 * 3600_000;

/** The file naming the process of the reporter that created a channel: `{ "pid": 123 }`. */
const OWNER_FILE = 'owner.json';

function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as { code?: unknown }).code === 'EPERM';
  }
}

/**
 * When the channel at `path` was last written to: the newest time of the folder and its entries
 * (a helper appends to a lines file, or copies a file into the files folder, without changing the
 * folder's own time).
 */
function lastWriteOf(path: string, folderTime: number): number {
  let newest = folderTime;
  for (const name of readdirSync(path)) {
    newest = Math.max(newest, lstatSync(join(path, name)).mtimeMs);
  }
  return newest;
}

/** Whether the reporter that created the channel at `path` still runs. */
function ownerRuns(path: string): boolean {
  try {
    const owner: unknown = JSON.parse(readFileSync(join(path, OWNER_FILE), 'utf8'));
    return typeof owner === 'object' && owner !== null && isAlive((owner as { pid?: unknown }).pid);
  } catch {
    return false;
  }
}

/**
 * Removes the channels of `parent` that runs of this user left behind: a run killed by a signal
 * (Ctrl-C, a cancelled CI job) never removes its own. Only directories named like a channel, owned
 * by this user, nothing written into them for a day, and whose reporter is gone. Never throws.
 */
function sweepStaleChannels(parent: string): void {
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    for (const name of readdirSync(parent)) {
      if (!name.startsWith(CHANNEL_PREFIX)) continue;
      try {
        const path = join(parent, name);
        const stats = lstatSync(path);
        if (!stats.isDirectory()) continue;
        if (uid !== undefined && stats.uid !== uid) continue;
        if (Date.now() - lastWriteOf(path, stats.mtimeMs) < STALE_CHANNEL_MS) continue;
        if (ownerRuns(path)) continue;
        rmSync(path, { recursive: true, force: true });
      } catch {
        // Another run's, still in use or being removed: left alone.
      }
    }
  } catch {
    // Nothing to sweep.
  }
}

/**
 * Creates a private channel directory (readable by this user only) in `parent`, the system's
 * temporary directory, after removing the stale channels there; `onWarning` receives each warning
 * line as it is read, and `onDebug` what the channel left out: unreadable lines, and the lines of
 * attempts never taken, when it closes.
 */
export function createChannel(
  onWarning: (warning: ChannelWarning) => void,
  onDebug: (message: string) => void = () => undefined,
  parent: string = tmpdir(),
): Channel {
  sweepStaleChannels(parent);
  const dir = mkdtempSync(join(parent, CHANNEL_PREFIX));
  mkdirSync(join(dir, FILES_FOLDER));
  writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: process.pid }));
  /** How far each lines file was read, and the bytes of a line not yet complete. */
  const read = new Map<string, { offset: number; rest: Buffer }>();
  /** The lines read and not yet taken: by test file, then by attempt, in order. */
  const pending = new Map<string, Map<string, TestLine[]>>();
  /** The test files the setup file ran in. */
  const setUp = new Set<string>();
  /** The tests the setup file skipped, by test file (`testIdOf`). */
  const skipped = new Map<string, Set<string>>();
  /** Why the setup file skipped no test, by test file. */
  const unselected = new Map<string, SelectionFailure>();
  /** Lines that were no JSON, or no line of the channel. */
  let unreadable = 0;
  let closed = false;

  function accept(text: string): void {
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      unreadable += 1;
      return;
    }
    if (!isRecord(line)) {
      unreadable += 1;
      return;
    }
    if (line.type === 'warning') {
      if (typeof line.message !== 'string') {
        unreadable += 1;
        return;
      }
      onWarning({
        message: line.message,
        ...(typeof line.file === 'string' ? { file: line.file } : {}),
        ...(typeof line.test === 'string' ? { test: line.test } : {}),
      });
      return;
    }
    if (line.type === 'setup') {
      if (typeof line.file === 'string') setUp.add(line.file);
      else unreadable += 1;
      return;
    }
    if (line.type === 'selection') {
      const { file, applied, deselected, reason } = line;
      if (typeof file !== 'string' || typeof applied !== 'boolean') {
        unreadable += 1;
        return;
      }
      if (!applied) {
        // A reason this version does not know is a failure all the same.
        const known = SELECTION_FAILURES.find((each) => each === reason);
        unselected.set(file, known ?? 'failed');
        return;
      }
      const ids = skipped.get(file) ?? new Set<string>();
      for (const names of Array.isArray(deselected) ? (deselected as unknown[]) : []) {
        if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) continue;
        const title = names.at(-1);
        if (typeof title !== 'string') continue;
        ids.add(testIdOf(file, { ancestorTitles: names.slice(0, -1), title }));
      }
      skipped.set(file, ids);
      return;
    }
    if (!isTestLine(line)) {
      unreadable += 1;
      return;
    }
    let attempts = pending.get(line.file);
    if (attempts === undefined) {
      attempts = new Map();
      pending.set(line.file, attempts);
    }
    const key = attemptKey(line.file, line.test, line.attempt);
    const list = attempts.get(key) ?? [];
    list.push(line);
    attempts.set(key, list);
  }

  /** Reads what each lines file gained since the last call; a partial last line waits. */
  function drain(): void {
    if (closed) return;
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(LINES_EXTENSION));
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const state = read.get(name) ?? { offset: 0, rest: Buffer.alloc(0) };
      read.set(name, state);
      let fd: number | undefined;
      try {
        fd = openSync(join(dir, name), 'r');
        const size = fstatSync(fd).size;
        if (size <= state.offset) continue;
        const chunk = Buffer.alloc(size - state.offset);
        const got = readSync(fd, chunk, 0, chunk.length, state.offset);
        state.offset += got;
        const bytes = Buffer.concat([state.rest, chunk.subarray(0, got)]);
        const end = bytes.lastIndexOf(0x0a);
        state.rest = end === -1 ? bytes : bytes.subarray(end + 1);
        if (end === -1) continue;
        for (const text of bytes.subarray(0, end).toString('utf8').split('\n')) accept(text);
      } catch {
        // Read again next time.
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
  }

  return {
    dir,
    take(file) {
      const details = new Map<string, AttemptDetails>();
      try {
        drain();
        const attempts = pending.get(file);
        pending.delete(file);
        for (const [key, lines] of attempts ?? []) details.set(key, detailsOf(lines, dir));
      } catch {
        // Never into Jest: the attempts go without their details.
      }
      return details;
    },
    hasSetup(file) {
      try {
        drain();
      } catch {
        // What was read so far answers.
      }
      return setUp.has(file);
    },
    deselected(file) {
      try {
        drain();
      } catch {
        // What was read so far answers.
      }
      return new Set(skipped.get(file));
    },
    selectionFailure(file) {
      try {
        drain();
      } catch {
        // What was read so far answers.
      }
      return unselected.get(file);
    },
    close() {
      if (closed) return;
      try {
        drain();
        const untaken = [...pending.values()].reduce((total, each) => total + each.size, 0);
        if (untaken > 0) {
          onDebug(
            `Left out what the probara.* helpers said about ${plural(untaken, 'attempt')} of test files Jest did not finish`,
          );
        }
        if (unreadable > 0) {
          onDebug(`Skipped ${plural(unreadable, 'unreadable line')} of the probara.* channel`);
        }
      } catch {
        // Only a debug line is lost.
      }
      closed = true;
      pending.clear();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A leftover temporary directory is never worth an error.
      }
    },
  };
}
