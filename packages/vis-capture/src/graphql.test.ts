import { describe, expect, it } from 'vitest';
import { graphqlHasErrors, graphqlOperation } from './graphql.js';

const post = (body: string, contentType = 'application/json') => ({
  method: 'POST',
  url: 'https://shop.test/graphql',
  contentType,
  body,
});

describe('graphqlOperation', () => {
  it('reads the name and type of a JSON request', () => {
    expect(
      graphqlOperation(
        post(JSON.stringify({ query: 'mutation AddItem($id: ID!) { add(id: $id) { id } }' })),
      ),
    ).toEqual({ operationName: 'AddItem', operationType: 'mutation' });
  });

  it('prefers the operationName field, and finds that operation in a document of several', () => {
    const query = [
      '# the cart page',
      'fragment Line on Item { id }',
      'query Cart { cart { ...Line } }',
      'subscription Prices { price }',
    ].join('\n');
    expect(graphqlOperation(post(JSON.stringify({ query, operationName: 'Prices' })))).toEqual({
      operationName: 'Prices',
      operationType: 'subscription',
    });
    expect(graphqlOperation(post(JSON.stringify({ query })))).toEqual({
      operationName: 'Cart',
      operationType: 'query',
    });
  });

  it('reads the shorthand and anonymous forms as unnamed queries', () => {
    expect(graphqlOperation(post('{"query":"{ cart { id } }"}'))).toEqual({
      operationName: null,
      operationType: 'query',
    });
    expect(graphqlOperation(post('{"query":"mutation { clear }"}'))).toEqual({
      operationName: null,
      operationType: 'mutation',
    });
  });

  it('ignores keywords inside strings and comments', () => {
    const query = '# mutation Fake\nquery Search { find(text: "mutation Other") { id } }';
    expect(graphqlOperation(post(JSON.stringify({ query })))).toEqual({
      operationName: 'Search',
      operationType: 'query',
    });
  });

  it('names every operation of a batched array, with the type of the first', () => {
    const body = JSON.stringify([
      { query: 'query Cart { cart { id } }' },
      { query: 'mutation Pay { pay }', operationName: 'Pay' },
    ]);
    expect(graphqlOperation(post(body))).toEqual({
      operationName: 'Cart, Pay',
      operationType: 'query',
    });
  });

  it('reads a persisted query that sends only its name', () => {
    const body = JSON.stringify({
      operationName: 'Cart',
      extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } },
    });
    expect(graphqlOperation(post(body))).toEqual({ operationName: 'Cart', operationType: null });
  });

  it('reads a GET request from its query parameters', () => {
    const url = `https://shop.test/graphql?query=${encodeURIComponent('query Cart { cart { id } }')}`;
    expect(graphqlOperation({ method: 'GET', url, contentType: null, body: null })).toEqual({
      operationName: 'Cart',
      operationType: 'query',
    });
    expect(
      graphqlOperation({
        method: 'GET',
        url: 'https://shop.test/graphql?operationName=Cart&extensions=%7B%7D',
        contentType: null,
        body: null,
      }),
    ).toEqual({ operationName: 'Cart', operationType: null });
  });

  it('reads a body sent as application/graphql', () => {
    expect(graphqlOperation(post('query Cart { cart { id } }', 'application/graphql'))).toEqual({
      operationName: 'Cart',
      operationType: 'query',
    });
  });

  it('is null for requests that are not GraphQL', () => {
    expect(graphqlOperation(post('{"user":"ana"}'))).toBeNull();
    expect(graphqlOperation(post('{"query":"pizza"}'))).toBeNull();
    expect(graphqlOperation(post('[1, 2]'))).toBeNull();
    expect(graphqlOperation(post('{"query": "query Cart { cart'))).toBeNull();
    expect(graphqlOperation(post('query=shoes', 'application/x-www-form-urlencoded'))).toBeNull();
    expect(
      graphqlOperation({
        method: 'GET',
        url: 'https://shop.test/search?query=shoes',
        contentType: null,
        body: null,
      }),
    ).toBeNull();
  });
});

describe('graphqlHasErrors', () => {
  it('is true when a response, or one of a batch, carries errors', () => {
    expect(graphqlHasErrors('{"data":null,"errors":[{"message":"Not found"}]}')).toBe(true);
    expect(graphqlHasErrors('[{"data":{}},{"errors":[{"message":"x"}]}]')).toBe(true);
  });

  it('is false without errors, with an empty list, or when the body is not JSON', () => {
    expect(graphqlHasErrors('{"data":{"cart":null}}')).toBe(false);
    expect(graphqlHasErrors('{"data":{},"errors":[]}')).toBe(false);
    expect(graphqlHasErrors('{"errors":[{"mess')).toBe(false);
    expect(graphqlHasErrors(null)).toBe(false);
  });
});
