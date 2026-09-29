/**
 * Reduces a published OpenAPI document to the operations the SDK calls, so the committed spec and
 * the generated types only carry what `@probara/core` depends on.
 */

export type OpenApiDocument = Record<string, unknown>;

export interface OperationSelector {
  readonly path: string;
  readonly method: string;
}

type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const COMPONENT_REF_PREFIX = '#/components/';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortedKeys(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** Collects every `$ref` string found anywhere inside `value`. */
function collectRefs(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string') into.push(child);
    else collectRefs(child, into);
  }
}

/**
 * Returns a new document with only `operations`, the components they reference (transitively),
 * the document metadata (`openapi`, `info`, `servers`, `security`) and every security scheme.
 * Path, method, section and component names are emitted sorted so regenerations diff cleanly.
 */
export function filterOpenApi(
  spec: OpenApiDocument,
  operations: readonly OperationSelector[],
): OpenApiDocument {
  const source = structuredClone(spec);
  const sourcePaths = isObject(source['paths']) ? source['paths'] : {};
  const sourceComponents = isObject(source['components']) ? source['components'] : {};

  const paths: Record<string, JsonObject> = {};
  for (const { path, method } of operations) {
    const lowerMethod = method.toLowerCase();
    const pathItem = sourcePaths[path];
    const operation = isObject(pathItem) ? pathItem[lowerMethod] : undefined;
    if (!isObject(pathItem) || !isObject(operation)) {
      throw new Error(`Operation ${method.toUpperCase()} ${path} is not in the OpenAPI document`);
    }
    const kept = paths[path] ?? {};
    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(key)) kept[key] = value;
    }
    kept[lowerMethod] = operation;
    paths[path] = kept;
  }

  const components: Record<string, JsonObject> = {};
  const pending: string[] = [];
  collectRefs(paths, pending);
  const visited = new Set<string>();
  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
    if (!ref.startsWith(COMPONENT_REF_PREFIX)) {
      throw new Error(`Unsupported reference ${ref}: only #/components/ references are handled`);
    }
    const [section, name] = ref
      .slice(COMPONENT_REF_PREFIX.length)
      .split('/')
      .map(decodePointerSegment);
    const key = `${section ?? ''}/${name ?? ''}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const sectionValue = section === undefined ? undefined : sourceComponents[section];
    const component = isObject(sectionValue) && name !== undefined ? sectionValue[name] : undefined;
    if (section === undefined || name === undefined || component === undefined) {
      throw new Error(`Unresolved reference ${ref}`);
    }
    (components[section] ??= {})[name] = component;
    collectRefs(component, pending);
  }
  if (isObject(sourceComponents['securitySchemes'])) {
    components['securitySchemes'] = sourceComponents['securitySchemes'];
  }

  const filtered: OpenApiDocument = { openapi: source['openapi'], info: source['info'] };
  if (source['servers'] !== undefined) filtered['servers'] = source['servers'];
  if (source['security'] !== undefined) filtered['security'] = source['security'];
  filtered['paths'] = sortedKeys(
    Object.fromEntries(Object.entries(paths).map(([path, item]) => [path, sortedKeys(item)])),
  );
  filtered['components'] = sortedKeys(
    Object.fromEntries(
      Object.entries(components).map(([section, entries]) => [section, sortedKeys(entries)]),
    ),
  );
  return filtered;
}
