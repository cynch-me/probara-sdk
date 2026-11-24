/**
 * The main-thread cost of the instant replay (S7): the same scripted session runs without a
 * reporter and with one keeping an instant replay, and the total blocking time it adds must stay
 * within a budget. Two pages: an order list opened twice, as the one whose re-render stopped the
 * replay of VIS-19, which the replay records through without pausing; and a page re-rendering a
 * big table every 400 ms, which costs more than the replay's budget, so it pauses. Run on its own (`pnpm --filter @probara/vis test:perf`): timing
 * needs a quiet machine, not one shared with the rest of the suite.
 */
import { mountOrderList } from '@probara/test-support/order-list';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReplayRecorder } from '@probara/vis-capture/replay';
import type { ReplayModule } from './replay-loader.js';
import { createReporterWith, type Reporter } from './reporter.js';

/** The session: a fixed number of ticks, so both variants do the same work. */
const TICKS = 75;
const TICK_MS = 200;
/** The heavy page: a table of ROWS x COLUMNS cells. */
const ROWS = 120;
const COLUMNS = 50;
/** Rows whose cells are rewritten each tick. */
const ROWS_PER_TICK = 2;
/** The ticks that open the order list again: a re-render of all its rows. */
const ORDER_LIST_OPENINGS = [15, 45];
/** Ticks that re-render the whole table: from FIRST_BURST, every BURST_EVERY ticks. */
const FIRST_BURST = 45;
const BURST_EVERY = 2;
/**
 * The most total blocking time the instant replay may add to the session (the quietest session
 * with it minus the quietest without it). Measured on an Apple Silicon laptop, before the replay
 * paused instead of stopping: -25 to 6 ms (noise), and 13 ms with the CPU slowed down twice; a
 * replay that kept recording the heavy page adds 290-750 ms, and 1,340 ms slowed down. The budget
 * sits between the two with room for a slower CI machine.
 */
const ADDED_BLOCKING_TIME_BUDGET_MS = 100;
/**
 * The same for the order list, which the replay now records through instead of stopping at its
 * first opening. Measured on an Apple Silicon laptop: 104-125 ms, the replay's first full snapshot
 * of the page and its 1.67 MB of CSS (about 37 ms of it) and each opening's mutation batch, about
 * 35 ms over a long task's 50 ms.
 */
const ORDER_LIST_BLOCKING_TIME_BUDGET_MS = 150;
/** Measured pairs, after one warm-up pair that is not counted. */
const PAIRS = 3;

/** Rrweb's full snapshot event type. */
const FULL_SNAPSHOT = 2;
const KEY = 'pvk_eyJ2IjoxfQ.c2lnbmF0dXJl';
const ACME = '01JACME0000000000000000000';
const CONFIG = {
  organizationName: 'Acme',
  recordingMaxMinutes: 15,
  instantReplay: true,
  requireVerifiedReporter: false,
};

/** Long tasks of this frame: the time each spends past 50 ms is blocking time. */
function observeLongTasks() {
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => {
    tasks.push(...list.getEntries());
  });
  observer.observe({ type: 'longtask' });
  return {
    stop(): PerformanceEntry[] {
      tasks.push(...observer.takeRecords());
      observer.disconnect();
      return tasks;
    },
  };
}

const blockingTime = (tasks: readonly PerformanceEntry[], from = 0, to = Infinity): number =>
  tasks
    .filter((task) => task.name === 'self' && task.startTime >= from && task.startTime < to)
    .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);

/**
 * The quietest of `values`. A busy machine only ever adds blocking time, to a session with the
 * replay as to one without it: on a shared CI runner one quiet session of three is common, two of
 * three are not (a run measured 242, 0 and 63 ms without the replay). The cost of a replay that
 * keeps recording is in every session, the quietest included.
 */
const quietest = (values: readonly number[]): number => Math.min(...values);

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function heapBytes(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory === undefined ? null : memory.usedJSHeapSize;
}

