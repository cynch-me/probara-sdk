import { join } from 'node:path';
import { createBuildHandler, type ProbaraBundlerPluginOptions } from '@probara/bundler-plugin-core';

export type ProbaraWebpackPluginOptions = ProbaraBundlerPluginOptions;

export interface WebpackCompilationLike {
  outputOptions: { path?: string | undefined };
  getAssets(): readonly { name: string }[];
}

export interface WebpackCompilerLike {
  hooks: {
    afterEmit: {
      tapPromise(name: string, hook: (compilation: WebpackCompilationLike) => Promise<void>): void;
    };
  };
}

export interface ProbaraWebpackPlugin {
  apply(compiler: WebpackCompilerLike): void;
}

export function probaraWebpackPlugin(
  options: ProbaraWebpackPluginOptions = {},
): ProbaraWebpackPlugin {
  const handle = createBuildHandler(options, { name: '@probara/webpack-plugin' });
  return {
    apply(compiler) {
      compiler.hooks.afterEmit.tapPromise('ProbaraWebpackPlugin', async (compilation) => {
        const dir = compilation.outputOptions.path;
        if (dir === undefined) return;
        const files = compilation.getAssets().map((asset) => join(dir, asset.name));
        await handle({ dir, files });
      });
    },
  };
}
