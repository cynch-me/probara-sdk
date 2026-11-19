/** The recorder's words, in English and Spanish, chosen from the browser language. */

export type Locale = 'en' | 'es';

export interface Strings {
  recorder: string;
  /** The ready card's heading. */
  ready: string;
  /** The microphone switch's label. */
  microphone: string;
  /** The brand link at the top of the panel. */
  brand: string;
  record: string;
  pause: string;
  resume: string;
  stop: string;
  /** The state while recording; `paused` while paused. */
  recording: string;
  /** The recorded time against the limit, both as `m:ss`. */
  timer: (elapsed: string, limit: string) => string;
  /** The recording watched before it is sent. */
  review: string;
  player: string;
  /** The recording the player could not play: only Record again and Discard are offered. */
  unplayable: string;
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
  /** A recording link's ends: a title, and below it what to do. */
  done: string;
  unavailable: string;
  unavailableBody: string;
  busy: string;
  busyBody: string;
  failed: string;
  /**
   * The link got no answer from a page on another origin than the API: the intake refused the
   * page's domain or the organizations it names.
   */
  originRefused: (domain: string) => string;
  unsupported: string;
  unsupportedBody: string;
  /** Why the recording stopped by itself, shown while it is watched, sent and once it is. */
  sizeLimit: string;
  timeLimit: string;
  /** In-app reporting: the launcher's label and the panel's name. */
  reportProblem: string;
  /** The choice of what to send, when the panel opens without a mode. */
  choose: string;
  sendWhatHappened: string;
  recordFromStart: string;
  /** The instant replay's review. */
  replayReview: string;
  /** How much the instant replay covers, as `m:ss`. */
  replaySpan: (duration: string) => string;
  replayPage: (page: string) => string;
  whatHappened: string;
  discardReplayTitle: string;
  discardReplayBody: string;
  sendingReplay: string;
  doneReplay: string;
  /** A widget the intake does not serve (unknown, revoked, or the plan allows no Vis). */
  widgetUnavailable: string;
  /** A browser that cannot record the screen, with no instant replay to send. */
  widgetUnsupported: string;
  /** A report that could not be sent. */
  widgetFailed: string;
  /** The widget intake's refusals. */
  reporterRequired: string;
  invalidReporter: string;
  hourlyCap: string;
  tooManyOpen: string;
  rateLimited: string;
}

const EN: Strings = {
  recorder: 'Probara Vis recorder',
  ready: 'Ready to record?',
  microphone: 'Microphone',
  brand: 'Probara Vis',
  record: 'Start recording',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  recording: 'Recording',
  timer: (elapsed, limit) => `${elapsed} of ${limit}`,
  review: 'Ready to send?',
  player: 'Your recording',
  unplayable: 'This recording cannot be played, so it cannot be sent. Record again or discard it.',
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
  done: 'Recording sent',
  unavailable: 'This link is not available',
  unavailableBody: 'Ask whoever sent it for a new link.',
  busy: 'This link is busy',
  busyBody: 'Try again in a few minutes.',
  failed: 'Your recording could not be sent. Nothing was kept.',
  originRefused: (domain) =>
    `This page cannot record: ${domain} must be a recording domain of the organization in Probara, and the page must name the organization in the recorder's organizations option.`,
  unsupported: 'This browser cannot record the screen',
  unsupportedBody: 'Open the link in an up-to-date desktop browser.',
  sizeLimit: 'The recording stopped because it reached the largest size allowed.',
  timeLimit: 'The recording stopped because it reached the time limit.',
  reportProblem: 'Report a problem',
  choose: 'What do you want to send?',
  sendWhatHappened: 'Send what just happened',
  recordFromStart: 'Record from the start',
  replayReview: 'Send what just happened?',
  replaySpan: (duration) => `Covers the last ${duration}`,
  replayPage: (page) => `Page: ${page}`,
  whatHappened: 'What happened?',
  discardReplayTitle: 'Discard what just happened?',
  discardReplayBody: 'Nothing is sent. This cannot be undone.',
  sendingReplay: 'Sending what just happened…',
  doneReplay: 'Thank you! Your report was sent.',
  widgetUnavailable: 'Reporting a problem is not available right now.',
  widgetUnsupported: 'This browser cannot record the screen, and there is nothing to send yet.',
  widgetFailed: 'Your report could not be sent. Nothing was kept.',
  reporterRequired: 'Sign in to report a problem.',
  invalidReporter: 'Your session could not be verified. Reload the page and try again.',
  hourlyCap: 'Too many reports were sent in the last hour. Try again later.',
  tooManyOpen: 'You have too many reports still being sent. Try again when they finish.',
  rateLimited: 'Too many requests right now. Try again in a few minutes.',
};

