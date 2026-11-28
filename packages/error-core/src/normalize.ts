export const DEFAULT_NORMALIZE_DEPTH = 3;
export const MAX_NORMALIZE_BREADTH = 1000;

function described(value: unknown): unknown {
  switch (typeof value) {
    case 'undefined':
      return '[undefined]';
    case 'number':
      return Number.isFinite(value) ? value : `[${String(value)}]`;
    case 'bigint':
      return `[BigInt: ${String(value)}]`;
    case 'symbol':
      return `[${String(value)}]`;
    case 'function':
      return `[Function: ${value.name === '' ? '<anonymous>' : value.name}]`;
    default:
      return value;
  }
}

function plainOf(value: object): object {
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: value.message };
    if (value.stack !== undefined) out['stack'] = value.stack;
    for (const key of Object.keys(value))
      out[key] = (value as unknown as Record<string, unknown>)[key];
    return out;
  }
  return value;
}

export function normalize(input: unknown, depth: number): unknown {
  const ancestors: object[] = [];
  const visit = (value: unknown, remaining: number): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return described(value);
    }
    if (typeof value === 'function') return described(value);
    if (ancestors.includes(value)) return '[Circular ~]';
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') {
      try {
        const jsonValue: unknown = toJson.call(value);
        if (jsonValue !== value) return visit(jsonValue, remaining);
      } catch {
        return '[Object]';
      }
    }
    if (remaining <= 0) return Array.isArray(value) ? '[Array]' : '[Object]';
    ancestors.push(value);
    try {
      if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (const [index, item] of value.entries()) {
          if (index >= MAX_NORMALIZE_BREADTH) {
            out.push('[MaxProperties ~]');
            break;
          }
          out.push(visit(item, remaining - 1));
        }
        return out;
      }
      const source = plainOf(value) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const key of Object.keys(source)) {
        if (count >= MAX_NORMALIZE_BREADTH) {
          out['...'] = '[MaxProperties ~]';
          break;
        }
        out[key] = visit(source[key], remaining - 1);
        count += 1;
      }
      return out;
    } finally {
      ancestors.pop();
    }
  };
  return visit(input, depth);
}

export function truncate(text: string, max: number | undefined): string {
  if (max === undefined || max <= 0 || text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
