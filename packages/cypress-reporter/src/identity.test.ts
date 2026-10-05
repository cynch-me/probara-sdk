import { describe, expect, it } from 'vitest';
import { automationKeyOf, cypressTestIdentity, type IdentityContext } from './identity.js';

const FILE = 'cypress/e2e/cart.cy.js';
const withFile: IdentityContext = {
  projectCodes: ['SHOP'],
  keyIncludesFile: true,
  rootDir: '/work/app',
};
const withoutFile: IdentityContext = { ...withFile, keyIncludesFile: false };

describe('cypressTestIdentity', () => {
  it('keys a test with the spec file and the full title as ONE segment, like the cypress-junit import', () => {
    const identity = cypressTestIdentity(FILE, { suiteTitles: ['Cart'], title: 'adds an item' }, withFile);
    expect(identity.identity).toEqual({
      file: FILE,
      titlePath: ['Cart adds an item'],
    });
    expect(
      automationKeyOf(FILE, { suiteTitles: ['Cart'], title: 'adds an item' }, withFile),
    ).toBe('cypress/e2e/cart.cy.js > Cart adds an item');
  });

  it('joins the describes and the title with spaces, at every depth', () => {
    const deep = { suiteTitles: ['Cart', 'Totals', 'Taxes'], title: 'adds VAT' };
    expect(cypressTestIdentity(FILE, deep, withFile).identity.titlePath).toEqual([
      'Cart Totals Taxes adds VAT',
    ]);
    expect(cypressTestIdentity(FILE, { suiteTitles: [], title: 'top level' }, withFile).identity
      .titlePath).toEqual(['top level']);
    expect(automationKeyOf(FILE, { suiteTitles: [], title: 'top level' }, withFile)).toBe(
      'cypress/e2e/cart.cy.js > top level',
    );
  });

  it('drops the file from the key with keyIncludesFile false, and nothing else', () => {
    const test = { suiteTitles: ['Cart'], title: 'adds an item' };
    expect(automationKeyOf(FILE, test, withoutFile)).toBe('Cart adds an item');
    expect(cypressTestIdentity(FILE, test, withoutFile).identity).toEqual({
      titlePath: ['Cart adds an item'],
    });
  });

  it('takes the case ids of the projects it may report to out of the title, and links them', () => {
    const identity = cypressTestIdentity(
      FILE,
      { suiteTitles: ['SHOP-7 Cart'], title: 'adds an item SHOP-12' },
      withFile,
    );
    expect(identity.ids).toEqual(['SHOP-7', 'SHOP-12']);
    expect(identity.identity.titlePath).toEqual(['Cart adds an item']);
    expect(
      automationKeyOf(FILE, { suiteTitles: ['SHOP-7 Cart'], title: 'adds an item SHOP-12' }, withFile),
    ).toBe('cypress/e2e/cart.cy.js > Cart adds an item');
  });

  it('leaves the id of a project it does not report to in the title', () => {
    const test = { suiteTitles: ['Cart'], title: 'WEB-7 keeps another project id in its title' };
    expect(cypressTestIdentity(FILE, test, withFile).ids).toEqual([]);
    expect(cypressTestIdentity(FILE, test, withFile).identity.titlePath).toEqual([
      'Cart WEB-7 keeps another project id in its title',
    ]);
  });

  it('reads no case id without the projects to read them from', () => {
    const test = { suiteTitles: ['Cart'], title: 'SHOP-12 adds an item' };
    expect(cypressTestIdentity(FILE, test, { ...withFile, projectCodes: [] }).ids).toEqual([]);
  });

  it('has no key for a test without a title, rather than throwing', () => {
    expect(automationKeyOf(FILE, { suiteTitles: [], title: '' }, withFile)).toBeUndefined();
  });
});