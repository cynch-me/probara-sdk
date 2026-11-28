import { dirname, join } from 'node:path';
import { createBuildHandler, type ProbaraBundlerPluginOptions } from '@probara/bundler-plugin-core';

export type ProbaraRollupPluginOptions = ProbaraBundlerPluginOptions;

export interface ProbaraRollupPlugin {
  name: string;
  writeBundle(
    outputOptions: { dir?: string | undefined; file?: string | undefined },
    bundle: Record<string, { type: string; fileName: string }>,
  ): Promise<void>;
}

export function probaraRollupPlugin(options: ProbaraRollupPluginOptions = {}): ProbaraRollupPlugin {
  const handle = createBuildHandler(options, { name: '@probara/rollup-plugin' });
  return {
    name: 'probara-rollup-plugin',
    async writeBundle(outputOptions, bundle) {
      const dir =
        outputOptions.dir ??
        (outputOptions.file === undefined ? undefined : dirname(outputOptions.file));
      if (dir === undefined) return;
      const files = Object.values(bundle)
        .filter((output) => output.type === 'chunk')
        .map((chunk) => join(dir, chunk.fileName));
      await handle({ dir, files });
    },
  };
}
