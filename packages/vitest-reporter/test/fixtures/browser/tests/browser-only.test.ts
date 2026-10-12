import { OUTSIDE_FILE } from './outside-file';
import { probara } from '@probara/vitest-reporter';
import { expect, it } from 'vitest';

// Browser mode only: the paths of Vite's file access, concurrent tests, the console, and a failure with a screenshot.

it('leaves out a file outside the folders Vite serves, with a warning', async () => {
  // The path is written by the end-to-end test beside this file (it is the planted file, outside the project).
  await probara.attach({ name: 'outside', path: OUTSIDE_FILE });
});

it.concurrent('is a concurrent test whose helper cannot be attributed', () => {
  probara.comment('written by a concurrent test');
});

it('prints a line to the console', () => {
  console.log('hello from the browser');
});

it('fails, so that Vitest takes a screenshot of the page', () => {
  expect(1).toBe(2);
});
