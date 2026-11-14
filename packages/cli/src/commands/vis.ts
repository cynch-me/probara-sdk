/**
 * `probara vis list|get|update|delete`: the organization's Vises through core's client. A Vis
 * belongs to the organization, so these commands need the token and never a project. `vis create`
 * (`vis-create.ts`) shares the setup and the client of this file.
 */
import {
  createClient,
  createIdempotencyKey,
  ProbaraApiError,
  ProbaraNetworkError,
  type ListVisesQuery,
  type ProbaraClient,
  type ProbaraOptions,
  type ResolvedConfig,
  type UpdateVisRequest,
  type Vis,
  type VisKind,
  type VisSource,
  type VisStatus,
} from '@probara/core';
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import {
  stringOf,
  toCoreOptions,
  UsageError,
  type CommandName,
  type ParsedCommandLine,
} from '../options.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';

const DISPLAY_ID = /^vis-([1-9][0-9]*)$/i;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** A command ready to call Probara: its configuration and a client. */
export interface VisSession {
  config: ResolvedConfig;
  client: ProbaraClient;
  json: boolean;
}

/** A session, or the exit code of a command that sends nothing (already logged). */
export type Prepared = { ready: true; session: VisSession } | { ready: false; exitCode: number };

/**
 * Resolves the configuration of a Vis command with core: the token is required, a project never
 * is. A disabled one (`PROBARA_ENABLED=false`) sends nothing and exits 0; an invalid one exits 2.
 * `check` runs between the two, so a disabled command still validates its input.
 */
export async function prepareVis(
  command: CommandName,
  { values }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
  clientName: string,
  check: () => Promise<number | undefined> = () => Promise.resolve(undefined),
): Promise<Prepared> {
  const options: ProbaraOptions = { ...toCoreOptions(command, values, io.cwd), clientName };
  const setup = resolveSetup(options, io.env, {
    requireCredentials: true,
    requireProject: false,
    now: io.now,
  });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  for (const warning of setup.warnings) logger.warn(warning);
  const json = values.get('json') === true;
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    return { ready: false, exitCode: EXIT_USAGE };
  }
  const failed = await check();
  if (failed !== undefined) return { ready: false, exitCode: failed };
  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: nothing was sent`);
    if (json) output.json({ status: 'disabled' });
    return { ready: false, exitCode: EXIT_OK };
  }
  const { config } = setup;
  const client = createClient({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    clientName,
    logger,
    ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    ...(io.sleep === undefined ? {} : { sleep: io.sleep }),
    ...(io.now === undefined ? {} : { now: () => io.now?.().getTime() ?? Date.now() }),
  });
  return { ready: true, session: { config, client, json } };
}

/** Whether `error` is Probara's answer or its absence: logged as such, never a crash. */
export function isProbaraError(error: unknown): error is ProbaraApiError | ProbaraNetworkError {
  return error instanceof ProbaraApiError || error instanceof ProbaraNetworkError;
}

/** Logs Probara's refusal, with what to do when the token is an app token (403 on every Vis call). */
export function logRefusal(
  error: ProbaraApiError | ProbaraNetworkError,
  { io, logger }: CommandContext,
): void {
  logger.error(error.message);
  const token = io.env.PROBARA_API_TOKEN?.trim() ?? '';
  if (
    error instanceof ProbaraApiError &&
    error.status === 403 &&
    token.startsWith('probara_app_')
  ) {
    logger.error(
      'PROBARA_API_TOKEN is an app token, which can only report results: the Vis commands need a personal API token',
    );
  }
}

/** Runs `body`; a refusal or an unreachable Probara is logged and exits 1. */
async function calling(context: CommandContext, body: () => Promise<number>): Promise<number> {
  try {
    return await body();
  } catch (error) {
    if (!isProbaraError(error)) throw error;
    logRefusal(error, context);
    return EXIT_REPORTING_FAILED;
  }
}

/** The web page of a Vis. */
export function visUrl(config: ResolvedConfig, vis: Vis): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/vis/${vis.displayId}`;
}

/**
 * The one Vis id among `positionals`: a ULID or a `VIS-<n>` display ID.
 *
 * @throws UsageError when there is none, several, or one that is no Vis id.
 */
function visIdOf(command: CommandName, positionals: readonly string[]): string {
  const help = `probara ${command}`;
  const [id, extra] = positionals;
  if (id === undefined) throw new UsageError('Missing the Vis: its ULID or its display ID', help);
  if (extra !== undefined) throw new UsageError(`Unexpected argument "${extra}"`, help);
  if (!DISPLAY_ID.test(id) && !ULID.test(id)) {
    throw new UsageError(
      `"${id}" is not a Vis: pass its ULID or its display ID, such as VIS-12`,
      help,
    );
  }
  return id;
}

/** Reads the Vis `id` names, by display ID or by ULID. */
function fetchVis(client: ProbaraClient, id: string): Promise<Vis> {
  const number = DISPLAY_ID.exec(id)?.[1];
  return number === undefined
    ? client.getVis(id.toUpperCase())
    : client.getVisByDisplayId(`VIS-${number}`);
}

function dateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** `rows` as aligned columns, two spaces apart; the last column is never padded. */
function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  '),
  );
}