/** A heavy page: a big table rewritten on a timer, a field typed into, a button and requests. */
function mountHeavyPage() {
  const root = document.createElement('main');
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  for (let row = 0; row < ROWS; row += 1) {
    const tr = document.createElement('tr');
    for (let column = 0; column < COLUMNS; column += 1) {
      const cell = document.createElement('td');
      cell.textContent = String(row * COLUMNS + column);
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  const field = document.createElement('input');
  field.name = 'search';
  const button = document.createElement('button');
  button.textContent = 'Refresh';
  let clicks = 0;
  button.addEventListener('click', () => {
    clicks += 1;
    table.dataset['page'] = String(clicks);
  });
  root.append(field, button, table);
  document.body.append(root);
  const stub = URL.createObjectURL(
    new Blob([JSON.stringify({ rows: ROWS, columns: COLUMNS })], { type: 'application/json' }),
  );
  const requests: Promise<unknown>[] = [];

  /** One tick of the session: deterministic, from its index alone. */
  function tick(index: number): void {
    if (index >= FIRST_BURST && (index - FIRST_BURST) % BURST_EVERY === 0) {
      // A full re-render of the table, as a page does when its data reloads.
      body.innerHTML = Array.from(
        { length: ROWS },
        (_, row) =>
          '<tr>' +
          Array.from(
            { length: COLUMNS },
            (_, column) => '<td>' + String((index + 1) * (row * COLUMNS + column)) + '</td>',
          ).join('') +
          '</tr>',
      ).join('');
    }
    for (let offset = 0; offset < ROWS_PER_TICK; offset += 1) {
      const tr = body.rows[(index * ROWS_PER_TICK + offset) % ROWS];
      if (tr === undefined) continue;
      tr.innerHTML = Array.from(
        { length: COLUMNS },
        (_, column) => '<td>' + String((index + 1) * 7919 + column) + '</td>',
      ).join('');
    }
    // A class change on the table and a layout read, as a busy page does on each update.
    table.className = index % 2 === 0 ? 'even' : 'odd';
    table.getBoundingClientRect();
    const key = String.fromCharCode(97 + (index % 26));
    field.value += key;
    field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    if (index % 5 === 0) button.click();
    if (index % 10 === 0) requests.push(fetch(stub).then((response) => response.json()));
  }

  return {
    tick,
    async dispose(): Promise<void> {
      await Promise.all(requests);
      URL.revokeObjectURL(stub);
      root.remove();
    },
  };
}

interface Page {
  tick(index: number): void;
  dispose(): Promise<void>;
}

/** The order list, opened again at `ORDER_LIST_OPENINGS`, and a field typed into meanwhile. */
function mountOrderListPage(): Page {
  const list = mountOrderList(document);
  const field = document.createElement('input');
  field.name = 'search';
  list.root.prepend(field);
  return {
    tick(index) {
      if (ORDER_LIST_OPENINGS.includes(index)) list.render(index);
      const key = String.fromCharCode(97 + (index % 26));
      field.value += key;
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    },
    dispose() {
      list.remove();
      return Promise.resolve();
    },
  };
}

interface Run {
  /** Blocking time from the reporter's start to the session's end. */
  total: number;
  /** Of it, the blocking time before the first tick: the replay's first full snapshot. */
  startup: number;
  heap: number | null;
  pauses: number;
  /** When the replay first paused, in milliseconds after the first tick. */
  pausedAfterMs: number | null;
  /** The first re-render of the whole table, in milliseconds after the first tick. */
  firstBurstAfterMs: number;
}

/** One session on a fresh heavy page, with or without a reporter keeping an instant replay. */
async function session(
  mount: () => Page,
  withReporter: boolean,
  replay: ReplayModule,
): Promise<Run> {
  const page = mount();
  const longTasks = observeLongTasks();
  const began = performance.now();
  let recorder: ReplayRecorder | undefined;
  let reporter: Reporter | null = null;
  if (withReporter) {
    reporter = createReporterWith(
      { widgetKey: KEY, organizations: [ACME], locale: 'en' },
      {
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify(CONFIG), {
              headers: { 'content-type': 'application/json' },
            }),
          ),
        storage: null,
        whenIdle: (run) => {
          const timer = setTimeout(run, 0);
          return () => {
            clearTimeout(timer);
          };
        },
        loadReplay: () =>
          Promise.resolve({
            ...replay,
            createReplayRecorder: (options) => {
              recorder = replay.createReplayRecorder(options);
              return recorder;
            },
          }),
      },
    );
    expect(reporter).not.toBeNull();
    // The replay starts with the reporter, before the session.
    for (let attempt = 0; attempt < 100 && recorder?.active !== true; attempt += 1) await wait(10);
    expect(recorder?.active).toBe(true);
    expect(
      recorder?.events().some((event) => {
        const type: number = event.type;
        return type === FULL_SNAPSHOT;
      }),
    ).toBe(true);
  } else {
    await wait(20);
  }
  const ticking = performance.now();
  let firstBurst = Infinity;
  for (let index = 0; index < TICKS; index += 1) {
    await wait(TICK_MS);
    if (index === FIRST_BURST) firstBurst = performance.now();
    page.tick(index);
  }
  await wait(100);
  const tasks = longTasks.stop();
  const pausedAt = recorder
    ?.events()
    .find(
      (event) => (event.data as { tag?: string } | undefined)?.tag === replay.REPLAY_PAUSED_TAG,
    )?.timestamp;
  const run: Run = {
    total: blockingTime(tasks, began),
    startup: blockingTime(tasks, began, ticking),
    heap: heapBytes(),
    pauses: recorder?.health.pauses ?? 0,
    pausedAfterMs:
      pausedAt === undefined ? null : Math.round(pausedAt - performance.timeOrigin - ticking),
    firstBurstAfterMs: Math.round(firstBurst - ticking),
  };
  reporter?.destroy();
  await page.dispose();
  return run;
}

