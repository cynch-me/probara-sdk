import { describe, expect, it } from 'vitest';
import { toAttempt, type CucumberAttempt, type CucumberStepResult } from './translate.js';

const CWD = '/work/shop';
const context = { cwd: CWD, rootDir: CWD };

interface AttachmentSpec {
  mediaType: string;
  body: string;
  contentEncoding?: string;
  fileName?: string;
}

interface StepSpec {
  /** As written, with its trailing space: `Given `. Defaults to `Given `. */
  keyword?: string;
  /** The step text, as the pickle has it (outline values already filled in). */
  text: string;
  /** A Cucumber Messages status. Defaults to `PASSED`. */
  status?: string;
  message?: string;
  ms?: number;
  docString?: string;
  table?: string[][];
  attachments?: AttachmentSpec[];
}

interface HookSpec {
  phase: 'before' | 'after';
  status: string;
  message?: string;
  ms?: number;
  attachments?: AttachmentSpec[];
}

interface Spec {
  uri?: string;
  feature?: string;
  rule?: string;
  background?: StepSpec[];
  scenario?: string;
  scenarioTags?: string[];
  steps?: StepSpec[];
  /** An outline with one row: its header and cells. The pickle is named `pickleName`. */
  examples?: { header: string[]; cells: string[]; pickleName: string };
  hooks?: HookSpec[];
}

function duration(ms: number) {
  return { seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1_000_000 };
}

function attachmentOf(attachment: AttachmentSpec) {
  return {
    body: attachment.body,
    contentEncoding: attachment.contentEncoding ?? 'IDENTITY',
    mediaType: attachment.mediaType,
    ...(attachment.fileName === undefined ? {} : { fileName: attachment.fileName }),
  };
}

/** One attempt, shaped as the event data collector of Cucumber hands it to a formatter. */
function attemptOf(spec: Spec): CucumberAttempt {
  const uri = spec.uri ?? 'features/checkout/pay.feature';
  let counter = 0;
  const next = (prefix: string) => `${prefix}${++counter}`;

  const gherkinStep = (step: StepSpec) => ({
    id: next('gs'),
    keyword: step.keyword ?? 'Given ',
    text: step.text,
  });
  const backgroundSteps = (spec.background ?? []).map((step) => ({
    step,
    gherkin: gherkinStep(step),
  }));
  const ownSteps = (spec.steps ?? []).map((step) => ({ step, gherkin: gherkinStep(step) }));
  const scenarioId = next('sc');
  const scenarioName = spec.scenario ?? 'Pay with the saved card';
  const row =
    spec.examples === undefined
      ? undefined
      : { id: next('row'), header: spec.examples.header, cells: spec.examples.cells };
  const scenario = {
    id: scenarioId,
    name: scenarioName,
    tags: (spec.scenarioTags ?? []).map((name) => ({ name })),
    steps: ownSteps.map(({ gherkin }) => gherkin),
    examples:
      row === undefined
        ? []
        : [
            {
              tableHeader: { cells: row.header.map((value) => ({ value })) },
              tableBody: [{ id: row.id, cells: row.cells.map((value) => ({ value })) }],
            },
          ],
  };
  const backgroundNode = {
    id: next('bg'),
    steps: backgroundSteps.map(({ gherkin }) => gherkin),
  };
  const backgroundChildren = backgroundSteps.length > 0 ? [{ background: backgroundNode }] : [];
  const feature = {
    name: spec.feature ?? 'Checkout',
    children:
      spec.rule === undefined
        ? [...backgroundChildren, { scenario }]
        : [...backgroundChildren, { rule: { name: spec.rule, children: [{ scenario }] } }],
  };

  const testSteps: { id: string; pickleStepId?: string; hookId?: string }[] = [];
  const pickleSteps: {
    id: string;
    text: string;
    astNodeIds: string[];
    argument?: {
      docString?: { content: string };
      dataTable?: { rows: { cells: { value: string }[] }[] };
    };
  }[] = [];
  const stepResults: Record<string, CucumberStepResult> = {};
  const stepAttachments: Record<string, ReturnType<typeof attachmentOf>[]> = {};

  const addStep = (step: StepSpec, gherkinId: string) => {
    const pickleStepId = next('ps');
    const argument =
      step.docString !== undefined
        ? { docString: { content: step.docString } }
        : step.table !== undefined
          ? {
              dataTable: {
                rows: step.table.map((cells) => ({ cells: cells.map((value) => ({ value })) })),
              },
            }
          : undefined;
    pickleSteps.push({
      id: pickleStepId,
      text: step.text,
      astNodeIds: [gherkinId],
      ...(argument === undefined ? {} : { argument }),
    });
    const testStepId = next('ts');
    testSteps.push({ id: testStepId, pickleStepId });
    stepResults[testStepId] = {
      status: step.status ?? 'PASSED',
      ...(step.message === undefined ? {} : { message: step.message }),
      duration: duration(step.ms ?? 0),
    };
    if (step.attachments !== undefined) {
      stepAttachments[testStepId] = step.attachments.map(attachmentOf);
    }
  };
  const addHook = (hook: HookSpec) => {
    const testStepId = next('ts');
    testSteps.push({ id: testStepId, hookId: next('hook') });
    stepResults[testStepId] = {
      status: hook.status,
      ...(hook.message === undefined ? {} : { message: hook.message }),
      duration: duration(hook.ms ?? 0),
    };
    if (hook.attachments !== undefined) {
      stepAttachments[testStepId] = hook.attachments.map(attachmentOf);
    }
  };

  const hooks = spec.hooks ?? [];
  hooks.filter((hook) => hook.phase === 'before').forEach(addHook);
  for (const { step, gherkin } of backgroundSteps) addStep(step, gherkin.id);
  for (const { step, gherkin } of ownSteps) addStep(step, gherkin.id);
  hooks.filter((hook) => hook.phase === 'after').forEach(addHook);

  return {
    attempt: 0,
    willBeRetried: false,
    gherkinDocument: { uri, feature },
    pickle: {
      id: next('pk'),
      uri,
      name: spec.examples?.pickleName ?? scenarioName,
      steps: pickleSteps,
      astNodeIds: row === undefined ? [scenarioId] : [scenarioId, row.id],
    },
    testCase: { testSteps },
    stepResults,
    stepAttachments,
  };
}

