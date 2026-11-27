/**
 * Angular's ErrorHandler, sending what it gets to Probara as unhandled errors before logging it to
 * the console as Angular's own does.
 */
import { ErrorHandler } from '@angular/core';
import { captureException } from '@probara/browser';
import { extractError, isSkipped } from './errors.js';

export interface ProbaraErrorHandlerOptions {
  /** Logs each error to the console as Angular does (`console.error('ERROR', error)`): on unless false. */
  logErrors?: boolean;
}

export class ProbaraErrorHandler extends ErrorHandler {
  readonly #logErrors: boolean;

  constructor(options: ProbaraErrorHandlerOptions = {}) {
    super();
    this.#logErrors = options.logErrors !== false;
  }

  override handleError(error: unknown): void {
    try {
      if (!isSkipped(error)) {
        captureException(extractError(error), { mechanism: { type: 'angular', handled: false } });
      }
    } catch {
      // Reporting never breaks the app.
    }
    if (this.#logErrors) console.error('ERROR', error);
  }
}