afterEach(() => {
  sessionStorage.clear();
});

describe('the instant replay', () => {
  it('long tasks of this frame are observable', async () => {
    expect(PerformanceObserver.supportedEntryTypes).toContain('longtask');
    const longTasks = observeLongTasks();
    const until = performance.now() + 120;
    while (performance.now() < until) {
      // A deliberate long task.
    }
    await wait(50);
    const tasks = longTasks.stop();
    expect(blockingTime(tasks)).toBeGreaterThanOrEqual(60);
  });

  /** Sessions without and with the replay; the added blocking time must stay within budget. */
  async function measure(mount: () => Page, budgetMs: number): Promise<Run[]> {
    const replay: ReplayModule = await import('@probara/vis-capture/replay');
    const without: Run[] = [];
    const withReplay: Run[] = [];
    // Interleaved, so a machine that slows down weighs on both; the first pair warms up.
    for (let pair = 0; pair <= PAIRS; pair += 1) {
      const off = await session(mount, false, replay);
      const on = await session(mount, true, replay);
      console.log(
        `pair ${String(pair)}${pair === 0 ? ' (warm-up)' : ''}`,
        JSON.stringify({ off, on }),
      );
      if (pair === 0) continue;
      without.push(off);
      withReplay.push(on);
    }
    const added =
      quietest(withReplay.map((run) => run.total)) - quietest(without.map((run) => run.total));
    console.log(`added total blocking time: ${String(added)} ms (budget ${String(budgetMs)} ms)`);
    expect(added).toBeLessThanOrEqual(budgetMs);
    return withReplay;
  }

  it(
    'records the order list through its openings without pausing',
    { timeout: 600_000 },
    async () => {
      const runs = await measure(mountOrderListPage, ORDER_LIST_BLOCKING_TIME_BUDGET_MS);
      for (const run of runs) expect(run.pauses).toBe(0);
    },
  );

  it('pauses on a page that costs more than its budget', { timeout: 600_000 }, async () => {
    const runs = await measure(mountHeavyPage, ADDED_BLOCKING_TIME_BUDGET_MS);
    // The whole-table re-renders are what costs the replay most: it pauses at the first, and its
    // first pause outlasts the session.
    for (const run of runs) {
      expect(run.pauses).toBe(1);
      expect(run.pausedAfterMs).toBeGreaterThan(run.firstBurstAfterMs);
    }
  });
});
