/** The reporter's options: core's, plus the settings only a Playwright reporter has. */
import {
  resolveAdapterSetup,
  resolveBooleanSetting,
  resolveSnapSettings,
  type AdapterSetup,
  type ProbaraOptions,
  type RuntimeOptions,
} from '@probara/core';
import { VERSION } from './version.js';

/** Sent first in the User-Agent. */
export const CLIENT_NAME = `probara-playwright-reporter/${VERSION}`;

/**
 * The options of `['@probara/playwright-reporter', options]` in `playwright.config`: every option of
 * `@probara/core` under the same name, and `captureOutput`. Each falls back to its `PROBARA_*`
 * variable, then to its default.
 */
export interface ProbaraPlaywrightOptions extends ProbaraOptions, RuntimeOptions {
  /** `PROBARA_CAPTURE_OUTPUT`: attach each attempt's stdout and stderr. Defaults to `false`. */
  captureOutput?: boolean | undefined;
  /**
   * `PROBARA_SNAP`: this run takes part in Probara Snap. A sharded run needs it in every shard: a
   * shard then tells Probara it is done even without a screenshot, so the build completes.
   * Defaults to `false`: a run without shards sends the screenshots it took either way.
   */
  snap?: boolean | undefined;
  /**
   * `PROBARA_SNAP_BUILD_NAME`: the name of the Probara Snap build the screenshots of
   * `probaraSnap` go to, when one run uploads several builds. Defaults to Probara's `default`.
   */
  snapBuildName?: string | undefined;
  /**
   * `PROBARA_SNAP_NONCE`: what the shards of one CI run share, so their screenshots join one
   * Probara Snap build. Defaults to what the CI gives (the run id and attempt on GitHub Actions,
   * else the provider's pipeline id).
   */
  snapNonce?: string | undefined;
}

/** What the reporter needs once Playwright began the run: core's adapter setup, and its own. */
export interface Setup extends AdapterSetup {
  captureOutput: boolean;
  snap: boolean;
  snapBuildName?: string;
  snapNonce?: string;
}

/** Options Playwright adds to every reporter's (`configDir`, `_mode`...): never core's. */
function isPlaywrightOption(name: string): boolean {
  return name === 'configDir' || name.startsWith('_');
}

/**
 * The core options of a run: the reporter options, with `rootDir` defaulting to Playwright's (the
 * directory the JUnit reporter's paths are relative to), the reporter's client name, and a logger on
 * stderr (stdout belongs to Playwright's own reporters).
 */
export function resolveSetup(options: ProbaraPlaywrightOptions, rootDir: string): Setup {
  const {
    captureOutput: captureOption,
    snap: snapOption,
    snapBuildName,
    snapNonce,
    ...rest
  } = options;
  const own = Object.fromEntries(
    Object.entries(rest).filter(([name]) => !isPlaywrightOption(name)),
  ) as ProbaraOptions & RuntimeOptions;
  const env = own.env ?? process.env;
  const capture = resolveBooleanSetting(
    captureOption,
    'captureOutput',
    'PROBARA_CAPTURE_OUTPUT',
    env,
  );
  const snap = resolveSnapSettings({ snap: snapOption, snapBuildName, snapNonce }, env);
  const setup = resolveAdapterSetup(own, {
    rootDir,
    clientName: CLIENT_NAME,
    adapterProblems: [capture.problem, ...snap.problems].filter((problem) => problem !== undefined),
  });
  return {
    ...setup,
    captureOutput: capture.value ?? false,
    snap: snap.snap,
    ...(snap.buildName === undefined ? {} : { snapBuildName: snap.buildName }),
    ...(snap.nonce === undefined ? {} : { snapNonce: snap.nonce }),
  };
}
