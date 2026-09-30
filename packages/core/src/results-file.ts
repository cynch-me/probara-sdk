/**
 * The results file (`resultsFile`, `PROBARA_RESULTS_FILE`): the results a reporter could not send,
 * or every result when reporting is off, with the settings to send them later
 * (`probara import results <paths...>`). Version 1:
 *
 * ```json
 * { "version": 1, "project": "SHOP", "run": { "name": "Nightly", "close": true },
 *   "rootDir": "/work", "createMissingCases": true, "results": [ { "identity": ..., "status": ... } ] }
 * ```
 *
 * Results are `TestResultInput`s as the adapter gave them (statuses before `statusMapping`, which
 * applies again when the file is sent). Attachments are referenced by absolute path; a `body` is
 * written into a folder next to the file (`<name>-attachments/`). The token is never written.
 *
 * A writer never modifies a file already there: it writes to the first free sibling
 * (`<name>-2.json`, `<name>-3.json`, ...). Only the adapter that sends a file writes it again
 * (`replace`). A file is written whole to a temporary file in the same folder first (a dot name no
 * results glob matches), then appears under its name at once: a new file by a hard link, which
 * fails when the name is taken (a rename once the name is checked free, without hard links), a
 * replaced file by a rename over it. A reader never sees an empty or partial results file, even
 * when its writer stops halfway.
 */
import { randomUUID } from 'node:crypto';
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { ResultStatus } from './api.js';
import type { AttachmentInput } from './attachments.js';
import type {
  ProbaraOptions,
  ResolvedConfig,
  ResolvedRun,
  RunConfiguration,
  StatusMapping,
} from './config.js';
import { redact } from './logger.js';
import type { TestResultInput } from './result.js';
import type { RunSource } from './source.js';

/** The version of the results file this core writes and reads. */
export const RESULTS_FILE_VERSION = 1;

/** The run settings of a results file: the runs to reuse, or the run to create. */
export interface ResultsFileRun {
  ulid?: string;
  ulids?: Record<string, string>;
  name?: string;
  description?: string;
  environmentId?: string;
  environment?: string;
  milestoneId?: string;
  milestone?: string;
  plan?: string;
  configurationUlids?: string[];
  configurations?: RunConfiguration[];
  tags?: string[];
  /**
   * Whether to close the run of each project after sending, by project code (`closeRuns`): the
   * runs the reporter created close, those it reused stay open. `true` or `false` closes every
   * run or none (`closeRun`).
   */
  close?: Record<string, boolean> | boolean;
}

/** Everything of a results file but its results. */
export interface ResultsFileHeader {
  version: typeof RESULTS_FILE_VERSION;
  project?: string;
  projects?: string[];
  run?: ResultsFileRun;
  source?: RunSource;
  rootDir?: string;
  createMissingCases?: boolean;
  suiteUlid?: string;
  statusMapping?: StatusMapping;
  statusFilter?: ResultStatus[];
  assignFailedTo?: string[];
}

/** A results file read back: the options it describes, and its results. */
export type ResultsFileReading =
  { ok: true; options: ProbaraOptions; results: TestResultInput[] } | { ok: false; error: string };

type NewRun = Exclude<ResolvedRun, { ulid: string }>;

function newRunOf(run: ResolvedRun): NewRun | undefined {
  return 'ulid' in run ? undefined : run;
}

/**
 * The header of a results file for `config`. `runs` holds the runs a session already has, by
 * project: the results go back into them, so the file names them instead of new ones.
 */
