/**
 * The `setupNodeEvents` plugin, on a fake of what Cypress hands it, against a fake Probara.
 *
 * The plugin runs in its own process, and it is where the Probara run lives: it writes the marker
 * the reporter process looks for, collects what the reporter handed over at `after:spec` (with the
 * video of the spec on its failed results), and sends and closes the run at `after:run`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import type { ReportRequest } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJson, resultsFile, sessionDir } from './session-files.js';
import { resetRun } from './run.js';
import { probaraNodeEvents } from './setup.js';
import { VERSION } from './version.js';
import {
  fakePlugin,
  type FakePlugin,
  type PluginEventResults,
} from '../test/support/cypress-fakes.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const SPEC = 'cypress/e2e/cart.cy.js';

/** Where the plugin of this process meets the reporter process (its parent, here). */
const DIR = sessionDir(process.ppid);

/** Every line the plugin logged, on every level. */
function capturingLogger() {
  const lines: string[] = [];
  const write = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`);
  };
  return {
    lines,
    logger: {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
    },
  };
}

let fake: FakeProbara;
let log: ReturnType<typeof capturingLogger>;

/** A plugin configured against the fake Probara, with the reporter options set. */
function plugin(options: Record<string, unknown> = {}, config = {}): FakePlugin {
  const events = fakePlugin(config);
  events.config.reporterOptions = {
    projectId: 'SHOP',
    logger: log.logger,
    env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
    ...options,
  };
  return events;
}

/** What the reporter process would have handed over for `spec`. */
function handedOver(spec: string, results: readonly Record<string, unknown>[], ignored = 0): void {
  writeJson(DIR, resultsFile(spec), { spec, results, ignored });
}

/** Every entry Probara received: its key, its case, and its status. */
function entriesOf(probara: FakeProbara): Record<string, string[]> {
  const entries: Record<string, string[]> = {};
  for (const result of probara.reports().flatMap((report: ReportRequest) => report.results)) {
    const label = `${result.automationKey ?? '?'} | ${result.caseDisplayId ?? '-'}`;
    (entries[label] ??= []).push(result.status);
  }
  return entries;
}

/** One result, as a reporter of this package would hand it over, with the test it is of. */
function resultOf(key: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    test: JSON.stringify([SPEC, key]),
    input: {
      identity: { file: SPEC, titlePath: [key] },
      status,
      suitePath: [SPEC],
      ...extra,
    },
  };
}

beforeEach(async () => {
  resetRun();
  log = capturingLogger();
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  resetRun();
  await fake.close();
});

describe('probaraNodeEvents', () => {
  it('registers every event of a run, once, and returns the config it was given', () => {
    const events = plugin();
    const config = events.config;
    expect(probaraNodeEvents(events.on, config)).toBe(config);
    expect(probaraNodeEvents(events.on, config)).toBe(config);
    // Cypress loads the config twice in a run that fails to start: the events then fire twice.
    for (const name of [
      'before:run',
      'before:spec',
      'after:screenshot',
      'after:spec',
      'after:run',
    ]) {
      expect(events.count(name)).toBe(2);
    }
    expect(events.task('probara')).toBeTypeOf('function');
  });

  it('never throws, whatever it is given', () => {
    const events = plugin();
    expect(() => probaraNodeEvents(events.on, undefined as unknown as never)).not.toThrow();
    expect(() => probaraNodeEvents(undefined as never, events.config)).not.toThrow();
    expect(log.lines.join('\n')).not.toContain(TOKEN);
  });

  it('reads the reporter options out of a multi-reporter wrapper, as the reporter process does', async () => {
    // The shape a multi-reporter hands over: one key, this reporter's own name, and the user's
    // options inside it. The reporter process unwraps it (`reporterOptionsOf`), so the plugin must
    // agree: reading it raw resolves no options at all, and the run this plugin owns reports
    // nothing. The environment keeps the token and the Probara to talk to, and drops the project,
    // so the wrapped `projectId` is the only thing that can configure the run: what it configures is
    // what this run must do.
    const events = plugin({ env: { PROBARA_API_TOKEN: TOKEN, PROBARA_BASE_URL: fake.baseUrl } });
    events.config.reporterOptions = {
      '@probara/cypress-reporter': events.config.reporterOptions as Record<string, unknown>,
    };
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });
    await events.emit('before:spec', { relative: SPEC });
    handedOver(SPEC, [resultOf('Cart adds an item', 'passed')]);
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 1, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(log.lines.filter((line) => line.includes('unknown option'))).toEqual([]);
    expect(entriesOf(fake)).toEqual({ [`${SPEC} > Cart adds an item | -`]: ['passed'] });
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
  });

  it('leaves the marker the reporter process looks for, with the browser of the run', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });

    // What the reporter process reads to know it has a plugin, and which browser this run used.
    // The file the two processes meet in, read the way the reporter process reads it.
    const marker = JSON.parse(readFileSync(`${DIR}/plugin.json`, 'utf8')) as {
      version: string;
    };
    expect(marker.version).toBe(VERSION);
    // And the browser the run uses, which every result of the reporter carries as a parameter.
    expect(JSON.parse(readFileSync(`${DIR}/browser.json`, 'utf8'))).toEqual({
      name: 'electron',
    });
  });

  it('sends the results the reporter handed over, in one closed run', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });
    await events.emit('before:spec', { relative: SPEC });
    handedOver(SPEC, [
      resultOf('Cart adds an item', 'passed'),
      resultOf('Cart fails on purpose', 'failed'),
    ]);
    await events.emit('after:spec', { relative: SPEC }, {
      stats: { tests: 2, failures: 1 },
      video: null,
    } satisfies PluginEventResults['after:spec'][1]);
    await events.emit('after:run', { totalDuration: 1 });

    expect(entriesOf(fake)).toEqual({
      [`${SPEC} > Cart adds an item | -`]: ['passed'],
      [`${SPEC} > Cart fails on purpose | -`]: ['failed'],
    });
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
    expect(log.lines.filter((line) => line.startsWith('info: Sending '))).toEqual([
      'info: Sending 2 results of 2 tests (1 passed, 1 failed, 0 skipped, 0 blocked)',
    ]);
  });

  it('counts the results probara.ignore() left out, in the line it logs', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    handedOver(SPEC, [resultOf('Cart adds an item', 'passed')], 3);
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 1, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(log.lines.filter((line) => line.startsWith('info: Sending '))).toEqual([
      'info: Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked); 3 ignored with probara.ignore()',
    ]);
  });

  it('attaches the video of the spec to every failed result of it, and to no passing one', async () => {
    const events = plugin({ attachVideos: true });
    probaraNodeEvents(events.on, events.config);
    const video = `${DIR}/cart.cy.js.mp4`;
    writeFileSync(video, 'a video');
    await events.emit('before:spec', { relative: SPEC });
    handedOver(SPEC, [
      resultOf('Cart fails on purpose', 'failed'),
      resultOf('Cart adds an item', 'passed'),
    ]);
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 2, failures: 1 }, video },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(fake.stagedFiles().filter((file) => file.type === 'video/mp4')).toHaveLength(1);
  });

  it('reports one failed result for a spec that ran no test at all', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: 'cypress/e2e/broken.cy.js' });
    // Cypress builds no reporter for a spec it cannot parse: no results, one failure.
    await events.emit(
      'after:spec',
      { relative: 'cypress/e2e/broken.cy.js' },
      {
        stats: { tests: 0, failures: 1 },
        video: null,
      },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(entriesOf(fake)).toEqual({
      'cypress/e2e/broken.cy.js > Spec failed to run | -': ['failed'],
    });
  });

  it('names the run it creates, and leaves an interactive one open', async () => {
    const events = plugin({}, { isInteractive: true });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    handedOver(SPEC, [resultOf('Cart adds an item', 'passed')]);
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 1, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(fake.runs().map((created) => created.state)).toEqual(['open']);
    expect(log.lines.filter((line) => line.startsWith('info: The run'))).toEqual([
      expect.stringMatching(
        /^info: The run R-1 of SHOP stays open: close it in Probara, or with probara run close --project SHOP --run-ulid [0-9A-Z]{26}$/,
      ),
    ]);
  });

  it('exposes what the browser side of the run needs, before Cypress sends it anywhere', async () => {
    const runUlid = fake.seedRun({
      cases: [
        {
          caseDisplayId: 'SHOP-12',
          automationKey: 'cypress/e2e/cart.cy.js > Cart adds an item',
        },
      ],
    });
    const events = plugin({ runCasesOnly: true, run: { ulid: runUlid } });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });

    // Cypress sends the browser what `config.expose` holds when `setupNodeEvents` returns, and the
    // cases of the run can only be read after that: the browser gets the flag, and asks.
    expect(events.config.expose).toEqual({
      probara: { version: VERSION, captureOutput: false, runCasesOnly: true },
    });
    // Read once, whatever the number of specs.
    await events.emit('before:spec', { relative: 'cypress/e2e/other.cy.js' });
    expect(fake.requestsTo('caseKeys')).toHaveLength(1);
    expect(runUlid).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('warns once, without the token, when the cases of the run cannot be read', async () => {
    const events = plugin({ runCasesOnly: true });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    await events.emit('before:spec', { relative: SPEC });

    expect(log.lines.filter((line) => line.includes('runCasesOnly'))).toEqual([
      'warn: runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported',
    ]);
    expect(log.lines.join('\n')).not.toContain(TOKEN);
  });

  it('accepts what the `probara.*` helpers of the browser send, and never fails a test with it', () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    const task = events.task('probara');
    const line = (over: Record<string, unknown>) => ({
      kind: 'line',
      line: { file: SPEC, test: 'Cart adds an item', ...over },
    });
    expect(
      task?.(line({ type: 'message', message: { type: 'title', value: 'Adds an item' } })),
    ).toBeNull();
    expect(
      task?.(line({ type: 'message', message: { type: 'parameters', value: { build: '42' } } })),
    ).toBeNull();
    expect(task?.('a string')).toBeNull();
    expect(task?.(42)).toBeNull();
    expect(task?.(undefined)).toBeNull();
    // Nothing of it throws into the browser, whatever the support file sends.
    expect(() =>
      task?.(line({ type: 'message', message: { type: 'title', value: 'x' } })),
    ).not.toThrow();

    // The reporter process reads them from the session; what it does with them is its own test.
    const lines = JSON.parse(readFileSync(`${DIR}/lines.json`, 'utf8')) as { type: string }[];
    expect(lines.filter((line_) => line_.type === 'message')).toHaveLength(3);
  });

  it('writes the bytes of an attached file into the session, and records its copy', () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    const task = events.task('probara');

    expect(
      task?.({
        kind: 'attachment',
        line: {
          file: SPEC,
          test: 'Cart adds an item',
          type: 'attachment',
          name: 'note.txt',
          body: 'text',
        },
        text: 'hello',
      }),
    ).toBeNull();
    const bytes = task?.({
      kind: 'attachment',
      line: {
        file: SPEC,
        test: 'Cart adds an item',
        type: 'attachment',
        name: 'cart.csv',
        source: 'cart.csv',
        body: 'bytes',
      },
      base64: btoa('sku,qty\nA-1,2\n'),
    });

    expect(bytes).toBeNull();
    const lines = JSON.parse(readFileSync(`${DIR}/lines.json`, 'utf8')) as {
      type: string;
      name: string;
      copy: string;
      body?: string;
      source?: string;
    }[];
    const attachments = lines.filter((line_) => line_.type === 'attachment');
    expect(attachments).toHaveLength(2);
    // Core's reader looks a copy up as `files/<uuid>`: a uuid of its own, never a path.
    for (const line_ of attachments) {
      expect(line_.copy).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
    expect(readFileSync(`${DIR}/files/${attachments[0]?.copy ?? ''}`, 'utf8')).toBe('hello');
    expect(readFileSync(`${DIR}/files/${attachments[1]?.copy ?? ''}`, 'utf8')).toBe(
      'sku,qty\nA-1,2\n',
    );
  });

  it('answers the run selection with the cases of the run, and writes what it skipped', async () => {
    const runUlid = fake.seedRun({
      cases: [
        { caseDisplayId: 'SHOP-12', automationKey: 'cypress/e2e/cart.cy.js > Cart adds an item' },
      ],
    });
    const events = plugin({ runCasesOnly: true, run: { ulid: runUlid } });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    const task = events.task('probara');
    // A task may answer with a promise (Cypress awaits it): the cases are read once, on the way.
    const asked = (titlePath: string[]) =>
      Promise.resolve(task?.({ kind: 'select', file: SPEC, titlePath })) as Promise<{
        selected: boolean;
      }>;

    // The run takes the case whose id its title names, and the one whose key it has.
    await expect(asked(['Cart', 'SHOP-12 adds an item'])).resolves.toEqual({ selected: true });
    await expect(asked(['Cart', 'adds an item'])).resolves.toEqual({ selected: true });
    await expect(asked(['Cart', 'pays by card'])).resolves.toEqual({ selected: false });

    // What it skipped, the reporter leaves out of the report when the spec ends.
    const written = JSON.parse(readFileSync(`${DIR}/selection.json`, 'utf8')) as Record<
      string,
      { run: string; deselected: string[][] }
    >;
    expect(written[SPEC]?.deselected).toEqual([['Cart', 'pays by card']]);
    expect(written[SPEC]?.run).toBe(runUlid);
  });

  it('takes every test when nothing selected it, and says what the support file is for', async () => {
    const runUlid = fake.seedRun({ cases: [] });
    const events = plugin({ runCasesOnly: true, run: { ulid: runUlid } });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    await events.emit('after:spec', { relative: SPEC }, { stats: { tests: 0, failures: 0 } });
    await events.emit('after:run', {});

    // No spec ever asked: every test ran and is reported, and this says what would change it.
    expect(log.lines.filter((line) => line.includes('runCasesOnly'))).toEqual([
      "warn: runCasesOnly needs the support file: require('@probara/cypress-reporter/support') in the Cypress support file, or every test runs and is reported",
    ]);
  });

  it('answers the selection of a run it could not read, so every test runs', async () => {
    const events = plugin({ runCasesOnly: true, run: { ulid: 'not a ulid' } });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });

    await expect(
      Promise.resolve(
        events.task('probara')?.({ kind: 'select', file: SPEC, titlePath: ['Cart'] }),
      ),
    ).resolves.toEqual({ selected: true });
  });

  it('says nothing when the reporter process handed over no result at all', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 0, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    // No run is created and nothing is logged, and the plugin never claims a reporter is missing:
    // there is no path to a plugin that owns no run. `resolveAdapterSetup` always resolves a logger
    // (`@probara/core`), so `openRun` always opens the run, and it opens it before `after:run` is
    // registered; a plugin that could not open one returned the config before registering anything.
    // A run of a config that registers no reporter therefore reports nothing and says nothing about
    // it: what the user sees is a run that never got results, and the reporter process' own warning
    // is the only one that names it (`SETUP_MISSING`, once per spec).
    expect(log.lines.filter((line) => !line.startsWith('debug:'))).toEqual([]);
    expect(fake.runs()).toEqual([]);
  });
});