describe('toAttempt: identity and the key fields', () => {
  it('keys a scenario by its file, Feature and scenario names, and never by its Rule', () => {
    const { input, problems } = toAttempt(
      attemptOf({
        feature: 'Checkout',
        rule: 'Refunds',
        scenario: 'Refund a paid order',
        uri: `${CWD}/features/checkout/pay.feature`,
        steps: [{ text: 'a paid order' }],
      }),
      context,
    );
    expect(problems).toEqual([]);
    expect(input?.identity).toEqual({
      file: 'features/checkout/pay.feature',
      titlePath: ['Checkout', 'Refund a paid order'],
    });
    expect(input?.title).toBe('Refund a paid order');
    expect(input?.suitePath).toEqual(['features', 'checkout', 'Checkout', 'Refunds']);
  });

  it('keys an outline row by the written scenario name, with its Examples values as parameters', () => {
    const { input } = toAttempt(
      attemptOf({
        scenario: 'Pay with <method>',
        examples: {
          header: ['method', 'amount'],
          cells: ['visa', '12'],
          pickleName: 'Pay with visa',
        },
        steps: [{ text: 'the customer pays with visa 12' }],
      }),
      context,
    );
    expect(input?.identity).toEqual({
      file: 'features/checkout/pay.feature',
      titlePath: ['Checkout', 'Pay with <method>'],
    });
    expect(input?.title).toBe('Pay with <method>');
    expect(input?.parameters).toEqual({ method: 'visa', amount: '12' });
  });

  it('roots the file at the working directory, or at the root directory when it is set above it', () => {
    const { input } = toAttempt(
      attemptOf({ uri: 'features/cart.feature', scenario: 'Add', steps: [{ text: 'a book' }] }),
      { cwd: '/work/shop', rootDir: '/work' },
    );
    expect(input?.identity.file).toBe('shop/features/cart.feature');
  });

  it('skips a feature outside the root directory, with a problem, and sends nothing for it', () => {
    const { input, problems } = toAttempt(
      attemptOf({ uri: '../elsewhere/x.feature', scenario: 'Add', steps: [{ text: 'a book' }] }),
      context,
    );
    expect(input).toBeUndefined();
    expect(problems).toEqual([
      'skipped the feature "Checkout": its uri is not a file under the root directory',
    ]);
  });

  it('skips a scenario without a name, with a problem that names its file', () => {
    const { input, problems } = toAttempt(attemptOf({ scenario: '', steps: [] }), context);
    expect(input).toBeUndefined();
    expect(problems).toEqual(['features/checkout/pay.feature: skipped a scenario without a name']);
  });
});

