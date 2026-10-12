/**
 * The runs of a session of re-runs (Jest's watch mode, Cypress's interactive mode): one Probara run
 * per project for the whole session, never closed by it, and the runs Probara refuses meanwhile.
 */
import { describe, expect, it } from 'vitest';
import { resolveConfig, type ProbaraOptions } from './config.js';
import type {
  ProjectReportSummary,
  ReporterOptions,
  ReportError,
  ReportSummary,
} from './reporter.js';
import {
  closeRunCommand,
  createSessionRuns,
  refusalOf,
  sessionOptions,
  type SessionRun,
} from './session-runs.js';

const TOKEN = 'probara_secretTOKEN123';
const RUN_A = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN_B = '01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const WEB_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2W5';
const A: SessionRun = { ulid: RUN_A, displayId: 'SHOP-R1' };

/** The options of a reporter for SHOP, with an environment of its own (none from the process). */
const OPTIONS: ProbaraOptions & { env: Record<string, string> } = {
  apiToken: TOKEN,
  projectId: 'SHOP',
  env: {},
};

/** The run the reports of SHOP would go into under `options`: its ULID when it is reused. */
function ulidOf(options: ReporterOptions): string | undefined {
  const resolution = resolveConfig(options, options.env ?? {});
  if (!resolution.ok) throw new Error('the options do not resolve');
  return 'ulid' in resolution.config.run ? resolution.config.run.ulid : undefined;
}

function error(status: number, code: string, retryable: boolean): ReportError {
  return { message: `${String(status)} ${code}`, status, code, retryable };
}

/** A project of a report summary: its status, its errors, and the run it reported into, if any. */
function project(
  projectId: string,
  fields: {
    status: ProjectReportSummary['status'];
    errors?: ReportError[];
    run?: SessionRun;
  },
): ProjectReportSummary {
  return {
    projectId,
    status: fields.status,
    ...(fields.run === undefined
      ? {}
      : {
          run: {
            ...fields.run,
            state: 'open',
            url: `https://probara.test/runs/${fields.run.ulid}`,
          },
        }),
    recorded: 0,
    created: 0,
    unmatched: 0,
    notSent: 0,
    errors: fields.errors ?? [],
    attachments: { uploaded: 0, skipped: 0, failed: 0 },
  };
}

function summary(projects: ProjectReportSummary[]): Pick<ReportSummary, 'projects'> {
  return { projects };
}

describe('closeRunCommand', () => {
  it('names the command that closes a run of the session in Probara', () => {
    expect(closeRunCommand('SHOP', RUN_A)).toBe(
      `probara run close --project SHOP --run-ulid ${RUN_A}`,
    );
  });
});

describe('refusalOf', () => {
  it('reads a 409 conflict that was not retried as a closed run, and a 404 as a deleted one', () => {
    expect(refusalOf([error(409, 'conflict', false)])).toBe('closed');
    expect(refusalOf([error(404, 'not_found', false)])).toBe('deleted');
  });

  it('reads a retried 409, or any other failure, as no refusal: that report may be recorded', () => {
    expect(refusalOf([error(409, 'conflict', true)])).toBeUndefined();
    expect(refusalOf([error(500, 'internal', true)])).toBeUndefined();
    expect(refusalOf([])).toBeUndefined();
  });

  it('reads a closed run first when a report failed both ways', () => {
    expect(refusalOf([error(404, 'not_found', false), error(409, 'conflict', false)])).toBe(
      'closed',
    );
  });
});

describe('sessionOptions', () => {
  it('never closes a run, whatever the options said', () => {
    const options = sessionOptions({ ...OPTIONS, closeRun: true, closeRuns: { SHOP: true } });

    expect(options.closeRun).toBe(false);
    expect(options.closeRuns).toBeUndefined();
  });

  it('gives the options a first report creates a run from, when there is no run yet', () => {
    const options = sessionOptions(OPTIONS);

    expect(options).toEqual({ ...OPTIONS, closeRun: false, closeRuns: undefined });
    expect(ulidOf(options)).toBeUndefined();
  });

  it('reports into the run of each project it is given, before the run the environment names', () => {
    const options = sessionOptions(
      { ...OPTIONS, env: { PROBARA_RUN_ULID: RUN_B } },
      new Map([['SHOP', A]]),
    );

    expect(ulidOf(options)).toBe(RUN_A);
  });
});

describe('createSessionRuns', () => {
  it('starts the run of each project the first report gave one, and reports into it from then on', () => {
    const session = createSessionRuns();

    const changes = session.follow(summary([project('SHOP', { status: 'completed', run: A })]));

    expect(changes).toEqual({
      started: [{ projectId: 'SHOP', run: A }],
      refused: [],
    });
    expect(ulidOf(session.options(OPTIONS))).toBe(RUN_A);
  });

  it('refuses a run a report found closed (409) or deleted (404), and forgets it', () => {
    const session = createSessionRuns();
    session.follow(summary([project('SHOP', { status: 'completed', run: A })]));

    const closed = session.follow(
      summary([project('SHOP', { status: 'failed', errors: [error(409, 'conflict', false)] })]),
    );
    expect(closed).toEqual({
      started: [],
      refused: [{ projectId: 'SHOP', run: A, gone: 'closed', partial: false }],
    });
    expect(ulidOf(session.options(OPTIONS))).toBeUndefined();

    session.follow(summary([project('SHOP', { status: 'completed', run: A })]));
    const deleted = session.follow(
      summary([project('SHOP', { status: 'partial', errors: [error(404, 'not_found', false)] })]),
    );
    expect(deleted).toEqual({
      started: [],
      refused: [{ projectId: 'SHOP', run: A, gone: 'deleted', partial: true }],
    });
  });

  it('keeps a run that no report refused, whatever its later reports say', () => {
    const session = createSessionRuns();
    session.follow(summary([project('SHOP', { status: 'completed', run: A })]));

    const changes = session.follow(
      summary([
        project('SHOP', {
          status: 'failed',
          errors: [error(500, 'internal', false)],
        }),
      ]),
    );
    const again = session.follow(
      summary([
        project('SHOP', { status: 'completed', run: { ulid: RUN_B, displayId: 'SHOP-R2' } }),
      ]),
    );

    expect(changes).toEqual({ started: [], refused: [] });
    expect(again).toEqual({ started: [], refused: [] });
    expect(ulidOf(session.options(OPTIONS))).toBe(RUN_A);
  });

  it('starts nothing for a project without a run, and reads no refusal in it', () => {
    const session = createSessionRuns();

    const changes = session.follow(
      summary([project('SHOP', { status: 'failed', errors: [error(404, 'not_found', false)] })]),
    );

    expect(changes).toEqual({ started: [], refused: [] });
    expect(ulidOf(session.options(OPTIONS))).toBeUndefined();
  });

  it('adopts the runs of the projects it does not know, and refuses none of the others', () => {
    const session = createSessionRuns();
    session.follow(summary([project('SHOP', { status: 'completed', run: A })]));

    const adopted = session.adopt(
      summary([
        project('SHOP', {
          status: 'failed',
          errors: [error(409, 'conflict', false)],
          run: { ulid: RUN_B, displayId: 'SHOP-R2' },
        }),
        project('WEB', { status: 'completed', run: { ulid: WEB_RUN, displayId: 'WEB-R1' } }),
      ]),
    );

    expect(adopted).toEqual([{ projectId: 'WEB', run: { ulid: WEB_RUN, displayId: 'WEB-R1' } }]);
    expect(ulidOf(session.options(OPTIONS))).toBe(RUN_A);
  });
});
