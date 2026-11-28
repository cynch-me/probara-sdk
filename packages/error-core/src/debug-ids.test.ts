import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type ProbaraEvent } from './index.js';

const DSN = 'https://pek_test@ingest.probara.test/';
const registry = globalThis as { _probaraDebugIds?: Record<string, string> };

function setUp() {
  const payloads: string[] = [];
  const client = createClient({
    dsn: DSN,
    platform: 'node',
    sdk: { name: 'probara.javascript.test', version: '1.2.3' },
    send: (body) => {
      payloads.push(new TextDecoder().decode(body));
      return Promise.resolve({ status: 200, body: { id: 'x', replay: 'skip' } });
    },
  });
  if (client === null) throw new Error('no client');
  const events = () =>
    payloads.map((text) => JSON.parse(text.split('\n')[2] ?? '{}') as ProbaraEvent);
  return { client, events };
}

/** An error whose stack has one frame per file, the innermost last in the list. */
function errorIn(...files: string[]): Error {
  const error = new Error('boom');
  error.stack = [
    'Error: boom',
    ...files.map((file, index) => `    at f${index} (${file}:1:${index + 10})`),
  ].join('\n');
  return error;
}

/** What the snippet `probara sourcemaps inject` adds registers: the stack of an error made in `file`. */
function registered(file: string): string {
  return `Error\n    at ${file}:1:42\n    at load (https://cdn.example.com/loader.js:9:1)`;
}

afterEach(() => {
  delete registry._probaraDebugIds;
});

describe('debug IDs of injected files', () => {
  it('lists the debug ID of each frame file the injected snippet registered, once per file', async () => {
    registry._probaraDebugIds = {
      [registered('https://cdn.example.com/assets/app.min.js')]:
        'a1b2c3d4-0000-4000-8000-000000000001',
      [registered('https://cdn.example.com/assets/vendor.min.js')]:
        'a1b2c3d4-0000-4000-8000-000000000002',
    };
    const { client, events } = setUp();
    client.captureException(
      errorIn(
        'https://cdn.example.com/assets/app.min.js',
        'https://cdn.example.com/assets/other.js',
        'https://cdn.example.com/assets/app.min.js',
      ),
    );
    await client.flush();
    expect(events()[0]?.debug_meta).toEqual({
      images: [
        {
          type: 'sourcemap',
          code_file: 'https://cdn.example.com/assets/app.min.js',
          debug_id: 'a1b2c3d4-0000-4000-8000-000000000001',
        },
      ],
    });
  });

  it('sends no debug_meta when no frame file has a debug ID', async () => {
    registry._probaraDebugIds = {
      [registered('https://cdn.example.com/assets/vendor.min.js')]:
        'a1b2c3d4-0000-4000-8000-000000000002',
    };
    const { client, events } = setUp();
    client.captureException(errorIn('https://cdn.example.com/assets/app.min.js'));
    await client.flush();
    expect(events()[0]).not.toHaveProperty('debug_meta');
  });

  it('picks up files registered after the first event, such as a chunk loaded later', async () => {
    registry._probaraDebugIds = {
      [registered('https://cdn.example.com/assets/app.min.js')]:
        'a1b2c3d4-0000-4000-8000-000000000001',
    };
    const { client, events } = setUp();
    client.captureException(errorIn('https://cdn.example.com/assets/chunk.min.js'));
    registry._probaraDebugIds[registered('https://cdn.example.com/assets/chunk.min.js')] =
      'a1b2c3d4-0000-4000-8000-000000000003';
    client.captureException(errorIn('https://cdn.example.com/assets/chunk.min.js', 'x:/second.js'));
    await client.flush();
    expect(
      events().map((event) => event.debug_meta?.images.map((image) => image.debug_id)),
    ).toEqual([undefined, ['a1b2c3d4-0000-4000-8000-000000000003']]);
  });

  it('resolves the files of a Node bundle from a real stack made in it', async () => {
    registry._probaraDebugIds = {
      [new Error().stack ?? '']: 'a1b2c3d4-0000-4000-8000-000000000004',
    };
    const { client, events } = setUp();
    client.captureException(new Error('thrown in this file'));
    await client.flush();
    const image = events()[0]?.debug_meta?.images[0];
    expect(image?.debug_id).toBe('a1b2c3d4-0000-4000-8000-000000000004');
    expect(image?.code_file).toContain('debug-ids.test.ts');
  });
});
