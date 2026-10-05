/**
 * The reporter's reading of the transport (see `channel.ts`): the lines of one attempt, in the
 * order they were written, become its metadata, its step tree and the files of its result. Nothing
 * here knows how the lines were carried, so an adapter with files of its own hands the details over
 * the same way.
 */
import { extname, join } from 'node:path';
import { hasFileExtension, type AttachmentInput } from './attachments.js';
import type { ChannelLine } from './channel.js';
import { readMetadataMessages, type AttemptMetadata, type CaseStep } from './metadata.js';
import type { TestStepInput } from './result.js';

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

const UNFINISHED = 'The step had not finished when the test ended';
/** The name every copy gets: a UUID, never a path. */
const COPY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The folder of the transport that holds the copies of attached files. */
const FILES_FOLDER = 'files';

/**
 * The content type of an attached file or a named body without one, from its extension, as the
 * JUnit writers of the frameworks infer it.
 */
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

function optional(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A file of the transport as core uploads it, named and typed like the JUnit writers name theirs. */
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
  // A body is typed from the extension of its name, else as text or as core's default for bytes.
  const contentType =
    optional(line.contentType) ??
    (source !== undefined
      ? CONTENT_TYPES[extension.toLowerCase()]
      : (CONTENT_TYPES[extname(given).toLowerCase()] ??
        (line.body === 'text' ? 'text/plain' : undefined)));
  return {
    name: line.name,
    fileName,
    ...(contentType === undefined ? {} : { contentType }),
    path: join(dir, FILES_FOLDER, line.copy),
    // Removed with the transport: a results file keeps a copy next to it.
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

/**
 * The details of one attempt from its lines, in the order they were written: the messages merged
 * with {@link readMetadataMessages}, the steps nested as they started, and the files attached in a
 * step with it, the others beside the steps. `dir` is the folder that holds the copies the lines
 * name (its `files/` subfolder), and a line of another kind (a warning, a setup, a selection) is
 * left out. Never throws.
 */
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
