/**
 * The Probara Snap commands. `probara snap finalize` completes the build the machines of a Cypress
 * run joined by their nonce; `probara snap wait` waits until Probara compared a build; `probara snap
 * upload` sends a directory of PNG files as a build. The name and the nonce are resolved by core, as
 * the reporters resolve them, so every command names the build they sent.
 */
import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  detectSnapCiSource,
  finalizeSnapBuildByNonce,
  resolveSnapSettings,
  snapNonceOf,
  uploadSnapScreenshots,
  waitForSnapBuild,
  type SnapScreenshotInput,
} from '@probara/core';
import { EXIT_CHANGES, EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { stringOf, UsageError, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import { prepare, runtimeOf, settle } from './run.js';
import { VERSION } from '../version.js';

const NONCE_MISSING =
  'The nonce is not set: pass --nonce or set PROBARA_SNAP_NONCE to the value the machines of the run sent (this CI names none)';
const BUILD_UNKNOWN =
  'The build is not known: pass --build or --nonce, or set PROBARA_COMMIT to the commit it is of (this CI names neither a nonce nor a commit)';
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const FULL_COMMIT = /^[0-9a-f]{40}$/i;
const COMMIT_UNKNOWN =
  'The commit is not known: set PROBARA_COMMIT to the full 40-character SHA of the commit the screenshots are of';
const BRANCH_UNKNOWN =
  'The branch is not known: set PROBARA_BRANCH to the branch the screenshots are of';

function snapSettingsOf(parsed: ParsedCommandLine, env: CommandContext['io']['env']) {
  return resolveSnapSettings(
    {
      snapBuildName: stringOf(parsed.values, 'build-name'),
      snapNonce: stringOf(parsed.values, 'nonce'),
    },
    env,
  );
}

export async function finalizeSnapCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { options, setup, json } = prepare('snap finalize', parsed, context, clientName);
  const { io, logger, output } = context;
  for (const warning of setup.warnings) logger.debug(warning);
  const settled = settle(setup, context, json, 'no build was finalized');
  if (!settled.ready) return settled.exitCode;
  const settings = snapSettingsOf(parsed, io.env);
  const nonce = snapNonceOf(settings.nonce, io.env);
  if (nonce === undefined) {
    logger.error(NONCE_MISSING);
    return EXIT_USAGE;
  }

  const summary = await finalizeSnapBuildByNonce({
    ...options,
    ...runtimeOf(context),
    nonce,
    ...(settings.buildName === undefined ? {} : { buildName: settings.buildName }),
  });
  if (json) output.json(summary);
  return summary.status === 'finalized' ? EXIT_OK : EXIT_REPORTING_FAILED;
}

export async function waitSnapCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { options, setup, json } = prepare('snap wait', parsed, context, clientName);
  const { io, logger, output } = context;
  for (const warning of setup.warnings) logger.debug(warning);
  const settled = settle(setup, context, json, 'no build was waited for');
  if (!settled.ready) return settled.exitCode;
  const settings = snapSettingsOf(parsed, io.env);
  const buildUlid = stringOf(parsed.values, 'build')?.trim().toUpperCase();
  if (buildUlid !== undefined && !ULID.test(buildUlid)) {
    logger.error('--build must be the ULID of a build, such as 01J9Z3K4M5N6P7Q8R9S0T1V2W3');
    return EXIT_USAGE;
  }
  const ci = detectSnapCiSource(io.env);
  if (
    buildUlid === undefined &&
    settings.nonce === undefined &&
    ci.snapNonce === undefined &&
    ci.headCommit === undefined
  ) {
    logger.error(BUILD_UNKNOWN);
    return EXIT_USAGE;
  }
  const seconds = parsed.values.get('max-wait');

  const summary = await waitForSnapBuild({
    ...options,
    ...runtimeOf(context),
    ...(buildUlid === undefined ? {} : { buildUlid }),
    ...(settings.nonce === undefined ? {} : { nonce: settings.nonce }),
    ...(settings.buildName === undefined ? {} : { buildName: settings.buildName }),
    ...(typeof seconds === 'number' ? { waitTimeoutMs: seconds * 1000 } : {}),
  });
  if (json) output.json(summary.build ?? { status: summary.status });
  if (summary.status === 'disabled') return EXIT_OK;
  if (summary.status !== 'complete') return EXIT_REPORTING_FAILED;
  return parsed.values.get('fail-on-changes') === true && summary.unacceptedChanges === true
    ? EXIT_CHANGES
    : EXIT_OK;
}

