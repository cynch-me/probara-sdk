import { describe, expect, it } from 'vitest';
import { isInApp, parseStackTrace } from './index.js';

describe('parseStackTrace', () => {
  it('reads V8 stacks, outermost frame first, the crashing frame last', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      '    at loadCart (https://shop.test/assets/app.js:10:15)',
      '    at async Promise.all (index 0)',
      '    at https://shop.test/assets/app.js:20:3',
      '    at Object.<anonymous> (https://shop.test/node_modules/lib/index.js:5:1)',
      '    at new Widget (https://shop.test/assets/widget.js:3:9)',
    ].join('\n');
    expect(parseStackTrace(stack)).toEqual([
      {
        filename: 'https://shop.test/assets/widget.js',
        function: 'new Widget',
        lineno: 3,
        colno: 9,
        in_app: true,
      },
      {
        filename: 'https://shop.test/node_modules/lib/index.js',
        function: 'Object.<anonymous>',
        lineno: 5,
        colno: 1,
        in_app: false,
      },
      {
        filename: 'https://shop.test/assets/app.js',
        function: '?',
        lineno: 20,
        colno: 3,
        in_app: true,
      },
      {
        filename: 'https://shop.test/assets/app.js',
        function: 'loadCart',
        lineno: 10,
        colno: 15,
        in_app: true,
      },
    ]);
  });

  it('reads SpiderMonkey stacks', () => {
    const stack = [
      'loadCart@https://shop.test/assets/app.js:10:15',
      '@https://shop.test/assets/app.js:20:3',
      'handler/<@https://shop.test/assets/app.js:30:7',
    ].join('\n');
    expect(
      parseStackTrace(stack).map((frame) => [frame.function, frame.lineno, frame.colno]),
    ).toEqual([
      ['handler/<', 30, 7],
      ['?', 20, 3],
      ['loadCart', 10, 15],
    ]);
  });

  it('reads JavaScriptCore stacks, native frames out of the app', () => {
    const stack = [
      'loadCart@https://shop.test/assets/app.js:10:15',
      'forEach@[native code]',
      'global code@https://shop.test/assets/app.js:20:3',
    ].join('\n');
    expect(parseStackTrace(stack)).toEqual([
      {
        filename: 'https://shop.test/assets/app.js',
        function: 'global code',
        lineno: 20,
        colno: 3,
        in_app: true,
      },
      { filename: '[native code]', function: 'forEach', in_app: false },
      {
        filename: 'https://shop.test/assets/app.js',
        function: 'loadCart',
        lineno: 10,
        colno: 15,
        in_app: true,
      },
    ]);
  });

  it('marks runtime internals and browser extensions as not in the app', () => {
    const stack = [
      'Error: x',
      '    at Module._compile (node:internal/modules/cjs/loader:1256:14)',
      '    at inject (chrome-extension://abcdef/content.js:1:2)',
      '    at main (/srv/app/src/index.js:3:1)',
    ].join('\n');
    expect(parseStackTrace(stack).map((frame) => [frame.filename, frame.in_app])).toEqual([
      ['/srv/app/src/index.js', true],
      ['chrome-extension://abcdef/content.js', false],
      ['node:internal/modules/cjs/loader', false],
    ]);
  });

  it('is empty for text without frames', () => {
    expect(parseStackTrace('Error: nothing here')).toEqual([]);
  });

  it('marks Windows dependency paths as not in the app', () => {
    expect(isInApp('C:\\app\\node_modules\\lib\\index.js')).toBe(false);
    expect(isInApp('C:\\app\\src\\index.js')).toBe(true);
  });
});
