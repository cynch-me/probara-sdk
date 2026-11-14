import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeVisApi, type FakeVisApi } from './support/fake-vis.js';
import { runCli, TOKEN, type CliRun } from './support/run-cli.js';

const BASE_URL = 'https://probara.test';
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_BASE_URL: BASE_URL };
const NOW = new Date('2026-09-29T12:00:00.000Z');
const LINKS = /^\/api\/v1\/vis-recording-links/;

let api: FakeVisApi;

beforeEach(() => {
  api = createFakeVisApi({ token: TOKEN });
});

async function probara(
  args: readonly string[],
  options: {
    env?: Record<string, string | undefined>;
    prompt?: (q: string) => Promise<string>;
  } = {},
): Promise<CliRun> {
  const run = await runCli(['vis', 'recording-links', ...args], {
    env: options.env ?? ENV,
    fetch: api.fetch,
    now: () => NOW,
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
  });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

/** The requests sent to the recording-link endpoints. */
function linkRequests() {
  return api.requests().filter((request) => LINKS.test(request.path));
}

describe('probara vis recording-links list', () => {
  it('prints one line per link, newest first, and the page on stderr', async () => {
    const older = api.seedLink({ title: 'Support recordings', submissionCount: 3 });
    const newer = api.seedLink({ title: 'Beta testers', mode: 'one_time' });

    const run = await probara(['list']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        `${newer.ulid}  active  one_time  0 received  Beta testers`,
        `${older.ulid}  active  reusable  3 received  Support recordings`,
        '',
      ].join('\n'),
    );
    expect(run.stderr).toContain('[probara] Page 1 of 1: 2 recording links');
  });

  it('sends --state and the page to Probara, and prints the page as JSON', async () => {
    api.seedLink({ status: 'revoked', url: null });

    const run = await probara([
      'list',
      '--state',
      'revoked',
      '--page',
      '1',
      '--page-size',
      '5',
      '--json',
    ]);

    expect(run.exitCode).toBe(0);
    const [request] = linkRequests();
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      status: 'revoked',
      page: '1',
      pageSize: '5',
    });
    expect(JSON.parse(run.stdout)).toMatchObject({ page: 1, pageSize: 5, total: 1 });
  });

  it('says when no link matches', async () => {
    const run = await probara(['list']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('No recording link matches');
  });
});

describe('probara vis recording-links get', () => {
  it('prints the link, its URL and what it received', async () => {
    const link = api.seedLink({
      reference: 'TICKET-42',
      folderUlid: '01KC0000000000000000000F01',
      expiresAt: Date.parse('2026-12-31T18:00:00.000Z'),
      microphone: true,
      submissionCount: 2,
      lastSubmissionAt: Date.parse('2026-09-28T10:00:00.000Z'),
    });

    const run = await probara(['get', link.ulid]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        'Support recordings',
        `ULID        ${link.ulid}`,
        'Status      active',
        'Mode        reusable',
        `URL         ${link.url ?? ''}`,
        'Folder      01KC0000000000000000000F01',
        'Reference   TICKET-42',
        'Expires     2026-12-31T18:00:00.000Z',
        'Microphone  on',
        'Received    2 recordings, the last on 2026-09-28T10:00:00.000Z',
        `Created     ${new Date(link.createdAt).toISOString()}`,
        '',
      ].join('\n'),
    );
  });

  it('prints a revoked link with no URL, and the link as JSON with --json', async () => {
    const link = api.seedLink({ status: 'revoked', url: null, revokedAt: NOW.getTime() });

    const text = await probara(['get', link.ulid]);
    const json = await probara(['get', link.ulid, '--json']);

    expect(text.stdout).toContain('URL         none: the link is revoked');
    expect(text.stdout).toContain('Revoked     2026-09-29T12:00:00.000Z');
    expect(JSON.parse(json.stdout)).toEqual(link);
  });

  it('refuses an id that is not a ULID, and sends nothing', async () => {
    const missing = await probara(['get']);
    const wrong = await probara(['get', 'VIS-12']);

    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('Missing the recording link: its ULID');
    expect(wrong.exitCode).toBe(2);
    expect(wrong.stderr).toContain('"VIS-12" is not a recording link: pass its ULID');
    expect(api.requests()).toHaveLength(0);
  });

  it('exits 1 with the refusal of Probara for a link it does not show', async () => {
    const run = await probara(['get', '01KC0000000000000000000R99']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Recording link not found');
  });
});

