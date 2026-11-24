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
  REPLAY_HEALTH_TAG,
  REPLAY_MUTATION_LIMIT,
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

  it('in rolling mode keeps only the current and the previous segment', async () => {
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

  it('stops a rolling replay past its mutation limit, keeping what it held and why', async () => {
    expect(REPLAY_MUTATION_LIMIT).toBe(10_000);
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', mutationLimit: 50 });
    recorders.push(replay);
    replay.start();
    expect(replay.stopReason).toBeNull();
    for (let i = 0; i < 5; i += 1) {
      root.replaceChildren(
        ...Array.from({ length: 20 }, (_, n) => {
          const line = document.createElement('p');
          line.textContent = `burst ${String(i)}-${String(n)}`;
          return line;
        }),
      );
      await sleep(20);
    }
    expect(replay.active).toBe(false);
    expect(replay.stopReason).toBe('mutation_limit');
    const events = replay.events();
    expect(events[1]?.type).toBe(EventType.FullSnapshot);
    const last = events.at(-1);
    expect(last?.type).toBe(EventType.Custom);
    expect(last?.data).toEqual({
      tag: 'probara/replay-stopped',
      payload: { reason: 'mutation_limit', limit: 50 },
    });
    const held = events.length;
    await keepChanging(root, 100);
    expect(replay.events()).toHaveLength(held);
  });

  it('counts mutations per segment, so a checkout starts the count over', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'rolling', checkoutMs: 100, mutationLimit: 30 });
    recorders.push(replay);
    replay.start();
    // One replaced line is two mutation records; about eight per segment stays under the limit.
    await keepChanging(root, 600);
    expect(replay.active).toBe(true);
    expect(replay.stopReason).toBeNull();
  });

  it('starts over with no stop reason', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'full', mutationLimit: 5 });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 150);
    expect(replay.stopReason).toBe('mutation_limit');
    replay.start();
    expect(replay.active).toBe(true);
    expect(replay.stopReason).toBeNull();
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

  it('re-renders as one batch shaped like the one that stopped VIS-19', async () => {
    const list = mountOrderList(document);
    const replay = createReplayRecorder({ mode: 'full' });
    recorders.push(replay);
    replay.start();
    list.render(1);
    await sleep(50);
    replay.stop();
    list.remove();
    const events = replay.events();
    const batches = mutationsIn(events);
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (batch === undefined) throw new Error('no mutation batch');
    expect(records(batch)).toBeGreaterThan(REPLAY_MUTATION_LIMIT);
    expect(records(batch)).toBe(11_000);
    const comments = batch.adds.filter((add) => add.node.type === 5).length;
    expect(comments).toBe(ORDER_LIST_SHAPE.rows * ORDER_LIST_SHAPE.commentsPerRow);
    const snapshot = events.find((event) => event.type === EventType.FullSnapshot);
    expect(JSON.stringify(snapshot).length).toBeGreaterThan(ORDER_LIST_SHAPE.cssBytes);
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
    expect(health.stopReason).toBeNull();
    expect(health.checkouts).toBe(1);
    expect(health.size).toBe(sizeOf(events));
    expect(health.recordedSize).toBe(health.size);
    const batch = events.find((event) => event.type === EventType.IncrementalSnapshot);
    expect(health.largestBatch?.records).toBe(11_000);
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

  it('reports why it stopped', async () => {
    const root = mount('<main></main>');
    const replay = createReplayRecorder({ mode: 'full', mutationLimit: 5 });
    recorders.push(replay);
    replay.start();
    await keepChanging(root, 150);
    expect(replay.health.stopReason).toBe('mutation_limit');
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
