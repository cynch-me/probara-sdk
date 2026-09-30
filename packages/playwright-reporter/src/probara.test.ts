import type { TestInfo } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { METADATA_CONTENT_TYPE, parseStepTitle, readMetadata, stepTitle } from './metadata.js';
import { createProbara, probara } from './probara.js';

type Attachment = TestInfo['attachments'][number];

/** The members of a TestInfo the helpers use, recording what they did. */
function fakeTestInfo() {
  const info = {
    annotations: [] as TestInfo['annotations'],
    attachments: [] as Attachment[],
    attach: vi.fn(async (name: string, options: Partial<Omit<Attachment, 'name'>>) => {
      await Promise.resolve();
      info.attachments.push({ name, ...options, contentType: options.contentType ?? 'text/plain' });
    }),
  };
  return info;
}

function setup() {
  const info = fakeTestInfo();
  const warnings: string[] = [];
  const helpers = createProbara(
    () => info as unknown as TestInfo,
    (message) => warnings.push(message),
  );
  return { info, warnings, helpers, metadata: () => readMetadata(info.attachments) };
}

describe('probara helpers', () => {
  it('link cases through probara_case annotations, which the JUnit import reads too', () => {
    const { info, helpers } = setup();
    helpers.id('PRB-1');
    helpers.id(['PRB-2', ' PRB-3 ']);
    expect(info.annotations).toEqual([
      { type: 'probara_case', description: 'PRB-1' },
      { type: 'probara_case', description: 'PRB-2, PRB-3' },
    ]);
    expect(info.attachments).toEqual([]);
  });

  it('send the title, suite and comment of the attempt as metadata attachments: the last call wins', () => {
    const { info, helpers, metadata } = setup();
    helpers.title('First title').title('Checkout with a saved card');
    helpers.suite('Payments').suite(['Payments', ' Cards ']);
    helpers.comment('Checked on staging');

    expect(info.attachments.every((attachment) => attachment.name === '_probara')).toBe(true);
    expect(info.attachments.map((attachment) => attachment.contentType)).toEqual(
      Array(5).fill(METADATA_CONTENT_TYPE),
    );
    expect(metadata().problems).toEqual([]);
    expect(metadata().metadata).toMatchObject({
      title: 'Checkout with a saved card',
      suitePath: ['Payments', 'Cards'],
      comment: 'Checked on staging',
      ignored: false,
    });
  });

  it('merge parameters and fields by name, accumulate tags, and mark an ignored attempt', () => {
    const { helpers, metadata } = setup();
    helpers.parameters({ browser: 'chromium', retries: 2 });
    helpers.parameters({ browser: 'firefox', headless: true });
    helpers.tags('smoke', 'checkout').tags('smoke', ' regression ');
    helpers.fields({ severity: 'critical', description: 'Pays with a card' });
    helpers.fields({ severity: 'major', 'Test owner': 'Ana' });
    helpers.ignore();

    const { metadata: read } = metadata();
    expect({ ...read.parameters }).toEqual({ browser: 'firefox', retries: '2', headless: 'true' });
    expect(read.tags).toEqual(['smoke', 'checkout', 'regression']);
    expect({ ...read.fields }).toEqual({
      severity: 'major',
      description: 'Pays with a card',
      'Test owner': 'Ana',
    });
    expect(read.ignored).toBe(true);
  });

  it('decorate a test.step title with a short reference to the declared case step', () => {
    const { helpers, metadata } = setup();
    const first = helpers.step('Open the cart', 'The cart lists 2 items', 'sku=42');
    const second = helpers.step('Pay');

    expect(first).toBe('Open the cart [probara:1]');
    expect(second).toBe('Pay [probara:2]');
    expect(parseStepTitle(first)).toEqual({ action: 'Open the cart', ref: 1 });
    expect([...metadata().metadata.steps]).toEqual([
      [1, { action: 'Open the cart', expected: 'The cart lists 2 items', data: 'sku=42' }],
      [2, { action: 'Pay' }],
    ]);
  });

  it('numbers the steps of each attempt from 1', () => {
    const first = setup();
    const second = setup();
    first.helpers.step('a');
    expect(second.helpers.step('b')).toBe('b [probara:1]');
  });

  it('attach a file or a body through testInfo.attach, so Playwright keeps a copy', async () => {
    const { info, helpers } = setup();
    await helpers.attach({ name: 'report', path: '/tmp/report.html' });
    await helpers.attach({ name: 'data.json', body: '{"a":1}', contentType: 'application/json' });

    expect(info.attach.mock.calls).toEqual([
      ['report', { path: '/tmp/report.html' }],
      ['data.json', { body: '{"a":1}', contentType: 'application/json' }],
    ]);
  });

  it('hand a Uint8Array body to Playwright as a Buffer, which it serializes intact', async () => {
    const { info, helpers } = setup();
    const bytes = new Uint8Array([0, 1, 2, 255, 254]);
    await helpers.attach({ name: 'bytes', body: bytes, contentType: 'application/octet-stream' });

    const [, options] = info.attach.mock.calls[0] ?? [];
    expect(Buffer.isBuffer(options?.body)).toBe(true);
    expect((options?.body as Buffer).toString('base64')).toBe(
      Buffer.from(bytes).toString('base64'),
    );

    // A view into a larger buffer keeps its own bytes only.
    const view = new Uint8Array([9, 0, 1, 9]).subarray(1, 3);
    await helpers.attach({ name: 'view', body: view, contentType: 'application/octet-stream' });
    const viewBody = info.attach.mock.calls[1]?.[1].body as Buffer;
    expect([...viewBody]).toEqual([0, 1]);
  });

  it('warn instead of throwing when an attachment cannot be attached', async () => {
    const { info, helpers, warnings } = setup();
    info.attach.mockRejectedValueOnce(new Error('ENOENT: no such file'));
    await expect(helpers.attach({ name: 'gone', path: '/tmp/gone.png' })).resolves.toBeUndefined();
    expect(warnings).toEqual(['probara.attach() could not attach "gone": ENOENT: no such file']);
  });

  it('warn and ignore arguments of the wrong type instead of throwing into the test', () => {
    const { info, helpers, warnings } = setup();
    const loose = helpers as unknown as Record<string, (...args: unknown[]) => unknown>;
    loose.id?.(42);
    loose.title?.({ text: 'x' });
    loose.suite?.(['ok', 3]);
    loose.parameters?.('browser=chromium');
    loose.tags?.('smoke', null);
    loose.fields?.({ severity: { level: 1 } });
    expect(loose.step?.(undefined)).toBe('undefined');

    expect(info.annotations).toEqual([]);
    expect(info.attachments).toEqual([]);
    expect(warnings).toEqual([
      'probara.id() takes a case id or a list of case ids, such as PRB-12',
      'probara.title() takes a string',
      'probara.suite() takes a suite title or a list of suite titles',
      'probara.parameters() takes an object of strings, numbers or booleans',
      'probara.tags() takes strings',
      'probara.fields() takes an object of strings, numbers or booleans',
      'probara.step() takes an action (a string)',
    ]);
  });

  it('warn when called while no test runs, and return the plain action from step', async () => {
    const warnings: string[] = [];
    const helpers = createProbara(
      () => {
        throw new Error('test.info() can only be called while test is running');
      },
      (message) => warnings.push(message),
    );
    helpers.title('x');
    expect(helpers.step('Pay')).toBe('Pay');
    await helpers.attach({ name: 'log', body: 'x', contentType: 'text/plain' });
    expect(warnings).toEqual([
      'probara.title() only works while a test runs (in a test, a hook or a fixture)',
      'probara.step() only works while a test runs (in a test, a hook or a fixture)',
      'probara.attach() only works while a test runs (in a test, a hook or a fixture)',
    ]);
  });

  it('are exported ready to use, bound to the running test of Playwright', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(probara.step('Pay')).toBe('Pay');
    expect(warn).toHaveBeenCalledWith(
      '[probara] probara.step() only works while a test runs (in a test, a hook or a fixture)',
    );
    warn.mockRestore();
  });
});