describe('probara vis recording-links create', () => {
  it('sends every field and prints the ULID and the URL on stdout', async () => {
    const run = await probara([
      'create',
      '--title',
      'Support recordings',
      '--folder',
      '01KC0000000000000000000F01',
      '--reference',
      'TICKET-42',
      '--one-time',
      '--expires',
      '2026-12-31T18:00:00Z',
      '--microphone',
    ]);

    expect(run.exitCode).toBe(0);
    const [link] = api.links();
    expect(run.stdout).toBe(`${link?.ulid ?? ''} ${link?.url ?? ''}\n`);
    expect(run.stderr).toContain(
      `Created the recording link "Support recordings": ${link?.url ?? ''}`,
    );
    const [request] = linkRequests();
    expect(request?.method).toBe('POST');
    expect(request?.headers['idempotency-key']).toMatch(/\S/);
    expect(request?.json).toEqual({
      title: 'Support recordings',
      folderUlid: '01KC0000000000000000000F01',
      reference: 'TICKET-42',
      mode: 'one_time',
      expiresAt: Date.parse('2026-12-31T18:00:00Z'),
      microphone: true,
    });
  });

  it('sends only the title by default, and prints the link as JSON with --json', async () => {
    const run = await probara(['create', '--title', 'Support recordings', '--json']);

    expect(run.exitCode).toBe(0);
    expect(linkRequests()[0]?.json).toEqual({ title: 'Support recordings' });
    expect(JSON.parse(run.stdout)).toEqual(api.links()[0]);
  });

  it('needs --title, and an --expires in the future with its time zone; nothing is sent', async () => {
    const untitled = await probara(['create']);
    const zoneless = await probara(['create', '--title', 'x', '--expires', '2026-12-31T18:00']);
    const past = await probara(['create', '--title', 'x', '--expires', '2026-09-01T00:00:00Z']);

    expect(untitled.exitCode).toBe(2);
    expect(untitled.stderr).toContain(
      'Missing --title: the default title of the Vises the link receives',
    );
    expect(zoneless.exitCode).toBe(2);
    expect(zoneless.stderr).toContain(
      '--expires takes never, or a date and time with its time zone, such as 2026-12-31T18:00:00Z',
    );
    expect(past.exitCode).toBe(2);
    expect(past.stderr).toContain('--expires is in the past');
    expect(api.requests()).toHaveLength(0);
  });

  it('exits 1 with the refusal of Probara past the links of the plan', async () => {
    api = createFakeVisApi({ token: TOKEN, recordingLinksPerMonth: 0 });

    const run = await probara(['create', '--title', 'Support recordings']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('vis_recording_link_limit_exceeded');
    expect(api.links()).toHaveLength(0);
  });
});

describe('probara vis recording-links update', () => {
  it('sends only the options given', async () => {
    const link = api.seedLink();

    const run = await probara(['update', link.ulid, '--title', 'Beta testers', '--no-microphone']);

    expect(run.exitCode).toBe(0);
    expect(linkRequests()[0]?.json).toEqual({ title: 'Beta testers', microphone: false });
    expect(run.stderr).toContain('Updated the recording link "Beta testers"');
    expect(api.link(link.ulid)?.title).toBe('Beta testers');
  });

  it('clears the folder, the reference and the expiry, and prints the link with --json', async () => {
    const link = api.seedLink({
      folderUlid: '01KC0000000000000000000F01',
      reference: 'TICKET-42',
      expiresAt: Date.parse('2026-12-31T18:00:00.000Z'),
    });

    const run = await probara([
      'update',
      link.ulid,
      '--folder',
      'none',
      '--reference',
      '',
      '--expires',
      'never',
      '--json',
    ]);

    expect(run.exitCode).toBe(0);
    expect(linkRequests()[0]?.json).toEqual({ folderUlid: null, reference: null, expiresAt: null });
    expect(JSON.parse(run.stdout)).toMatchObject({
      folderUlid: null,
      reference: null,
      expiresAt: null,
    });
  });

  it('refuses a command with nothing to change, and sends nothing', async () => {
    const link = api.seedLink();

    const run = await probara(['update', link.ulid]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(
      'Nothing to change: pass --title, --folder, --reference, --expires or --[no-]microphone',
    );
    expect(api.requests()).toHaveLength(0);
  });
});

describe('probara vis recording-links revoke', () => {
  it('asks on the terminal and revokes on yes', async () => {
    const link = api.seedLink();
    const questions: string[] = [];

    const run = await probara(['revoke', link.ulid], {
      prompt: (question) => {
        questions.push(question);
        return Promise.resolve('y');
      },
    });

    expect(run.exitCode).toBe(0);
    expect(questions).toEqual([
      'Revoke the recording link "Support recordings"? Its URL stops working for good. [y/N] ',
    ]);
    expect(run.stderr).toContain(
      'Revoked the recording link "Support recordings": its URL no longer works',
    );
    expect(api.link(link.ulid)?.status).toBe('revoked');
  });

  it('keeps the link when the answer is not yes (exit 1)', async () => {
    const link = api.seedLink();

    const run = await probara(['revoke', link.ulid], { prompt: () => Promise.resolve('n') });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Not revoked: the link still works');
    expect(api.requestsTo('POST', LINKS)).toHaveLength(0);
  });

  it('revokes without asking with --yes, and needs it when stdin is not a terminal', async () => {
    const link = api.seedLink();

    const refused = await probara(['revoke', link.ulid]);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain(
      'Not revoked: stdin is not a terminal, so there is no one to confirm. Pass --yes to revoke it',
    );
    expect(api.link(link.ulid)?.status).toBe('active');

    const run = await probara(['revoke', link.ulid, '--yes', '--json']);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ulid: link.ulid, status: 'revoked', url: null });
  });
});

