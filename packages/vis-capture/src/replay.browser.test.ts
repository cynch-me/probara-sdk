/**
 * The DOM replay recorder in a real Chromium page, on rrweb: the rolling buffer keeps the last
 * segments, the full mode keeps everything, and what is typed, secret or blurred never reaches
 * the events.
 */
import { EventType, IncrementalSource } from '@rrweb/types';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { mountOrderList, ORDER_LIST_SHAPE } from '@probara/test-support/order-list';
import { createBlurController, type BlurController } from './blur.js';
import {
  createReplayRecorder,
  REPLAY_CHECKOUT_MS,
  REPLAY_BUDGET,
  REPLAY_HEALTH_TAG,
  REPLAY_PAUSED_TAG,
  replayHealthEvent,
  type ReplayEvent,
  type ReplayRecorder,
} from './replay.js';

const roots: HTMLElement[] = [];
const recorders: ReplayRecorder[] = [];
const blurs: BlurController[] = [];

afterEach(() => {
  for (const recorder of recorders.splice(0)) recorder.stop();
  for (const blur of blurs.splice(0)) blur.stop();
  for (const root of roots.splice(0)) root.remove();
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  roots.push(root);
  return root;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Changes the page every 25 ms for `ms`, so rrweb has events to check out on. */
async function keepChanging(root: HTMLElement, ms: number): Promise<void> {
  const end = performance.now() + ms;
  let i = 0;
  while (performance.now() < end) {
    const line = document.createElement('p');
    line.textContent = `line ${String(i++)}`;
    root.replaceChildren(line);
    await sleep(25);
  }
}

const count = (events: readonly ReplayEvent[], type: EventType): number =>
  events.filter((event) => event.type === type).length;

function lastFullSnapshot(events: readonly ReplayEvent[]): string {
  const snapshots = events.filter((event) => event.type === EventType.FullSnapshot);
  return JSON.stringify(snapshots.at(-1));
}

describe('createReplayRecorder', () => {
  it('checks out every two minutes by default', () => {
    expect(REPLAY_CHECKOUT_MS).toBe(120_000);
  });

  it('in rolling mode drops the oldest segments', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', checkoutMs: 150 });
    recorders.push(replay);
    replay.start();
    expect(replay.active).toBe(true);
    await keepChanging(root, 800);
    const events = replay.events();
    expect(events[0]?.type).toBe(EventType.Meta);
    expect(events[1]?.type).toBe(EventType.FullSnapshot);
    expect(count(events, EventType.Meta)).toBe(2);
    expect(count(events, EventType.FullSnapshot)).toBe(2);
    // The first lines were dropped with the oldest segments.
    expect(JSON.stringify(events)).not.toContain('"line 0"');
  });

  it('in full mode keeps everything from the start, readable after stop', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 300);
    replay.stop();
    expect(replay.active).toBe(false);
    const events = replay.events();
    expect(count(events, EventType.FullSnapshot)).toBe(1);
    expect(count(events, EventType.IncrementalSnapshot)).toBeGreaterThan(0);
    expect(JSON.stringify(events)).toContain('line 0');
    const before = events.length;
    await keepChanging(root, 100);
    expect(replay.events()).toHaveLength(before);
  });

  it('starts a new recording with an empty buffer after stop', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 100);
    replay.stop();
    root.replaceChildren();
    replay.start();
    await sleep(50);
    const events = replay.events();
    expect(events[0]?.type).toBe(EventType.Meta);
    expect(JSON.stringify(events)).not.toContain('line 0');
  });

  it('masks every input, records no password field, and blocks blurred elements', async () => {
    const root = mount(
      '<input id="name" value="initial-name"><input id="pw" type="password" value="hunter2-pw">' +
        '<p id="card">card-4111-text</p><p class="email">mail-at-example</p><p>visible-text</p>',
    );
    const blur = createBlurController();
    blurs.push(blur);
    blur.blur(find(root, '#card'));
    blur.blur('.email');
    const replay = createReplayRecorder({ mode: 'full', blur });
    recorders.push(replay);
    replay.start();
    const name = find(root, '#name') as HTMLInputElement;
    name.value = 'typed-later';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    const json = JSON.stringify(replay.events());
    expect(json).toContain('visible-text');
    for (const secret of [
      'initial-name',
      'typed-later',
      'hunter2-pw',
      'card-4111-text',
      'mail-at-example',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('masks the text of a contenteditable element and everything typed into it', async () => {
    const root = mount(
      '<div id="editor" contenteditable="true"><p>initial-edit-text</p></div>' +
        '<div contenteditable="false">plain-noneditable</div><p>visible-text</p>',
    );
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    const editor = find(root, '#editor');
    await userEvent.type(editor, 'EditSecretDelta');
    editor.append(document.createElement('p'));
    editor.lastElementChild?.append(document.createTextNode('AppendedSecret'));
    await sleep(100);
    expect(editor.textContent).toContain('EditSecretDelta');
    const json = JSON.stringify(replay.events());
    expect(json).toContain('visible-text');
    expect(json).toContain('plain-noneditable');
    for (const secret of ['initial-edit-text', 'EditSecretDelta', 'AppendedSecret']) {
      expect(json).not.toContain(secret);
    }
  });

  it('blocks an element blurred during the recording from the next snapshot on', async () => {
    const root = mount('<p id="late">late-secret</p>');
    const blur = createBlurController();
    blurs.push(blur);
    const replay = createReplayRecorder({ mode: 'full', blur });
    recorders.push(replay);
    replay.start();
    expect(lastFullSnapshot(replay.events())).toContain('late-secret');
    blur.blur(find(root, '#late'));
    await sleep(50);
    expect(count(replay.events(), EventType.FullSnapshot)).toBe(2);
    expect(lastFullSnapshot(replay.events())).not.toContain('late-secret');
    replay.stop();
    blur.blur('.after-stop');
    expect(count(replay.events(), EventType.FullSnapshot)).toBe(2);
  });

  it('does nothing more when started twice', async () => {
    mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    replay.start();
    await sleep(50);
    expect(count(replay.events(), EventType.FullSnapshot)).toBe(1);
  });
});

describe('the order list fixture', () => {
  type Mutation = {
    adds: { node: { type: number } }[];
    removes: unknown[];
    texts: unknown[];
    attributes: unknown[];
  };
  function mutationsIn(events: readonly ReplayEvent[]): Mutation[] {
    const batches: Mutation[] = [];
    for (const event of events) {
      if (event.type !== EventType.IncrementalSnapshot) continue;
      const data: unknown = event.data;
      if ((data as { source?: number }).source === IncrementalSource.Mutation) {
        batches.push(data as Mutation);
      }
    }
    return batches;
  }
  const records = (batch: Mutation): number =>
    batch.adds.length + batch.removes.length + batch.texts.length + batch.attributes.length;

  it('re-renders as one batch shaped like the one that stopped VIS-19, less its comments', async () => {
    const list = mountOrderList(document);
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    list.render(1);
    await sleep(50);
    replay.stop();
    const events = replay.events();
    const batches = mutationsIn(events);
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (batch === undefined) throw new Error('no mutation batch');
    const comments = ORDER_LIST_SHAPE.rows * ORDER_LIST_SHAPE.commentsPerRow;
    const walker = document.createTreeWalker(list.root, NodeFilter.SHOW_COMMENT);
    let held = 0;
    while (walker.nextNode() !== null) held += 1;
    expect(held).toBe(comments);
    expect(records(batch) + comments).toBe(11_000);
    const snapshot = events.find((event) => event.type === EventType.FullSnapshot);
    expect(JSON.stringify(snapshot).length).toBeGreaterThan(ORDER_LIST_SHAPE.cssBytes);
    list.remove();
  });
});

describe('the health of a replay', () => {
  const sizeOf = (events: readonly ReplayEvent[]): number =>
    events.reduce((sum, event) => sum + JSON.stringify(event).length, 0);

  it('measures the largest batch, the snapshot and what it holds', async () => {
    const list = mountOrderList(document);
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    const before = performance.now();
    list.render(1);
    await Promise.resolve();
    const task = performance.now() - before;
    await sleep(50);
    replay.stop();
    list.remove();
    const events = replay.events();
    const health = replay.health;
    expect(health.pauses).toBe(0);
    expect(health.checkouts).toBe(1);
    expect(health.size).toBe(sizeOf(events));
    expect(health.recordedSize).toBe(health.size);
    const batch = events.find((event) => event.type === EventType.IncrementalSnapshot);
    expect(health.largestBatch?.records).toBe(8_000);
    expect(health.largestBatch?.size).toBe(JSON.stringify(batch).length);
    // rrweb's work on the batch is timed inside the task that changed the page.
    expect(health.largestBatch?.ms).toBeGreaterThan(0);
    expect(health.largestBatch?.ms).toBeLessThanOrEqual(task);
    expect(health.longestSnapshotMs).toBeGreaterThan(0);
    expect(health.mainThreadMs).toBeGreaterThanOrEqual(
      (health.largestBatch?.ms ?? 0) + health.longestSnapshotMs,
    );
    expect(replay.coverage).toEqual({
      from: events[0]?.timestamp,
      to: events.at(-1)?.timestamp,
    });
  });

  it('counts every checkout and what was dropped, but holds only the kept segments', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', checkoutMs: 150 });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 800);
    const health = replay.health;
    expect(health.checkouts).toBeGreaterThanOrEqual(4);
    expect(health.size).toBe(sizeOf(replay.events()));
    expect(health.recordedSize).toBeGreaterThan(health.size);
  });

  it('holds no coverage before it starts, and starts over on start()', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    expect(replay.coverage).toBeNull();
    replay.start();
    await keepChanging(root, 100);
    replay.stop();
    replay.start();
    expect(replay.health.checkouts).toBe(1);
    expect(replay.health.largestBatch).toBeNull();
  });

  it('is told by a custom event stamped at the given time', () => {
    const health = createReplayRecorder({ mode: 'full' }).health;
    expect(replayHealthEvent(health, 1234)).toEqual({
      type: EventType.Custom,
      data: { tag: REPLAY_HEALTH_TAG, payload: health },
      timestamp: 1234,
    });
    expect(REPLAY_HEALTH_TAG).toBe('probara/replay-health');
  });
});

