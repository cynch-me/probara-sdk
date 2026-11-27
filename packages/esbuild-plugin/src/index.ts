import { dirname, resolve } from 'node:path';
import { createBuildHandler, type ProbaraBundlerPluginOptions } from '@probara/bundler-plugin-core';

export type ProbaraEsbuildPluginOptions = ProbaraBundlerPluginOptions;

export interface EsbuildBuildLike {
  initialOptions: {
    metafile?: boolean | undefined;
    write?: boolean | undefined;
    outdir?: string | undefined;
    outfile?: string | undefined;
    absWorkingDir?: string | undefined;
  };
  onEnd(
    callback: (result: {
      errors: readonly unknown[];
      metafile?: { outputs: Record<string, unknown> } | undefined;
    }) => Promise<void>,
  ): void;
}

export interface ProbaraEsbuildPlugin {
  name: string;
  setup(build: EsbuildBuildLike): void;
}

export function probaraEsbuildPlugin(
  options: ProbaraEsbuildPluginOptions = {},
): ProbaraEsbuildPlugin {
  const name = '@probara/esbuild-plugin';
  const handle = createBuildHandler(options, { name });
  return {
    name: 'probara-esbuild-plugin',
    setup(build) {
      const initial = build.initialOptions;
      initial.metafile = true;
      build.onEnd(async (result) => {
        if (options.disable === true || result.errors.length > 0) return;
        if (initial.write === false) {
          if (options.silent !== true) {
            console.warn(
              `[${name}] esbuild was run with write: false, so there is no file to inject or upload`,
            );
          }
          return;
        }
        const cwd = initial.absWorkingDir ?? process.cwd();
        const out =
          initial.outdir ?? (initial.outfile === undefined ? undefined : dirname(initial.outfile));
        if (out === undefined || result.metafile === undefined) return;
        const files = Object.keys(result.metafile.outputs).map((path) => resolve(cwd, path));
        await handle({ dir: resolve(cwd, out), files });
      });
    },
  };
}
