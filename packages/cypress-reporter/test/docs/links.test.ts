/**
 * Every link of the reporter's README, changelog and docs resolves, and so does every link to a
 * file of this repository on GitHub. The docs ship in the npm tarball, so their relative links
 * never leave `packages/cypress-reporter/`: a file outside it is linked by its GitHub URL.
 */
import { brokenLinks, linksLeavingPackage } from '@probara/test-support/docs/links';
import { shown } from '@probara/test-support/docs/markdown';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR, userDocs } from './markdown.js';

describe('links of the reporter docs', () => {
  it.each(userDocs().map((file) => [shown(file), file] as const))(
    '%s links only to files and headings that exist',
    (_name, file) => {
      expect(brokenLinks(file)).toEqual([]);
    },
  );

  it.each(userDocs().map((file) => [shown(file), file] as const))(
    '%s links relatively only inside the package',
    (_name, file) => {
      expect(linksLeavingPackage(file, PACKAGE_DIR)).toEqual([]);
    },
  );
});
