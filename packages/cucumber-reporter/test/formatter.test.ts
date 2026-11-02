/**
 * The formatter as cucumber-js runs it: the real cucumber-js, the built formatter, and a fake Probara
 * over HTTP. What the fake receives is what Probara would store: the results of each attempt, their
 * keys, statuses, steps and attachments, and the reporting failures that never change the run.
 */
import { describe, expect, it } from 'vitest';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { HOOKS, MEDIA, OUTCOMES, PAY, STEPS } from './support/project.js';
import { createWorkspace, probaraEnv, TOKEN, type Workspace } from './support/workspace.js';

const FORMAT = ['--format', '@probara/cucumber-reporter'];
const PAY_FILE = 'features/checkout/pay.feature';
const BACKGROUND = {
  action: 'Background',
  status: 'passed',
  steps: [{ keyword: 'Given', action: 'a cart with a book', status: 'passed' }],
};

/** Every result the fake Probara received, in arrival order. */
function resultsOf(fake: FakeProbara) {
  return fake.reports().flatMap((report) => report.results);
}

/** A project with the given feature files and the shared step definitions. */
function projectWith(features: Record<string, string>): Promise<Workspace> {
  return createWorkspace({ 'features/support/steps.js': STEPS, ...features });
}

describe('the formatter, run by cucumber-js against a fake Probara', { timeout: 120_000 }, () => {
  it('sends each scenario with its steps, keywords and data, linked to the case its tag names', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ [PAY_FILE]: PAY });
    try {
      const run = await ws.cucumber([...FORMAT, PAY_FILE], probaraEnv(fake.baseUrl));
      expect(run.exitCode).toBe(0);
      const results = resultsOf(fake);

      expect(results.find((result) => result.title === 'Pay with the saved card')).toMatchObject({
        automationKey: `${PAY_FILE} > Checkout > Pay with the saved card`,
        status: 'passed',
        caseDisplayId: 'SHOP-12',
        suitePath: ['features', 'checkout', 'Checkout'],
        steps: [
          BACKGROUND,
          { keyword: 'When', action: 'the customer pays with the saved card', status: 'passed' },
          { keyword: 'Then', action: 'the order is confirmed', status: 'passed' },
        ],
      });
      expect(results.find((result) => result.title === 'Send the receipt')?.steps).toMatchObject([
        BACKGROUND,
        {
          keyword: 'When',
          action: 'the customer sends the receipt:',
          status: 'passed',
          data: 'Thank you for the order.',
        },
        {
          keyword: 'Then',
          action: 'the receipt table is:',
          status: 'passed',
          data: '| item | price |\n| book | 12 |',
        },
      ]);
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('keys the results as sync gherkin keys the same scenarios, the Rule and the outline left out', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ [PAY_FILE]: PAY });
    try {
      await ws.cucumber([...FORMAT, PAY_FILE], probaraEnv(fake.baseUrl));
      const synced = await ws.probara(
        ['sync', 'gherkin', 'features/**/*.feature'],
        probaraEnv(fake.baseUrl),
      );
      expect(synced.exitCode).toBe(0);
      const syncedKeys = fake
        .gherkinSyncs()
        .flatMap((sync) => sync.features.flatMap((feature) => feature.scenarios))
        .map((scenario) => scenario.automationKey);
      const reportedKeys = new Set(resultsOf(fake).map((result) => result.automationKey));
      expect(syncedKeys.sort()).toEqual([...reportedKeys].sort());
      expect(reportedKeys).toEqual(
        new Set([
          `${PAY_FILE} > Checkout > Pay with the saved card`,
          `${PAY_FILE} > Checkout > Send the receipt`,
          `${PAY_FILE} > Checkout > Pay with <method>`,
        ]),
      );
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('sends each outline row as its own result under one key, with its Examples values as parameters', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ [PAY_FILE]: PAY });
    try {
      await ws.cucumber([...FORMAT, PAY_FILE], probaraEnv(fake.baseUrl));
      const rows = resultsOf(fake).filter((result) => result.title === 'Pay with <method>');
      expect(rows.map((row) => row.parameters)).toEqual([
        { method: 'visa', amount: '12' },
        { method: 'paypal', amount: '30' },
      ]);
      expect(new Set(rows.map((row) => row.automationKey))).toEqual(
        new Set([`${PAY_FILE} > Checkout > Pay with <method>`]),
      );
      expect(rows[0]?.steps?.[1]).toMatchObject({ action: 'the customer pays 12 with visa' });
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('reports each step status: a failed step fails the scenario with its error, undefined and pending steps are skipped, an ambiguous step fails', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ 'features/outcomes/outcomes.feature': OUTCOMES });
    try {
      const run = await ws.cucumber(
        [...FORMAT, 'features/outcomes/outcomes.feature'],
        probaraEnv(fake.baseUrl),
      );
      expect(run.exitCode).toBe(1);
      const results = resultsOf(fake);
      const declined = results.find((result) => result.title === 'A declined card fails');
      expect(declined?.status).toBe('failed');
      expect(declined?.notes).toContain('The card was declined');
      expect(declined?.steps?.map((step) => [step.action, step.status])).toEqual([
        ['a page with a card', 'passed'],
        ['the customer pays with a declined card', 'failed'],
        ['the order is confirmed', 'skipped'],
      ]);
      expect(declined?.steps?.[1]?.error).toContain('The card was declined');
      expect(
        results.find((result) => result.title === 'A page with no step definition'),
      ).toMatchObject({
        status: 'skipped',
      });
      expect(
        results.find((result) => result.title === 'A step that is still pending'),
      ).toMatchObject({
        status: 'skipped',
      });
      const ambiguous = results.find(
        (result) => result.title === 'A step that matches two definitions',
      );
      expect(ambiguous?.status).toBe('failed');
      expect(ambiguous?.notes).toMatch(/step definition/);
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('fails a scenario on a failed After hook with the hook message, and leaves the hook out of its steps', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ 'features/hooks/hooks.feature': HOOKS });
    try {
      await ws.cucumber([...FORMAT, 'features/hooks/hooks.feature'], probaraEnv(fake.baseUrl));
      const [result] = resultsOf(fake);
      expect(result).toMatchObject({
        title: 'The after hook breaks',
        status: 'failed',
        steps: [{ keyword: 'Given', action: 'a cart with a book', status: 'passed' }],
      });
      expect(result?.notes).toContain('cleanup broke');
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('sends every attempt of a retried scenario as a result of its own', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ 'features/outcomes/outcomes.feature': OUTCOMES });
    try {
      await ws.cucumber(
        [...FORMAT, '--retry', '1', 'features/outcomes/outcomes.feature'],
        probaraEnv(fake.baseUrl),
      );
      const attempts = resultsOf(fake).filter((result) => result.title === 'A declined card fails');
      expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'failed']);
      expect(attempts.map((attempt) => attempt.automationKey)).toEqual([
        'features/outcomes/outcomes.feature > Outcomes > A declined card fails',
        'features/outcomes/outcomes.feature > Outcomes > A declined card fails',
      ]);
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('uploads the attachments of a step and of a hook: text, a log as a text file, and an image', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ 'features/media/media.feature': MEDIA });
    try {
      const run = await ws.cucumber(
        [...FORMAT, 'features/media/media.feature'],
        probaraEnv(fake.baseUrl),
      );
      expect(run.exitCode).toBe(0);
      expect(
        fake
          .stagedFiles()
          .map((file) => [file.name, file.type, file.size])
          .sort(),
      ).toEqual([
        ['attachment.png', 'image/png', 4],
        ['attachment.txt', 'text/plain', 'before text'.length],
        ['attachment.txt', 'text/plain', 'the page text'.length],
        ['log.txt', 'text/plain', 'a log line'.length],
      ]);
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('never changes the exit code of the run: a run that passes exits 0 and a failing one exits 1, with Probara unreachable', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const unreachable = fake.baseUrl;
    await fake.close();
    const ws = await projectWith({
      [PAY_FILE]: PAY,
      'features/outcomes/outcomes.feature': OUTCOMES,
    });
    try {
      const env = probaraEnv(unreachable);
      const options = ['--format-options', '{"probara":{"maxRetries":0}}'];
      const passing = await ws.cucumber([...FORMAT, ...options, PAY_FILE], env);
      expect(passing.exitCode).toBe(0);
      expect(passing.stderr).toContain('[probara]');
      const failing = await ws.cucumber(
        [...FORMAT, ...options, 'features/outcomes/outcomes.feature'],
        env,
      );
      expect(failing.exitCode).toBe(1);
      for (const output of [passing.stdout, passing.stderr, failing.stdout, failing.stderr]) {
        expect(output).not.toContain(TOKEN);
      }
    } finally {
      await ws.remove();
    }
  });

  it('writes nothing to stdout, and logs its summary on stderr', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ [PAY_FILE]: PAY });
    try {
      const run = await ws.cucumber([...FORMAT, PAY_FILE], probaraEnv(fake.baseUrl));
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain(
        '[probara] Sending 4 results of 4 tests (4 passed, 0 failed, 0 skipped, 0 blocked)',
      );
    } finally {
      await ws.remove();
      await fake.close();
    }
  });

  it('takes its options from the probara key of the format options, over the environment', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await projectWith({ [PAY_FILE]: PAY });
    try {
      await ws.cucumber(
        [...FORMAT, '--format-options', '{"probara":{"projectId":"WEB"}}', PAY_FILE],
        probaraEnv(fake.baseUrl),
      );
      expect(fake.requestsTo('report').map((request) => request.projectId)).toEqual(['WEB']);
    } finally {
      await ws.remove();
      await fake.close();
    }
  });
});
