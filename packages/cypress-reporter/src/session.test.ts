/**
 * The state one run keeps: what the `probara.*` helpers said and which attempt it belongs to, the
 * screenshots Cypress took, the browser the run uses, and what a run without a plugin does when
 * Cypress ends its process.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakePlugin,
  fakeRunner,
  passes,
  runSpec,
  type FakePlugin,
  type PluginEventResults,
} from '../test/support/cypress-fakes.js';
import { until } from '../test/support/wait.js';
import Reporter from './index.js';
import { resetRun } from './run.js';
import { probaraNodeEvents } from './setup.js';
import { session } from './session.js';
import {
  BROWSER_FILE,
  LINES_FILE,
  PLUGIN_FILE,
  screenshotsFile,
  sessionDir,
  writeJson,
} from './session-files.js';
import { VERSION } from './version.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const SPEC = 'cypress/e2e/cart.cy.js';
/** Where the package runs its own tests: nothing of a run may land there. */
const PACKAGE_DIR = join(__dirname, '..');

let fake: FakeProbara;
let log: string[];

function logger(): {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
} {
  const write = (level: string) => (message: string) => {
    log.push(`${level}: ${message}`);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

/** The options a run of this test reports with. */
function options(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: 'SHOP',
    logger: logger(),
    env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
    ...extra,
  };
}

/**
 * The reporter process's session, opened as one with a plugin: the marker is what the plugin
 * leaves before Cypress builds any reporter, so it is in place before this session opens.
 */
function openSession(extra: Record<string, unknown> = {}): void {
  session.begin({ reporterOptions: options(extra) }, '/work/app');
  const dir = sessionDir(process.pid);
  writeJson(dir, PLUGIN_FILE, { version: VERSION, readyAt: Date.now() });
  expect(session.open().plugin).toBe(true);
}

beforeEach(async () => {
  session.reset();
  resetRun();
  log = [];
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
  session.reset();
  resetRun();
});

describe('the session of a run', () => {
  it('opens the directory it shares with its plugin, and closes it with the run', () => {
    const dir = sessionDir(process.pid);
    openSession();
    expect(session.dir()).toBe(dir);
    expect(session.dir()).toBe(dir);

    session.close();
    expect(() => readdirSync(dir)).toThrow();
    // And nothing of it landed in the directory the package runs its tests in.
    expect(readdirSync(PACKAGE_DIR)).toEqual(
      readdirSync(PACKAGE_DIR).filter(
        (name) => !['browser.json', 'lines.json', 'plugin.json'].includes(name),
      ),
    );
  });

  it('takes no marker a run before this process left for its plugin', () => {
    // A pid is taken again: the marker of a run that crashed is older than this process, and a
    // plugin of this run writes its own after this process started.
    session.begin({ reporterOptions: options() }, '/work/app');
    writeJson(sessionDir(process.pid), PLUGIN_FILE, { version: VERSION, readyAt: 0 });
    expect(session.open().plugin).toBe(false);
  });

  it('gives each attempt the helpers of that attempt, in the order the plugin wrote them', () => {
    openSession();
    writeJson(session.dir(), LINES_FILE, []);
    const said = (message: { type: string; value?: string | Record<string, string> }) => {
      writeJson(session.dir(), LINES_FILE, [
        ...session.pluginState().lines,
        { type: 'message', message },
      ]);
    };

    // What the plugin writes while each attempt runs, read as each attempt ends.
    said({ type: 'title', value: 'Adds an item' });
    const first = session.pluginState().lines;
    said({ type: 'parameters', value: { build: '1' } });
    const both = session.pluginState().lines;

    expect(both).toHaveLength(2);
    // The reporter hands the reader the lines of the attempt that ended (which of them is its own
    // bookkeeping); the reader takes what it is given, in order.
    expect(session.detailsOf(first).metadata.title).toBe('Adds an item');
    expect(session.detailsOf(both.slice(1)).metadata.parameters).toEqual({ build: '1' });
    expect(session.detailsOf(both.slice(1)).metadata.title).toBeUndefined();
  });

  it('reads the screenshots of a spec by the names Cypress gave them', () => {
    openSession();
    const dir = session.dir();
    writeJson(dir, screenshotsFile(SPEC), [
      { path: `${dir}/Cart -- adds an item (failed).png` },
      { path: `${dir}/Cart -- adds an item (failed) (attempt 2).png` },
      { path: `${dir}/my own name.png` },
    ]);

    expect(session.screenshotsOf(SPEC).map((shot) => shot.name)).toEqual([
      'Cart -- adds an item (failed)',
      'Cart -- adds an item (failed) (attempt 2)',
      'my own name',
    ]);
    // A spec with none of its own has none.
    expect(session.screenshotsOf('cypress/e2e/other.cy.js')).toEqual([]);
  });

  it('reads the browser the plugin announced, and none without one', () => {
    openSession();
    writeJson(session.dir(), BROWSER_FILE, { name: 'electron' });
    expect(session.browser()).toBe('electron');
    expect(session.pluginState().browser).toBe('electron');

    session.reset();
    openSession();
    writeJson(session.dir(), BROWSER_FILE, {});
    expect(session.browser()).toBeUndefined();
  });

  it('warns about an option it does not know, and hands the results over all the same', () => {
    openSession({ notAnOption: true });
    const dir = session.dir();
    session.handOver({ spec: SPEC, ignored: 0, results: [] });
    // What it handed over is where the plugin reads it, named after the spec.
    expect(readdirSync(dir)).toContain('results');
    expect(log.filter((line) => line.includes('unknown option'))).toEqual([
      'warn: Ignored the unknown option "notAnOption" of @probara/cypress-reporter',
    ]);
  });
});

describe('a run whose Cypress config registers no plugin', () => {
  it('warns once what is missing, and sends the spec in a run of its own', async () => {
    expect(session.open().plugin).toBe(false);
    const runner = fakeRunner(SPEC);
    new Reporter(runner.runner, { reporterOptions: options() });
    runSpec(runner, SPEC, { tests: [passes('adds an item')] }, () => undefined);
    // Nothing waits for the send on the product's side either: this is the wait for it here.
    await until(() => fake.reports().length === 1, 'the report of a run without a plugin');

    expect(fake.reports()).toHaveLength(1);
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
    const warnings = log.filter((line) => line.includes('setupNodeEvents'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('first seen in');
    expect(log.join('\n')).not.toContain(TOKEN);
  });

  it('holds the exit of its process until what it collected is sent', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- what is compared here.
    const exit = process.exit;
    expect(session.open().plugin).toBe(false);
    const runner = fakeRunner(SPEC);
    new Reporter(runner.runner, { reporterOptions: options() });
    // Cypress ends this process with an explicit `process.exit`, which no `beforeExit` hook sees:
    // the reporter took it over, and sends what it collected before letting the process go.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- what is compared here.
    expect(process.exit).not.toBe(exit);

    runSpec(runner, SPEC, { tests: [passes('adds an item')] }, () => undefined);
    const sent = fake.reports().length;
    await until(
      () => fake.reports().length > sent,
      'the report the exit of the process waited for',
    );
    expect(fake.reports().length).toBeGreaterThan(sent);
  });
});

describe('the plugin of a run', () => {
  it('leaves the marker the reporter looks for, with the browser of the run', async () => {
    const events: FakePlugin = fakePlugin();
    events.config.reporterOptions = options();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });

    // In the directory of the reporter process, which is this process' parent.
    const dir = sessionDir(process.ppid);
    expect(readdirSync(dir)).toContain('plugin.json');
    expect(readdirSync(dir, { recursive: true }).join(' ')).toContain('browser.json');
  });

  it('warns about an option it does not know, once, and sends all the same', async () => {
    const events = fakePlugin();
    events.config.reporterOptions = options({ notAnOption: true });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    await events.emit('after:spec', { relative: SPEC }, {
      stats: { tests: 1, failures: 0 },
      video: null,
    } satisfies PluginEventResults['after:spec'][1]);
    await events.emit('after:run', { totalDuration: 1 });

    expect(log.filter((line) => line.includes('unknown option'))).toEqual([
      'warn: Ignored the unknown option "notAnOption" of @probara/cypress-reporter',
    ]);
  });
});
