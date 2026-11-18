/**
 * The script-tag build's replay loader: the engine's published replay script of the bundled
 * version, appended once, read from the global it sets. The script is never really fetched here.
 */
import { VERSION as CAPTURE_VERSION } from '@probara/vis-capture';
import { afterEach, describe, expect, it, vi } from 'vitest';

const GLOBAL = 'ProbaraVisCaptureReplay';

afterEach(() => {
  Reflect.deleteProperty(globalThis, GLOBAL);
  vi.restoreAllMocks();
});

/** A fresh loader, and the scripts it appends, kept out of the page. */
let instances = 0;

async function loader() {
  const appended: HTMLScriptElement[] = [];
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    for (const node of nodes) if (node instanceof HTMLScriptElement) appended.push(node);
  });
  // A query makes a fresh instance of the module, with nothing loaded yet.
  instances += 1;
  const module = (await import(
    /* @vite-ignore */ `./replay-script.js?instance=${String(instances)}`
  )) as typeof import('./replay-script.js');
  return { ...module, appended };
}

const fakeModule = { createReplayRecorder: () => undefined };

describe('loadReplayScript', () => {
  it('appends the replay script of the bundled engine version and reads its global on load', async () => {
    const { loadReplayScript, REPLAY_SCRIPT_URL, appended } = await loader();
    expect(REPLAY_SCRIPT_URL).toBe(
      `https://cdn.jsdelivr.net/npm/@probara/vis-capture@${CAPTURE_VERSION}/dist/vis-capture-replay.iife.js`,
    );
    const loading = loadReplayScript();
    expect(loadReplayScript()).toBe(loading);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe(REPLAY_SCRIPT_URL);
    expect(appended[0]?.crossOrigin).toBe('anonymous');
    Reflect.set(globalThis, GLOBAL, fakeModule);
    appended[0]?.dispatchEvent(new Event('load'));
    await expect(loading).resolves.toBe(fakeModule);
  });

  it('rejects when the script cannot load or sets no recorder, and tries again next time', async () => {
    const { loadReplayScript, appended } = await loader();
    const refused = loadReplayScript();
    appended[0]?.dispatchEvent(new Event('error'));
    await expect(refused).rejects.toThrow('could not load');
    const empty = loadReplayScript();
    expect(appended).toHaveLength(2);
    appended[1]?.dispatchEvent(new Event('load'));
    await expect(empty).rejects.toThrow('set no recorder');
    void loadReplayScript().catch(() => undefined);
    expect(appended).toHaveLength(3);
  });

  it('appends nothing when the replay script is already on the page', async () => {
    Reflect.set(globalThis, GLOBAL, fakeModule);
    const { loadReplayScript, appended } = await loader();
    await expect(loadReplayScript()).resolves.toBe(fakeModule);
    expect(appended).toEqual([]);
  });
});
