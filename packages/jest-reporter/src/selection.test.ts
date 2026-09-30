/**
 * Run selection (`runCasesOnly`): which tests match the cases of a run, by automation key or by a
 * case id of their titles, computed with the reporter's own identity of a test; and how the setup
 * file skips the others in jest-circus's state before they run.
 */
import { toReportEntry } from '@probara/core';
import { describe, expect, it } from 'vitest';
import { parseSelection, type RunSelection } from './channel.js';
import { createSelector, deselectTests, type Selector } from './selection.js';
import { toResultInput } from './translate.js';

const ROOT = '/work/app';
const CART = `${ROOT}/tests/cart.test.js`;

function selection(overrides: Partial<RunSelection> = {}): RunSelection {
  return {
    run: '01K00000000000000000000RUN',
    keys: [],
    caseIds: [],
    projectCodes: ['SHOP'],
    keyIncludesFile: true,
    rootDir: ROOT,
    ...overrides,
  };
}

/** Whether `selects` takes the test of `titles` (describes, then the title) of `path`. */
function takes(selects: Selector, titles: readonly string[], path = CART): boolean {
  return selects(path, { ancestorTitles: titles.slice(0, -1), title: titles.at(-1) ?? '' });
}

describe('createSelector', () => {
  it('takes a test whose automation key is the key of a case of the run, with the file', () => {
    const selects = createSelector(selection({ keys: ['tests/cart.test.js > cart adds an item'] }));
    expect(takes(selects, ['cart', 'adds an item'])).toBe(true);
    expect(takes(selects, ['cart', 'removes an item'])).toBe(false);
    expect(takes(selects, ['cart', 'adds an item'], `${ROOT}/tests/other.test.js`)).toBe(false);
  });

  it('builds the keys without the file with keyIncludesFile off', () => {
    const keys = ['cart adds an item', 'tests/cart.test.js > cart removes an item'];
    const selects = createSelector(selection({ keys, keyIncludesFile: false }));
    expect(takes(selects, ['cart', 'adds an item'])).toBe(true);
    expect(takes(selects, ['cart', 'removes an item'])).toBe(false);
  });

  it('takes a test whose title or describes name a case of the run, without its id in the key', () => {
    const selects = createSelector(selection({ caseIds: ['SHOP-5', 'SHOP-9'] }));
    expect(takes(selects, ['cart', 'SHOP-5 removes an item'])).toBe(true);
    expect(takes(selects, ['SHOP-9 checkout', 'pays'])).toBe(true);
    expect(takes(selects, ['SHOP-9 checkout', 'nested', 'pays twice'])).toBe(true);
    expect(takes(selects, ['cart', 'SHOP-6 empties the cart'])).toBe(false);
    // The key a case of the run has is the one without the id.
    const byKey = createSelector(
      selection({ keys: ['tests/cart.test.js > cart removes an item'] }),
    );
    expect(takes(byKey, ['cart', 'SHOP-5 removes an item'])).toBe(true);
  });

  it('reads the ids of the configured projects only', () => {
    const selects = createSelector(selection({ caseIds: ['WEB-5'], projectCodes: ['SHOP'] }));
    expect(takes(selects, ['cart', 'WEB-5 removes an item'])).toBe(false);
    expect(
      takes(createSelector(selection({ caseIds: ['WEB-5'], projectCodes: ['SHOP', 'WEB'] })), [
        'cart',
        'WEB-5 removes an item',
      ]),
    ).toBe(true);
  });

  it('tells apart the rows of test.each by their titles', () => {
    const selects = createSelector(
      selection({ keys: ['tests/cart.test.js > cart pays with visa'] }),
    );
    expect(takes(selects, ['cart', 'pays with visa'])).toBe(true);
    expect(takes(selects, ['cart', 'pays with amex'])).toBe(false);
  });

  it("names a test like jest-junit's templates, $ patterns of its title too", () => {
    // `$&` in a title is the tag it replaces: jest-junit names this test "cart costs {title} more".
    const selects = createSelector(
      selection({ keys: ['tests/cart.test.js > cart costs {title} more'] }),
    );
    expect(takes(selects, ['cart', 'costs $& more'])).toBe(true);
    expect(takes(selects, ['cart', 'costs $$ more'])).toBe(false);
  });

  it('keys a test exactly like the result the reporter sends for it', () => {
    const context = { projectCodes: ['SHOP'], keyIncludesFile: true, rootDir: ROOT };
    const tests = [
      { ancestorTitles: ['cart', 'SHOP-5 box'], title: 'adds  an item › twice' },
      { ancestorTitles: [], title: 'top level $$ test' },
      { ancestorTitles: ['a b'], title: 'c' },
    ];
    for (const keyIncludesFile of [true, false]) {
      const keys = tests.map((test) => {
        const input = toResultInput(
          CART,
          { ...test, status: 'passed' },
          { ...context, keyIncludesFile },
        );
        return toReportEntry(input, { rootDir: ROOT }).entry.automationKey ?? '';
      });
      const selects = createSelector(selection({ keys, keyIncludesFile }));
      for (const test of tests) expect(selects(CART, test)).toBe(true);
      expect(selects(CART, { ancestorTitles: ['cart'], title: 'adds an item' })).toBe(false);
    }
  });
});

