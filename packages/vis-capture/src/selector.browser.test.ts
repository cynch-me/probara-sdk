/**
 * The CSS path of an element, in a real Chromium page: short, stable, and pointing back at the
 * element it was taken from.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cssSelector } from './selector.js';

const roots: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.remove();
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  roots.push(root);
  return root;
}

function find(root: HTMLElement, selector: string): Element {
  const element = root.querySelector(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

describe('cssSelector', () => {
  it('uses a readable id alone', () => {
    const root = mount('<form><button id="save-button">Save</button></form>');
    expect(cssSelector(find(root, 'button'))).toBe('#save-button');
  });

  it('prefers a test attribute, with its value quoted', () => {
    const root = mount('<ul><li><a data-testid="open \'menu\'">Menu</a></li></ul>');
    const link = find(root, 'a');
    const selector = cssSelector(link);
    expect(selector).toBe('[data-testid="open \'menu\'"]');
    expect(document.querySelector(selector)).toBe(link);
  });

  it('ignores generated ids and walks up to a stable anchor with nth-of-type', () => {
    const root = mount(
      '<section id="checkout"><div><p>a</p><p>b</p><p id=":r12:"><span>c</span></p></div></section>',
    );
    const span = find(root, 'span');
    const selector = cssSelector(span);
    expect(selector).toBe('#checkout > div > p:nth-of-type(3) > span');
    expect(document.querySelector(selector)).toBe(span);
  });

  it('ignores ids with long digit runs, which change between page loads', () => {
    const root = mount('<div id="cart"><i id="ember12345">x</i></div>');
    expect(cssSelector(find(root, 'i'))).toBe('#cart > i');
  });

  it('keeps at most five steps when no anchor is near', () => {
    const root = mount(
      '<div><div><div><div><div><div><div><b>deep</b></div></div></div></div></div></div></div>',
    );
    const selector = cssSelector(find(root, 'b'));
    expect(selector.split(' > ')).toHaveLength(5);
    expect(selector.endsWith('div > b')).toBe(true);
  });

  it('names the document element and body by their tags', () => {
    expect(cssSelector(document.body)).toBe('body');
    expect(cssSelector(document.documentElement)).toBe('html');
  });
});
