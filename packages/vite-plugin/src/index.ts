import { dirname, join, resolve } from 'node:path';
import { createBuildHandler, type ProbaraBundlerPluginOptions } from '@probara/bundler-plugin-core';

export type ProbaraVitePluginOptions = ProbaraBundlerPluginOptions;

export interface ProbaraVitePlugin {
  name: string;
  apply: 'build';
  enforce: 'post';
  config(config: {
    build?: { sourcemap?: unknown } | undefined;
  }): { build: { sourcemap: 'hidden' } } | undefined;
  writeBundle(
    outputOptions: { dir?: string | undefined; file?: string | undefined },
    bundle: Record<string, { type: string; fileName: string }>,
  ): Promise<void>;
}

export function probaraVitePlugin(options: ProbaraVitePluginOptions = {}): ProbaraVitePlugin {
  const name = '@probara/vite-plugin';
  const handle = createBuildHandler(options, { name });
  let mapsTurnedOn = false;
  return {
    name: 'probara-vite-plugin',
    apply: 'build',
    enforce: 'post',
    config(config) {
      if (options.disable === true || options.sourcemaps?.disable === true) return undefined;
      if (config.build?.sourcemap !== undefined) return undefined;
      mapsTurnedOn = true;
      if (options.debug === true && options.silent !== true) {
        console.debug(
          `[${name}] build.sourcemap is not set: hidden source maps are on for the upload, and deleted after it`,
        );
      }
      return { build: { sourcemap: 'hidden' } };
    },
    async writeBundle(outputOptions, bundle) {
      const out =
        outputOptions.dir ??
        (outputOptions.file === undefined ? undefined : dirname(outputOptions.file));
      if (out === undefined) return;
      const dir = resolve(out);
      const files = Object.values(bundle)
        .filter((output) => output.type === 'chunk')
        .map((chunk) => join(dir, chunk.fileName));
      await handle({
        dir,
        files,
        deleteMaps: mapsTurnedOn && options.sourcemaps?.filesToDeleteAfterUpload === undefined,
      });
    },
  };
}
