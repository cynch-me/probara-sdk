/** The recorder's words, in English and Spanish, chosen from the browser language. */

export type Locale = 'en' | 'es';

export interface Strings {
  recorder: string;
  /** The ready card's heading. */
  ready: string;
  /** The microphone toggle: what a click does. */
  unmuteMicrophone: string;
  muteMicrophone: string;
  /** The small brand link under the panel. */
  brand: string;
  record: string;
  pause: string;
  resume: string;
  stop: string;
  /** The recording watched before it is sent. */
  review: string;
  player: string;
  /** The recording the player could not play: only Record again and Discard are offered. */
  unplayable: string;
  unplayableBody: string;
  send: string;
  recordAgain: string;
  recordAgainTitle: string;
  recordAgainBody: string;
  discard: string;
  discardTitle: string;
  discardBody: string;
  cancel: string;
  close: string;
  loading: string;
  starting: string;
  paused: string;
  sending: string;
  done: string;
  unavailable: string;
  busy: string;
  failed: string;
  /**
   * The link got no answer from a page on another origin than the API: the intake refused the
   * page's domain or the organizations it names.
   */
  originRefused: (domain: string) => string;
  unsupported: string;
  /** Why the recording stopped by itself, shown while it is watched, sent and once it is. */
  sizeLimit: string;
  timeLimit: string;
}

const EN: Strings = {
  recorder: 'Probara Vis recorder',
  ready: 'Ready to record?',
  unmuteMicrophone: 'Unmute mic',
  muteMicrophone: 'Mute mic',
  brand: 'Probara Vis',
  record: 'Start recording',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  review: 'Ready to send?',
  player: 'Your recording',
  unplayable: 'This recording cannot be played',
  unplayableBody: 'Record again, or discard it. Nothing is sent.',
  send: 'Send',
  recordAgain: 'Record again',
  recordAgainTitle: 'Record again?',
  recordAgainBody: 'This recording is deleted and nothing is sent. This cannot be undone.',
  discard: 'Discard',
  discardTitle: 'Discard this recording?',
  discardBody: 'What you recorded is deleted and nothing is sent. This cannot be undone.',
  cancel: 'Cancel',
  close: 'Close',
  loading: 'Loading…',
  starting: 'Choose this tab to share it…',
  paused: 'Paused',
  sending: 'Sending your recording…',
  done: 'Thank you! Your recording was sent.',
  unavailable: 'This recording link is not available.',
  busy: 'Too many recordings right now. Try again in a few minutes.',
  failed: 'Your recording could not be sent. Nothing was kept.',
  originRefused: (domain) =>
    `This page cannot record: ${domain} must be a recording domain of the organization in Probara, and the page must name the organization in the recorder's organizations option.`,
  unsupported: 'This browser cannot record the screen. Open this link in a desktop browser.',
  sizeLimit: 'The recording stopped because it reached the largest size allowed.',
  timeLimit: 'The recording stopped because it reached the time limit.',
};

const ES: Strings = {
  recorder: 'Grabadora de Probara Vis',
  ready: '¿Todo listo para grabar?',
  unmuteMicrophone: 'Activar micrófono',
  muteMicrophone: 'Silenciar micrófono',
  brand: 'Probara Vis',
  record: 'Empezar a grabar',
  pause: 'Pausar',
  resume: 'Reanudar',
  stop: 'Detener',
  review: '¿Todo listo para enviar?',
  player: 'Tu grabación',
  unplayable: 'Esta grabación no se puede reproducir',
  unplayableBody: 'Graba de nuevo o descártala. No se envía nada.',
  send: 'Enviar',
  recordAgain: 'Grabar de nuevo',
  recordAgainTitle: '¿Grabar de nuevo?',
  recordAgainBody: 'Esta grabación se elimina y no se envía nada. No se puede deshacer.',
  discard: 'Descartar',
  discardTitle: '¿Descartar esta grabación?',
  discardBody: 'Lo que grabaste se elimina y no se envía nada. No se puede deshacer.',
  cancel: 'Cancelar',
  close: 'Cerrar',
  loading: 'Cargando…',
  starting: 'Elige esta pestaña para compartirla…',
  paused: 'En pausa',
  sending: 'Enviando tu grabación…',
  done: '¡Gracias! Tu grabación se envió.',
  unavailable: 'Este enlace de grabación no está disponible.',
  busy: 'Hay demasiadas grabaciones en este momento. Inténtalo de nuevo en unos minutos.',
  failed: 'No se pudo enviar tu grabación. No se guardó nada.',
  originRefused: (domain) =>
    `Esta página no puede grabar: ${domain} debe ser un dominio de grabación de la organización en Probara, y la página debe indicar la organización en la opción organizations de la grabadora.`,
  unsupported:
    'Este navegador no puede grabar la pantalla. Abre este enlace en un navegador de escritorio.',
  sizeLimit: 'La grabación se detuvo porque alcanzó el tamaño máximo permitido.',
  timeLimit: 'La grabación se detuvo porque alcanzó el tiempo máximo.',
};

/** The strings of `locale`, or of the browser language: Spanish for `es` and its regions, English otherwise. */
export function stringsFor(locale?: Locale): Strings {
  if (locale !== undefined) return locale === 'es' ? ES : EN;
  try {
    const language = typeof navigator === 'undefined' ? '' : navigator.language;
    return language.toLowerCase().startsWith('es') ? ES : EN;
  } catch {
    return EN;
  }
}
