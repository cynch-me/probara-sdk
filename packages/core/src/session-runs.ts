/**
 * The runs of a session of re-runs: Jest's watch mode, where every re-run reports into the runs the
 * session started, and Cypress's interactive mode, where a run stays open for the user to close. A
 * session never closes its runs. When Probara refuses one (it was closed, or deleted, meanwhile),
 * the session forgets it; the adapter sends the results that run did not record into a new run,
 * from the reports core hands back ({@link SessionRuns.follow}).
 */
import { reuseRuns } from './config.js';
import type {
  ProjectReportSummary,
  ReporterOptions,
  ReportError,
  ReportSummary,
} from './reporter.js';

/** A run of a session: its ULID, and the display id Probara names it by (`SHOP-R12`). */
export interface SessionRun {
  ulid: string;
  displayId: string;
}

/**
 * Why Probara refused a run of a session: `closed` (409 `conflict`, not retried) or `deleted` (404
 * `not_found`).
 */
export type RunRefusal = 'closed' | 'deleted';

/** A project whose report started a run of the session, which the adapter says once. */
export interface StartedRun {
  projectId: string;
  run: SessionRun;
}

/** A project whose run Probara refused: the run it had, and whether some of its reports were sent. */
export interface RefusedRun extends StartedRun {
  gone: RunRefusal;
  /** Some reports of the project were recorded in the run before the refusal. */
  partial: boolean;
}

/** What one report changed in the session's runs. */
export interface SessionRunChanges {
  started: StartedRun[];
  refused: RefusedRun[];
}

/** The runs of one session, held by the adapter for as long as the session lasts. */
export interface SessionRuns {
  /** The options of a report of the session: into the runs it has, never closing one. */
  options(core: ReporterOptions): ReporterOptions;
  /**
   * Follows a report of the session: a project without a run the session knows takes the run the
   * report gave it; a project whose run the report found closed or deleted loses it. A project the
   * session knows and that the report did not refuse keeps its run.
   */
  follow(summary: Pick<ReportSummary, 'projects'>): SessionRunChanges;
  /**
   * The runs of a report the session did not follow, such as a re-send into new runs: a project the
   * session does not know yet takes its run. Nothing is refused.
   */
  adopt(summary: Pick<ReportSummary, 'projects'>): StartedRun[];
}

/** The command that closes a run of a session in Probara, which the adapter's log lines name. */
export function closeRunCommand(projectId: string, ulid: string): string {
  return `probara run close --project ${projectId} --run-ulid ${ulid}`;
}

/**
 * Why the errors of a report say its run went away: `closed` (409 `conflict`) or `deleted` (404
 * `not_found`), each only when not retried. A 409 that was retried (`Retry-After`: the same report
 * was still in flight) is no refusal, since that report may be recorded, so it is never sent again.
 */
export function refusalOf(errors: readonly ReportError[]): RunRefusal | undefined {
  const refused = (status: number, code: string) =>
    errors.some(
      (error) => error.status === status && error.code === code && error.retryable === false,
    );
  if (refused(409, 'conflict')) return 'closed';
  if (refused(404, 'not_found')) return 'deleted';
  return undefined;
}

/**
 * The options of a report of a session: into the runs it has (by project code), and never closing
 * one, since a closed run would refuse the next report. With no run yet, the options are the ones
 * given: the session's first report creates the run from them.
 */
export function sessionOptions(
  core: ReporterOptions,
  runs: ReadonlyMap<string, SessionRun> = new Map(),
): ReporterOptions {
  const ulids = Object.fromEntries([...runs].map(([code, run]) => [code, run.ulid]));
  // With no run, `reuseRuns` would still clear the settings a new run takes: not wanted here.
  const options = runs.size === 0 ? core : reuseRuns(core, ulids);
  return { ...options, closeRun: false, closeRuns: undefined };
}

/** The run a project reported into, as the session keeps it, if it has one. */
function runOf(project: ProjectReportSummary): SessionRun | undefined {
  if (project.run === undefined) return undefined;
  return { ulid: project.run.ulid, displayId: project.run.displayId };
}

/** Creates the runs of a session: none yet, until a report gives the session one. */
export function createSessionRuns(): SessionRuns {
  const runs = new Map<string, SessionRun>();

  /** Takes the run of `project` when the session has none for it, and returns it as started. */
  const adoptOne = (project: ProjectReportSummary): StartedRun | undefined => {
    const run = runOf(project);
    if (run === undefined || runs.has(project.projectId)) return undefined;
    runs.set(project.projectId, run);
    return { projectId: project.projectId, run };
  };

  return {
    options: (core) => sessionOptions(core, runs),
    follow(summary) {
      const started: StartedRun[] = [];
      const refused: RefusedRun[] = [];
      for (const project of summary.projects) {
        const known = runs.get(project.projectId);
        if (known === undefined) {
          const adopted = adoptOne(project);
          if (adopted !== undefined) started.push(adopted);
          continue;
        }
        // `partial`: the run was closed or deleted after some reports: only the rest was not sent.
        const gone = project.status === 'completed' ? undefined : refusalOf(project.errors);
        if (gone === undefined) continue;
        runs.delete(project.projectId);
        refused.push({
          projectId: project.projectId,
          run: known,
          gone,
          partial: project.status === 'partial',
        });
      }
      return { started, refused };
    },
    adopt(summary) {
      return summary.projects.flatMap((project) => {
        const adopted = adoptOne(project);
        return adopted === undefined ? [] : [adopted];
      });
    },
  };
}
