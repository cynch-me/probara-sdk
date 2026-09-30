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
});
