/**
 * The browser's way to the Node side (V10): one Vitest browser command, `probaraAttach`, which copies the file of a
 * `probara.attach()` into the run's folder, as the Node helpers do. The browser setup installs the command object of
 * its Vitest major on `globalThis`, and the helpers call through it, so no helper module names a Vitest specifier.
 * Platform-neutral: the browser and the Node side both load it.
 */
import type { StageOutcome } from './probara-helpers.js';

/**
 * The name of the command, as the browser's commands object and the reporter's `browser.commands` list it. Vitest 4 takes
 * only letters, digits, `$` and `_` in a command name (a colon is refused), so the name has no separator.
 */
export const ATTACH_COMMAND = 'probaraAttach' as const;

/** The slot of the browser's commands object on `globalThis`, set by the browser setup file. */
export const BROWSER_COMMANDS_KEY = Symbol.for('@probara/vitest-reporter/browser-commands/v1');

/** What the browser sends: a path (resolved by the Node side against the project root), or a body (text, or base64). */
export type BrowserAttachRequest = { path: string } | { body: string; encoding: 'text' | 'base64' };

/** What the Node side answers: the copy, the reason it was refused, or `null` when the run has no folder. */
export type BrowserAttachResult = StageOutcome | null;

/** A browser command, called with its arguments: it answers a promise of its result. */
export type BrowserCommand = (...args: unknown[]) => Promise<unknown>;

/** The commands object of a browser: each command by its name. */
export type BrowserCommands = Record<string, BrowserCommand>;

/**
 * The browser's own trigger of commands, by name, which Vitest's generated commands object calls: `undefined` outside a
 * Vitest browser. The server looks a command up when it is called, so a command the generated object does not list
 * (one its parent gained after the browser context was generated) is reached the same way.
 */
function triggerOf(name: string): BrowserCommand | undefined {
  const state: unknown = Reflect.get(globalThis, '__vitest_browser_runner__');
  const commands: unknown =
    typeof state === 'object' && state !== null ? Reflect.get(state, 'commands') : undefined;
  const trigger: unknown =
    typeof commands === 'object' && commands !== null
      ? Reflect.get(commands, 'triggerCommand')
      : undefined;
  if (typeof trigger !== 'function') return undefined;
  return (...args: unknown[]) => Reflect.apply(trigger, commands, [name, args]) as Promise<unknown>;
}

/** The browser command `name` of this browser, or `undefined` when neither the commands nor the trigger of the browser exist. */
export function browserCommandOf(name: string): BrowserCommand | undefined {
  const commands: unknown = Reflect.get(globalThis, BROWSER_COMMANDS_KEY);
  const command: unknown =
    typeof commands === 'object' && commands !== null ? Reflect.get(commands, name) : undefined;
  if (typeof command === 'function') return command as BrowserCommand;
  return triggerOf(name);
}
