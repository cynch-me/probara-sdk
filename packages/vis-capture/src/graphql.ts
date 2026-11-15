/**
 * GraphQL detection: the operation a request carries (a JSON body, a batched array, an
 * `application/graphql` body or the query parameters of a GET) and whether its response holds
 * `errors`, which GraphQL servers usually return with HTTP 200.
 */
import type { GraphqlInfo, GraphqlOperationType } from './entries.js';

/** The request a GraphQL operation is read from. */
export interface GraphqlRequest {
  method: string;
  url: string;
  contentType: string | null;
  /** The captured text of the body; `null` when none was captured. */
  body: string | null;
}

export type GraphqlOperation = Pick<GraphqlInfo, 'operationName' | 'operationType'>;

interface Definition {
  name: string | null;
  type: GraphqlOperationType;
}

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `document` with its strings and comments blanked, so their words are not read as keywords. */
function withoutStringsAndComments(document: string): string {
  let out = '';
  let i = 0;
  while (i < document.length) {
    const char = document.charAt(i);
    if (char === '#') {
      const end = document.indexOf('\n', i);
      i = end === -1 ? document.length : end;
      out += ' ';
    } else if (document.startsWith('"""', i)) {
      const end = document.indexOf('"""', i + 3);
      i = end === -1 ? document.length : end + 3;
      out += ' ';
    } else if (char === '"') {
      i += 1;
      while (i < document.length && document[i] !== '"' && document[i] !== '\n') {
        i += document[i] === '\\' ? 2 : 1;
      }
      i += 1;
      out += ' ';
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

const HEADER = /^(query|mutation|subscription|fragment)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/;

/** The operations of a GraphQL document, fragments left out; `null` when it is not one. */
function operationsOf(document: string): Definition[] | null {
  const headers: string[] = [];
  let depth = 0;
  let header = '';
  for (const char of withoutStringsAndComments(document)) {
    if (char === '{') {
      if (depth === 0) {
        headers.push(header.trim());
        header = '';
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (depth === 0) {
      header += char;
    }
  }
  // A document cut short, or text without a selection set.
  if (depth !== 0 || header.trim() !== '' || headers.length === 0) return null;
  const operations: Definition[] = [];
  for (const text of headers) {
    if (text === '') {
      operations.push({ name: null, type: 'query' });
      continue;
    }
    const match = HEADER.exec(text);
    if (match === null) return null;
    const keyword = match[1] as GraphqlOperationType | 'fragment';
    if (keyword !== 'fragment') operations.push({ name: match[2] ?? null, type: keyword });
  }
  return operations.length === 0 ? null : operations;
}

/** The operation of one request: `query` (the document) and `operationName`. */
function operationOf(
  query: unknown,
  operationName: unknown,
  persisted: boolean,
): GraphqlOperation | null {
  const name = typeof operationName === 'string' && operationName !== '' ? operationName : null;
  if (typeof query !== 'string') {
    return persisted && name !== null ? { operationName: name, operationType: null } : null;
  }
  const operations = operationsOf(query);
  if (operations === null) return null;
  if (name === null) {
    const first = operations[0] as Definition;
    return { operationName: first.name, operationType: first.type };
  }
  const named = operations.find((operation) => operation.name === name);
  const type = named?.type ?? (operations.length === 1 ? (operations[0] as Definition).type : null);
  return { operationName: name, operationType: type };
}

function fromJson(value: unknown): GraphqlOperation | null {
  if (isObject(value)) {
    return operationOf(value['query'], value['operationName'], isObject(value['extensions']));
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const operations: GraphqlOperation[] = [];
  for (const item of value) {
    const operation = fromJson(isObject(item) ? item : undefined);
    if (operation === null) return null;
    operations.push(operation);
  }
  const names = operations.flatMap((operation) =>
    operation.operationName === null ? [] : [operation.operationName],
  );
  return {
    operationName: names.length === 0 ? null : names.join(', '),
    operationType: (operations[0] as GraphqlOperation).operationType,
  };
}

function fromBody(body: string, contentType: string | null): GraphqlOperation | null {
  if (contentType !== null && /application\/graphql(?![-+\w])/i.test(contentType)) {
    return operationOf(body, undefined, false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return fromJson(parsed);
}

function fromUrl(url: string): GraphqlOperation | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  let extensions: unknown;
  try {
    extensions = JSON.parse(params.get('extensions') ?? 'null');
  } catch {
    extensions = undefined;
  }
  return operationOf(
    params.get('query') ?? undefined,
    params.get('operationName') ?? undefined,
    isObject(extensions),
  );
}

/**
 * The GraphQL operation a request carries; `null` when it is not a GraphQL request. A batched
 * array names every operation, comma-separated, with the type of the first.
 */
export function graphqlOperation(request: GraphqlRequest): GraphqlOperation | null {
  try {
    if (request.body !== null && request.body !== '') {
      const operation = fromBody(request.body, request.contentType);
      if (operation !== null) return operation;
    }
    return fromUrl(request.url);
  } catch {
    return null;
  }
}

/** The response body holds a non-empty `errors` list (in any item of a batch). */
export function graphqlHasErrors(body: string | null): boolean {
  if (body === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.some(
    (item) => isObject(item) && Array.isArray(item['errors']) && item['errors'].length > 0,
  );
}