export function headerOf(
  config: ResolvedConfig,
  runs: ReadonlyMap<string, string> = new Map(),
): ResultsFileHeader {
  const mainUlid =
    runs.get(config.projectId) ?? ('ulid' in config.run ? config.run.ulid : undefined);
  const ulids: Record<string, string> = {};
  for (const project of config.projects) {
    const ulid =
      runs.get(project.projectId) ?? ('ulid' in project.run ? project.run.ulid : undefined);
    if (ulid !== undefined) ulids[project.projectId] = ulid;
  }
  const creating = config.projects.some((project) => ulids[project.projectId] === undefined);
  const newRun =
    newRunOf(config.run) ??
    config.projects.map((project) => newRunOf(project.run)).find((run) => run !== undefined);
  const run: ResultsFileRun = {
    ...(mainUlid === undefined ? {} : { ulid: mainUlid }),
    ...(Object.keys(ulids).length === 0 ? {} : { ulids }),
  };
  if (newRun !== undefined && (mainUlid === undefined || creating)) {
    run.name = newRun.name;
    // A new run of the project holds every reference by name; a new run of another project only
    // the description and the environment (the milestone, plan and configurations belong to the
    // project's run).
    for (const field of ['description', 'environment', 'milestone', 'plan'] as const) {
      const value = newRun[field];
      if (value !== undefined) run[field] = value;
    }
    if (newRun.configurations !== undefined && newRun.configurations.length > 0) {
      run.configurations = newRun.configurations.map(({ group, name }) => ({ group, name }));
    }
    // The ULIDs of the environment, milestone and configurations only belong to a new run of the
    // project.
    if (mainUlid === undefined) {
      if (newRun.environmentId !== undefined) run.environmentId = newRun.environmentId;
      if (newRun.milestoneId !== undefined) run.milestoneId = newRun.milestoneId;
      if (newRun.configurationUlids.length > 0) {
        run.configurationUlids = [...newRun.configurationUlids];
      }
    }
    if (newRun.tags.length > 0) run.tags = [...newRun.tags];
  }
  run.close = {
    [config.projectId]: config.closeRun,
    ...Object.fromEntries(config.projects.map((project) => [project.projectId, project.closeRun])),
  };
  return {
    version: RESULTS_FILE_VERSION,
    project: config.projectId,
    ...(config.projects.length === 0
      ? {}
      : { projects: config.projects.map((project) => project.projectId) }),
    run,
    ...(Object.keys(config.source).length === 0 ? {} : { source: { ...config.source } }),
    rootDir: config.rootDir,
    createMissingCases: config.createMissingCases,
    ...(config.suiteUlid === undefined ? {} : { suiteUlid: config.suiteUlid }),
    ...(Object.keys(config.statusMapping).length === 0
      ? {}
      : { statusMapping: { ...config.statusMapping } }),
    ...(config.statusFilter.length === 0 ? {} : { statusFilter: [...config.statusFilter] }),
    ...(config.assignFailedTo === undefined ? {} : { assignFailedTo: [...config.assignFailedTo] }),
  };
}

const MAX_STORED_NAME_LENGTH = 100;

/** A file name that is safe on every file system. */
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, MAX_STORED_NAME_LENGTH);
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Options of {@link writeResultsFile}. */
export interface WriteResultsFileOptions {
  /**
   * Write `path` itself, replacing the file there: for the adapter that sends that very file and
   * writes back what it could not send. Otherwise a file already at `path` is never touched.
   */
  replace?: boolean;
}

/** The folder of the bodies of a results file: `<name>-attachments/` next to it. */
export function attachmentsFolderOf(path: string): string {
  return join(dirname(path), `${basename(path, extname(path))}-attachments`);
}

/** How many names {@link writeNewFile} tries before it gives up. */
const MAX_SIBLINGS = 1000;

/**
 * Link errors of a file system without hard links (some network and removable drives): the file is
 * renamed into place instead, still only when the name is free.
 */
const NO_HARD_LINKS: ReadonlySet<unknown> = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

/** A temporary file next to `target`: a dot name, which no results glob matches. */
function temporaryOf(target: string): string {
  return join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
}

