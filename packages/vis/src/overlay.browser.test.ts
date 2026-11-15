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
  onMicrophone: noop,
  onRecord: noop,
  onPause: noop,
  onResume: noop,
  onStop: noop,
  onSend: noop,
  onRecordAgain: noop,
  onDiscard: noop,
  onClose: noop,
};

function show(
  snapshot: Partial<RecorderSnapshot>,
  locale: 'en' | 'es' = 'en',
  on: Partial<typeof handlers> = {},
): ShadowRoot {
  const overlay = createOverlay(document, stringsFor(locale), { ...handlers, ...on }, 'open');
  overlays.push(overlay);
  overlay.render({
    state: 'sending',
    link: null,
    title: '',
    microphone: false,
    maxDurationMs: 0,
    stopReason: null,
    recording: null,
    originRefused: false,
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

  it('says a limit stopped the recording while it is watched', () => {
    expect(
      show({ state: 'review', stopReason: 'time_limit', recording: new Blob(['x']) }).textContent,
    ).toContain('The recording stopped because it reached the time limit.');
  });

  function visible(root: ShadowRoot, name: string): HTMLButtonElement {
    const found = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === name && candidate.closest('[hidden]') === null,
    );
    if (found === undefined) throw new Error(`no visible button "${name}"`);
    return found;
  }

  it('asks before discarding a watched recording, with the focus on Cancel, and Escape backs out', () => {
    const asked: string[] = [];
    const root = show({ state: 'review', recording: new Blob(['x']) }, 'es', {
      onDiscard: () => asked.push('discard'),
    });
    const opener = visible(root, 'Descartar');
    opener.focus();
    opener.click();
    expect(root.textContent).toContain('¿Descartar esta grabación?');
    expect(root.textContent).toContain('No se puede deshacer.');
    expect(root.activeElement).toBe(visible(root, 'Cancelar'));
    expect(asked).toEqual([]);
    root.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(root.activeElement).toBe(opener);
    expect(() => visible(root, 'Cancelar')).toThrow();
    expect(asked).toEqual([]);
    visible(root, 'Descartar').click();
    visible(root, 'Descartar').click();
    expect(asked).toEqual(['discard']);
  });

  it('discards at once while recording, as before', () => {
    const asked: string[] = [];
    const root = show({ state: 'recording' }, 'en', { onDiscard: () => asked.push('discard') });
    visible(root, 'Discard').click();
    expect(asked).toEqual(['discard']);
    expect(root.textContent).not.toContain('Discard this recording?');
  });

  /** Whether a button with this text is shown. */
  function shows(root: ShadowRoot, name: string): boolean {
    return [...root.querySelectorAll('button')].some(
      (candidate) => candidate.textContent === name && candidate.closest('[hidden]') === null,
    );
  }

  async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  const undecodable = (): Blob => new Blob(['this is not a video'], { type: 'video/webm' });

  it('offers only Record again and Discard for a recording that cannot be played', async () => {
    const root = show({ state: 'review', recording: undecodable() });
    await until(() => root.textContent.includes('cannot be played'));
    expect(root.textContent).toContain('This recording cannot be played');
    expect(root.textContent).toContain('Record again, or discard it. Nothing is sent.');
    expect(root.textContent).not.toContain('Ready to send?');
    expect(shows(root, 'Send')).toBe(false);
    expect(shows(root, 'Record again')).toBe(true);
    expect(shows(root, 'Discard')).toBe(true);
    // Backing out of a confirmation does not bring Send back.
    visible(root, 'Discard').click();
    visible(root, 'Cancel').click();
    expect(shows(root, 'Send')).toBe(false);
    expect(shows(root, 'Discard')).toBe(true);
  });

  it('says so in Spanish too', async () => {
    const root = show({ state: 'review', recording: undecodable() }, 'es');
    await until(() => root.textContent.includes('no se puede reproducir'));
    expect(root.textContent).toContain('Esta grabación no se puede reproducir');
    expect(root.textContent).toContain('Graba de nuevo o descártala. No se envía nada.');
    expect(shows(root, 'Enviar')).toBe(false);
    expect(shows(root, 'Grabar de nuevo')).toBe(true);
    expect(shows(root, 'Descartar')).toBe(true);
  });

  it('links to Probara Vis under the panel, in a new tab', () => {
    const link = show({ state: 'ready' }).querySelector('a');
    expect(link?.textContent).toBe('Probara Vis');
    expect(link?.href).toBe('https://probara.net/');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
  });
});
