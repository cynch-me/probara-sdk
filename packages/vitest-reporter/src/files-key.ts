/**
 * The provided key of the folder `probara.attach()` copies its files into (V-D66). The reporter provides
 * it to each project it registers (the attachments folder of the run, under Vitest's `attachmentsDir`); the
 * setup file reads it in the worker. Shared by both sides, and loads nothing.
 */
export const FILES_KEY = 'probaraFilesDir' as const;

declare module 'vitest' {
  interface ProvidedContext {
    /** The folder the worker copies `probara.attach()` files into (see `attachment-files.ts`). */
    probaraFilesDir: string;
  }
}
