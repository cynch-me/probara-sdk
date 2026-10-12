/**
 * The `probara.*` helpers of a test, in real Vitest, against a fake Probara: what each helper sends,
 * the steps and the concurrent tests attributed to their own test on the threads and forks pools, a
 * run through a blob and `--merge-reports`, and a run without the reporter, where the helpers do nothing.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;

/** The automation key of a top-level test of the fixture: its file, then its title. */
function keyOf(title: string): string {
  return `tests/helpers.test.ts > ${title}`;
}

/** Every result the fake received, in the order they were sent. */
function sentOf(probara: FakeProbara) {
  return probara.reports().flatMap((report) => report.results);
}

type Sent = ReturnType<typeof sentOf>;

/** The one result sent for a test of the fixture. */
function resultOf(results: Sent, title: string) {
  const found = resultsOf(results, title);
  expect(found).toHaveLength(1);
  const [only] = found;
  if (only === undefined) throw new Error(`no result sent for "${title}"`);
  return only;
}

/** Every result sent for a test of the fixture: one per case the test links (core fans them out). */
function resultsOf(results: Sent, title: string) {
  return results.filter((result) => result.automationKey === keyOf(title));
}

/** The parts of the sent results that do not depend on timing, by key: the same for every pool. */
function projectionOf(results: Sent) {
  return results
    .map((result) => ({
      key: result.automationKey,
      status: result.status,
      title: result.title,
      parameters: result.parameters,
      steps: (result.steps ?? []).map((step) => step.action),
      caseTags: result.case?.tags,
    }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/** How many times `text` appears in the output of a run. */
function occurrences(run: CommandRun, text: string): number {
  return (run.stdout + run.stderr).split(text).length - 1;
}

describe.each(VITEST_VERSIONS)('$name: the probara.* helpers', (vitest) => {
  /** Vitest 4.1 and later have the native tags of a test, which the helpers' case takes. */
  const nativeTags = vitest.name !== 'Vitest 3';
  let threads: FakeProbara;
  let forks: FakeProbara;
  let merged: FakeProbara;
  let workspace: Workspace;
  let withReporter: CommandRun;
  let withForks: CommandRun;
  let withoutReporter: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    threads = await startFakeProbara({ token: TOKEN });
    forks = await startFakeProbara({ token: TOKEN });
    merged = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'helpers');
    withReporter = await workspace.vitest(['run'], probaraEnv(threads.baseUrl));
    withForks = await workspace.vitest(['run', '--pool=forks'], probaraEnv(forks.baseUrl));
    withoutReporter = await workspace.vitest(['run', '--config', 'plain.config.mts']);
    // A shard writes its blob with the reporter beside it (V-D4): the helpers' setup and runner are then
    // registered, and the merge run reports the blob once, with the metadata the helpers recorded.
    await workspace.vitest(['run', '--config', 'blob.config.mts', '--shard=1/1']);
    await workspace.vitest(['--merge-reports'], probaraEnv(merged.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all([threads.close(), forks.close(), merged.close()]);
    await workspace.remove();
  });

  it('sends the title, suite, comment, parameters, links and the issue of the helpers', () => {
    expect(
      resultOf(
        sentOf(threads),
        'records the title, suite, comment, parameters, a link and an issue',
      ),
    ).toMatchObject({
      status: 'passed',
      title: 'Checkout total',
      suitePath: ['Payments', 'Cards'],
      notes: 'Runs on staging only',
      parameters: { region: 'eu' },
      links: [
        { url: 'https://ci.example.com/build/12', name: 'Build' },
        { url: 'https://jira.example.com/browse/SHOP-7', name: 'SHOP-7' },
      ],
    });
  });

  it('links the case of probara.id() and the case id of the title, the helper first, one result for each', () => {
    const results = resultsOf(sentOf(threads), 'checks the total');
    expect(results.map((result) => result.caseDisplayId)).toEqual(['SHOP-41', 'SHOP-40']);
  });

  it('is not sent when it ignores itself', () => {
    expect(sentOf(threads).map((result) => result.automationKey)).not.toContain(
      keyOf('is left out of the report when it ignores itself'),
    );
  });

  it('sends the tags and the fields of the helpers in the case it creates, and nowhere else', () => {
    const result = resultOf(
      sentOf(threads),
      'gives the case it creates its tags and fields, and nothing else',
    );
    expect(result).not.toHaveProperty('tags');
    expect(result.case).toMatchObject({
      description: 'Sums the cart',
      tags: ['smoke', 'payments'],
      fields: { priority: 'high' },
    });
  });

  it('adds the native tags of the test to the case it creates, on Vitest 4.1 and later', () => {
    const result = resultOf(
      sentOf(threads),
      'gives the case it creates the native tags of Vitest 4.1 and later too',
    );
    expect(result.case?.tags).toEqual(nativeTags ? ['smoke', 'regression'] : ['smoke']);
  });

  it('sends the steps nested as they ran, and the outermost ones as the steps of its case', () => {
    const result = resultOf(
      sentOf(threads),
      'nests the steps it runs, and gives the case the outermost ones, with their expected results and data',
    );
    expect(result.steps).toEqual([
      expect.objectContaining({
        action: 'Open the cart',
        status: 'passed',
        expected: 'The cart is open',
        steps: [
          expect.objectContaining({
            action: 'Add the item',
            status: 'passed',
            expected: 'One item in the cart',
            data: 'SKU-1',
          }),
        ],
      }),
    ]);
    expect(result.case?.steps).toEqual([{ action: 'Open the cart', expected: 'The cart is open' }]);
  });

  it('sends a step its test never waited for as unfinished, and the test as it ended', () => {
    const result = resultOf(
      sentOf(threads),
      'reports a step its test never waited for as unfinished',
    );
    expect(result.status).toBe('passed');
    expect(result.steps).toEqual([
      expect.objectContaining({
        action: 'Wait for the email',
        status: 'failed',
        error: expect.stringContaining('The step had not finished when the test ended') as string,
      }),
    ]);
  });

  it('fails the test with the error of the step that threw', () => {
    const result = resultOf(sentOf(threads), 'fails the test with the error of a step that throws');
    expect(result.status).toBe('failed');
    expect(result.steps).toEqual([
      expect.objectContaining({
        action: 'Submit the form',
        status: 'failed',
        error: expect.stringContaining('the card was declined') as string,
      }),
    ]);
  });

  it('attributes the helpers of two concurrent tests to their own test', () => {
    const sent = sentOf(threads);
    expect(resultOf(sent, 'the first of two concurrent tests')).toMatchObject({
      title: 'First concurrent',
      parameters: { who: 'first' },
      steps: [expect.objectContaining({ action: 'First step', status: 'passed' })],
      case: { tags: ['first'] },
    });
    const second = resultOf(sent, 'the second of two concurrent tests');
    expect(second).toMatchObject({
      title: 'Second concurrent',
      parameters: { who: 'second' },
      steps: [expect.objectContaining({ action: 'Second step', status: 'passed' })],
    });
    expect(second.case?.tags).toBeUndefined();
  });

  it('sends the parameters of each row of test.each, with the row title as the key', () => {
    const sent = sentOf(threads);
    expect(resultOf(sent, 'doubles the input 1').parameters).toEqual({ input: '1' });
    expect(resultOf(sent, 'doubles the input 2').parameters).toEqual({ input: '2' });
  });

  it('passes a test that attaches while it runs', () => {
    expect(
      resultOf(sentOf(threads), 'attaches a body while the test runs, and passes').status,
    ).toBe('passed');
  });

  it('warns once about a wrong argument, and sends the test as it ran', () => {
    expect(resultOf(sentOf(threads), 'warns about a wrong argument once, and goes on').status).toBe(
      'passed',
    );
    expect(
      occurrences(
        withReporter,
        'probara.id() takes a case id or a list of case ids, such as PRB-12',
      ),
    ).toBe(1);
  });

  it('warns once about a helper called outside a test, and records nothing for it', () => {
    expect(occurrences(withReporter, 'probara.title() only works while a test runs')).toBe(1);
  });

  it('gives each attempt of a retried test the steps of its own attempt, and none of the attempts before it', () => {
    const results = resultsOf(
      sentOf(threads),
      'routes the helpers of each attempt to that attempt',
    );
    expect(results.map((result) => result.status)).toEqual(['failed', 'failed', 'passed']);
    expect(results.map((result) => (result.steps ?? []).map((step) => step.action))).toEqual([
      ['Attempt 1 step'],
      ['Attempt 2 step'],
      ['Attempt 3 step'],
    ]);
  });

  it('sends the same results on the forks pool as on the threads pool, with the same exit code', () => {
    expect(withForks.exitCode).toBe(withReporter.exitCode);
    expect(projectionOf(sentOf(forks))).toEqual(projectionOf(sentOf(threads)));
  });

  it('keeps the helpers through a blob and --merge-reports: the merged run sends the same results', () => {
    expect(projectionOf(sentOf(merged))).toEqual(projectionOf(sentOf(threads)));
  });

  it('does nothing without the reporter, and a step still runs its body: the run is the same', () => {
    expect(withoutReporter.exitCode).toBe(withReporter.exitCode);
    expect(occurrences(withoutReporter, '[probara]')).toBe(0);
  });
});
