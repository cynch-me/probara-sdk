/**
 * `probara vis recording-links list|get|create|update|revoke|delete`: the recording links of the
 * organization through core's client. A recording link is a URL anyone records their screen with,
 * no account needed; what they record arrives as a Vis. These commands share the setup of the other
 * Vis commands (`vis.ts`): the token is required, a project never is.
 */
import {
  createIdempotencyKey,
  type CreateVisRecordingLinkRequest,
  type ListVisRecordingLinksQuery,
  type UpdateVisRecordingLinkRequest,
  type VisRecordingLink,
  type VisRecordingLinkStatus,
} from '@probara/core';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { stringOf, UsageError, type CommandName, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';
import { calling, columns, prepareVis } from './vis.js';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
/** A date and time with its time zone, such as `2026-12-31T18:00:00Z` or `...+02:00`. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function helpOf(command: CommandName): string {
  return `probara ${command}`;
}

/**
 * The one link id among `positionals`: its ULID.
 *
 * @throws UsageError when there is none, several, or one that is no ULID.
 */
function linkIdOf(command: CommandName, positionals: readonly string[]): string {
  const [id, extra] = positionals;
  if (id === undefined) {
    throw new UsageError('Missing the recording link: its ULID', helpOf(command));
  }
  if (extra !== undefined) throw new UsageError(`Unexpected argument "${extra}"`, helpOf(command));
  if (!ULID.test(id)) {
    throw new UsageError(`"${id}" is not a recording link: pass its ULID`, helpOf(command));
  }
  return id.toUpperCase();
}

/**
 * `--expires`: epoch milliseconds, or `null` for `never`; `undefined` when not given.
 *
 * @throws UsageError on a value that is not a date and time with its time zone, or in the past.
 */
function expiresOf(
  command: CommandName,
  parsed: ParsedCommandLine,
  { io }: CommandContext,
): number | null | undefined {
  const value = stringOf(parsed.values, 'expires')?.trim();
  if (value === undefined) return undefined;
  if (value.toLowerCase() === 'never') return null;
  const time = DATE_TIME.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) {
    throw new UsageError(
      '--expires takes never, or a date and time with its time zone, such as 2026-12-31T18:00:00Z',
      helpOf(command),
    );
  }
  const now = io.now?.().getTime() ?? Date.now();
  if (time <= now) throw new UsageError('--expires is in the past', helpOf(command));
  return time;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** The lines `get` prints: the title, then one labelled line per field. */
function describeLink(link: VisRecordingLink): string[] {
  const last = link.lastSubmissionAt === null ? '' : `, the last on ${iso(link.lastSubmissionAt)}`;
  const received = `${plural(link.submissionCount, 'recording')}${last}`;
  const rows: [string, string][] = [
    ['ULID', link.ulid],
    ['Status', link.status],
    ['Mode', link.mode],
    ['URL', link.url ?? 'none: the link is revoked'],
    ['Folder', link.folderUlid ?? 'none'],
    ['Reference', link.reference ?? 'none'],
    ['Expires', link.expiresAt === null ? 'never' : iso(link.expiresAt)],
    ['Microphone', link.microphone ? 'on' : 'off'],
    ['Received', received],
    ['Created', iso(link.createdAt)],
  ];
  if (link.revokedAt !== null) rows.push(['Revoked', iso(link.revokedAt)]);
  return [link.title, ...rows.map(([label, value]) => `${label.padEnd(10)}  ${value}`)];
}

export async function listRecordingLinksCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const command = 'vis recording-links list';
  const [unexpected] = parsed.positionals;
  if (unexpected !== undefined) {
    throw new UsageError(`Unexpected argument "${unexpected}"`, helpOf(command));
  }
  const prepared = await prepareVis(command, parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  const { values } = parsed;
  const query: ListVisRecordingLinksQuery = {};
  const state = stringOf(values, 'state');
  const page = values.get('page');
  const pageSize = values.get('page-size');
  if (state !== undefined) query.status = state as VisRecordingLinkStatus;
  if (typeof page === 'number') query.page = page;
  if (typeof pageSize === 'number') query.pageSize = pageSize;

  return calling(context, async () => {
    const answer = await client.listVisRecordingLinks(query);
    const { logger, output } = context;
    if (json) {
      output.json(answer);
      return EXIT_OK;
    }
    for (const line of columns(
      answer.items.map((link) => [
        link.ulid,
        link.status,
        link.mode,
        `${String(link.submissionCount)} received`,
        link.title,
      ]),
    )) {
      output.line(line);
    }
    const pages = Math.max(1, Math.ceil(answer.total / answer.pageSize));
    logger.info(
      answer.total === 0
        ? 'No recording link matches'
        : `Page ${String(answer.page)} of ${String(pages)}: ${plural(answer.total, 'recording link', 'recording links')}`,
    );
    return EXIT_OK;
  });
}

export async function getRecordingLinkCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const command = 'vis recording-links get';
  const id = linkIdOf(command, parsed.positionals);
  const prepared = await prepareVis(command, parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  return calling(context, async () => {
    const link = await client.getVisRecordingLink(id);
    if (json) context.output.json(link);
    else for (const line of describeLink(link)) context.output.line(line);
    return EXIT_OK;
  });
}

export async function createRecordingLinkCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const command = 'vis recording-links create';
  const [unexpected] = parsed.positionals;
  if (unexpected !== undefined) {
    throw new UsageError(`Unexpected argument "${unexpected}"`, helpOf(command));
  }
  const { values } = parsed;
  const title = stringOf(values, 'title');
  if (title === undefined || title.trim() === '') {
    throw new UsageError(
      'Missing --title: the default title of the Vises the link receives',
      helpOf(command),
    );
  }
  const body: CreateVisRecordingLinkRequest = { title };
  const folder = stringOf(values, 'folder');
  const reference = stringOf(values, 'reference');
  const expiresAt = expiresOf(command, parsed, context);
  const microphone = values.get('microphone');
  if (folder !== undefined) body.folderUlid = folder;
  if (reference !== undefined && reference !== '') body.reference = reference;
  if (values.get('one-time') === true) body.mode = 'one_time';
  if (expiresAt !== undefined && expiresAt !== null) body.expiresAt = expiresAt;
  if (typeof microphone === 'boolean') body.microphone = microphone;

  const prepared = await prepareVis(command, parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  return calling(context, async () => {
    const link = await client.createVisRecordingLink(body, {
      idempotencyKey: createIdempotencyKey(),
    });
    const url = link.url ?? '';
    context.logger.info(`Created the recording link "${link.title}": ${url}`);
    if (json) context.output.json(link);
    else context.output.line(`${link.ulid} ${url}`);
    return EXIT_OK;
  });
}

export async function updateRecordingLinkCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const command = 'vis recording-links update';
  const id = linkIdOf(command, parsed.positionals);
  const { values } = parsed;
  const body: UpdateVisRecordingLinkRequest = {};
  const title = stringOf(values, 'title');
  const folder = stringOf(values, 'folder');
  const reference = stringOf(values, 'reference');
  const expiresAt = expiresOf(command, parsed, context);
  const microphone = values.get('microphone');
  if (title !== undefined) body.title = title;
  if (folder !== undefined) body.folderUlid = folder === 'none' ? null : folder;
  if (reference !== undefined) body.reference = reference === '' ? null : reference;
  if (expiresAt !== undefined) body.expiresAt = expiresAt;
  if (typeof microphone === 'boolean') body.microphone = microphone;
  if (Object.keys(body).length === 0) {
    throw new UsageError(
      'Nothing to change: pass --title, --folder, --reference, --expires or --[no-]microphone',
      helpOf(command),
    );
  }
  const prepared = await prepareVis(command, parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  return calling(context, async () => {
    const link = await client.updateVisRecordingLink(id, body, {
      idempotencyKey: createIdempotencyKey(),
    });
    context.logger.info(`Updated the recording link "${link.title}"`);
    if (json) context.output.json(link);
    return EXIT_OK;
  });
}

/**
 * Whether the person at the terminal confirmed `question`; without a terminal, `undefined`
 * (already logged), unless `--yes` was given.
 */
async function confirmed(
  parsed: ParsedCommandLine,
  { io, logger }: CommandContext,
  question: string,
  refusal: string,
): Promise<boolean | undefined> {
  if (parsed.values.get('yes') === true) return true;
  if (io.prompt === undefined) {
    logger.error(refusal);
    return undefined;
  }
  return /^\s*y(?:es)?\s*$/i.test(await io.prompt(question));
}

export async function revokeRecordingLinkCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const command = 'vis recording-links revoke';
  const id = linkIdOf(command, parsed.positionals);
  const prepared = await prepareVis(command, parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  const { logger, output } = context;
  return calling(context, async () => {
    const link = await client.getVisRecordingLink(id);
    const answer = await confirmed(
      parsed,
      context,
      `Revoke the recording link "${link.title}"? Its URL stops working for good. [y/N] `,
      'Not revoked: stdin is not a terminal, so there is no one to confirm. Pass --yes to revoke it',
    );
    if (answer === undefined) return EXIT_USAGE;
    if (!answer) {
      logger.info('Not revoked: the link still works');
      return EXIT_REPORTING_FAILED;
    }
    const revoked = await client.revokeVisRecordingLink(id, {
      idempotencyKey: createIdempotencyKey(),
    });
    logger.info(`Revoked the recording link "${revoked.title}": its URL no longer works`);
    if (json) output.json(revoked);
    return EXIT_OK;
  });
}

export async function deleteRecordingLinkCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const command = 'vis recording-links delete';
  const id = linkIdOf(command, parsed.positionals);
  const prepared = await prepareVis(command, parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  const { logger, output } = context;
  return calling(context, async () => {
    const link = await client.getVisRecordingLink(id);
    const answer = await confirmed(
      parsed,
      context,
      `Delete the recording link "${link.title}"? The Vises it received are kept. [y/N] `,
      'Not deleted: stdin is not a terminal, so there is no one to confirm. Pass --yes to delete it',
    );
    if (answer === undefined) return EXIT_USAGE;
    if (!answer) {
      logger.info('Not deleted: the link is kept');
      return EXIT_REPORTING_FAILED;
    }
    await client.deleteVisRecordingLink(id, { idempotencyKey: createIdempotencyKey() });
    logger.info(`Deleted the recording link "${link.title}": the Vises it received are kept`);
    if (json) output.json({ status: 'deleted', ulid: link.ulid });
    return EXIT_OK;
  });
}
