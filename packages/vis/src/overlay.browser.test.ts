/**
 * The overlay's words for the state of a recording, in a real page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RecorderSnapshot } from './controller.js';
import { stringsFor } from './i18n.js';
import { createOverlay, type Overlay } from './overlay.js';

const overlays: Overlay[] = [];

afterEach(() => {
  for (const overlay of overlays.splice(0)) overlay.remove();
});

const noop = (): void => undefined;
const handlers = {
  onTitle: noop,
  onMicrophone: noop,
  onRecord: noop,
  onPause: noop,
  onResume: noop,
  onStop: noop,
  onDiscard: noop,
  onClose: noop,
};

function show(snapshot: Partial<RecorderSnapshot>, locale: 'en' | 'es' = 'en'): ShadowRoot {
  const overlay = createOverlay(document, stringsFor(locale), handlers, 'open');
  overlays.push(overlay);
  overlay.render({
    state: 'sending',
    link: null,
    title: '',
    microphone: false,
    maxDurationMs: 0,
    stopReason: null,
    ...snapshot,
  });
  return overlay.root;
}

describe('the overlay', () => {
  it('tells the visitor a limit stopped the recording, while it is sent and once it is', () => {
    expect(show({ state: 'sending', stopReason: 'size_limit' }).textContent).toContain(
      'The recording stopped because it reached the largest size allowed.',
    );
    expect(show({ state: 'done', stopReason: 'time_limit' }, 'es').textContent).toContain(
      'La grabación se detuvo porque alcanzó el tiempo máximo.',
    );
    expect(show({ state: 'done', stopReason: null }).textContent).not.toContain('stopped because');
  });
});
