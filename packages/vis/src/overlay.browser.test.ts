/**
 * The overlay's words for the state of a recording, in a real page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RecorderSnapshot } from './controller.js';
import type { PanelSnapshot } from './overlay.js';
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

describe('the overlay of in-app reporting', () => {
  const visibleButtons = (root: ShadowRoot): string[] =>
    [...root.querySelectorAll('button')]
      .filter((candidate) => candidate.closest('[hidden]') === null)
      .map((candidate) => candidate.textContent);

  function panel(
    snapshot: Partial<PanelSnapshot>,
    locale: 'en' | 'es' = 'en',
    on: Record<string, (...args: never[]) => void> = {},
  ): ShadowRoot {
    const overlay = createOverlay(document, stringsFor(locale), { ...handlers, ...on }, 'open');
    overlays.push(overlay);
    overlay.render({
      state: 'choosing',
      link: null,
      title: '',
      microphone: false,
      maxDurationMs: 0,
      stopReason: null,
      recording: null,
      originRefused: false,
      refusal: null,
      widget: true,
      ...snapshot,
    });
    return overlay.root;
  }

  it('offers both modes, or only recording when there is no instant replay', () => {
    const chosen: string[] = [];
    const root = panel({ state: 'choosing', choices: { replay: true, record: true } }, 'en', {
      onChooseReplay: () => chosen.push('replay'),
      onChooseRecord: () => chosen.push('record'),
    });
    expect(root.textContent).toContain('What do you want to send?');
    expect(visibleButtons(root)).toEqual([
      'Send what just happened',
      'Record from the start',
      'Close',
    ]);
    for (const name of ['Send what just happened', 'Record from the start']) {
      [...root.querySelectorAll('button')].find((b) => b.textContent === name)?.click();
    }
    expect(chosen).toEqual(['replay', 'record']);
    expect(
      visibleButtons(panel({ state: 'choosing', choices: { replay: false, record: true } }, 'es')),
    ).toEqual(['Grabar desde el inicio', 'Cerrar']);
  });

  it('reviews an instant replay and sends it with what happened, up to 2,000 characters', () => {
    const sent: (string | undefined)[] = [];
    const root = panel(
      {
        state: 'replay-review',
        replay: {
          durationMs: 192_000,
          page: 'shop.example.com/cart',
          consoleErrors: 2,
          failedRequests: 1,
        },
      },
      'en',
      { onSend: (description?: string) => sent.push(description) },
    );
    const text = root.textContent;
    expect(text).toContain('Send what just happened?');
    expect(text).toContain('Covers the last 3:12');
    expect(text).toContain('Page: shop.example.com/cart');
    expect(text).toContain('Console errors: 2 · Failed requests: 1');
    const field = root.querySelector('textarea');
    expect(field?.maxLength).toBe(2000);
    expect(root.querySelector(`label[for="${field?.id ?? ''}"]`)?.textContent).toBe(
      'What happened?',
    );
    expect(visibleButtons(root)).toEqual(['Send', 'Discard']);
    if (field !== null) field.value = '  The total was wrong  ';
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Send')?.click();
    expect(sent).toEqual(['The total was wrong']);
  });

  it('asks before discarding an instant replay, in Spanish too', () => {
    const discarded: string[] = [];
    const root = panel(
      {
        state: 'replay-review',
        replay: { durationMs: 5000, page: 'tienda.example/', consoleErrors: 0, failedRequests: 0 },
      },
      'es',
      { onDiscard: () => discarded.push('discard') },
    );
    expect(root.textContent).toContain('Abarca los últimos 0:05');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Descartar')?.click();
    expect(discarded).toEqual([]);
    expect(root.textContent).toContain('¿Descartar lo que acaba de pasar?');
    const confirmed = [...root.querySelectorAll('.confirm button')].find(
      (b) => b.textContent === 'Descartar',
    ) as HTMLButtonElement | undefined;
    confirmed?.click();
    expect(discarded).toEqual(['discard']);
  });

  it('tells each refusal of the widget intake, and the widget wording of the other ends', () => {
    const said = (snapshot: Partial<PanelSnapshot>, locale: 'en' | 'es' = 'en') =>
      panel(snapshot, locale).querySelector('.message')?.textContent;
    expect(said({ state: 'unavailable', refusal: 'reporter_required' })).toBe(
      'Sign in to report a problem.',
    );
    expect(said({ state: 'unavailable', refusal: 'invalid_reporter' }, 'es')).toBe(
      'No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.',
    );
    expect(said({ state: 'busy', refusal: 'hourly_cap' })).toBe(
      'Too many reports were sent in the last hour. Try again later.',
    );
    expect(said({ state: 'busy', refusal: 'too_many_open' })).toBe(
      'You have too many reports still being sent. Try again when they finish.',
    );
    expect(said({ state: 'busy', refusal: 'rate_limited' }, 'es')).toBe(
      'Hay demasiadas solicitudes en este momento. Inténtalo de nuevo en unos minutos.',
    );
    expect(said({ state: 'unavailable' })).toBe('Reporting a problem is not available right now.');
    expect(said({ state: 'failed' })).toBe('Your report could not be sent. Nothing was kept.');
    expect(said({ state: 'unsupported' })).toBe(
      'This browser cannot record the screen, and there is nothing to send yet.',
    );
    const replay = { durationMs: 1000, page: 'a.test/', consoleErrors: 0, failedRequests: 0 };
    expect(said({ state: 'sending', replay })).toBe('Sending what just happened…');
    expect(said({ state: 'done', replay }, 'es')).toBe('¡Gracias! Tu reporte se envió.');
  });

  it('keeps the recording link wording without the widget', () => {
    expect(show({ state: 'unavailable' }).querySelector('.message')?.textContent).toBe(
      'This recording link is not available.',
    );
  });
});
