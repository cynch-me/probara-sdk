/**
 * The provided key that carries the path of the user's own runner from the reporter (which
 * registers the runner extension) to the extension itself, which wraps it. Shared by both sides,
 * and loads nothing: the reporter process never imports the runner module.
 */
export const CUSTOM_RUNNER_KEY = 'probaraCustomRunner';

declare module 'vitest' {
  interface ProvidedContext {
    /** The path of the user's own runner, or `''` when the config names none (see `runner.ts`). */
    probaraCustomRunner: string;
  }
}
