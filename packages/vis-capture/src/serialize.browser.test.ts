import { describe, expect, it } from 'vitest';
import { serializeArgument } from './index.js';

describe('serializing DOM values', () => {
  it('writes an element as its opening tag', () => {
    const button = document.createElement('button');
    button.id = 'pay';
    button.className = 'primary large';
    button.textContent = 'Pay now';
    expect(serializeArgument(button)).toBe('<button id="pay" class="primary large">');
  });

  it('writes text nodes, documents and the window by their kind', () => {
    expect(serializeArgument(document.createTextNode('hello'))).toBe('#text "hello"');
    expect(serializeArgument(document)).toBe('#document');
    expect(serializeArgument(window)).toBe('[Window]');
  });

  it('writes elements inside objects without walking the DOM', () => {
    const input = document.createElement('input');
    input.name = 'email';
    expect(serializeArgument({ field: input })).toBe('{"field":"<input name=\\"email\\">"}');
  });
});
