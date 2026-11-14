/**
 * The blur controller in a real Chromium page: what it marks renders blurred, so a screen
 * recording shows it blurred, and stop puts the page back as it was.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BLUR_ATTRIBUTE, createBlurController, type BlurController } from './blur.js';

const roots: HTMLElement[] = [];
const controllers: BlurController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  for (const root of roots.splice(0)) root.remove();
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  roots.push(root);
  return root;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

function controller(): BlurController {
  const blur = createBlurController();
  controllers.push(blur);
  return blur;
}

const filterOf = (element: Element): string => getComputedStyle(element).filter;

describe('createBlurController', () => {
  it('blurs a marked element and its content, and unmarks it on stop', () => {
    const root = mount('<p id="card">4111 <b>secret</b></p><p id="other">plain</p>');
    const card = find(root, '#card');
    card.style.filter = 'opacity(0.9)';
    const blur = controller();

    blur.blur(card);
    expect(filterOf(card)).toMatch(/^blur\(/);
    expect(card.hasAttribute(BLUR_ATTRIBUTE)).toBe(true);
    expect(blur.isBlurred(find(card, 'b'))).toBe(true);
    expect(blur.isBlurred(find(root, '#other'))).toBe(false);
    expect(filterOf(find(root, '#other'))).toBe('none');

    blur.stop();
    expect(card.hasAttribute(BLUR_ATTRIBUTE)).toBe(false);
    expect(card.style.filter).toBe('opacity(0.9)');
    expect(blur.isBlurred(card)).toBe(false);
  });

  it('blurs every element a selector matches, also those added later, until stop', () => {
    const root = mount('<span class="email">a@b.c</span>');
    const blur = controller();
    const sheetsBefore = document.adoptedStyleSheets.length;

    blur.blur('.email');
    const later = document.createElement('span');
    later.className = 'email';
    root.append(later);
    expect(filterOf(find(root, '.email'))).toMatch(/^blur\(/);
    expect(filterOf(later)).toMatch(/^blur\(/);
    expect(blur.isBlurred(later)).toBe(true);

    blur.unblur('.email');
    expect(filterOf(later)).toBe('none');
    blur.blur('.email');
    blur.stop();
    expect(filterOf(later)).toBe('none');
    expect(document.adoptedStyleSheets).toHaveLength(sheetsBefore);
  });

  it('unblurs one element and leaves the others blurred', () => {
    const root = mount('<i id="a">a</i><i id="b">b</i>');
    const blur = controller();
    blur.blur(find(root, '#a'));
    blur.blur(find(root, '#b'));
    blur.unblur(find(root, '#a'));
    expect(filterOf(find(root, '#a'))).toBe('none');
    expect(blur.isBlurred(find(root, '#b'))).toBe(true);
  });

  it('names everything blurred in one selector, for the replay to block', () => {
    const blur = controller();
    expect(blur.selector).toBe(`[${BLUR_ATTRIBUTE}]`);
    blur.blur('.email');
    blur.blur('#card');
    expect(blur.selector).toBe(`[${BLUR_ATTRIBUTE}], .email, #card`);
  });

  it('tells subscribers when what is blurred changes', () => {
    const root = mount('<i>a</i>');
    const blur = controller();
    let changes = 0;
    const unsubscribe = blur.subscribe(() => {
      changes += 1;
    });
    blur.blur(find(root, 'i'));
    blur.blur('.x');
    blur.blur('.x');
    unsubscribe();
    blur.unblur('.x');
    expect(changes).toBe(2);
  });

  it('refuses a selector that is not valid CSS, and blurs nothing for it', () => {
    const blur = controller();
    expect(() => {
      blur.blur('div[');
    }).toThrow(TypeError);
    expect(blur.selector).toBe(`[${BLUR_ATTRIBUTE}]`);
  });
});
