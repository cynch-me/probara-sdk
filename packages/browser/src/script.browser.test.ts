/**
 * The script-tag build through the loader the README documents: calls made and errors thrown
 * before the script arrives are queued, and sent once it loads, which then sets `window.Probara`.
 */
import { SHARED_CAPTURE_KEY } from '@probara/vis-capture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import type { ProbaraEvent } from './index.js';

type ProbaraGlobal = Record<string, (...args: unknown[]) => unknown>;

const page = globalThis as unknown as { Probara?: ProbaraGlobal };

afterEach(async () => {
  await page.Probara?.['close']?.();
  Reflect.deleteProperty(globalThis, 'Probara');
  Reflect.deleteProperty(globalThis, SHARED_CAPTURE_KEY);
  vi.restoreAllMocks();
});

/** The loader of the README, its script tag kept out of the page and its DSN left out. */
async function runLoader(): Promise<HTMLScriptElement[]> {
  const readme = await commands.readFile('README.md');
  const block = /<!-- loader -->\s*```html\n<script>\n([\s\S]*?)<\/script>\n```/.exec(readme)?.[1];
  if (block === undefined) throw new Error('the README has no loader');
  const appended: HTMLScriptElement[] = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) appended.push(node);
    return node;
  });
  const loader = block.replace(/^\s*Probara\.init\(.*\);\s*$/m, '');
  const inline = document.createElement('script');
  inline.textContent = loader;
  document.body.append(inline);
  inline.remove();
  return appended;
}

describe('the script-tag build', () => {
  it('sends the calls and errors queued by the loader once it loads, then answers on window.Probara', async () => {
    const appended = await runLoader();
    expect(appended.map((script) => script.src)).toEqual([
      'https://cdn.jsdelivr.net/npm/@probara/browser@0/dist/probara.browser.min.js',
    ]);
    const sent: ProbaraEvent[] = [];
    const queued = page.Probara;
    queued?.['captureMessage']?.('queued before init');
    queued?.['init']?.({
      dsn: 'https://pek_script@ingest.probara.test/',
      beforeSend: (event: ProbaraEvent) => {
        sent.push(event);
        return null;
      },
    });
    const early = new Error('thrown before the script');
    window.dispatchEvent(
      new ErrorEvent('error', { error: early, message: early.message, cancelable: true }),
    );

    await import('./script.js');

    expect(page.Probara).not.toBe(queued);
    page.Probara?.['captureMessage']?.('after load');
    await page.Probara?.['flush']?.();
    expect(sent.map((event) => event.message ?? event.exception?.values.at(-1)?.value)).toEqual([
      'queued before init',
      'thrown before the script',
      'after load',
    ]);
    expect(sent[1]?.exception?.values.at(-1)?.mechanism).toEqual({
      type: 'onerror',
      handled: false,
    });
  });
});