describe('readMetadata', () => {
  it('ignores malformed metadata with a problem each, never throwing', () => {
    const attachment = (body: string) => ({ contentType: METADATA_CONTENT_TYPE, body });
    const { metadata, problems } = readMetadata([
      attachment('not json'),
      attachment('{"type":"future","value":1}'),
      attachment('{"type":"title","value":3}'),
      attachment('{"type":"step","value":{"ref":0,"action":"x"}}'),
      attachment('{"type":"parameters","value":{"__proto__":"x","browser":"webkit"}}'),
      { contentType: 'application/json', body: '{"type":"title","value":"not ours"}' },
    ]);
    expect(problems).toEqual([
      'Ignored malformed probara metadata (type "?")',
      'Ignored malformed probara metadata (type "future")',
      'Ignored malformed probara metadata (type "title")',
      'Ignored malformed probara metadata (type "step")',
      'Ignored malformed probara metadata (type "parameters")',
    ]);
    expect(metadata.title).toBeUndefined();
    expect({ ...metadata.parameters }).toEqual({});
  });

  it('reads the reference out of a step title only at its end', () => {
    expect(parseStepTitle(stepTitle('Pay [probara:9] now', 12))).toEqual({
      action: 'Pay [probara:9] now',
      ref: 12,
    });
    expect(parseStepTitle('Pay [probara:1] now')).toBeUndefined();
    expect(parseStepTitle('Pay [probara:0]')).toBeUndefined();
  });
});
