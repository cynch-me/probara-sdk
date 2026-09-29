# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.js >> login >> crashes on an unexpected exception
- Location: tests/login.spec.js:15:3

# Error details

```
TypeError: Cannot read properties of undefined (reading "token")
```

# Test source

```ts
  1  | // @ts-check
  2  | const path = require('node:path');
  3  | const { test, expect } = require('@playwright/test');
  4  | 
  5  | // No `page` fixture anywhere: these tests never launch a browser.
  6  | test.describe('login', () => {
  7  |   test('PRB-12 logs in with a valid password', async () => {
  8  |     expect(1 + 1).toBe(2);
  9  |   });
  10 | 
  11 |   test('rejects a wrong password', async () => {
  12 |     expect('denied').toBe('granted');
  13 |   });
  14 | 
  15 |   test('crashes on an unexpected exception', async () => {
> 16 |     throw new TypeError('Cannot read properties of undefined (reading "token")');
     |           ^ TypeError: Cannot read properties of undefined (reading "token")
  17 |   });
  18 | 
  19 |   test('supports SSO', async () => {
  20 |     test.skip(true, 'SSO provider not configured');
  21 |   });
  22 | 
  23 |   test.describe('session', () => {
  24 |     test.describe('refresh', () => {
  25 |       test('renews the token before expiry', async () => {
  26 |         expect([1, 2]).toHaveLength(2);
  27 |       });
  28 |     });
  29 |   });
  30 | 
  31 |   for (const [name, length] of [['alice', 5], ['bob', 3]]) {
  32 |     test(`username ${name} has length ${length}`, async () => {
  33 |       expect(name).toHaveLength(length);
  34 |     });
  35 |   }
  36 | 
  37 |   test('records a probara case annotation', {
  38 |     annotation: { type: 'issue', description: 'https://example.com/issues/42' },
  39 |     tag: '@smoke',
  40 |   }, async () => {
  41 |     test.info().annotations.push({ type: 'probara_case', description: 'PRB-13' });
  42 |     expect(true).toBe(true);
  43 |   });
  44 | 
  45 |   test('attaches a file and a body', async ({}, testInfo) => {
  46 |     await testInfo.attach('screenshot', { path: path.join(__dirname, '..', 'assets', 'pixel.png'), contentType: 'image/png' });
  47 |     await testInfo.attach('server-log', { path: path.join(__dirname, '..', 'assets', 'server.log.txt'), contentType: 'text/plain' });
  48 |     await testInfo.attach('note', { body: 'inline body attachment', contentType: 'text/plain' });
  49 |     expect(true).toBe(true);
  50 |   });
  51 | 
  52 |   test('prints to stdout and stderr', async () => {
  53 |     console.log('hello from stdout');
  54 |     console.error('hello from stderr');
  55 |     process.stdout.write('raw stdout line\n');
  56 |     process.stderr.write('raw stderr line\n');
  57 |   });
  58 | 
  59 |   test('accepts café and ñandú', async () => {
  60 |     expect('café ñandú').toContain('ñandú');
  61 |   });
  62 | 
  63 |   test('is flaky and passes on retry', async ({}, testInfo) => {
  64 |     expect(testInfo.retry).toBe(1);
  65 |   });
  66 | });
  67 | 
  68 | test('[PRB-14] top-level test outside any describe', async () => {
  69 |   expect(true).toBe(true);
  70 | });
  71 | 
```