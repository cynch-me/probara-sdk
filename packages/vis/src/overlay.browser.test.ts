/**
 * The overlay's words for the state of a recording, in a real page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RecorderSnapshot } from './controller.js';
import type { PanelSnapshot } from './overlay.js';
import { stringsFor } from './i18n.js';
import { createOverlay, type Overlay, type OverlayHandlers } from './overlay.js';

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
    expect(root.textContent).toContain(
      'This recording cannot be played, so it cannot be sent. Record again or discard it.',
    );
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
    expect(root.textContent).toContain(
      'Esta grabación no se puede reproducir, así que no se puede enviar. Graba de nuevo o descártala.',
    );
    expect(shows(root, 'Enviar')).toBe(false);
    expect(shows(root, 'Grabar de nuevo')).toBe(true);
    expect(shows(root, 'Descartar')).toBe(true);
  });

  it('links to Probara Vis with its mark at the top of the panel, in a new tab', () => {
    const root = show({ state: 'ready' });
    const link = root.querySelector('a');
    expect(link?.textContent).toBe('Probara Vis');
    expect(link?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const heading = [...root.querySelectorAll('*')].find(
      (node) => node.textContent === 'Ready to record?' && node.children.length === 0,
    );
    expect(link?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      heading?.getBoundingClientRect().top ?? 0,
    );
    expect(link?.href).toBe('https://probara.net/');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
  });
});

describe('the overlay of a recording', () => {
  function open(
    snapshot: Partial<RecorderSnapshot>,
    locale: 'en' | 'es' = 'en',
    on: Partial<OverlayHandlers> = {},
  ): Overlay {
    const overlay = createOverlay(document, stringsFor(locale), { ...handlers, ...on }, 'open');
    overlays.push(overlay);
    overlay.render({
      state: 'ready',
      link: null,
      title: '',
      microphone: false,
      maxDurationMs: 300_000,
      stopReason: null,
      recording: null,
      originRefused: false,
      ...snapshot,
    });
    return overlay;
  }

  it('shows the microphone as a switch named Microphone', () => {
    const turned: boolean[] = [];
    const root = open({ state: 'ready' }, 'en', {
      onMicrophone: (on: boolean) => turned.push(on),
    }).root;
    const toggle = root.querySelector<HTMLButtonElement>('[role="switch"]');
    const label = root.getElementById(toggle?.getAttribute('aria-labelledby') ?? '');
    expect(label?.textContent).toBe('Microphone');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    toggle?.click();
    expect(turned).toEqual([true]);
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(
      open({ state: 'ready', microphone: true }, 'es')
        .root.querySelector('[role="switch"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(open({ state: 'ready' }, 'es').root.textContent).toContain('Micrófono');
  });

  it('keeps the ready card while the share picker is open, its button busy', () => {
    const recorded: string[] = [];
    const root = open({ state: 'starting' }, 'en', {
      onRecord: () => recorded.push('record'),
    }).root;
    expect(root.textContent).toContain('Ready to record?');
    const busy = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Choose this tab to share it…',
    );
    expect(busy?.closest('[hidden]')).toBeNull();
    expect(busy?.disabled).toBe(true);
    busy?.click();
    expect(recorded).toEqual([]);
    expect(root.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
  });

  it('shows whether it is recording or paused, and the time against the limit', () => {
    const overlay = open({ state: 'recording' });
    expect(overlay.root.textContent).toContain('Recording');
    expect(overlay.root.textContent).toContain('0:00 of 5:00');
    overlay.tick(42_000, 300_000);
    expect(overlay.root.textContent).toContain('0:42 of 5:00');
    expect(overlay.root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '14',
    );
    overlay.render({
      state: 'paused',
      link: null,
      title: '',
      microphone: false,
      maxDurationMs: 300_000,
      stopReason: null,
      recording: null,
      originRefused: false,
    });
    expect(overlay.root.textContent).toContain('Paused');
    expect(overlay.root.textContent).toContain('0:42 of 5:00');
    const spanish = open({ state: 'paused' }, 'es').root.textContent;
    expect(spanish).toContain('En pausa');
    expect(spanish).toContain('0:00 de 5:00');
    expect(open({ state: 'recording' }, 'es').root.textContent).toContain('Grabando');
  });

  it('titles the ends of a recording link and says what to do next', () => {
    const text = (state: RecorderSnapshot['state'], locale: 'en' | 'es' = 'en') =>
      open({ state }, locale).root.textContent;
    expect(text('unavailable')).toContain('This link is not available');
    expect(text('unavailable')).toContain('Ask whoever sent it for a new link.');
    expect(text('busy')).toContain('This link is busy');
    expect(text('busy')).toContain('Try again in a few minutes.');
    expect(text('unsupported', 'es')).toContain('Este navegador no puede grabar la pantalla');
    expect(text('unsupported', 'es')).toContain(
      'Abre el enlace en un navegador de escritorio actualizado.',
    );
    expect(text('unsupported')).toContain('Open the link in an up-to-date desktop browser.');
    expect(text('done')).toContain('Recording sent');
    expect(text('done', 'es')).toContain('Grabación enviada');
  });

  it('asks in place of the review, and shows the review again on Cancel', () => {
    const root = open({ state: 'review', recording: new Blob(['x']) }).root;
    const video = root.querySelector('video');
    expect(video?.closest('[hidden]')).toBeNull();
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Record again')?.click();
    expect(root.textContent).toContain('Record again?');
    expect(video?.closest('[hidden]')).not.toBeNull();
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')?.click();
    expect(video?.closest('[hidden]')).toBeNull();
  });

  it("follows the page's dark color scheme", () => {
    const luminance = (root: ShadowRoot): number => {
      const card = root.querySelector('[role="dialog"]');
      const [r = 0, g = 0, b = 0] = (
        getComputedStyle(card as Element).backgroundColor.match(/[\d.]+/g) ?? []
      ).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    expect(luminance(open({ state: 'ready' }).root)).toBeGreaterThan(0.8);
    document.documentElement.style.colorScheme = 'dark';
    try {
      expect(luminance(open({ state: 'ready' }).root)).toBeLessThan(0.2);
    } finally {
      document.documentElement.style.colorScheme = '';
    }
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
        },
      },
      'en',
      { onSend: (description?: string) => sent.push(description) },
    );
    const text = root.textContent;
    expect(text).toContain('Send what just happened?');
    expect(text).toContain('Covers the last 3:12');
    expect(text).toContain('Page: shop.example.com/cart');
    expect(text).not.toContain('Optional: what you were doing and what went wrong.');
    expect(text).not.toContain('Console errors');
    expect(text).not.toContain('Failed requests');
    const field = root.querySelector('textarea');
    expect(field?.maxLength).toBe(2000);
    expect(root.querySelector(`label[for="${field?.id ?? ''}"]`)?.textContent).toBe(
      'What happened?',
    );
    expect(visibleButtons(root)).toEqual(['Discard', 'Send', 'Close']);
    if (field !== null) field.value = '  The total was wrong  ';
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Send')?.click();
    expect(sent).toEqual(['The total was wrong']);
  });

  it('asks before discarding an instant replay, in Spanish too', () => {
    const discarded: string[] = [];
    const root = panel(
      {
        state: 'replay-review',
        replay: { durationMs: 5000, page: 'tienda.example/' },
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
    const replay = { durationMs: 1000, page: 'a.test/' };
    expect(panel({ state: 'sending', replay }).textContent).toContain(
      'Sending what just happened…',
    );
    expect(said({ state: 'done', replay }, 'es')).toBe('¡Gracias! Tu reporte se envió.');
  });

  it('keeps the recording link wording without the widget', () => {
    expect(show({ state: 'unavailable' }).textContent).toContain('This link is not available');
  });
});
