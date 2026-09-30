import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test.describe('multi', () => {
  test('WEB-3 opens the home page', () => {});

  test('covers a case of PRB and one of API', () => {
    probara.id(['PRB-40', 'API-2']);
  });

  test('creates a case in the configured project', () => {});

  test('OPS-1 links a project that is not listed', () => {
    probara.id('OPS-1');
  });
});
