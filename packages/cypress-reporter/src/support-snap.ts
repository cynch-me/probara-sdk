/**
 * `cy.probaraSnap(name)`: a screenshot of the page under test for Probara Snap. Cypress takes it (`cy.screenshot`),
 * once the fonts are loaded and with the page held still, and the plugin gets it as two files of the attempt (a
 * description, then the PNG by its path), the way `probara.attach()` hands any file over. Runs in the spec frame:
 * no Node import.
 */
import type { BrowserAttachment, BrowserIdentity, ProbaraSettings } from './browser-message.js';
import {
  checkSnapName,
  checkSnapThreshold,
  duplicateSnapName,
  SNAP_CONTENT_TYPE,
  SNAP_IMAGE_CONTENT_TYPE,
  SNAP_MASK_ATTRIBUTE,
  SNAP_NAME,
  snapStabilizingCss,
  type ProbaraSnapOptions,
  type SnapDescription,
} from '@probara/core/browser';
import type { SupportContext } from './support-api.js';

export type { ProbaraSnapOptions } from '@probara/core/browser';

/** The folder of `screenshotsFolder` the captures go to: what tells them from the screenshots of a failure. */
export const SNAP_FOLDER = 'probara-snap';

/** The warning of a capture in a run without the plugin: nobody would send it. */
export const SNAP_NO_PLUGIN =
  'cy.probaraSnap() takes no screenshot: the Cypress config registers no plugin of @probara/cypress-reporter (probaraNodeEvents)';

/** The part of the page's document a capture uses. */
interface SnapDocument {
  readonly fonts?: { readonly ready: PromiseLike<unknown> } | undefined;
  readonly head: { append(node: SnapStyle): void };
  readonly defaultView?:
    | {
        readonly innerWidth?: number;
        readonly innerHeight?: number;
        matchMedia(query: string): { matches: boolean };
      }
    | null
    | undefined;
  createElement(tag: 'style'): SnapStyle;
}

interface SnapStyle {
  textContent: string | null;
  remove(): void;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Adds `cy.probaraSnap` to the frame. `settings` reads what the plugin exposed, and `identityOf` names the spec and
 * the test that runs. Never throws; the command itself throws only what must fail its test: a wrong name or
 * threshold, a name used twice, or a capture Cypress did not take.
 */
export function installSnapCommand(
  context: SupportContext,
  settings: () => ProbaraSettings | undefined,
  identityOf: (context: SupportContext) => BrowserIdentity,
): void {
  /** The names each attempt of a test used so far: a retry takes its screenshots again. */
  const taken = new Map<string, { attempt: number; names: Set<string> }>();
  let warned = false;

  function namesOf(identity: BrowserIdentity, attempt: number): Set<string> {
    const key = JSON.stringify([identity.file, identity.test]);
    const kept = taken.get(key);
    if (kept?.attempt === attempt) return kept.names;
    const names = new Set<string>();
    taken.set(key, { attempt, names });
    return names;
  }

  function probaraSnap(name: unknown, options: ProbaraSnapOptions = {}): void {
    checkSnapName(name);
    checkSnapThreshold(options.threshold);
    const known = settings();
    if (known === undefined) {
      if (!warned) context.warn(SNAP_NO_PLUGIN);
      warned = true;
      return;
    }
    const cypress = context.cypress();
    const cy = context.cy();
    if (!known.snap || cypress === undefined) return;
    if (cy?.document === undefined || cy.screenshot === undefined) return;
    const identity = identityOf(context);
    const names = namesOf(identity, cypress.currentRetry ?? 0);
    if (names.has(name)) throw duplicateSnapName(name);
    names.add(name);

    let document: SnapDocument | undefined;
    let style: SnapStyle | undefined;
    let path: string | undefined;
    cy.document({ log: false }).then((subject) => {
      document = subject as SnapDocument;
      return document.fonts?.ready;
    });
    cy.screenshot(`${SNAP_FOLDER}/${context.uuid()}`, {
      capture: options.fullPage === true ? 'fullPage' : 'viewport',
      overwrite: true,
      log: false,
      disableTimersAndAnimations: true,
      blackout: [SNAP_MASK_ATTRIBUTE, ...(options.mask ?? [])],
      onBeforeScreenshot: () => {
        if (document === undefined) return;
        style = document.createElement('style');
        style.textContent = snapStabilizingCss(options.hide ?? [], options.remove ?? []);
        document.head.append(style);
      },
      onAfterScreenshot: (_element: unknown, props: { path?: unknown } | undefined) => {
        style?.remove();
        if (typeof props?.path === 'string') path = props.path;
      },
    }).then(() => {
      if (path === undefined) throw new Error('probaraSnap(): Cypress took no screenshot');
      // The window of the page is the viewport `cy.viewport()` set; the config only holds its default.
      const view = document?.defaultView;
      const width = view?.innerWidth ?? cypress.config?.('viewportWidth');
      const height = view?.innerHeight ?? cypress.config?.('viewportHeight');
      const dark = view?.matchMedia('(prefers-color-scheme: dark)').matches;
      const description: SnapDescription = {
        name,
        ...(positiveInteger(width) && positiveInteger(height)
          ? { viewport: { width, height } }
          : {}),
        ...(typeof dark === 'boolean' ? { colorMode: dark ? 'dark' : 'light' } : {}),
        ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
      };
      const line = { ...identity, type: 'attachment' as const, name: SNAP_NAME };
      cy.task(
        'probara',
        {
          kind: 'attachment',
          line: { ...line, contentType: SNAP_CONTENT_TYPE, body: 'text' },
          text: JSON.stringify(description),
        } satisfies BrowserAttachment,
        { log: false },
      );
      cy.task(
        'probara',
        {
          kind: 'attachment',
          line: { ...line, contentType: SNAP_IMAGE_CONTENT_TYPE, body: 'bytes' },
          path,
        } satisfies BrowserAttachment,
        { log: false },
      );
    });
  }

  try {
    context.cypress()?.Commands?.add('probaraSnap', probaraSnap as (...args: unknown[]) => unknown);
  } catch {
    // A frame that already has the command (a support file loaded twice) keeps the one it has.
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Cypress declares its commands in this namespace
  namespace Cypress {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- Cypress's own signature, which a merged declaration repeats
    interface Chainable<Subject = any> {
      /**
       * Takes a screenshot of the page for Probara Snap, once the fonts are loaded and with animations stopped. The
       * name is unique within the test. Needs the plugin (`probaraNodeEvents`).
       */
      probaraSnap(name: string, options?: ProbaraSnapOptions): Chainable<void>;
    }
  }
}
