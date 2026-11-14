/** The recorder's words, in English and Spanish, chosen from the browser language. */

export type Locale = 'en' | 'es';

export interface Strings {
  recorder: string;
  heading: (organization: string) => string;
  titleLabel: string;
  microphone: string;
  limit: (minutes: number) => string;
  record: string;
  pause: string;
  resume: string;
  stop: string;
  discard: string;
  close: string;
  loading: string;
  starting: string;
  paused: string;
  sending: string;
  done: string;
  unavailable: string;
  busy: string;
  failed: string;
}

const EN: Strings = {
  recorder: 'Probara Vis recorder',
  heading: (organization) => `Record your screen for ${organization}`,
  titleLabel: 'Title',
  microphone: 'Record my microphone',
  limit: (minutes) => (minutes === 1 ? 'Up to 1 minute' : `Up to ${String(minutes)} minutes`),
  record: 'Start recording',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop and send',
  discard: 'Discard',
  close: 'Close',
  loading: 'Loading…',
  starting: 'Choose this tab to share it…',
  paused: 'Paused',
  sending: 'Sending your recording…',
  done: 'Thank you! Your recording was sent.',
  unavailable: 'This recording link is not available.',
  busy: 'Too many recordings right now. Try again in a few minutes.',
  failed: 'Your recording could not be sent. Nothing was kept.',
};

const ES: Strings = {
  recorder: 'Grabadora de Probara Vis',
  heading: (organization) => `Graba tu pantalla para ${organization}`,
  titleLabel: 'Título',
  microphone: 'Grabar mi micrófono',
  limit: (minutes) => (minutes === 1 ? 'Hasta 1 minuto' : `Hasta ${String(minutes)} minutos`),
  record: 'Empezar a grabar',
  pause: 'Pausar',
  resume: 'Reanudar',
  stop: 'Detener y enviar',
  discard: 'Descartar',
  close: 'Cerrar',
  loading: 'Cargando…',
  starting: 'Elige esta pestaña para compartirla…',
  paused: 'En pausa',
  sending: 'Enviando tu grabación…',
  done: '¡Gracias! Tu grabación se envió.',
  unavailable: 'Este enlace de grabación no está disponible.',
  busy: 'Hay demasiadas grabaciones en este momento. Inténtalo de nuevo en unos minutos.',
  failed: 'No se pudo enviar tu grabación. No se guardó nada.',
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
