import * as vitest from 'vitest';

// The default runner of this Vitest: the class of `vitest` from 4.1, `vitest/runners` before. The
// subpath is a variable: a literal `import()` of it fails the transform of this file on Vitest 5.
const RUNNERS = 'vitest/runners';
const Base = 'TestRunner' in vitest ? vitest.TestRunner : (await import(RUNNERS)).VitestTestRunner;

// Marks every test it runs, so the test can tell that its runner ran it.
export default class UserRunner extends Base {
  async onBeforeRunTask(test) {
    test.meta.userRunner = true;
    return super.onBeforeRunTask?.(test);
  }
}
