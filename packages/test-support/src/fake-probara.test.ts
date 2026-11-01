import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeProbara, type FakeProbara } from './fake-probara.js';

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ customFields: ['Browser'] });
});

afterEach(async () => {
  await fake.close();
});

async function post(path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${fake.baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const pays = {
  automationKey: 'cart.spec.ts > pays',
  title: 'pays',
  status: 'passed',
  steps: [{ action: 'Pay', status: 'passed' }],
  case: { fields: { priority: 'high', browser: 'chromium', Sevrity: 'x' } },
};

describe('the fake Probara', () => {
  it('refuses a report the server refuses, naming the field, and records nothing', async () => {
    const refused = await post('/api/v1/projects/PRB/reports', {
      run: { name: 'Nightly' },
      results: [{ ...pays, parameters: { a: '1', ' a ': '2' } }],
    });

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'results[0].parameters. a : repeats another name once trimmed',
      },
    });
    expect(fake.runs()).toEqual([]);
  });

  it('applies the case of the entry that creates it, and warns about the fields it cannot resolve', async () => {
    const report = { run: { name: 'Nightly', environment: 'staging' }, results: [pays, pays] };
    const created = await post('/api/v1/projects/PRB/reports', report);

    expect(created.status).toBe(201);
    expect(created.body.warnings).toEqual(['Unknown field "Sevrity" was skipped']);
    expect(fake.createdCases()).toEqual([
      { projectId: 'PRB', automationKey: 'cart.spec.ts > pays', title: 'pays', case: pays.case },
    ]);
    expect(fake.runs()[0]?.created).toEqual(report.run);
  });

  it('commits a file to a reported step, and refuses a stepIndex that names none', async () => {
    const { body } = await post('/api/v1/projects/PRB/reports', {
      run: { name: 'Nightly' },
      results: [pays],
    });
    const run = body.run as { ulid: string };
    const [result] = body.results as { resultUlid: string }[];
    const path = `/api/v1/runs/${run.ulid}/results/${result?.resultUlid ?? ''}/attachments`;
    const item = { ulid: '01J9Z3K4M5N6P7Q8R9S0T1V2W3', position: 0, stepIndex: 0 };

    expect((await post(path, { attachments: [item] }, 'PATCH')).status).toBe(200);
    expect((await post(path, { attachments: [{ ...item, stepIndex: 1 }] }, 'PATCH')).body).toEqual({
      error: { code: 'validation_failed', message: 'stepIndex 1 is not a step of this result' },
    });
  });

  it('assigns the failed results of a report to its members in turn, and counts the emails that match none', async () => {
    await fake.close();
    fake = await startFakeProbara({ members: ['ana@example.com', 'bo@example.com'] });
    const failed = (key: string) => ({ automationKey: key, title: key, status: 'failed' });
    const { body } = await post('/api/v1/projects/PRB/reports', {
      run: { name: 'Nightly' },
      results: [failed('a'), { ...failed('b'), status: 'passed' }, failed('c'), failed('d')],
      options: { assignFailedTo: ['Ana@example.com', 'nobody@example.com', 'bo@example.com'] },
    });

    expect(body.warnings).toEqual([
      'assignFailedTo: 1 of 3 emails did not match a member who can be assigned in this project',
    ]);
    const run = (body.run as { ulid: string }).ulid;
    expect(fake.assignments()).toEqual([
      { runUlid: run, automationKey: 'a', email: 'ana@example.com' },
      { runUlid: run, automationKey: 'c', email: 'bo@example.com' },
      { runUlid: run, automationKey: 'd', email: 'ana@example.com' },
    ]);
    expect(fake.reports()[0]?.options?.assignFailedTo).toEqual([
      'Ana@example.com',
      'nobody@example.com',
      'bo@example.com',
    ]);
  });

  it('answers a Gherkin sync with the outcome of each scenario, and records every request', async () => {
    const path = '/api/v1/projects/PRB/gherkin-sync';
    const scenario = {
      automationKey: 'features/pay.feature > Checkout > Pay',
      name: 'Pay',
      line: 3,
      tags: [],
      steps: [{ keyword: 'Given', text: 'a cart' }],
    };
    const sync = (steps: unknown[]) => ({
      scope: ['features/**/*.feature'],
      features: [
        {
          path: 'features/pay.feature',
          name: 'Checkout',
          tags: [],
          scenarios: [{ ...scenario, steps }],
        },
      ],
    });
    const summary = (counts: Partial<Record<string, number>>) => ({
      created: 0,
      updated: 0,
      moved: 0,
      restored: 0,
      archived: 0,
      unchanged: 0,
      ...counts,
    });

    const first = await post(path, sync(scenario.steps));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      dryRun: false,
      summary: summary({ created: 1 }),
      cases: [
        {
          action: 'created',
          automationKey: scenario.automationKey,
          previousAutomationKey: null,
          caseDisplayId: 'PRB-1',
          path: 'features/pay.feature',
          line: 3,
        },
      ],
    });
    const again = await post(path, sync(scenario.steps));
    expect(again.body).toMatchObject({ summary: summary({ unchanged: 1 }) });
    const edited = await post(path, sync([{ keyword: 'Given', text: 'a cart with a book' }]));
    expect(edited.body).toMatchObject({ summary: summary({ updated: 1 }) });

    expect(fake.gherkinSyncs()).toEqual([
      sync(scenario.steps),
      sync(scenario.steps),
      sync([{ keyword: 'Given', text: 'a cart with a book' }]),
    ]);
    expect(fake.requestsTo('gherkinSync')).toHaveLength(3);
  });

  it('answers a dry run with the outcome and writes nothing', async () => {
    const path = '/api/v1/projects/PRB/gherkin-sync';
    const body = {
      scope: ['features/**/*.feature'],
      features: [
        {
          path: 'features/pay.feature',
          name: 'Checkout',
          tags: [],
          scenarios: [
            {
              automationKey: 'features/pay.feature > Checkout > Pay',
              name: 'Pay',
              line: 3,
              tags: [],
              steps: [{ keyword: 'Given', text: 'a cart' }],
            },
          ],
        },
      ],
    };

    const dry = await post(path, { ...body, dryRun: true });
    expect(dry.body).toMatchObject({
      dryRun: true,
      summary: { created: 1 },
      cases: [{ action: 'created', caseUlid: null, caseDisplayId: null, line: 3 }],
    });
    const real = await post(path, body);
    expect(real.body).toMatchObject({ dryRun: false, summary: { created: 1 } });
  });

  it('refuses a sync whose two scenarios share an automation key, with nothing written', async () => {
    const path = '/api/v1/projects/PRB/gherkin-sync';
    const scenario = {
      automationKey: 'features/pay.feature > Checkout > Pay',
      name: 'Pay',
      line: 3,
      tags: [],
      steps: [{ keyword: 'Given', text: 'a cart' }],
    };
    const body = {
      scope: ['features/**/*.feature'],
      features: [
        {
          path: 'features/pay.feature',
          name: 'Checkout',
          tags: [],
          scenarios: [scenario, scenario],
        },
      ],
    };

    const refused = await post(path, body);
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'two scenarios share the automation key "features/pay.feature > Checkout > Pay"',
      },
    });
    expect(fake.gherkinSyncs()).toHaveLength(1);
    const { features } = body;
    const once = { ...body, features: [{ ...features[0], scenarios: [scenario] }] };
    expect(await post(path, once)).toMatchObject({
      status: 200,
      body: { summary: { created: 1 } },
    });
  });

  it('serves the cases of a seeded run a page at a time, following the cursor', async () => {
    const cases = Array.from({ length: 5 }, (_, index) => ({
      caseDisplayId: `PRB-${index + 1}`,
      automationKey: index === 2 ? null : `cart.test.ts > test ${index + 1}`,
    }));
    const run = fake.seedRun({ cases });
    const pages: unknown[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? 'limit=2' : `limit=2&cursor=${cursor}`;
      const response = await fetch(`${fake.baseUrl}/api/v1/runs/${run}/case-keys?${query}`, {
        headers: { authorization: 'Bearer any' },
      });
      const page = (await response.json()) as { items: unknown[]; nextCursor: string | null };
      pages.push(page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pages).toEqual([cases.slice(0, 2), cases.slice(2, 4), cases.slice(4)]);
    expect(fake.requestsTo('caseKeys')).toHaveLength(3);
  });

  it('knows the cases of a seeded run by their keys: a report matching one creates no case', async () => {
    const run = fake.seedRun({
      cases: [
        { caseDisplayId: 'PRB-3', automationKey: 'cart.spec.ts > pays' },
        { caseDisplayId: 'PRB-4', automationKey: null },
      ],
    });
    const reported = await post('/api/v1/projects/PRB/reports', {
      run: { ulid: run },
      results: [pays, { ...pays, automationKey: 'cart.spec.ts > refunds', title: 'refunds' }],
    });

    expect(reported.body.summary).toEqual({ recorded: 2, created: 1, unmatched: 0 });
    expect(fake.createdCases().map((created) => created.automationKey)).toEqual([
      'cart.spec.ts > refunds',
    ]);
  });

  it('answers the case keys of 50 cases by default, and refuses what the server refuses', async () => {
    const cases = Array.from({ length: 51 }, (_, index) => ({
      caseDisplayId: `PRB-${index + 1}`,
      automationKey: `k${index}`,
    }));
    const run = fake.seedRun({ cases });
    const get = async (
      path: string,
      headers: Record<string, string> = { authorization: 'Bearer x' },
    ) => {
      const response = await fetch(`${fake.baseUrl}${path}`, { headers });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };

    const first = await get(`/api/v1/runs/${run}/case-keys`);
    expect((first.body.items as unknown[]).length).toBe(50);
    expect(first.body.nextCursor).toEqual(expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/));
    expect((await get(`/api/v1/runs/${run}/case-keys`, {})).status).toBe(401);
    expect((await get('/api/v1/runs/01KRN00000000000000000000Z/case-keys')).status).toBe(404);
    expect((await get(`/api/v1/runs/${run}/case-keys?limit=201`)).status).toBe(422);
    expect((await get(`/api/v1/runs/${run}/case-keys?cursor=nope`)).status).toBe(422);
    expect((await get(`/api/v1/runs/${fake.seedRun()}/case-keys`)).body).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
