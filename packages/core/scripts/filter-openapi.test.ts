import { describe, expect, it } from 'vitest';
import { filterOpenApi, type OpenApiDocument } from './filter-openapi.ts';

function fixture(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: { title: 'Fixture API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.test' }],
    security: [{ bearerAuth: [] }],
    webhooks: { ping: { post: { responses: { '200': { description: 'ok' } } } } },
    paths: {
      '/things': {
        parameters: [{ $ref: '#/components/parameters/Trace' }],
        get: {
          operationId: 'listThings',
          responses: { '200': { $ref: '#/components/responses/Unused' } },
        },
        post: {
          operationId: 'createThing',
          parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Thing' } },
            },
          },
          responses: {
            '422': {
              description: 'invalid',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/others': {
        get: {
          operationId: 'listOthers',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Other' } },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session' },
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      parameters: {
        Trace: { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        IdempotencyKey: { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } },
        UnusedParam: { name: 'X-Unused', in: 'header', schema: { type: 'string' } },
      },
      responses: {
        Unused: { description: 'only used by a dropped operation' },
      },
      schemas: {
        Thing: {
          type: 'object',
          properties: { name: { type: 'string' }, tag: { $ref: '#/components/schemas/Tag' } },
        },
        Tag: { type: 'string' },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { code: { $ref: '#/components/schemas/ApiErrorCode' } },
            },
          },
        },
        ApiErrorCode: { type: 'string', enum: ['not_found', 'conflict'] },
        Other: { type: 'object', properties: { tag: { $ref: '#/components/schemas/Tag' } } },
      },
    },
  };
}

const createThing = [{ path: '/things', method: 'post' }] as const;

describe('filterOpenApi', () => {
  it('keeps only the requested operation and the path-level fields it inherits', () => {
    const filtered = filterOpenApi(fixture(), createThing);

    expect(Object.keys(filtered['paths'] as object)).toEqual(['/things']);
    const thingsPath = (filtered['paths'] as Record<string, Record<string, unknown>>)['/things'];
    expect(Object.keys(thingsPath ?? {})).toEqual(['parameters', 'post']);
    expect((thingsPath?.['post'] as { operationId: string }).operationId).toBe('createThing');
  });

  it('keeps the components referenced transitively and drops the rest', () => {
    const filtered = filterOpenApi(fixture(), createThing);
    const components = filtered['components'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(components['schemas'] ?? {})).toEqual([
      'ApiErrorCode',
      'ErrorResponse',
      'Tag',
      'Thing',
    ]);
    expect(Object.keys(components['parameters'] ?? {})).toEqual(['IdempotencyKey', 'Trace']);
    expect(components['responses']).toBeUndefined();
  });

  it('follows a different operation to a different set of components', () => {
    const filtered = filterOpenApi(fixture(), [{ path: '/others', method: 'GET' }]);
    const components = filtered['components'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(filtered['paths'] as object)).toEqual(['/others']);
    expect(Object.keys(components['schemas'] ?? {})).toEqual(['Other', 'Tag']);
    expect(components['parameters']).toBeUndefined();
  });

  it('keeps the document metadata and every security scheme, and drops webhooks', () => {
    const filtered = filterOpenApi(fixture(), createThing);
    const components = filtered['components'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(filtered)).toEqual([
      'openapi',
      'info',
      'servers',
      'security',
      'paths',
      'components',
    ]);
    expect(filtered['info']).toEqual({ title: 'Fixture API', version: '1.0.0' });
    expect(filtered['security']).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(components['securitySchemes'] ?? {})).toEqual([
      'bearerAuth',
      'sessionCookie',
    ]);
  });

  it('emits the same output whatever order the source lists its keys in', () => {
    const source = fixture();
    const reordered = fixture();
    const schemas = (reordered['components'] as Record<string, Record<string, unknown>>)[
      'schemas'
    ] as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(schemas).reverse());
    (reordered['components'] as Record<string, unknown>)['schemas'] = reversed;

    expect(JSON.stringify(filterOpenApi(reordered, createThing))).toBe(
      JSON.stringify(filterOpenApi(source, createThing)),
    );
  });

  it('does not modify the source document', () => {
    const source = fixture();
    const snapshot = structuredClone(source);

    filterOpenApi(source, createThing);

    expect(source).toEqual(snapshot);
  });

  it('fails when a requested operation is missing from the spec', () => {
    expect(() => filterOpenApi(fixture(), [{ path: '/things', method: 'delete' }])).toThrow(
      'Operation DELETE /things is not in the OpenAPI document',
    );
  });

  it('fails when a reference points at a component that does not exist', () => {
    const broken = fixture();
    const schemas = (broken['components'] as Record<string, Record<string, unknown>>)[
      'schemas'
    ] as Record<string, unknown>;
    delete schemas['Tag'];

    expect(() => filterOpenApi(broken, createThing)).toThrow(
      'Unresolved reference #/components/schemas/Tag',
    );
  });
});
