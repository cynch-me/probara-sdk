/**
 * The Probara Snap settings every adapter and the CLI share: whether a run takes part, the name of
 * its build, and the nonce its machines share. One resolution, so the machines that send a build
 * and the command that finalizes it name the same build.
 */
import { detectSnapCiSource } from './ci.js';
import { resolveBooleanSetting, resolveTextSetting } from './config.js';

type Env = Readonly<Record<string, string | undefined>>;

/** The Snap options of an adapter, as its user wrote them. */
export interface SnapSettingsInput {
  /** `PROBARA_SNAP`: the run takes part in Probara Snap. */
  snap?: unknown;
  /** `PROBARA_SNAP_BUILD_NAME`: the name of the build. */
  snapBuildName?: unknown;
  /** `PROBARA_SNAP_NONCE`: what the machines of one run share. */
  snapNonce?: unknown;
}

export interface SnapSettings {
  /** `false` unless the option or its variable turns it on. */
  snap: boolean;
  /** Probara's `default` when unset. */
  buildName?: string;
  /** The nonce that was set; {@link snapNonceOf} adds what the CI gives. */
  nonce?: string;
  /** The options of a wrong type, each named; to pass to `createReporter` as `adapterProblems`. */
  problems: string[];
}

/** Resolves the Snap options with core's rules: the option, else its variable, trimmed. */
export function resolveSnapSettings(
  input: SnapSettingsInput,
  env: Env = process.env,
): SnapSettings {
  const snap = resolveBooleanSetting(input.snap, 'snap', 'PROBARA_SNAP', env);
  const buildName = resolveTextSetting(
    input.snapBuildName,
    'snapBuildName',
    'PROBARA_SNAP_BUILD_NAME',
    env,
  );
  const nonce = resolveTextSetting(input.snapNonce, 'snapNonce', 'PROBARA_SNAP_NONCE', env);
  return {
    snap: snap.value ?? false,
    ...(buildName.value === undefined ? {} : { buildName: buildName.value }),
    ...(nonce.value === undefined ? {} : { nonce: nonce.value }),
    problems: [snap.problem, buildName.problem, nonce.problem].filter(
      (problem) => problem !== undefined,
    ),
  };
}

/**
 * The nonce the machines of one run join a build by: the one that was set, else what the CI gives
 * (the run id and attempt on GitHub Actions, else the provider's pipeline id).
 */
export function snapNonceOf(nonce: string | undefined, env: Env = process.env): string | undefined {
  return nonce ?? detectSnapCiSource(env).snapNonce;
}
