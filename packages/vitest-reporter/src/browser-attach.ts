/**
 * The `probaraAttach` browser command (V10): the Node side of `probara.attach()` in a browser run. It copies the file, or
 * writes the body, into the run's folder, as the Node helpers do (V-D65, V-D66). A browser cannot read a file, so a path is
 * read here, and only where Vite serves it: the same folders (`server.fs.allow`) and the same default denials (`.env`,
 * `.pem`, `.crt`) decide, so a browser test reaches no file Vite would refuse (V-D103). A refusal is a reason the helper
 * warns with; nothing is copied, and nothing is lost silently. Node only: Vitest runs it in the reporter's process.
 */
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { stageFile } from './attachment-files.js';
import type { BrowserAttachRequest, BrowserAttachResult } from './browser-commands.js';

/** The part of Vite's `server.fs` the rule reads: unless `strict` is false, only the folders in `allow` are served. */
export interface ServeRules {
  readonly strict?: boolean | undefined;
  /** Absolute folders Vite serves, as Vite resolved them. */
  readonly allow: readonly string[];
}

/** A Vite server as this command reads it: its config's file rules. */
interface ViteServer {
  readonly config: { readonly server: { readonly fs: ServeRules } };
}

/**
 * The part of a browser command's context this command reads: the project of the run (Vitest's `BrowserCommandContext`
 * carries it), its root, and the Vite server of its browser (`browser`) or of the project (`vite`). Vitest 3 throws when
 * `vite` is read on a project of a browser run, so each read is guarded.
 */
export interface AttachContext {
  readonly project: {
    readonly config: { readonly root: string };
    readonly browser?: { readonly vite?: ViteServer | undefined } | undefined;
    readonly vite?: ViteServer | undefined;
  };
}

/** A read that may throw in some Vitest version: its value, or `undefined` when it throws or is absent. */
function readOr<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The file rules Vite applies to this run: the browser's Vite server (Vitest 3 and 5 keep it there), else the project's. */
function serveRulesOf(project: AttachContext['project']): ServeRules | undefined {
  const rules = readOr(() => project.browser?.vite?.config.server.fs);
  return rules ?? readOr(() => project.vite?.config.server.fs);
}

/** Vite's default `server.fs.deny`: environment files and certificates, which Vite never serves. */
const DENIED_NAME = /^\.env(\..*)?$|\.(pem|crt)$/u;

/** Why Vite would not serve `file` (absolute), for the warning; `undefined` when it would serve it. */
export function notServedReason(rules: ServeRules, file: string): string | undefined {
  if (rules.strict === false) return undefined;
  if (DENIED_NAME.test(basename(file))) return `Vite does not serve "${file}" (server.fs.deny)`;
  const served = rules.allow.some((folder) => {
    const path = relative(folder, file);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  });
  return served ? undefined : `Vite does not serve "${file}": it is outside server.fs.allow`;
}

/**
 * The command itself: copies the file (its path is relative to the project's root, as Vite's folders are) or writes the
 * body into the run's folder, `folder`, which the reporter gives it (the browser instance of a project does not carry the
 * values the reporter provided to the project, so the folder is not read from the context). `null` when the run has none.
 */
export function attachFile(
  folder: string | undefined,
  context: AttachContext,
  request: BrowserAttachRequest,
): BrowserAttachResult {
  if (folder === undefined || folder === '') return null;
  if ('path' in request) {
    const file = resolve(context.project.config.root, request.path);
    const rules = serveRulesOf(context.project);
    if (rules === undefined) {
      return {
        problem: `Vite's file rules are not reachable from this run, so "${file}" is not served`,
      };
    }
    const refused = notServedReason(rules, file);
    if (refused !== undefined) return { problem: refused };
    return stageFile(folder, { path: file });
  }
  const body = request.encoding === 'base64' ? Buffer.from(request.body, 'base64') : request.body;
  return stageFile(folder, { body });
}
