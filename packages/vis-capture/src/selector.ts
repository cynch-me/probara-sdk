/**
 * A short, stable CSS path of an element, for user event entries: an id or a test attribute
 * when one is readable, otherwise tag names with `:nth-of-type` up to the nearest such anchor,
 * at most five steps long.
 */

/** Attributes test suites put on elements on purpose, so they survive redesigns. */
const TEST_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];

const MAX_STEPS = 5;

/**
 * An id written by a person: it starts with a letter, holds only letters, digits, `-` and `_`,
 * and no run of four digits or more (`ember1234`, `:r12:` and the like change on every load).
 */
function isStableId(id: string): boolean {
  return /^[A-Za-z][\w-]*$/.test(id) && !/\d{4}/.test(id);
}

/** A double-quoted CSS string. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;
}

/** The selector of `element` alone when it carries a stable id or a test attribute. */
function anchorOf(element: Element): string | undefined {
  const id = element.getAttribute('id');
  if (id !== null && isStableId(id)) return `#${id}`;
  for (const name of TEST_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value !== null && value !== '') return `[${name}=${quote(value)}]`;
  }
  return undefined;
}

/** The tag of `element`, with `:nth-of-type` when a sibling shares it. */
function stepOf(element: Element): string {
  const tag = element.localName;
  const parent = element.parentElement;
  if (parent === null) return tag;
  let index = 0;
  let position = 0;
  for (const sibling of parent.children) {
    if (sibling.localName !== tag) continue;
    index += 1;
    if (sibling === element) position = index;
  }
  return index > 1 ? `${tag}:nth-of-type(${position})` : tag;
}

/** The CSS path of `element`, such as `#checkout > div > p:nth-of-type(3) > span`. */
export function cssSelector(element: Element): string {
  const steps: string[] = [];
  let current: Element | null = element;
  while (current !== null && steps.length < MAX_STEPS) {
    const anchor = anchorOf(current);
    if (anchor !== undefined) {
      steps.unshift(anchor);
      break;
    }
    const tag = current.localName;
    if (tag === 'html' || tag === 'body') {
      steps.unshift(tag);
      break;
    }
    steps.unshift(stepOf(current));
    current = current.parentElement;
  }
  return steps.join(' > ');
}