describe('comments', () => {
  type SerializedNode = {
    id: number;
    type: number;
    attributes?: Record<string, unknown>;
    childNodes?: SerializedNode[];
  };
  function idOf(node: SerializedNode, elementId: string): number | undefined {
    if (node.attributes?.['id'] === elementId) return node.id;
    for (const child of node.childNodes ?? []) {
      const found = idOf(child, elementId);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const hasComment = (node: SerializedNode): boolean =>
    node.type === 5 || (node.childNodes ?? []).some(hasComment);

  it('are never recorded, and what is inserted before one keeps its place', async () => {
    const root = mount('<ul><li id="a">a</li><!--anchor--><li id="b">b</li></ul>');
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    const added = document.createElement('li');
    added.id = 'c';
    const anchor = [...find(root, 'ul').childNodes].find(
      (node) => node.nodeType === Node.COMMENT_NODE,
    );
    if (anchor === undefined) throw new Error('no anchor comment');
    anchor.before(document.createComment('more'));
    find(root, 'ul').insertBefore(added, anchor);
    await sleep(50);
    const events = replay.events();
    const snapshot = events.find((event) => event.type === EventType.FullSnapshot);
    const tree = (snapshot?.data as { node: SerializedNode }).node;
    expect(hasComment(tree)).toBe(false);
    const adds = events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot
        ? ((event.data as { adds?: { nextId: number | null; node: SerializedNode }[] }).adds ?? [])
        : [],
    );
    expect(adds.map((add) => add.node.type)).toEqual([2]);
    expect(adds[0]?.nextId).toBe(idOf(tree, 'b'));
  });
});

describe('the rolling buffer', () => {
  const metas = (events: readonly ReplayEvent[]): number => count(events, EventType.Meta);

  it('keeps as many segments as cover the lookback', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', checkoutMs: 100, lookbackMs: 350 });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 1200);
    const events = replay.events();
    expect(events[1]?.type).toBe(EventType.FullSnapshot);
    const span = (events.at(-1)?.timestamp ?? 0) - (events[0]?.timestamp ?? 0);
    expect(span).toBeGreaterThanOrEqual(350);
    expect(span).toBeLessThan(350 + 250);
    expect(metas(events)).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(events)).not.toContain('"line 0"');
  });

  it('looks back one segment by default, as before', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', checkoutMs: 150 });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 800);
    expect(metas(replay.events())).toBe(2);
  });

  it('past its size cap drops the oldest segments and checks out early', async () => {
    const root = mount('<main></main>');
    const maxSize = 60_000;
    const replay = createReplayRecorder({ mode: 'rolling', checkoutMs: 60_000, maxSize });
    recorders.push(replay);
    replay.start();
    const end = performance.now() + 800;
    for (let i = 0; performance.now() < end; i += 1) {
      const line = document.createElement('p');
      line.textContent = `line ${String(i)} ${'x'.repeat(2_000)}`;
      root.replaceChildren(line);
      await sleep(10);
    }
    const health = replay.health;
    expect(health.checkouts).toBeGreaterThan(2);
    expect(health.size).toBeLessThanOrEqual(maxSize);
    expect(health.recordedSize).toBeGreaterThan(maxSize);
    const events = replay.events();
    expect(events[1]?.type).toBe(EventType.FullSnapshot);
    // About half the cap stays in history behind the current segment.
    expect(metas(events)).toBeGreaterThanOrEqual(2);
  });

  it('never checks out early only because its snapshot is large', async () => {
    const list = mountOrderList(document);
    const replay = createReplayRecorder({
      mode: 'rolling',
      checkoutMs: 60_000,
      maxSize: 1_000_000,
    });
    recorders.push(replay);
    replay.start();
    const root = mount('<main></main>');
    await keepChanging(root, 200);
    expect(replay.health.checkouts).toBe(1);
    list.remove();
  });
});