export async function listVisesCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const [unexpected] = parsed.positionals;
  if (unexpected !== undefined) {
    throw new UsageError(`Unexpected argument "${unexpected}"`, 'probara vis list');
  }
  const prepared = await prepareVis('vis list', parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  const { values } = parsed;
  const query: ListVisesQuery = {};
  const kind = stringOf(values, 'kind');
  const source = stringOf(values, 'from');
  const status = stringOf(values, 'status');
  const creator = stringOf(values, 'creator');
  const folder = stringOf(values, 'folder');
  const search = stringOf(values, 'search');
  const page = values.get('page');
  const pageSize = values.get('page-size');
  if (kind !== undefined) query.kind = kind as VisKind;
  if (source !== undefined) query.source = source as VisSource;
  if (creator !== undefined) query.creator = creator;
  if (folder !== undefined) query.folder = folder;
  if (search !== undefined) query.q = search;
  if (status !== undefined) query.status = status as VisStatus;
  if (typeof page === 'number') query.page = page;
  if (typeof pageSize === 'number') query.pageSize = pageSize;

  return calling(context, async () => {
    const answer = await client.listVises(query);
    const { logger, output } = context;
    if (json) {
      output.json(answer);
      return EXIT_OK;
    }
    for (const line of columns(
      answer.items.map((vis) => [
        vis.displayId,
        vis.kind,
        vis.status,
        dateOf(vis.createdAt),
        vis.title,
      ]),
    )) {
      output.line(line);
    }
    const pages = Math.max(1, Math.ceil(answer.total / answer.pageSize));
    logger.info(
      answer.total === 0
        ? 'No Vis matches'
        : `Page ${String(answer.page)} of ${String(pages)}: ${plural(answer.total, 'Vis', 'Vises')}`,
    );
    return EXIT_OK;
  });
}

/** The lines `vis get` prints: the title, then one labelled line per field. */
function describeVis(vis: Vis, url: string): string[] {
  const rows: [string, string][] = [
    ['ULID', vis.ulid],
    ['Kind', `${vis.kind}, from ${vis.source}`],
    ['Status', vis.status],
  ];
  if (vis.durationMs !== null) rows.push(['Length', `${(vis.durationMs / 1000).toFixed(1)} s`]);
  if (vis.pageUrl !== null) rows.push(['Page', vis.pageUrl]);
  rows.push(['Folder', vis.folderUlid ?? 'none']);
  rows.push(['Access', `${vis.accessMode}, link sharing: ${vis.linkSharing}`]);
  rows.push(['Created', new Date(vis.createdAt).toISOString()]);
  if (vis.metadata !== null) rows.push(['Metadata', JSON.stringify(vis.metadata)]);
  if (vis.description !== null) rows.push(['Notes', vis.description]);
  rows.push(['URL', url]);
  return [
    `${vis.displayId}  ${vis.title}`,
    ...rows.map(([label, value]) => `${label.padEnd(8)}  ${value}`),
  ];
}

export async function getVisCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const id = visIdOf('vis get', parsed.positionals);
  const prepared = await prepareVis('vis get', parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, config, json } = prepared.session;
  return calling(context, async () => {
    const vis = await fetchVis(client, id);
    if (json) context.output.json(vis);
    else for (const line of describeVis(vis, visUrl(config, vis))) context.output.line(line);
    return EXIT_OK;
  });
}

export async function updateVisCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const id = visIdOf('vis update', parsed.positionals);
  const { values } = parsed;
  const body: UpdateVisRequest = {};
  const title = stringOf(values, 'title');
  const description = stringOf(values, 'description');
  const folder = stringOf(values, 'folder');
  const visibility = stringOf(values, 'visibility') as 'public' | 'private' | undefined;
  if (title !== undefined) body.title = title;
  if (description !== undefined) body.description = description === '' ? null : description;
  if (folder !== undefined) body.folderUlid = folder === 'none' ? null : folder;
  if (Object.keys(body).length === 0 && visibility === undefined) {
    throw new UsageError(
      'Nothing to change: pass --title, --description, --folder or --visibility',
      'probara vis update',
    );
  }
  const prepared = await prepareVis('vis update', parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, config, json } = prepared.session;
  return calling(context, async () => {
    let vis = await fetchVis(client, id);
    if (Object.keys(body).length > 0) {
      vis = await client.updateVis(vis.ulid, body, { idempotencyKey: createIdempotencyKey() });
    }
    if (visibility !== undefined) {
      await client.updateVisAccess(
        vis.ulid,
        { mode: visibility },
        { idempotencyKey: createIdempotencyKey() },
      );
      // A private Vis stops being shared by link: read what the change left.
      vis = await client.getVis(vis.ulid);
    }
    context.logger.info(`Updated ${vis.displayId}: ${visUrl(config, vis)}`);
    if (json) context.output.json(vis);
    return EXIT_OK;
  });
}

export async function deleteVisCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const id = visIdOf('vis delete', parsed.positionals);
  const yes = parsed.values.get('yes') === true;
  const prepared = await prepareVis('vis delete', parsed, context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { client, json } = prepared.session;
  const { io, logger, output } = context;
  return calling(context, async () => {
    const vis = await fetchVis(client, id);
    const named = `${vis.displayId} "${vis.title}"`;
    if (!yes) {
      if (io.prompt === undefined) {
        logger.error(
          `Not deleted: stdin is not a terminal, so there is no one to confirm. Pass --yes to delete ${vis.displayId}`,
        );
        return EXIT_USAGE;
      }
      const answer = await io.prompt(
        `Delete ${named} and all its media? It cannot be restored. [y/N] `,
      );
      if (!/^\s*y(?:es)?\s*$/i.test(answer)) {
        logger.info(`Not deleted: ${vis.displayId} is kept`);
        return EXIT_REPORTING_FAILED;
      }
    }
    await client.deleteVis(vis.ulid, { idempotencyKey: createIdempotencyKey() });
    logger.info(`Deleted ${named}`);
    if (json) output.json({ status: 'deleted', ulid: vis.ulid, displayId: vis.displayId });
    return EXIT_OK;
  });
}
