/**
 * The options tables of `docs/configuration.md` are the reporter's real options: one row per
 * option of `ProbaraPlaywrightOptions` (read from its types), with its type; each variable sets
 * what its option sets; every `PROBARA_*` variable the code reads has its row; and the literal
 * defaults are the resolved ones.
 */
import { join } from 'node:path';
import { resolveConfig, type ConfigResolution } from '@probara/core';
import { read, tableAfter } from '@probara/test-support/docs/markdown';
import { describe, expect, it } from 'vitest';
import { resolveSetup, type ProbaraPlaywrightOptions } from '../../src/options.js';
import { PACKAGE_DIR } from './markdown.js';
import { realOptions, variablesInSource } from './options.js';

const NONE = '—';
const PAGE = join(PACKAGE_DIR, 'docs', 'configuration.md');
/** Options the reporter sets itself: they are not the user's to set. */
const SET_BY_THE_REPORTER: Readonly<Record<string, string>> = {
  clientName: 'the reporter sends its own name and version in the User-Agent',
};
const ULID = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const CREDENTIALS = { PROBARA_API_TOKEN: 'prb_docs_token', PROBARA_PROJECT: 'SHOP' };

/** A cell as a reader sees it: without the backticks around code. */
function plain(cell: string): string {
  return cell.replace(/`/g, '').replace(/\\\|/g, '|').trim();
}

interface Row {
  option: string;
  variable: string;
  type: string;
  defaultValue: string;
}

function rowsAfter(marker: string): Row[] {
  return tableAfter(read(PAGE), marker).map((cells) => ({
    option: plain(cells[0] ?? ''),
    variable: plain(cells[1] ?? ''),
    type: plain(cells[2] ?? ''),
    defaultValue: (cells[3] ?? '').trim(),
  }));
}

const options = realOptions();
const settings = options.filter(
  (option) => !option.runtime && SET_BY_THE_REPORTER[option.name] === undefined,
);
const runtime = options.filter((option) => option.runtime);
const rows = rowsAfter('options-table');
const runtimeRows = rowsAfter('runtime-options-table');

/** What the reporter makes of options and variables: core's configuration, and its own. */
function probe(options: ProbaraPlaywrightOptions, env: Record<string, string>) {
  const setup = resolveSetup({ ...options, env, logger: silent }, '/work/shop');
  const resolution: ConfigResolution = resolveConfig(setup.core, env);
  return JSON.parse(
    JSON.stringify({
      resolution,
      captureOutput: setup.captureOutput,
      problems: setup.core.adapterProblems,
    }),
  ) as unknown;
}

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Each variable, a value of it, and the option value that means the same. */
const SAMPLES: Readonly<
  Record<string, { env: string; option: unknown; base?: ProbaraPlaywrightOptions }>
> = {
  PROBARA_ENABLED: { env: 'false', option: false },
  PROBARA_API_TOKEN: { env: 'prb_other_token', option: 'prb_other_token' },
  PROBARA_PROJECT: { env: 'WEB', option: 'WEB' },
  PROBARA_BASE_URL: { env: 'https://probara.example.com', option: 'https://probara.example.com' },
  PROBARA_RUN_ULID: { env: ULID, option: ULID },
  PROBARA_RUN_NAME: { env: 'Nightly', option: 'Nightly' },
  PROBARA_RUN_DESCRIPTION: { env: 'Every night', option: 'Every night' },
  PROBARA_ENVIRONMENT: { env: 'staging', option: 'staging' },
  PROBARA_ENVIRONMENT_ID: { env: ULID, option: ULID },
  PROBARA_MILESTONE: { env: 'M-3', option: 'M-3' },
  PROBARA_MILESTONE_ID: { env: ULID, option: ULID },
  PROBARA_PLAN: { env: 'PLAN-2', option: 'PLAN-2' },
  PROBARA_CONFIGURATIONS: { env: 'OS=Linux', option: [{ group: 'OS', name: 'Linux' }] },
  PROBARA_CONFIGURATION_ULIDS: { env: ULID, option: [ULID] },
  PROBARA_RUN_TAGS: { env: 'nightly,smoke', option: ['nightly', 'smoke'] },
  PROBARA_RUN_ULIDS: { env: `WEB=${ULID}`, option: { WEB: ULID }, base: { projects: ['WEB'] } },
  PROBARA_PROJECTS: { env: 'WEB,API', option: ['WEB', 'API'] },
  PROBARA_BRANCH: { env: 'main', option: 'main' },
  PROBARA_COMMIT: { env: 'abc1234', option: 'abc1234' },
  PROBARA_BUILD_URL: { env: 'https://ci.example.com/1', option: 'https://ci.example.com/1' },
  PROBARA_CREATE_MISSING_CASES: { env: 'false', option: false },
  PROBARA_SUITE_ULID: { env: ULID, option: ULID },
  PROBARA_CLOSE_RUN: { env: 'false', option: false },
  PROBARA_UPLOAD_ATTACHMENTS: { env: 'false', option: false },
  PROBARA_CAPTURE_OUTPUT: { env: 'true', option: true },
  PROBARA_STATUS_MAPPING: { env: 'failed=blocked', option: { failed: 'blocked' } },
  PROBARA_STATUS_FILTER: { env: 'skipped', option: ['skipped'] },
  PROBARA_RESULTS_FILE: { env: 'probara-results.json', option: 'probara-results.json' },
  PROBARA_ASSIGN_FAILED_TO: {
    env: 'ana@example.com,bo@example.com',
    option: ['ana@example.com', 'bo@example.com'],
  },
  PROBARA_DEBUG: { env: 'true', option: true },
};

/** `{ run: { name: value } }` for `run.name`. */
function optionsWith(path: string, value: unknown): ProbaraPlaywrightOptions {
  const [head = '', field] = path.split('.');
  return field === undefined ? { [head]: value } : { [head]: { [field]: value } };
}

describe('docs/configuration.md options table', () => {
  it('has one row per option of the reporter, and no other', () => {
    expect(rows.map((row) => row.option).sort()).toEqual(
      settings.map((option) => option.name).sort(),
    );
    expect(new Set(rows.map((row) => row.option)).size).toBe(rows.length);
  });

  it.each(settings.map((option) => [option.name, option] as const))(
    '%s has the type of the option',
    (name, option) => {
      expect(rows.find((row) => row.option === name)?.type).toBe(option.type);
    },
  );

  it('names every PROBARA_* variable the code reads, once', () => {
    const named = rows.map((row) => row.variable).filter((variable) => variable !== NONE);
    expect([...named].sort()).toEqual(variablesInSource());
  });

  it.each(
    rows
      .filter((row) => row.variable !== NONE)
      .map((row) => [`${row.variable} is ${row.option}`, row] as const),
  )('%s', (_label, row) => {
    const sample = SAMPLES[row.variable];
    expect(sample, `a sample value of ${row.variable} in SAMPLES`).toBeDefined();
    const base = sample?.base ?? {};
    // Messages name where a setting came from: the variable, or the option.
    const unnamed = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value)
          .replaceAll(`the ${row.option} option`, '<setting>')
          .replaceAll(row.variable, '<setting>')
          .replaceAll(row.option, '<setting>'),
      ) as unknown;
    const byVariable = unnamed(probe(base, { ...CREDENTIALS, [row.variable]: sample?.env ?? '' }));
    const byOption = unnamed(
      probe({ ...base, ...optionsWith(row.option, sample?.option) }, CREDENTIALS),
    );

    expect(byVariable).toEqual(byOption);
    expect(byVariable).not.toEqual(unnamed(probe(base, CREDENTIALS)));
  });

  it.each(
    rows
      .filter((row) => /^`(?:true|false|\d+|https:\/\/\S+)`$/.test(row.defaultValue))
      .map((row) => [row.option, row] as const),
  )('%s defaults to what the configuration resolves', (name, row) => {
    const resolved = probe({}, CREDENTIALS) as {
      resolution: { config: Record<string, unknown> };
      captureOutput: boolean;
    };
    const value =
      name === 'captureOutput' ? resolved.captureOutput : resolved.resolution.config[name];
    expect(String(value)).toBe(plain(row.defaultValue));
  });
});

describe('docs/configuration.md runtime options table', () => {
  it('has one row per seam of the reporter, with its type', () => {
    expect(runtimeRows.map((row) => [row.option, row.type]).sort()).toEqual(
      runtime.map((option) => [option.name, option.type]).sort(),
    );
  });
});
