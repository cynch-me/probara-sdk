// A user runner in a file Node does not import (`.jsx`), which Vite transforms: Vitest runs it, the
// reporter must keep it as it is. The subpath is a variable: a literal `import()` of it fails the
// transform of this file on Vitest 5, which has no such subpath.
import * as vitest from 'vitest';

const RUNNERS = 'vitest/runners';
const Base = 'TestRunner' in vitest ? vitest.TestRunner : (await import(RUNNERS)).VitestTestRunner;

// Marks every test it runs, so the test can tell that its runner ran it.
export default class UserRunner extends Base {
  async onBeforeRunTask(test) {
    test.meta.userRunner = true;
    return super.onBeforeRunTask?.(test);
  }
}
