/**
 * What core's configuration means for a command: ready, disabled, or invalid with CLI-worded
 * problems. Core does the resolution; this only tells "not configured" from "disabled" and words
 * the missing token and project for a command line.
 */
import { resolveConfig, type ProbaraOptions, type ResolvedConfig } from '@probara/core';

type Env = Readonly<Record<string, string | undefined>>;

export type Setup =
  | { kind: 'ready'; config: ResolvedConfig; warnings: string[]; projectCode?: string }
  | { kind: 'disabled'; reason: string; warnings: string[] }
  | { kind: 'invalid'; problems: string[]; warnings: string[] };

export interface SetupOptions {
  /** Whether the token and the project must be set (not in a dry run). */
  requireCredentials: boolean;
  now?: (() => Date) | undefined;
}

/** Stands in for a missing token or project, so core still checks every other setting. */
const PLACEHOLDER = 'PROBARA-CLI-PLACEHOLDER';

export const NOT_CONFIGURED =
  'Probara is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT (or pass --project)';
export const TOKEN_MISSING =
  'PROBARA_API_TOKEN is not set: the API token is only read from the environment';
export const PROJECT_MISSING = 'The project is not set: pass --project or set PROBARA_PROJECT';

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Resolves `options` with core. A missing token or project is replaced by a placeholder for the
 * resolution, so core reports every other problem, and only `PROBARA_ENABLED` can disable it.
 */
export function resolveSetup(options: ProbaraOptions, env: Env, setup: SetupOptions): Setup {
  const tokenMissing = isBlank(env.PROBARA_API_TOKEN);
  const projectMissing = isBlank(options.projectId) && isBlank(env.PROBARA_PROJECT);
  const resolution = resolveConfig(
    {
      ...options,
      ...(tokenMissing ? { apiToken: PLACEHOLDER } : {}),
      ...(projectMissing ? { projectId: PLACEHOLDER } : {}),
    },
    env,
    setup.now === undefined ? {} : { now: setup.now },
  );
  const { warnings } = resolution;
  if (!resolution.ok && resolution.disabled) {
    return { kind: 'disabled', reason: resolution.reason, warnings };
  }

  const problems: string[] = [];
  if (setup.requireCredentials) {
    if (tokenMissing && projectMissing) problems.push(NOT_CONFIGURED);
    else if (tokenMissing) problems.push(TOKEN_MISSING);
    else if (projectMissing) problems.push(PROJECT_MISSING);
  }
  if (!resolution.ok) problems.push(...resolution.problems);
  if (problems.length > 0 || !resolution.ok) return { kind: 'invalid', problems, warnings };

  const { config } = resolution;
  return {
    kind: 'ready',
    config,
    warnings,
    ...(projectMissing ? {} : { projectCode: config.projectId }),
  };
}
