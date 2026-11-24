/**
 * The DOM replay recorder in a real Chromium page, on rrweb: the rolling buffer keeps the last
 * segments, the full mode keeps everything, and what is typed, secret or blurred never reaches
 * the events.
 */
import { EventType, IncrementalSource } from '@rrweb/types';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ASSET_LIST_SHAPE, mountAssetList } from '@probara/test-support/asset-list';
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

describe('the asset list fixture', () => {
  type SnapshotNode = {
    tagName?: string;
    attributes?: Record<string, unknown>;
    childNodes?: SnapshotNode[];
  };
  function nodesOf(node: SnapshotNode): SnapshotNode[] {
    return [node, ...(node.childNodes ?? []).flatMap(nodesOf)];
  }

  it('snapshots like the asset list of VIS-20, its stylesheet inlined', async () => {
    const list = await mountAssetList(document);
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    replay.stop();
    list.remove();
    const snapshot = replay.events().find((event) => event.type === EventType.FullSnapshot);
    const nodes = nodesOf((snapshot?.data as { node: SnapshotNode }).node);
    const tagged = (tag: string) => nodes.filter((node) => node.tagName === tag).length;
    expect(tagged('td')).toBe(ASSET_LIST_SHAPE.rows * ASSET_LIST_SHAPE.cellsPerRow);
    expect(tagged('input')).toBe(700);
    expect(nodes.length).toBeGreaterThan(35_000);
    expect(nodes.length).toBeLessThan(37_000);
    const inlined = nodes
      .filter((node) => node.tagName === 'link')
      .map((node) =>
        typeof node.attributes?._cssText === 'string' ? node.attributes._cssText.length : 0,
      );
    expect(Math.max(...inlined)).toBeGreaterThan(ASSET_LIST_SHAPE.cssBytes);
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
  const resumeWithinOf = (event: ReplayEvent | undefined): number | undefined =>
    (event?.data as { payload?: { resumeWithinMs?: number } } | undefined)?.payload?.resumeWithinMs;
  /**
   * A budget far under what the order list's rendering costs, that pauses in its first busy window,
   * and a first pause of `pauseMs` at most.
   */
  const budget = (pauseMs: number) => ({
    windowMs: 1_000,
    mainThreadMs: 5,
    busyWindows: 1,
    pauseMs,
  });
  async function burst(): Promise<void> {
    const list = mountOrderList(document, { cssBytes: 0 });
    await sleep(20);
    list.remove();
  }
  async function resumed(replay: ReplayRecorder): Promise<void> {
    const end = performance.now() + 5_000;
    while (replay.paused && performance.now() < end) await sleep(10);
  }

  it('keeps recording through the order list re-render that stopped VIS-19', async () => {
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
      payload: { reason: 'busy', windowMs: 1_000, busyWindows: 1, resumeWithinMs: 200 },
    });
    const spent = (paused?.data as { payload: { mainThreadMs: number } }).payload.mainThreadMs;
    expect(spent).toBeGreaterThan(5);
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

  it(
    'waits twice as long after each pause, up to the checkout interval',
    { timeout: 15_000 },
    async () => {
      mount('<main></main>');
      // A checkout interval far longer than a burst on a loaded machine, so no wait starts over.
      const replay = createReplayRecorder({
        mode: 'rolling',
        checkoutMs: 2_000,
        lookbackMs: 60_000,
        budget: budget(500),
      });
      recorders.push(replay);
      replay.start();
      const waits: (number | undefined)[] = [];
      for (let i = 0; i < 3; i += 1) {
        await burst();
        waits.push(resumeWithinOf(PAUSED(replay.events()).at(-1)));
        await resumed(replay);
      }
      expect(waits).toEqual([500, 1_000, 2_000]);
    },
  );

  it(
    'starts the wait over once a whole checkout interval records without a pause',
    { timeout: 15_000 },
    async () => {
      mount('<main></main>');
      const replay = createReplayRecorder({
        mode: 'rolling',
        checkoutMs: 2_000,
        lookbackMs: 60_000,
        budget: budget(500),
      });
      recorders.push(replay);
      replay.start();
      const waits: (number | undefined)[] = [];
      for (let i = 0; i < 2; i += 1) {
        await burst();
        waits.push(resumeWithinOf(PAUSED(replay.events()).at(-1)));
        await resumed(replay);
      }
      await sleep(2_100);
      await burst();
      waits.push(resumeWithinOf(PAUSED(replay.events()).at(-1)));
      expect(waits).toEqual([500, 1_000, 500]);
    },
  );

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

  it(
    'waits for the resume when what is blurred changes during a pause',
    { timeout: 15_000 },
    async () => {
      const root = mount('<main><p class="later">secret-later</p></main>');
      const blur = createBlurController();
      blurs.push(blur);
      const replay = createReplayRecorder({ mode: 'rolling', blur, budget: budget(1_000) });
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
    },
  );
});

describe('a busy page, with snapshots in view', () => {
  it('never counts a full snapshot against the budget', { timeout: 15_000 }, async () => {
    const list = mountOrderList(document);
    const replay = createReplayRecorder({
      mode: 'rolling',
      checkoutMs: 150,
      budget: { windowMs: 1_000, mainThreadMs: 20, busyWindows: 1, pauseMs: 100 },
    });
    recorders.push(replay);
    replay.start();
    // Checkouts of the heavy page, each over the budget, driven by one small change at a time.
    const root = mount('<main></main>');
    const end = performance.now() + 10_000;
    for (let i = 0; replay.health.checkouts <= 2 && performance.now() < end; i += 1) {
      find(root, 'main').textContent = `change ${String(i)}`;
      await sleep(100);
    }
    list.remove();
    expect(replay.health.checkouts).toBeGreaterThan(2);
    expect(replay.health.longestSnapshotMs).toBeGreaterThan(20);
    expect(replay.health.pauses).toBe(0);
  });
});

describe('the navigations of VIS-20', () => {
  it('keeps both lists with the default budget', { timeout: 15_000 }, async () => {
    const root = mount('<main>home</main>');
    const replay = createReplayRecorder({ mode: 'rolling', budget: REPLAY_BUDGET });
    recorders.push(replay);
    replay.start();
    find(root, 'main').textContent = '';
    const orders = mountOrderList(document);
    orders.render(1);
    await sleep(300);
    orders.remove();
    const assets = await mountAssetList(document);
    await sleep(300);
    find(root, 'main').textContent = 'after both lists';
    await sleep(50);
    assets.remove();
    expect(replay.paused).toBe(false);
    expect(replay.health.pauses).toBe(0);
    const json = JSON.stringify(replay.events());
    expect(json).toContain('1-0-0-0');
    expect(json).toContain('field 34');
    expect(json).toContain('after both lists');
  });
});

describe('a page that keeps re-rendering', () => {
  /** Windows short enough for a test, a budget under one re-render, and a long longest pause. */
  const budget = { windowMs: 500, mainThreadMs: 20, busyWindows: 3, pauseMs: 10_000 };
  async function rerender(list: { render(seed: number): void }, ms: number): Promise<void> {
    const end = performance.now() + ms;
    for (let seed = 1; performance.now() < end; seed += 1) {
      list.render(seed);
      await sleep(100);
    }
  }
  async function until(check: () => boolean, ms: number): Promise<void> {
    const end = performance.now() + ms;
    while (!check() && performance.now() < end) await sleep(10);
  }

  it(
    'pauses once busy for three windows in a row, while it stays busy, and resumes once calm',
    { timeout: 30_000 },
    async () => {
      const list = mountOrderList(document, { cssBytes: 0 });
      roots.push(list.root);
      const replay = createReplayRecorder({ mode: 'rolling', budget });
      recorders.push(replay);
      replay.start();
      const started = performance.now();
      const end = started + 10_000;
      while (!replay.paused && performance.now() < end) await rerender(list, 100);
      expect(replay.paused).toBe(true);
      expect(performance.now() - started).toBeGreaterThan(2 * budget.windowMs - 50);
      const paused = replay.events().at(-1);
      expect(paused?.data).toMatchObject({
        tag: REPLAY_PAUSED_TAG,
        payload: { reason: 'busy', windowMs: 500, busyWindows: 3, resumeWithinMs: 10_000 },
      });
      await rerender(list, 4 * budget.windowMs);
      expect(replay.paused).toBe(true);
      const calmFrom = performance.now();
      await until(() => !replay.paused, budget.pauseMs);
      expect(replay.paused).toBe(false);
      expect(performance.now() - calmFrom).toBeLessThan(budget.pauseMs / 2);
      const events = replay.events();
      const gap = events.findIndex((event) => event === paused);
      expect(events[gap + 1]?.type).toBe(EventType.Meta);
      expect(events[gap + 2]?.type).toBe(EventType.FullSnapshot);
      list.render(99);
      await sleep(50);
      expect(replay.paused).toBe(false);
      expect(replay.health.pauses).toBe(1);
    },
  );
});