describe('probara vis recording-links delete', () => {
  it('asks on the terminal, deletes on yes and says the Vises are kept', async () => {
    const link = api.seedLink();
    const questions: string[] = [];

    const run = await probara(['delete', link.ulid], {
      prompt: (question) => {
        questions.push(question);
        return Promise.resolve('yes');
      },
    });

    expect(run.exitCode).toBe(0);
    expect(questions).toEqual([
      'Delete the recording link "Support recordings"? The Vises it received are kept. [y/N] ',
    ]);
    expect(run.stderr).toContain(
      'Deleted the recording link "Support recordings": the Vises it received are kept',
    );
    expect(api.link(link.ulid)).toBeUndefined();
  });

  it('keeps the link when the answer is not yes, or when stdin is not a terminal and no --yes', async () => {
    const link = api.seedLink();

    const declined = await probara(['delete', link.ulid], { prompt: () => Promise.resolve('') });
    const noTerminal = await probara(['delete', link.ulid]);

    expect(declined.exitCode).toBe(1);
    expect(declined.stderr).toContain('Not deleted: the link is kept');
    expect(noTerminal.exitCode).toBe(2);
    expect(noTerminal.stderr).toContain(
      'Not deleted: stdin is not a terminal, so there is no one to confirm. Pass --yes to delete it',
    );
    expect(api.requestsTo('DELETE', LINKS)).toHaveLength(0);
    expect(api.link(link.ulid)).toBeDefined();
  });

  it('deletes without asking with --yes and prints a JSON summary', async () => {
    const link = api.seedLink();

    const run = await probara(['delete', link.ulid, '--yes', '--json']);

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ status: 'deleted', ulid: link.ulid });
    expect(api.link(link.ulid)).toBeUndefined();
  });
});

describe('probara vis recording-links', () => {
  it('sends nothing while reporting is off, and exits 0', async () => {
    const link = api.seedLink();

    const run = await probara(['revoke', link.ulid, '--yes'], {
      env: { ...ENV, PROBARA_ENABLED: 'false' },
    });

    expect(run.exitCode).toBe(0);
    expect(api.requests()).toHaveLength(0);
  });

  it('lists its commands without one (exit 2), and refuses an unknown one', async () => {
    const bare = await probara([]);
    const unknown = await probara(['rename']);

    expect(bare.exitCode).toBe(2);
    expect(bare.stderr).toContain('Usage: probara vis recording-links <command> [options]');
    expect(bare.stderr).toContain('revoke <id>');
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('Unknown command "vis recording-links rename"');
  });

  it('keeps its options to itself: vis list still refuses --state', async () => {
    const run = await runCli(['vis', 'list', '--state', 'active'], { env: ENV, fetch: api.fetch });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("Unknown option '--state'");
  });
});