describe('a busy page', () => {
  const PAUSED = (events: readonly ReplayEvent[]) =>
    events.filter(
      (event) =>
        event.type === EventType.Custom &&
        (event.data as { tag?: string }).tag === REPLAY_PAUSED_TAG,
    );
  const resumeInOf = (event: ReplayEvent | undefined): number | undefined =>
    (event?.data as { payload?: { resumeInMs?: number } } | undefined)?.payload?.resumeInMs;
  /** A small budget the order list's rendering exceeds, and a first pause of `pauseMs`. */
  const budget = (pauseMs: number) => ({ windowMs: 1_000, mainThreadMs: 15, pauseMs });
  async function burst(): Promise<void> {
    const list = mountOrderList(document, { cssBytes: 0 });
    await sleep(20);
    list.remove();
  }
  async function resumed(replay: ReplayRecorder): Promise<void> {
    const end = performance.now() + 2_000;
    while (replay.paused && performance.now() < end) await sleep(10);
  }

  it('keeps recording through the order list re-render that stopped VIS-19', async () => {
    expect(REPLAY_BUDGET).toEqual({ windowMs: 2_000, mainThreadMs: 100, pauseMs: 10_000 });
    const list = mountOrderList(document);
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', budget: REPLAY_BUDGET });
    recorders.push(replay);
    replay.start();
    list.render(1);
    await sleep(50);
    find(root, 'main').textContent = 'after the burst';
    await sleep(50);
    list.remove();
    expect(replay.paused).toBe(false);
    expect(replay.health.pauses).toBe(0);
    expect(JSON.stringify(replay.events())).toContain('after the burst');
  });

  it('pauses past its budget, marks the gap and resumes from a new full snapshot', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', budget: budget(200) });
    recorders.push(replay);
    replay.start();
    await burst();
    expect(replay.active).toBe(true);
    expect(replay.paused).toBe(true);
    const paused = replay.events().at(-1);
    expect(paused?.type).toBe(EventType.Custom);
    expect(paused?.data).toMatchObject({
      tag: 'probara/replay-paused',
      payload: { reason: 'busy', windowMs: 1_000, resumeInMs: 200 },
    });
    const spent = (paused?.data as { payload: { mainThreadMs: number } }).payload.mainThreadMs;
    expect(spent).toBeGreaterThan(15);
    find(root, 'main').textContent = 'during the pause';
    await resumed(replay);
    expect(replay.paused).toBe(false);
    find(root, 'main').textContent = 'after the pause';
    await sleep(50);
    const events = replay.events();
    const gap = events.findIndex((event) => event === events.find((e) => PAUSED([e]).length > 0));
    expect(events[gap + 1]?.type).toBe(EventType.Meta);
    expect(events[gap + 2]?.type).toBe(EventType.FullSnapshot);
    const json = JSON.stringify(events);
    expect(json).toContain('after the pause');
    expect(json.slice(0, json.indexOf('probara/replay-paused'))).not.toContain('during the pause');
    expect(replay.health.pauses).toBe(1);
  });

  it('waits twice as long after each pause, up to the checkout interval', async () => {
    mount('<main></main>');
    const replay = createReplayRecorder({
      mode: 'rolling',
      checkoutMs: 300,
      lookbackMs: 60_000,
      budget: budget(100),
    });
    recorders.push(replay);
    replay.start();
    const waits: (number | undefined)[] = [];
    for (let i = 0; i < 3; i += 1) {
      await burst();
      waits.push(resumeInOf(PAUSED(replay.events()).at(-1)));
      await resumed(replay);
    }
    expect(waits).toEqual([100, 200, 300]);
  });

  it('resumes no more once stopped, and starts over unpaused', async () => {
    mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', budget: budget(100) });
    recorders.push(replay);
    replay.start();
    await burst();
    expect(replay.paused).toBe(true);
    replay.stop();
    expect(replay.paused).toBe(false);
    const held = replay.events().length;
    await sleep(200);
    expect(replay.active).toBe(false);
    expect(replay.events()).toHaveLength(held);
    replay.start();
    expect(replay.paused).toBe(false);
    expect(replay.health.pauses).toBe(0);
  });

  it('waits for the resume when what is blurred changes during a pause', async () => {
    const root = mount('<main><p class="later">secret-later</p></main>');
    const blur = createBlurController();
    blurs.push(blur);
    const replay = createReplayRecorder({ mode: 'rolling', blur, budget: budget(150) });
    recorders.push(replay);
    replay.start();
    await burst();
    expect(replay.paused).toBe(true);
    blur.blur('.later');
    await sleep(20);
    expect(replay.paused).toBe(true);
    expect(count(replay.events(), EventType.FullSnapshot)).toBe(1);
    await resumed(replay);
    await sleep(20);
    expect(count(replay.events(), EventType.FullSnapshot)).toBe(2);
    expect(lastFullSnapshot(replay.events())).not.toContain('secret-later');
    expect(root.isConnected).toBe(true);
  });
});

describe('a busy page, with snapshots in view', () => {
  it('never pauses for a full snapshot, nor for changes that cost less than one', async () => {
    const list = mountOrderList(document);
    const replay = createReplayRecorder({
      mode: 'rolling',
      checkoutMs: 150,
      budget: { windowMs: 1_000, mainThreadMs: 1, pauseMs: 100 },
    });
    recorders.push(replay);
    replay.start();
    // Checkouts of the heavy page, and one small change after another, each far under a snapshot.
    await keepChanging(mount('<main></main>'), 500);
    list.remove();
    expect(replay.health.checkouts).toBeGreaterThan(2);
    expect(replay.health.pauses).toBe(0);
  });
});
