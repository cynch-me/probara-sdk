/**
 * Turns one console argument into the string a Vis stores. Never throws: a value that cannot be
 * read becomes `[Unserializable]`. Objects become JSON, with the values JSON cannot hold
 * (functions, bigint, cycles, DOM nodes) written as strings.
 */

/** The most characters one serialized argument keeps. */
export const MAX_ARGUMENT_LENGTH = 5000;

export interface SerializeOptions {
  /** The most characters of the result; longer results end with `…`. Default 5000. */
  maxLength?: number;
  /** How many levels of objects and arrays are written. Default 4. */
  maxDepth?: number;
  /** How many keys of an object, or items of an array, are written. Default 50. */
  maxKeys?: number;
}

interface Limits {
  maxLength: number;
  maxDepth: number;
  maxKeys: number;
}

const UNSERIALIZABLE = '[Unserializable]';
const MAX_ATTRIBUTES = 10;
const MAX_ATTRIBUTE_LENGTH = 200;
/** Attributes that may hold what a user typed. */
const SKIPPED_ATTRIBUTES = new Set(['value']);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Fields = Record<string, unknown>;

export function serializeArgument(value: unknown, options: SerializeOptions = {}): string {
  const limits: Limits = {
    maxLength: options.maxLength ?? MAX_ARGUMENT_LENGTH,
    maxDepth: options.maxDepth ?? 4,
    maxKeys: options.maxKeys ?? 50,
  };
  let text: string;
  try {
    if (typeof value === 'string') text = value;
    else text = describe(value) ?? JSON.stringify(toPlain(value, 0, new Set(), limits));
  } catch {
    text = UNSERIALIZABLE;
  }
  return cap(text, limits.maxLength);
}

function cap(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = Math.max(0, maxLength - 1);
  // Never split a surrogate pair.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + '…';
}

function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value);
}

/** The text of the values the console shows as text rather than as an object. */
function describe(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name === '' ? '(anonymous)' : value.name}]`;
  }
  if (value === null) return 'null';
  const tag = tagOf(value);
  if (tag === '[object Error]' || value instanceof Error) return errorText(value as Fields);
  if (tag === '[object RegExp]') return RegExp.prototype.toString.call(value);
  if (tag === '[object Window]') return '[Window]';
  return nodeText(value as Fields);
}

function errorText(error: Fields): string {
  const name = typeof error['name'] === 'string' ? error['name'] : 'Error';
  const message = typeof error['message'] === 'string' ? error['message'] : '';
  const head = message === '' ? name : `${name}: ${message}`;
  const stack = typeof error['stack'] === 'string' ? error['stack'] : '';
  if (stack === '') return head;
  // V8 starts the stack with the head; Firefox and Safari do not.
  return stack.startsWith(head) ? stack : `${head}\n${stack}`;
}

/** A DOM node as the console names it; `undefined` for anything else. */
function nodeText(value: Fields): string | undefined {
  if (typeof value['nodeType'] !== 'number' || typeof value['nodeName'] !== 'string') {
    return undefined;
  }
  switch (value['nodeType']) {
    case 1:
      return openingTag(value);
    case 3:
      return `#text ${JSON.stringify(String(value['data']))}`;
    case 9:
      return '#document';
    default:
      return value['nodeName'];
  }
}

function openingTag(element: Fields): string {
  const tag = String(element['tagName']).toLowerCase();
  const attributes = element['attributes'] as ArrayLike<{ name: string; value: string }>;
  let text = `<${tag}`;
  let written = 0;
  for (const { name, value } of Array.from(attributes)) {
    if (SKIPPED_ATTRIBUTES.has(name.toLowerCase())) continue;
    if (written++ === MAX_ATTRIBUTES) break;
    const shown = cap(value, MAX_ATTRIBUTE_LENGTH).replaceAll('"', '&quot;');
    text += ` ${name}="${shown}"`;
  }
  return text + '>';
}

function plural(count: number, noun: string): string {
  return `${count} more ${noun}${count === 1 ? '' : 's'}`;
}

/** `value` as JSON can hold it, within the limits. */
function toPlain(value: unknown, depth: number, ancestors: Set<object>, limits: Limits): JsonValue {
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value !== 'object') return describe(value) ?? UNSERIALIZABLE;
  const special = describe(value);
  if (special !== undefined) return special;
  if (value instanceof Date || tagOf(value) === '[object Date]') {
    const time = (value as Date).getTime();
    return Number.isNaN(time) ? 'Invalid Date' : (value as Date).toISOString();
  }
  if (ancestors.has(value)) return '[Circular]';
  if (depth >= limits.maxDepth) {
    return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  }
  ancestors.add(value);
  try {
    const child = (read: () => unknown): JsonValue => {
      try {
        return toPlain(read(), depth + 1, ancestors, limits);
      } catch {
        return UNSERIALIZABLE;
      }
    };
    const list = (items: readonly unknown[], noun: string): JsonValue[] => {
      const out = items.slice(0, limits.maxKeys).map((_, i) => child(() => items[i]));
      if (items.length > limits.maxKeys)
        out.push(`… ${plural(items.length - limits.maxKeys, noun)}`);
      return out;
    };
    if (Array.isArray(value)) return list(value, 'item');
    if (value instanceof Map) return { '[Map]': list([...value.entries()], 'entry') };
    if (value instanceof Set) return { '[Set]': list([...value.values()], 'item') };
    const keys = Object.keys(value);
    const out: { [key: string]: JsonValue } = {};
    for (const key of keys.slice(0, limits.maxKeys)) {
      out[key] = child(() => (value as Fields)[key]);
    }
    if (keys.length > limits.maxKeys) out['…'] = plural(keys.length - limits.maxKeys, 'key');
    return out;
  } finally {
    ancestors.delete(value);
  }
}
