import { createHash } from 'node:crypto';
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

  it('groups the reports of one GitHub Actions run attempt into one run, until a report closes it', async () => {
    const source = { provider: 'github_actions', repository: 'acme/shop', ciRunId: '9' };
    const shard = (key: string, attempt?: number) => ({
      run: {
        name: 'CI #4',
        source: attempt === undefined ? source : { ...source, ciRunAttempt: attempt },
      },
      results: [{ ...pays, automationKey: key }],
    });
    const first = await post('/api/v1/projects/PRB/reports', shard('a'));
    const second = await post('/api/v1/projects/PRB/reports', shard('b', 1));
    const retry = await post('/api/v1/projects/PRB/reports', shard('c', 2));

    const runOf = (reply: { body: Record<string, unknown> }) =>
      (reply.body.run as { ulid: string }).ulid;
    expect(runOf(second)).toBe(runOf(first));
    expect(runOf(retry)).not.toBe(runOf(first));
    expect(fake.run(runOf(first))?.results).toHaveLength(2);

    const close = await post('/api/v1/projects/PRB/reports', {
      run: { name: 'CI #4', source },
      results: [],
      options: { close: true },
    });
    expect(close.status).toBe(201);
    expect(close.body.run).toMatchObject({ ulid: runOf(first), state: 'closed' });

    const late = await post('/api/v1/projects/PRB/reports', shard('d'));
    expect(late.status).toBe(409);
    expect(late.body).toEqual({
      error: {
        code: 'ci_run_closed',
        message: 'The run of this CI run is closed',
        details: { runUlid: runOf(first) },
      },
    });
  });

  it('refuses a report without results unless it closes its run', async () => {
    const empty = await post('/api/v1/projects/PRB/reports', { run: { name: 'N' }, results: [] });
    expect(empty.status).toBe(422);
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

    const listed = cases.map((entry) => ({ ...entry, parameters: [] }));
    expect(pages).toEqual([listed.slice(0, 2), listed.slice(2, 4), listed.slice(4)]);
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

  it('answers each case key with its parameters by name and value, an empty list without them', async () => {
    const run = fake.seedRun({
      cases: [
        { caseDisplayId: 'PRB-1', automationKey: 'k1', parameters: { browser: 'chromium' } },
        { caseDisplayId: 'PRB-2', automationKey: null },
      ],
    });

    const response = await fetch(`${fake.baseUrl}/api/v1/runs/${run}/case-keys`, {
      headers: { authorization: 'Bearer x' },
    });

    expect(await response.json()).toEqual({
      items: [
        {
          caseDisplayId: 'PRB-1',
          automationKey: 'k1',
          parameters: [{ name: 'browser', value: 'chromium' }],
        },
        { caseDisplayId: 'PRB-2', automationKey: null, parameters: [] },
      ],
      nextCursor: null,
    });
  });
});

