/** The Markdown the CLI's docs tests check: the shared helpers, with the CLI's own files. */
import { fileURLToPath } from 'node:url';
import { packageDocs, rootMarkdownFiles } from '@probara/test-support/docs/markdown';

export {
  fencedBlocks,
  headingAnchors,
  linksOf,
  read,
  REPO_DIR,
  rootMarkdownFiles,
  shown,
  tableAfter,
  trackedRootMarkdown,
  unreadable,
  withoutCode,
  withoutFences,
  type FencedBlock,
  type Link,
} from '@probara/test-support/docs/markdown';

/** `packages/cli/`. */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** The user docs: the package README, its changelog and every page of `docs/`. */
export function userDocs(): string[] {
  return packageDocs(PACKAGE_DIR);
}

/** Every Markdown file whose links are checked: the repository-level files and the user docs. */
export function linkedDocs(): string[] {
  return [...rootMarkdownFiles(), ...userDocs()];
}
