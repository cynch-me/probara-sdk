/**
 * The folder the worker copies `probara.attach()` files into. The setup file installs it from the value the
 * reporter provides (`files-key.ts`), and the Node helpers read it on each call. It lives on `globalThis`
 * under a `Symbol.for` key, so every copy of this package in a worker finds the same one, and it loads
 * nothing: the reporter process imports it too.
 */
const FILES_SLOT = Symbol.for('@probara/vitest-reporter/files/v1');

/** Installs the folder of this worker's run; `undefined` (or `''`) when the reporter provides none. */
export function installFilesDir(dir: unknown): void {
  Reflect.set(globalThis, FILES_SLOT, typeof dir === 'string' && dir !== '' ? dir : undefined);
}

/** The folder files are copied into, or `undefined` when no reporter provided one. */
export function filesDirOf(): string | undefined {
  const dir: unknown = Reflect.get(globalThis, FILES_SLOT);
  return typeof dir === 'string' ? dir : undefined;
}