describe('the Snap routes of the fake Probara', () => {
  const COMMIT = 'a'.repeat(40);
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  const SHA = createHash('sha256').update(PNG).digest('hex');
  const BUILDS = '/api/v1/projects/PRB/snap/builds';

  async function put(path: string, body: Buffer, contentType = 'image/png') {
    const response = await fetch(`${fake.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: new Uint8Array(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function created(extra: Record<string, unknown> = {}) {
    const answer = await post(BUILDS, {
      commit: COMMIT,
      branch: 'feat/cart',
      files: [{ sha256: SHA }],
      ...extra,
    });
    const build = answer.body['build'] as { ulid: string; number: number; url: string };
    return { ...answer, build, shardUlid: answer.body['shardUlid'] as string };
  }

  it('creates a build, names the digests it does not hold, stores a PNG and finalizes the shard', async () => {
    const { status, body, build, shardUlid } = await created();

    expect(status).toBe(201);
    expect(body['missingFiles']).toEqual([SHA]);
    expect(build).toMatchObject({
      number: 1,
      name: 'default',
      commit: COMMIT,
      branch: 'feat/cart',
      jobStatus: 'pending',
      url: `${fake.baseUrl}/projects/PRB/snap/${build.ulid}`,
    });

    const stored = await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG);
    expect(stored).toEqual({ status: 200, body: { sha256: SHA, stored: true } });
    expect((await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG)).body).toEqual({
      sha256: SHA,
      stored: false,
    });
    expect(fake.snapFiles()).toEqual([SHA]);

    const screenshots = [{ name: 'home', sha256: SHA, browser: 'chromium' }];
    const finalize = `${BUILDS}/${build.ulid}/shards/${shardUlid}:finalize`;
    const finalized = await post(finalize, { screenshots });
    expect(finalized.status).toBe(200);
    expect(finalized.body).toMatchObject({ jobStatus: 'progress', screenshotCount: 1 });
    expect((await post(finalize, { screenshots })).status).toBe(200);
    expect((await post(finalize, { screenshots: [{ name: 'other', sha256: SHA }] })).status).toBe(
      409,
    );
    expect(fake.snapBuilds()).toMatchObject([
      { number: 1, projectId: 'PRB', jobStatus: 'progress', screenshots },
    ]);

    const read = await fetch(`${fake.baseUrl}${BUILDS}/${build.ulid}`);
    expect(await read.json()).toMatchObject({ ulid: build.ulid, shardsFinalized: 1 });
  });

  it('reads the width and the height of an uploaded PNG from its header, as Probara does', async () => {
    const { build } = await created();

    await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG);

    expect(fake.requestsTo('snapUploadFile').map((request) => request.body)).toMatchObject([
      { type: 'image/png', sha256: SHA, width: 1, height: 1 },
    ]);
  });

  it('refuses a body that is not the PNG its path names', async () => {
    const { build } = await created();
    const path = `${BUILDS}/${build.ulid}/files/${SHA}`;

    expect((await put(path, PNG, 'image/jpeg')).body).toMatchObject({
      error: { code: 'validation_failed', details: { reason: 'content_type_not_png' } },
    });
    expect((await put(path, Buffer.from('not a png'))).body).toMatchObject({
      error: { details: { reason: 'content_signature_mismatch' } },
    });
    const other = Buffer.concat([PNG, Buffer.from([0])]);
    expect(await put(path, other)).toMatchObject({
      status: 422,
      body: { error: { details: { reason: 'sha256_mismatch' } } },
    });
    expect(fake.snapFiles()).toEqual([]);
  });

  it('refuses to finalize a shard whose files it does not hold, naming them', async () => {
    const { build, shardUlid } = await created();
    const finalize = `${BUILDS}/${build.ulid}/shards/${shardUlid}:finalize`;
    const body = { screenshots: [{ name: 'home', sha256: SHA }] };

    expect(await post(finalize, body)).toMatchObject({
      status: 409,
      body: { error: { code: 'conflict', details: { missingFiles: [SHA] } } },
    });

    await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG);
    fake.forgetSnapFile(SHA);
    expect((await post(finalize, body)).status).toBe(409);
  });

  it('joins the shards of one nonce into one build, finalized by its last shard', async () => {
    const shard = (index: number) =>
      created({ ciNonce: '9876-1', shard: { index, total: 2 }, name: 'e2e' });
    const first = await shard(0);
    const again = await shard(0);
    const second = await shard(1);

    expect(again.shardUlid).toBe(first.shardUlid);
    expect(second.build.ulid).toBe(first.build.ulid);
    expect(second.shardUlid).not.toBe(first.shardUlid);
    expect((await created({ shard: { index: 0, total: 2 } })).status).toBe(422);
    expect(
      (await created({ ciNonce: '9876-1', shard: { index: 0, total: 3 }, name: 'e2e' })).status,
    ).toBe(409);

    await put(`${BUILDS}/${first.build.ulid}/files/${SHA}`, PNG);
    const finalize = (shardUlid: string, name: string) =>
      post(`${BUILDS}/${first.build.ulid}/shards/${shardUlid}:finalize`, {
        screenshots: [{ name, sha256: SHA }],
      });
    expect((await finalize(first.shardUlid, 'home')).body).toMatchObject({
      jobStatus: 'pending',
      shardsFinalized: 1,
    });
    expect((await finalize(second.shardUlid, 'home')).status).toBe(422);
    expect((await finalize(second.shardUlid, 'cart')).body).toMatchObject({
      jobStatus: 'progress',
      shardsFinalized: 2,
      screenshotCount: 2,
    });
  });

  it('finalizes a nonce build without a shard total only when asked', async () => {
    const { build, shardUlid } = await created({ ciNonce: 'pipeline-7' });
    const whole = `${BUILDS}/${build.ulid}:finalize`;

    expect((await post(whole, {})).status).toBe(409);
    await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG);
    const shard = await post(`${BUILDS}/${build.ulid}/shards/${shardUlid}:finalize`, {
      screenshots: [{ name: 'home', sha256: SHA }],
    });
    expect(shard.body).toMatchObject({ jobStatus: 'pending' });
    expect((await post(whole, {})).body).toMatchObject({ jobStatus: 'progress' });

    const plain = await created();
    expect((await post(`${BUILDS}/${plain.build.ulid}:finalize`, {})).status).toBe(422);
  });

  it('finalizes a build whose only finalized shard holds no screenshot', async () => {
    const { build, shardUlid } = await created({ ciNonce: 'pipeline-8', files: [] });
    await post(`${BUILDS}/${build.ulid}/shards/${shardUlid}:finalize`, { screenshots: [] });

    const whole = await post(`${BUILDS}/${build.ulid}:finalize`, {});

    expect(whole.status).toBe(200);
    expect(whole.body).toMatchObject({ jobStatus: 'progress', screenshotCount: 0 });
  });

  it('finalizes the build of a name and a nonce, once a shard of it is finalized', async () => {
    const byNonce = `${BUILDS}:finalize`;
    const unknown = await post(byNonce, { ciNonce: 'pipeline-9' });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({
      error: { code: 'not_found', message: 'no snap build has this name and CI nonce' },
    });

    const first = await created({ ciNonce: 'pipeline-9', files: [] });
    const second = await created({ ciNonce: 'pipeline-9', files: [] });
    expect(second.build.ulid).toBe(first.build.ulid);
    expect(second.shardUlid).not.toBe(first.shardUlid);
    const early = await post(byNonce, { ciNonce: 'pipeline-9' });
    expect(early.status).toBe(409);
    expect(early.body).toEqual({
      error: {
        code: 'conflict',
        message: 'finalize at least one shard before finalizing the build',
      },
    });

    await post(`${BUILDS}/${first.build.ulid}/shards/${first.shardUlid}:finalize`, {
      screenshots: [],
    });
    expect((await post(byNonce, { ciNonce: 'pipeline-9', name: 'mobile' })).status).toBe(404);
    const finalized = await post(byNonce, { ciNonce: ' pipeline-9 ', name: 'default' });
    expect(finalized.status).toBe(200);
    expect(finalized.body).toMatchObject({ ulid: first.build.ulid, jobStatus: 'progress' });
    const again = await post(byNonce, { ciNonce: 'pipeline-9' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(finalized.body);
    expect(fake.requestsTo('snapFinalizeBuildByNonce')).toHaveLength(5);
  });

  it('refuses to finalize by nonce a build with a shard total, or without a nonce to look for', async () => {
    const byNonce = `${BUILDS}:finalize`;
    await created({ ciNonce: 'pipeline-10', shard: { index: 0, total: 2 } });

    const sharded = await post(byNonce, { ciNonce: 'pipeline-10' });
    expect(sharded.status).toBe(422);
    expect(sharded.body).toMatchObject({
      error: {
        code: 'validation_failed',
        message: 'this build is finalized when its shards are finalized',
      },
    });
    expect((await post(byNonce, {})).status).toBe(422);
    expect((await post(byNonce, { ciNonce: '  ' })).status).toBe(422);
    expect((await post(byNonce, { ciNonce: 'pipeline-10', name: 'not a name' })).status).toBe(422);
  });

  it('refuses a shard beyond the screenshot allowance and fails its build', async () => {
    await fake.close();
    fake = await startFakeProbara({ snapScreenshotAllowance: 1 });
    const { build, shardUlid } = await created();
    await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG);

    const refused = await post(`${BUILDS}/${build.ulid}/shards/${shardUlid}:finalize`, {
      screenshots: [
        { name: 'home', sha256: SHA },
        { name: 'cart', sha256: SHA },
      ],
    });

    expect(refused).toMatchObject({
      status: 409,
      body: { error: { code: 'snap_screenshot_limit_reached' } },
    });
    expect(fake.snapBuilds()).toMatchObject([
      { jobStatus: 'error', errorCode: 'screenshot_limit_reached', screenshots: [] },
    ]);
  });

  it('holds one screenshot per test, name, browser, viewport and color mode', async () => {
    const { build, shardUlid } = await created();
    await put(`${BUILDS}/${build.ulid}/files/${SHA}`, PNG);
    const finalize = (screenshots: unknown[]) =>
      post(`${BUILDS}/${build.ulid}/shards/${shardUlid}:finalize`, { screenshots });
    const taken = (automationKey: string) => ({
      name: 'home',
      sha256: SHA,
      test: { automationKey, titlePath: [automationKey], retry: 0 },
    });

    expect(await finalize([taken('a'), taken('a')])).toMatchObject({
      status: 422,
      body: { error: { code: 'validation_failed' } },
    });
    expect(await finalize([taken('a'), taken('b')])).toMatchObject({
      status: 200,
      body: { screenshotCount: 2 },
    });
  });

  it('finalizes a shard without screenshots, which counts toward the shard total', async () => {
    const first = await created({ ciNonce: 'run-42', shard: { index: 0, total: 2 } });
    const second = await created({ ciNonce: 'run-42', shard: { index: 1, total: 2 }, files: [] });
    await put(`${BUILDS}/${first.build.ulid}/files/${SHA}`, PNG);

    const empty = await post(`${BUILDS}/${second.build.ulid}/shards/${second.shardUlid}:finalize`, {
      screenshots: [],
    });
    expect(empty).toMatchObject({ status: 200, body: { jobStatus: 'pending' } });

    const last = await post(`${BUILDS}/${first.build.ulid}/shards/${first.shardUlid}:finalize`, {
      screenshots: [{ name: 'home', sha256: SHA }],
    });
    expect(last).toMatchObject({
      status: 200,
      body: { jobStatus: 'progress', screenshotCount: 1 },
    });
    expect(fake.snapBuilds()).toHaveLength(1);
  });

  it('records the parentCommits of a build, and refuses more than 300 or one that is not a full SHA', async () => {
    const parents = ['b'.repeat(40), 'c'.repeat(40)];
    const answer = await created({
      parentCommits: parents,
      ciNonce: 'run-1',
      shard: { index: 0, total: 2 },
    });
    expect(answer.status).toBe(201);
    const joined = await created({ ciNonce: 'run-1', shard: { index: 1, total: 2 } });
    expect(joined.status).toBe(201);
    expect(fake.snapBuilds()).toMatchObject([{ parentCommits: parents }]);
    expect((await created()).status).toBe(201);
    expect(fake.snapBuilds()[1]).toMatchObject({ parentCommits: null });

    const tooMany = await created({
      parentCommits: Array.from({ length: 301 }, () => 'd'.repeat(40)),
    });
    expect(tooMany).toMatchObject({ status: 422, body: { error: { code: 'validation_failed' } } });
    for (const sha of ['D'.repeat(40), 'd'.repeat(39), 7]) {
      expect((await created({ parentCommits: [sha] })).status).toBe(422);
    }
    expect((await created({ parentCommits: 'd'.repeat(40) })).status).toBe(422);
    expect(fake.snapBuilds()).toHaveLength(2);
  });

  it('answers a scripted failure of a Snap route', async () => {
    fake.fail('snapCreateBuild', { status: 503 }, { times: 1 });

    expect((await created()).status).toBe(503);
    expect((await created()).status).toBe(201);
    expect(fake.requestsTo('snapCreateBuild')).toHaveLength(2);
  });
});