/** `--shard <index>/<total>`, from 1, as the shard of core (from 0). */
function shardOf(text: string | undefined): { index: number; total: number } | undefined {
  if (text === undefined) return undefined;
  const [, index, total] = /^(\d+)\/(\d+)$/.exec(text.trim()) ?? [];
  const shard = { index: Number(index) - 1, total: Number(total) };
  if (index === undefined || shard.index < 0 || shard.index >= shard.total) {
    throw new UsageError(
      '--shard takes <index>/<total>, from 1, such as 2/3',
      'probara snap upload',
    );
  }
  return shard;
}

/** `--viewport <width>x<height>`. */
function viewportOf(text: string | undefined): { width: number; height: number } | undefined {
  if (text === undefined) return undefined;
  const [, width, height] = /^(\d+)x(\d+)$/.exec(text.trim()) ?? [];
  const viewport = { width: Number(width), height: Number(height) };
  if (width === undefined || viewport.width < 1 || viewport.height < 1) {
    throw new UsageError(
      '--viewport takes <width>x<height> in pixels, such as 1280x720',
      'probara snap upload',
    );
  }
  return viewport;
}

/** The PNG files under `root`, in its folders too, by their path from it with `/`, sorted. */
async function pngsUnder(root: string, shown: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    throw new UsageError(`${shown} is not a directory`, 'probara snap upload');
  }
  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
  if (paths.length === 0) {
    throw new UsageError(`${shown} holds no .png file`, 'probara snap upload');
  }
  return paths;
}

export async function uploadSnapCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const [dir, unexpected] = parsed.positionals;
  if (unexpected !== undefined) {
    throw new UsageError(`Unexpected argument "${unexpected}"`, 'probara snap upload');
  }
  if (dir === undefined) {
    throw new UsageError('The directory of the screenshots is missing', 'probara snap upload');
  }
  const { values } = parsed;
  const { options, setup, json } = prepare(
    'snap upload',
    { values, positionals: [] },
    context,
    clientName,
  );
  const { io, logger, output } = context;
  const shard = shardOf(stringOf(values, 'shard'));
  const viewport = viewportOf(stringOf(values, 'viewport'));
  const browser = stringOf(values, 'browser');
  const colorMode = stringOf(values, 'color-mode') as SnapScreenshotInput['colorMode'];
  const root = resolve(io.cwd, dir);
  const screenshots: SnapScreenshotInput[] = (await pngsUnder(root, dir)).map((path) => ({
    name: path.slice(0, -'.png'.length),
    path: join(root, path),
    ...(browser === undefined ? {} : { browser }),
    ...(viewport === undefined ? {} : { viewport }),
    ...(colorMode === undefined ? {} : { colorMode }),
  }));
  for (const warning of setup.warnings) logger.debug(warning);
  const settled = settle(setup, context, json, 'no screenshot was sent');
  if (!settled.ready) return settled.exitCode;
  const ci = detectSnapCiSource(io.env);
  if (ci.headCommit === undefined || !FULL_COMMIT.test(ci.headCommit)) {
    logger.error(COMMIT_UNKNOWN);
    return EXIT_USAGE;
  }
  if (ci.branch === undefined) {
    logger.error(BRANCH_UNKNOWN);
    return EXIT_USAGE;
  }
  const settings = snapSettingsOf(parsed, io.env);
  const { run } = settled.setup.config;

  const summary = await uploadSnapScreenshots({
    ...options,
    ...runtimeOf(context),
    sdk: { name: '@probara/cli', version: VERSION },
    screenshots,
    cwd: io.cwd,
    ...(settings.buildName === undefined ? {} : { buildName: settings.buildName }),
    ...(settings.nonce === undefined ? {} : { nonce: settings.nonce }),
    ...(shard === undefined ? {} : { shard }),
    ...(values.get('parallel') === true ? { parallel: true } : {}),
    ...('ulid' in run ? { runUlid: run.ulid } : {}),
  });
  if (json) output.json(summary);
  return summary.status === 'uploaded' ? EXIT_OK : EXIT_REPORTING_FAILED;
}