describe('toAttempt: steps and their data', () => {
  it('sends each step with its keyword trimmed, its text and its duration in milliseconds', () => {
    const { input } = toAttempt(
      attemptOf({
        steps: [
          { keyword: 'Given ', text: 'a paid order', ms: 2 },
          { keyword: 'When ', text: 'the customer asks for a refund', ms: 3 },
        ],
      }),
      context,
    );
    expect(input?.steps).toEqual([
      { action: 'a paid order', keyword: 'Given', status: 'passed', durationMs: 2 },
      {
        action: 'the customer asks for a refund',
        keyword: 'When',
        status: 'passed',
        durationMs: 3,
      },
    ]);
    expect(input?.durationMs).toBe(5);
  });

  it('nests the Background steps under one Background step, with its rollup status and summed duration', () => {
    const { input } = toAttempt(
      attemptOf({
        background: [
          { keyword: 'Given ', text: 'a cart with a book', ms: 1 },
          { keyword: 'And ', text: 'the cart is open', ms: 4 },
        ],
        steps: [{ keyword: 'When ', text: 'the customer pays', ms: 2 }],
      }),
      context,
    );
    expect(input?.steps).toEqual([
      {
        action: 'Background',
        status: 'passed',
        durationMs: 5,
        steps: [
          { action: 'a cart with a book', keyword: 'Given', status: 'passed', durationMs: 1 },
          { action: 'the cart is open', keyword: 'And', status: 'passed', durationMs: 4 },
        ],
      },
      { action: 'the customer pays', keyword: 'When', status: 'passed', durationMs: 2 },
    ]);
  });

  it('sends a Doc String, or a Data Table as lines of pipes, as the data of its step', () => {
    const { input } = toAttempt(
      attemptOf({
        steps: [
          {
            keyword: 'When ',
            text: 'the customer sends the receipt:',
            docString: 'Thank you.',
          },
          {
            keyword: 'Then ',
            text: 'the receipt table is:',
            table: [
              ['item', 'price'],
              ['book', '12'],
            ],
          },
        ],
      }),
      context,
    );
    expect(input?.steps?.map((step) => step.data)).toEqual([
      'Thank you.',
      '| item | price |\n| book | 12 |',
    ]);
  });

  it('fails a scenario on its failed step, keeps the message as its error, and skips the steps after it', () => {
    const { input } = toAttempt(
      attemptOf({
        steps: [
          {
            text: 'the customer pays with a declined card',
            status: 'FAILED',
            message: 'The card was declined',
          },
          { text: 'the order is confirmed', status: 'SKIPPED' },
        ],
      }),
      context,
    );
    expect(input?.status).toBe('failed');
    expect(input?.error).toEqual(['The card was declined']);
    expect(input?.steps?.map((step) => [step.action, step.status])).toEqual([
      ['the customer pays with a declined card', 'failed'],
      ['the order is confirmed', 'skipped'],
    ]);
    expect(input?.steps?.[0]?.error).toBe('The card was declined');
  });

  it('maps undefined and pending steps to skipped, and an ambiguous step to failed with a reason', () => {
    const { input } = toAttempt(
      attemptOf({
        steps: [
          { text: 'a page with no step definition', status: 'UNDEFINED' },
          { text: 'a step that is still pending', status: 'PENDING' },
          { text: 'a step that matches two definitions', status: 'AMBIGUOUS' },
        ],
      }),
      context,
    );
    expect(input?.steps?.map((step) => step.status)).toEqual(['skipped', 'skipped', 'failed']);
    expect(input?.steps?.[2]?.error).toBe(
      'Ambiguous step: more than one step definition matches it',
    );
  });

  it('is skipped when a step did not run, and passed when every step passed', () => {
    const notRun = attemptOf({
      steps: [
        { text: 'a', status: 'PASSED' },
        { text: 'b', status: 'UNDEFINED' },
      ],
    });
    expect(toAttempt(notRun, context).input?.status).toBe('skipped');
    expect(toAttempt(attemptOf({ steps: [{ text: 'a' }] }), context).input?.status).toBe('passed');
  });
});

