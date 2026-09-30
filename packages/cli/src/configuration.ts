/**
 * What core's configuration means for a command: ready, disabled, or invalid with CLI-worded
 * problems. Core does the resolution and says why reporting is disabled; this words the missing
 * token and project for a command line.
 */
import {
  resolveConfig,
  type ProbaraOptions,
  type ResolveConfigContext,
  type ResolvedConfig,
} from '@probara/core';

type Env = Readonly<Record<string, string | undefined>>;

export type Setup =
  | { kind: 'ready'; config: ResolvedConfig; warnings: string[]; projectCode?: string }
  | {
      kind: 'disabled';
      reason: string;
      warnings: string[];
      /** The project codes whose ids a results file keeps: those it would report to, if known. */
      projectCodes: string[];
    }
  | { kind: 'invalid'; problems: string[]; warnings: string[] };

export interface SetupOptions {
  /** Whether the token and the project must be set (not in a dry run). */
  requireCredentials: boolean;
  now?: (() => Date) | undefined;
}

/** Stand in for a missing token or project, so core still checks every other setting. */
const TOKEN_PLACEHOLDER = 'PROBARA-CLI-PLACEHOLDER';
/** A project code, as core requires, that no real project is likely to have. */
const PROJECT_PLACEHOLDER = 'PROBARACLIPLACEHOLDER';

export const NOT_CONFIGURED =
  'Probara is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT (or pass --project)';
export const TOKEN_MISSING =
  'PROBARA_API_TOKEN is not set: the API token is only read from the environment';
export const PROJECT_MISSING = 'The project is not set: pass --project or set PROBARA_PROJECT';

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Resolves `options` with core, with placeholders for a missing token or project: core stops at
 * them, and with placeholders it still checks every other setting (and a dry run gets its config).
 */
function resolveCompletely(options: ProbaraOptions, env: Env, context: ResolveConfigContext) {
  const tokenMissing = isBlank(env.PROBARA_API_TOKEN);
  const projectMissing = isBlank(options.projectId) && isBlank(env.PROBARA_PROJECT);
  const resolution =
    tokenMissing || projectMissing
      ? resolveConfig(
          {
            ...options,
            ...(tokenMissing ? { apiToken: TOKEN_PLACEHOLDER } : {}),
            ...(projectMissing ? { projectId: PROJECT_PLACEHOLDER } : {}),
          },
          env,
          context,
        )
      : resolveConfig(options, env, context);
  return { resolution, tokenMissing, projectMissing };
}

/**
 * Resolves `options` with core. Only core's `disabled` cause (`PROBARA_ENABLED` or `enabled`
 * turned reporting off) disables the command; a missing token or project is a CLI problem
 * instead, and every other setting is still checked (see `resolveCompletely`).
 */
export function resolveSetup(options: ProbaraOptions, env: Env, setup: SetupOptions): Setup {
  const context: ResolveConfigContext = setup.now === undefined ? {} : { now: setup.now };
  const configured = resolveConfig(options, env, context);
  if (!configured.ok && configured.disabled && configured.cause === 'disabled') {
    // Core stops at the switch, before the settings that raise warnings: resolve them with
    // reporting on, so a disabled command still warns about the options it was given.
    const { resolution, projectMissing } = resolveCompletely(
      { ...options, enabled: true },
      env,
      context,
    );
    const projectCodes =
      resolution.ok && !projectMissing
        ? [
            resolution.config.projectId,
            ...resolution.config.projects.map((project) => project.projectId),
          ]
        : [];
    return {
      kind: 'disabled',
      reason: configured.reason,
      warnings: resolution.warnings,
      projectCodes,
    };
  }

  const { resolution, tokenMissing, projectMissing } = resolveCompletely(options, env, context);
  const { warnings } = resolution;

  const problems: string[] = [];
  if (setup.requireCredentials) {
    if (tokenMissing && projectMissing) problems.push(NOT_CONFIGURED);
    else if (tokenMissing) problems.push(TOKEN_MISSING);
    else if (projectMissing) problems.push(PROJECT_MISSING);
  }
  if (!resolution.ok) {
    problems.push(...(resolution.disabled ? [resolution.reason] : resolution.problems));
  }
  if (problems.length > 0 || !resolution.ok) return { kind: 'invalid', problems, warnings };

  const { config } = resolution;
  return {
    kind: 'ready',
    config,
    warnings,
    ...(projectMissing ? {} : { projectCode: config.projectId }),
  };
}