/** Whether anything is at `path`, a dangling link included. */
async function taken(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Puts the whole `temporary` file under `target` at once, only when nothing is there. `false` when
 * the name is taken.
 *
 * A hard link is exclusive and atomic. Without hard links, a rename is atomic but replaces what is
 * there, and Node has no exclusive rename (`RENAME_NOREPLACE`, `RENAME_EXCL`); a copy is exclusive
 * but fills the file after creating it, so a reader, or a writer stopped halfway, sees it partial.
 * The rename is safe here: the caller created the attachments folder of `target` exclusively, so
 * no other results writer publishes under this name, and one that published before is seen by the
 * check. Only a file another program creates under this exact name between the check and the
 * rename would be replaced.
 */
async function publish(temporary: string, target: string): Promise<boolean> {
  try {
    await link(temporary, target);
    return true;
  } catch (error) {
    if (codeOf(error) === 'EEXIST') return false;
    if (!NO_HARD_LINKS.has(codeOf(error))) throw error;
  }
  if (await taken(target)) return false;
  await rename(temporary, target);
  return true;
}

/** Writes `text` to a temporary file next to `target`, then renames it over `target`. */
async function writeAtomically(target: string, text: string): Promise<void> {
  const temporary = temporaryOf(target);
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Writes a new file at `path`, else at the first of `<name>-2<ext>`, `<name>-3<ext>`, ... whose file
 * and attachments folder do not exist. The folder is created exclusively first: it reserves the
 * number for the bodies, so two writers at once never share one. The file appears whole under its
 * name only when that name is still free (else the next number is tried); a folder that holds no
 * body goes once the file is there.
 */
async function writeNewFile(
  path: string,
  header: ResultsFileHeader,
  results: readonly TestResultInput[],
  secrets: readonly string[],
): Promise<string> {
  const extension = extname(path);
  const stem = path.slice(0, path.length - extension.length);
  for (let number = 1; number <= MAX_SIBLINGS; number += 1) {
    const candidate = number === 1 ? path : `${stem}-${number}${extension}`;
    if (await exists(candidate)) continue;
    const folder = attachmentsFolderOf(candidate);
    try {
      await mkdir(folder);
    } catch (error) {
      // Another file's folder, or one a writer holds: its files are not this writer's to mix with.
      if (codeOf(error) === 'EEXIST') continue;
      throw error;
    }
    const temporary = temporaryOf(candidate);
    let published: boolean;
    try {
      await writeFile(temporary, await contentsOf(folder, header, results, secrets), {
        flag: 'wx',
      });
      published = await publish(temporary, candidate);
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    } finally {
      // Once published the file has its name; a temporary file left behind matches no glob.
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    if (!published) {
      // Taken meanwhile: the bodies written for this name go, and are written again for the next.
      await rm(folder, { recursive: true, force: true });
      continue;
    }
    // Only a reservation when there was no body; one that holds bodies stays.
    await rmdir(folder).catch(() => undefined);
    return candidate;
  }
  throw new Error(`no free name next to ${path}: ${MAX_SIBLINGS} results files are already there`);
}

/**
 * Writes `results` under `header` to `path`, or to its first free sibling when a file (or the
 * attachments folder of one) is already there, unless `replace`; returns the path written.
 * Attachment paths are made absolute, bodies written into the `<name>-attachments/` folder of the
 * file written (numbered, so names never collide), the files of steps too, and `secrets` redacted.
 * The file appears whole or not at all. Throws on a file system error, leaving nothing of its own
 * behind (a replaced file stays as it was).
 */
export async function writeResultsFile(
  path: string,
  header: ResultsFileHeader,
  results: readonly TestResultInput[],
  secrets: readonly string[],
  options: WriteResultsFileOptions = {},
): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  if (options.replace !== true) return writeNewFile(path, header, results, secrets);
  await writeAtomically(
    path,
    await contentsOf(attachmentsFolderOf(path), header, results, secrets),
  );
  return path;
}

/** The text of a results file, its bodies written into `folder`. */
async function contentsOf(
  folder: string,
  header: ResultsFileHeader,
  results: readonly TestResultInput[],
  secrets: readonly string[],
): Promise<string> {
  let bodies = 0;

  /** The files of a result or a step, as the file holds them. */
  const store = async (attachments: unknown): Promise<AttachmentInput[]> => {
    const list: unknown[] = Array.isArray(attachments)
      ? attachments
      : attachments === undefined
        ? []
        : [attachments];
    const files: AttachmentInput[] = [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue;
      const { name, fileName, contentType, path: filePath, body } = item as AttachmentInput;
      const typed = typeof contentType === 'string' ? { contentType } : {};
      if (nonBlank(filePath) !== undefined) {
        files.push({
          ...(typeof name === 'string' ? { name } : {}),
          ...(typeof fileName === 'string' ? { fileName } : {}),
          ...typed,
          path: resolve(filePath ?? ''),
        });
      } else if (typeof body === 'string' || body instanceof Uint8Array) {
        const stored = nonBlank(fileName) ?? nonBlank(name) ?? 'attachment';
        // A number no file of the folder has yet: the bodies of results already there stay.
        let target: string;
        do {
          bodies += 1;
          target = join(folder, `${bodies}-${safeName(stored)}`);
        } while (await exists(target));
        await mkdir(folder, { recursive: true });
        await writeFile(target, body);
        // The stored name stays the one the body had: the path is only where it waits.
        files.push({ fileName: stored, ...typed, path: target });
      }
    }
    return files;
  };

  /** A step tree with the files of every step stored; what is not a list stays as given. */
  const storeSteps = async (steps: unknown): Promise<unknown> => {
    if (!Array.isArray(steps)) return steps;
    const stored: unknown[] = [];
    for (const step of steps as unknown[]) {
      if (!isRecord(step)) {
        stored.push(step);
        continue;
      }
      const { attachments, steps: children, ...rest } = step;
      const files = await store(attachments);
      const nested = await storeSteps(children);
      stored.push({
        ...rest,
        ...(files.length === 0 ? {} : { attachments: files }),
        ...(nested === undefined ? {} : { steps: nested }),
      });
    }
    return stored;
  };

  const written: unknown[] = [];
  for (const input of results) {
    const { attachments, steps, ...rest } = input;
    const files = await store(attachments);
    const storedSteps = await storeSteps(steps);
    written.push({
      ...rest,
      ...(storedSteps === undefined ? {} : { steps: storedSteps }),
      ...(files.length === 0 ? {} : { attachments: files }),
    });
  }
  return `${redact(JSON.stringify({ ...header, results: written }, null, 2), secrets)}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the fields that are set. */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

/** The options a results file describes; core checks their values like any other option. */
function optionsOf(file: Record<string, unknown>): ProbaraOptions {
  const run = isRecord(file.run) ? file.run : {};
  const runOptions = defined({
    ulid: run.ulid,
    ulids: run.ulids,
    name: run.name,
    description: run.description,
    environmentId: run.environmentId,
    environment: run.environment,
    milestoneId: run.milestoneId,
    milestone: run.milestone,
    plan: run.plan,
    configurationUlids: run.configurationUlids,
    configurations: run.configurations,
    tags: run.tags,
  });
  return defined({
    projectId: file.project,
    projects: file.projects,
    run: Object.keys(runOptions).length === 0 ? undefined : runOptions,
    ...(typeof run.close === 'boolean' || run.close === undefined
      ? { closeRun: run.close }
      : { closeRuns: run.close }),
    source: file.source,
    rootDir: file.rootDir,
    createMissingCases: file.createMissingCases,
    suiteUlid: file.suiteUlid,
    statusMapping: file.statusMapping,
    statusFilter: file.statusFilter,
    assignFailedTo: file.assignFailedTo,
  }) as ProbaraOptions;
}

/**
 * Reads a results file: the options it describes (its project, runs and settings) and its results.
 * Never throws; `error` names the file and what is wrong with it. The values are checked when the
 * options are resolved, like any option, and each result when it is added.
 */
export async function readResultsFile(path: string): Promise<ResultsFileReading> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return {
      ok: false,
      error: `${path} could not be read (${typeof code === 'string' ? code : 'unknown error'})`,
    };
  }
  if (text.trim() === '') {
    return {
      ok: false,
      error: `${path} is empty: a reporter may still be writing it, or stopped before it finished`,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: `${path} is not JSON` };
  }
  if (!isRecord(data) || typeof data.version !== 'number') {
    return { ok: false, error: `${path} is not a Probara results file` };
  }
  if (data.version !== RESULTS_FILE_VERSION) {
    return {
      ok: false,
      error: `${path} holds version ${String(data.version)} of the results file: this version reads version ${RESULTS_FILE_VERSION}`,
    };
  }
  if (!Array.isArray(data.results)) {
    return { ok: false, error: `${path} is not a Probara results file: it has no results list` };
  }
  return { ok: true, options: optionsOf(data), results: data.results as TestResultInput[] };
}