describe('toAttempt: hooks, errors and time', () => {
  it('leaves the hook steps out, and fails the scenario on a failed hook with its message', () => {
    const { input } = toAttempt(
      attemptOf({
        hooks: [{ phase: 'after', status: 'FAILED', message: 'cleanup broke' }],
        steps: [{ text: 'a book' }],
      }),
      context,
    );
    expect(input?.status).toBe('failed');
    expect(input?.error).toEqual(['cleanup broke']);
    expect(input?.steps?.map((step) => step.action)).toEqual(['a book']);
  });

  it('uses "The hook failed" when a failed hook has no message', () => {
    const { input } = toAttempt(
      attemptOf({
        hooks: [{ phase: 'before', status: 'FAILED' }],
        steps: [{ text: 'a book' }],
      }),
      context,
    );
    expect(input?.error).toEqual(['The hook failed']);
  });

  it('sends the start time, and the duration of the scenario with its hooks, in milliseconds', () => {
    const startedAt = new Date('2026-11-01T10:00:00.000Z');
    const { input } = toAttempt(
      attemptOf({
        hooks: [{ phase: 'before', status: 'PASSED', ms: 3 }],
        steps: [{ text: 'a book', ms: 1 }],
      }),
      { ...context, startedAt },
    );
    expect(input?.startedAt).toBe(startedAt);
    expect(input?.durationMs).toBe(4);
  });
});

describe('toAttempt: attachments and case links', () => {
  it('uploads a step attachment on its step: text as a file, and a log as a text file', () => {
    const { input } = toAttempt(
      attemptOf({
        steps: [
          {
            text: 'the page is shown',
            attachments: [
              { mediaType: 'text/plain', body: 'hello' },
              { mediaType: 'text/x.cucumber.log+plain', body: 'Logged text' },
            ],
          },
        ],
      }),
      context,
    );
    expect(input?.steps?.[0]?.attachments).toEqual([
      { name: 'attachment', contentType: 'text/plain', body: 'hello' },
      { name: 'log', contentType: 'text/plain', body: 'Logged text' },
    ]);
  });

  it('decodes a base64 attachment into its bytes, and names it after its file name', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { input } = toAttempt(
      attemptOf({
        steps: [
          {
            text: 'the page is shown',
            attachments: [
              {
                mediaType: 'image/png',
                body: png.toString('base64'),
                contentEncoding: 'BASE64',
                fileName: 'screen.png',
              },
            ],
          },
        ],
      }),
      context,
    );
    expect(input?.steps?.[0]?.attachments).toEqual([
      { name: 'screen.png', contentType: 'image/png', body: png },
    ]);
  });

  it('uploads the attachments of a hook on the result, not on a step', () => {
    const { input } = toAttempt(
      attemptOf({
        hooks: [
          {
            phase: 'after',
            status: 'PASSED',
            attachments: [{ mediaType: 'text/plain', body: 'cleanup' }],
          },
        ],
        steps: [{ text: 'a book' }],
      }),
      context,
    );
    expect(input?.attachments).toEqual([
      { name: 'attachment', contentType: 'text/plain', body: 'cleanup' },
    ]);
    expect(input?.steps?.[0]?.attachments).toBeUndefined();
  });

  it('links the scenario to the case of its @probara tag, and ignores the other tags', () => {
    const { input, problems } = toAttempt(
      attemptOf({ scenarioTags: ['@smoke', '@probara:SHOP-12'], steps: [{ text: 'a book' }] }),
      context,
    );
    expect(problems).toEqual([]);
    expect(input?.caseDisplayId).toBe('SHOP-12');
  });

  it('links to every case of several @probara tags, and warns about a tag that is no case id', () => {
    const { input, problems } = toAttempt(
      attemptOf({
        scenarioTags: ['@probara:SHOP-12', '@probara:shop-3', '@probara:SHOP-4'],
        steps: [{ text: 'a book' }],
      }),
      context,
    );
    expect(input?.caseDisplayIds).toEqual(['SHOP-12', 'SHOP-4']);
    expect(problems).toEqual([
      'ignored the @probara tag "@probara:shop-3": it is not a case display ID such as SHOP-12',
    ]);
  });

  it('links nothing when the scenario has no @probara tag', () => {
    const { input } = toAttempt(attemptOf({ steps: [{ text: 'a book' }] }), context);
    expect(input?.caseDisplayId).toBeUndefined();
    expect(input?.caseDisplayIds).toBeUndefined();
  });
});