describe('parseSelection', () => {
  it('reads back a selection, and nothing of a malformed one', () => {
    const given = selection({ keys: ['k'], caseIds: ['SHOP-1'] });
    expect(parseSelection(JSON.parse(JSON.stringify(given)))).toEqual(given);
    expect(parseSelection(undefined)).toBeUndefined();
    expect(parseSelection({ ...given, keys: 'k' })).toBeUndefined();
    expect(parseSelection({ ...given, caseIds: [1] })).toBeUndefined();
    expect(parseSelection({ ...given, rootDir: undefined })).toBeUndefined();
    expect(parseSelection({ ...given, keyIncludesFile: 'yes' })).toBeUndefined();
  });
});

interface Block {
  type: 'describeBlock';
  name: string;
  mode?: string | undefined;
  parent?: Block | undefined;
  children: (Block | Entry)[];
}

interface Entry {
  type: 'test';
  name: string;
  mode?: string | undefined;
  parent: Block;
}

type Tree = readonly (string | [string, string] | { describe: string; tests: Tree })[];

/** jest-circus's collected tests: a name, `[name, mode]`, or a describe block. */
function circusState(tree: Tree) {
  const root: Block = { type: 'describeBlock', name: 'ROOT_DESCRIBE_BLOCK', children: [] };
  const add = (parent: Block, items: Tree) => {
    for (const item of items) {
      if (typeof item === 'string' || Array.isArray(item)) {
        const [name, mode] = typeof item === 'string' ? [item, undefined] : item;
        parent.children.push({ type: 'test', name, mode, parent });
      } else {
        const block: Block = { type: 'describeBlock', name: item.describe, parent, children: [] };
        parent.children.push(block);
        add(block, item.tests);
      }
    }
  };
  add(root, tree);
  const global = { [Symbol('JEST_STATE_SYMBOL')]: { rootDescribeBlock: root } };
  return { global: global as unknown as typeof globalThis, root };
}

/** Every test of `block`, as `describe › title: mode`. */
function modes(block: Block, path: string[] = []): string[] {
  return block.children.flatMap((child) =>
    child.type === 'test'
      ? [`${[...path, child.name].join(' › ')}: ${child.mode ?? 'run'}`]
      : modes(child, [...path, child.name]),
  );
}

describe('deselectTests', () => {
  const selects = createSelector(
    selection({ keys: ['tests/cart.test.js > cart adds an item'], caseIds: ['SHOP-9'] }),
  );

  it('skips every test that matches no case of the run, and names them', () => {
    const { global, root } = circusState([
      {
        describe: 'cart',
        tests: [
          'adds an item',
          'removes an item',
          ['saves it for later', 'todo'],
          ['shares it', 'skip'],
          { describe: 'SHOP-9 checkout', tests: ['pays', ['pays twice', 'only']] },
          { describe: 'wishlist', tests: [['lists', 'only']] },
        ],
      },
      'top level',
    ]);

    const deselected = deselectTests(global, selects, CART);

    expect(modes(root)).toEqual([
      'cart › adds an item: run',
      'cart › removes an item: skip',
      // A todo stays one: it never runs.
      'cart › saves it for later: todo',
      'cart › shares it: skip',
      'cart › SHOP-9 checkout › pays: run',
      'cart › SHOP-9 checkout › pays twice: only',
      'cart › wishlist › lists: skip',
      'top level: skip',
    ]);
    expect(deselected).toEqual({
      applied: true,
      deselected: [
        ['cart', 'removes an item'],
        ['cart', 'saves it for later'],
        ['cart', 'shares it'],
        ['cart', 'wishlist', 'lists'],
        ['top level'],
      ],
    });
  });

  it('keeps every test whose names hold {displayName}: the project is unknown here, the reporter decides', () => {
    const { global, root } = circusState([
      { describe: 'cart', tests: ['{displayName} pays', 'removes an item'] },
      { describe: '{displayName} wishlist', tests: ['lists'] },
    ]);

    expect(deselectTests(global, selects, CART)).toEqual({
      applied: true,
      deselected: [['cart', 'removes an item']],
    });
    expect(modes(root)).toEqual([
      'cart › {displayName} pays: run',
      'cart › removes an item: skip',
      '{displayName} wishlist › lists: run',
    ]);
  });

  it('changes nothing without jest-circus state, nor when matching fails, says why, and never throws', () => {
    expect(deselectTests({} as typeof globalThis, selects, CART)).toEqual({
      applied: false,
      reason: 'no-circus',
    });
    // A state of a shape it does not know: not jest-circus's as the setup file knows it.
    const broken = { [Symbol('JEST_STATE_SYMBOL')]: { rootDescribeBlock: { children: 7 } } };
    expect(deselectTests(broken as unknown as typeof globalThis, selects, CART)).toEqual({
      applied: false,
      reason: 'no-circus',
    });

    const { global, root } = circusState(['adds an item', 'removes an item']);
    let calls = 0;
    const failing: Selector = () => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return false;
    };
    expect(deselectTests(global, failing, CART)).toEqual({ applied: false, reason: 'failed' });
    // Every test runs rather than some.
    expect(modes(root)).toEqual(['adds an item: run', 'removes an item: run']);
  });
});
