/**
 * Regenerates the committed OpenAPI subset and the API types of `@probara/core`.
 *
 * Usage: `pnpm --filter @probara/core generate:api [source] [--check]`
 *
 * - `source`: URL or file path of the published spec. Falls back to `PROBARA_OPENAPI_SOURCE`,
 *   then to the public spec.
 * - `--check`: generates in memory and exits 1 when the committed files differ (drift guard).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDrift, renderApiOutputs, type ApiOutputName } from './api-outputs.ts';
import type { OpenApiDocument } from './filter-openapi.ts';

const DEFAULT_SOURCE = 'https://docs.probara.net/openapi/v1.json';

const OUTPUT_FILES: Record<ApiOutputName, string> = {
  spec: fileURLToPath(new URL('../openapi/probara-api.json', import.meta.url)),
  types: fileURLToPath(new URL('../src/generated/api.ts', import.meta.url)),
};

async function loadSpec(source: string): Promise<OpenApiDocument> {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Fetching ${source} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as OpenApiDocument;
  }
  return JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument;
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const source =
    argv.find((arg) => !arg.startsWith('--')) ??
    process.env['PROBARA_OPENAPI_SOURCE'] ??
    DEFAULT_SOURCE;

  const outputs = await renderApiOutputs(await loadSpec(source), source);

  if (check) {
    const drifted = findDrift(outputs, {
      spec: await readIfPresent(OUTPUT_FILES.spec),
      types: await readIfPresent(OUTPUT_FILES.types),
    });
    if (drifted.length > 0) {
      const files = drifted.map((name) => `  ${OUTPUT_FILES[name]}`).join('\n');
      console.error(
        `The committed API files drifted from ${source}:\n${files}\n` +
          'Run `pnpm --filter @probara/core generate:api` and commit the result.',
      );
      return 1;
    }
    console.log(`The committed API files match ${source}.`);
    return 0;
  }

  for (const name of Object.keys(OUTPUT_FILES) as ApiOutputName[]) {
    await mkdir(dirname(OUTPUT_FILES[name]), { recursive: true });
    await writeFile(OUTPUT_FILES[name], outputs[name]);
    console.log(`Wrote ${OUTPUT_FILES[name]}`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