const ES: Strings = {
  recorder: 'Grabadora de Probara Vis',
  ready: '¿Todo listo para grabar?',
  microphone: 'Micrófono',
  brand: 'Probara Vis',
  record: 'Empezar a grabar',
  pause: 'Pausar',
  resume: 'Reanudar',
  stop: 'Detener',
  recording: 'Grabando',
  timer: (elapsed, limit) => `${elapsed} de ${limit}`,
  review: '¿Todo listo para enviar?',
  player: 'Tu grabación',
  unplayable:
    'Esta grabación no se puede reproducir, así que no se puede enviar. Graba de nuevo o descártala.',
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
  done: 'Grabación enviada',
  unavailable: 'Este enlace no está disponible',
  unavailableBody: 'Pide un enlace nuevo a quien te lo envió.',
  busy: 'Este enlace está ocupado',
  busyBody: 'Vuelve a intentarlo en unos minutos.',
  failed: 'No se pudo enviar tu grabación. No se guardó nada.',
  originRefused: (domain) =>
    `Esta página no puede grabar: ${domain} debe ser un dominio de grabación de la organización en Probara, y la página debe indicar la organización en la opción organizations de la grabadora.`,
  unsupported: 'Este navegador no puede grabar la pantalla',
  unsupportedBody: 'Abre el enlace en un navegador de escritorio actualizado.',
  sizeLimit: 'La grabación se detuvo porque alcanzó el tamaño máximo permitido.',
  timeLimit: 'La grabación se detuvo porque alcanzó el tiempo máximo.',
  reportProblem: 'Reportar un problema',
  choose: '¿Qué quieres enviar?',
  sendWhatHappened: 'Enviar lo que acaba de pasar',
  recordFromStart: 'Grabar desde el inicio',
  replayReview: '¿Enviar lo que acaba de pasar?',
  replaySpan: (duration) => `Abarca los últimos ${duration}`,
  replayPage: (page) => `Página: ${page}`,
  whatHappened: '¿Qué pasó?',
  discardReplayTitle: '¿Descartar lo que acaba de pasar?',
  discardReplayBody: 'No se envía nada. No se puede deshacer.',
  sendingReplay: 'Enviando lo que acaba de pasar…',
  doneReplay: '¡Gracias! Tu reporte se envió.',
  widgetUnavailable: 'Reportar un problema no está disponible en este momento.',
  widgetUnsupported:
    'Este navegador no puede grabar la pantalla y todavía no hay nada para enviar.',
  widgetFailed: 'No se pudo enviar tu reporte. No se guardó nada.',
  reporterRequired: 'Inicia sesión para reportar un problema.',
  invalidReporter: 'No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.',
  hourlyCap: 'Se enviaron demasiados reportes en la última hora. Inténtalo más tarde.',
  tooManyOpen: 'Tienes demasiados reportes que aún se están enviando. Inténtalo cuando terminen.',
  rateLimited: 'Hay demasiadas solicitudes en este momento. Inténtalo de nuevo en unos minutos.',
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
