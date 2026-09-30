/**
 * Run selection (`runCasesOnly`): the tests of a Jest run that belong to the cases of a Probara run.
 * A test belongs to the run when its automation key is the key of one of the run's cases, or when
 * its title or one of its describes names one of the run's cases (`SHOP-12`). The ids of
 * `probara.id()` count for nothing here: that call happens as the test runs, after the selection.
 *
 * The reporter reads the run's cases before Jest starts its test processes and hands them to the
 * setup file (`@probara/jest-reporter/setup`) through the channel's settings; the setup file skips
 * the other tests from a root `beforeAll` hook, once Jest collected the tests of the file, before
 * any of them runs. Both sides match with the same function and the reporter's own identity of a
 * test (`identity.ts`). Loaded inside the test sandbox: `@probara/core/metadata` only.
 */
import type { RunSelection, SelectionOutcome } from './channel.js';
import {
  automationKeyOf,
  jestTestIdentity,
  namesProject,
  type IdentityContext,
  type JestTestNames,
} from './identity.js';

/**
 * Whether the test `test` of the file at `path` (absolute) belongs to the run: `displayName` is the
 * name of the Jest project that runs it, when known (the setup file cannot see it).
 */
export type Selector = (path: string, test: JestTestNames, displayName?: string) => boolean;

/** The {@link Selector} of the cases of `selection`. */
export function createSelector(selection: RunSelection): Selector {
  const keys = new Set(selection.keys);
  const caseIds = new Set(selection.caseIds);
  const context: IdentityContext = {
    projectCodes: selection.projectCodes,
    keyIncludesFile: selection.keyIncludesFile,
    rootDir: selection.rootDir,
  };
  return (path, test, displayName) => {
    const named = { ...context, displayName };
    if (jestTestIdentity(path, test, named).ids.some((id) => caseIds.has(id))) return true;
    const key = automationKeyOf(path, test, named);
    return key !== undefined && keys.has(key);
  };
}

/** What jest-circus keeps of a describe block or a test: the members the walk reads and sets. */
interface CircusNode {
  type?: unknown;
  name?: unknown;
  mode?: unknown;
  children?: unknown;
}

/** The description of jest-circus's state symbol, an unregistered `Symbol('JEST_STATE_SYMBOL')`. */
const CIRCUS_STATE = 'JEST_STATE_SYMBOL';

function isNode(value: unknown): value is CircusNode {
  return typeof value === 'object' && value !== null;
}

function rootBlockOf(global: typeof globalThis): CircusNode | undefined {
  const symbol = Object.getOwnPropertySymbols(global).find(
    (each) => each.description === CIRCUS_STATE,
  );
  if (symbol === undefined) return undefined;
  const state: unknown = (global as unknown as Record<symbol, unknown>)[symbol];
  const root = isNode(state)
    ? (state as { rootDescribeBlock?: unknown }).rootDescribeBlock
    : undefined;
  // A root block without its list of children is not jest-circus's state as this code knows it.
  return isNode(root) && Array.isArray(root.children) ? root : undefined;
}

/** Every test under `block`, with its describes (outermost first) and its title. */
function testsOf(
  block: CircusNode,
  ancestors: readonly string[],
): { node: CircusNode; names: JestTestNames }[] {
  if (!Array.isArray(block.children)) return [];
  return (block.children as unknown[]).flatMap((child) => {
    if (!isNode(child) || typeof child.name !== 'string') return [];
    if (child.type === 'describeBlock') return testsOf(child, [...ancestors, child.name]);
    if (child.type !== 'test') return [];
    return [{ node: child, names: { ancestorTitles: ancestors, title: child.name } }];
  });
}

/**
 * Skips, in jest-circus's state of the sandbox `global`, every collected test of the file at `file`
 * that `selects` does not take, but those whose names hold `{displayName}` (the reporter decides
 * those); a `test.todo` stays one (it never runs). Call it once Jest collected
 * the file's tests and before they run: from a root `beforeAll` hook. Returns the names of the tests
 * it left out of the run (describes, then title), or why it changed nothing: no jest-circus state
 * of a shape it knows (`no-circus`), or a failure (`failed`), when every test runs rather than some. Never throws.
 */
export function deselectTests(
  global: typeof globalThis,
  selects: Selector,
  file: string,
): SelectionOutcome {
  try {
    const root = rootBlockOf(global);
    if (root === undefined) return { applied: false, reason: 'no-circus' };
    // Decided for every test first: a failure half-way leaves them all running. A test whose names
    // hold {displayName} is kept: the project's name is unknown here, the reporter decides with it.
    const left = testsOf(root, []).filter(
      ({ names }) => !namesProject(names) && !selects(file, names),
    );
    for (const { node } of left) if (node.mode !== 'todo') node.mode = 'skip';
    return {
      applied: true,
      deselected: left.map(({ names }) => [...names.ancestorTitles, names.title]),
    };
  } catch {
    return { applied: false, reason: 'failed' };
  }
}
