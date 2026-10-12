/**
 * The `probaraAttach` browser command (V10): the Node side of `probara.attach()` in a browser run. It copies the file, or
 * writes the body, into the run's folder, as the Node helpers do (V-D65, V-D66). A browser cannot read a file, so a path is
 * read here, and only where Vite serves it: Vite's own file check (`fileRulesOf`, V-D103, V-D119) decides, with the project's
 * `server.fs` allow and deny lists, Vite's defaults and the real path of a symlink. A refusal is a reason the helper warns
 * with; nothing is copied, and nothing is lost silently. Node only: Vitest runs it in the reporter's process.
 */
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { stageFile } from './attachment-files.js';
import type { BrowserAttachRequest, BrowserAttachResult } from './browser-commands.js';
import type { FileRules } from './vite-rules.js';

/** A Vite server as this command reads it: its resolved configuration, which Vite's file rules take. */
interface ViteServer {
  readonly config: unknown;
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

/** The Vite server this run uses (Vitest 3 and 5 keep it on the browser's), else the project's: its file checks read it. */
function serverOf(project: AttachContext['project']): unknown {
  return readOr(() => project.browser?.vite) ?? readOr(() => project.vite);
}

/**
 * The real path of `file`, its symlinks resolved: Vite judges the path a module is loaded from, and that is the target of a
 * link. A file that does not exist keeps its path (the copy then reports it missing).
 */
function realPathOf(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * Whether Vite serves `file` for `server`. A check that throws is a refusal: the file is not read.
 */
function servedBy(fileRules: FileRules, server: unknown, file: string): boolean {
  try {
    return fileRules(server, file);
  } catch {
    return false;
  }
}

/**
 * The command itself: copies the file (its path is relative to the project's root, as Vite's folders are) or writes the
 * body into the run's folder, `folder`, which the reporter gives it (the browser instance of a project does not carry the
 * values the reporter provided to the project, so the folder is not read from the context). `null` when the run has none.
 * `fileRules` is the file check of the project's Vite, as `fileRulesOf` gives it (`vite-rules.ts`); without it a path is not
 * read.
 */
export function attachFile(
  folder: string | undefined,
  context: AttachContext,
  request: BrowserAttachRequest,
  fileRules?: FileRules,
): BrowserAttachResult {
  if (folder === undefined || folder === '') return null;
  if ('path' in request) {
    const file = resolve(context.project.config.root, request.path);
    const server = serverOf(context.project);
    if (fileRules === undefined || server === undefined) {
      return {
        problem: `Vite's file rules are not reachable from this run, so "${file}" is not served`,
      };
    }
    // The real path is the one checked and the one copied: a link moved after the check copies no other file (V-D121).
    const real = realPathOf(file);
    if (!servedBy(fileRules, server, real)) {
      return { problem: `Vite does not serve "${file}" (server.fs.allow or server.fs.deny)` };
    }
    // The copy is the real file, but the attachment keeps the name the test asked for: a link named `named.txt` is `named.txt`.
    const staged = stageFile(folder, { path: real });
    return 'staged' in staged ? { staged: { ...staged.staged, source: basename(file) } } : staged;
  }
  const body = request.encoding === 'base64' ? Buffer.from(request.body, 'base64') : request.body;
  return stageFile(folder, { body });
}
