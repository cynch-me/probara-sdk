/**
 * Playwright reporter objects for unit tests, typed against Playwright's own reporter types: only
 * the members the reporter reads are real, and each builder fills them like Playwright does.
 */
import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter';

export const ROOT_DIR = '/work/app/tests';

export function fakeConfig(overrides: Partial<FullConfig> = {}): FullConfig {
  return {
    rootDir: ROOT_DIR,
    configFile: '/work/app/playwright.config.ts',
    ...overrides,
  } as FullConfig;
}

export interface FakeTestOptions {
  /** Relative to {@link ROOT_DIR}. */
  file?: string;
  /** Describe titles, then the test title. */
  titles?: readonly string[];
  /** The Playwright project name; `''` for an unnamed project. */
  project?: string;
  expectedStatus?: TestCase['expectedStatus'];
  annotations?: TestCase['annotations'];
}

/** A test as Playwright hands it to `onTestEnd`: `titlePath()` is `['', project, file, ...titles]`. */
export function fakeTest(options: FakeTestOptions = {}): TestCase {
  const file = options.file ?? 'login.spec.ts';
  const titles = options.titles ?? ['login', 'logs in'];
  const project = options.project ?? 'chromium';
  const suite = { project: () => ({ name: project }) } as unknown as Suite;
  return {
    title: titles[titles.length - 1] ?? '',
    titlePath: () => ['', project, file, ...titles],
    location: { file: `${ROOT_DIR}/${file}`, line: 3, column: 7 },
    parent: suite,
    expectedStatus: options.expectedStatus ?? 'passed',
    annotations: options.annotations ?? [],
    retries: 0,
    results: [],
  } as unknown as TestCase;
}

/** One attempt of a test, passed by default. */
export function fakeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    retry: 0,
    status: 'passed',
    duration: 120,
    startTime: new Date('2026-09-29T14:05:00.000Z'),
    errors: [],
    attachments: [],
    annotations: [],
    stdout: [],
    stderr: [],
    steps: [],
    workerIndex: 0,
    parallelIndex: 0,
    ...overrides,
  };
}
