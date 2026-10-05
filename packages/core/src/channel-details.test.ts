/**
 * The reporter's reading of a transport: what the lines of one attempt say about it, assembled
 * into the metadata, the step tree and the files of its result. Framework-agnostic: the lines come
 * from files, from `cy.task` or from anywhere else.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detailsOf } from './channel-details.js';
import type { ChannelLine } from './channel.js';

type DetailsLine = Parameters<typeof detailsOf>[0][number];

const DIR = '/work/channel';
const FILE = '/work/app/cypress/e2e/flaky.cy.js';
const REF = { file: FILE, test: 'Flaky pays with a saved card', attempt: 1 };
const COPY = '0f8fad5b-d9cb-469f-a165-70867728950e';

const detailsOfAll = (lines: readonly ChannelLine[]) =>
  detailsOf(lines as readonly DetailsLine[], DIR);

describe('detailsOf metadata', () => {
  it('merges the messages of the attempt in call order, and names the malformed ones', () => {
    const { metadata, problems } = detailsOfAll([
      { ...REF, type: 'message', message: { type: 'tags', value: ['smoke', 'checkout'] } },
      { ...REF, type: 'message', message: { type: 'title', value: 'Pays with a card' } },
      { ...REF, type: 'message', message: { type: 'title', value: 'Pays with a saved card' } },
      { ...REF, type: 'message', message: { type: 'id', value: ['SHOP-12'] } },
      { ...REF, type: 'message', message: { type: 'comment', value: 5 } as never },
      { ...REF, type: 'message', message: { type: 'comment', value: 'On staging' } },
    ]);

    expect(metadata).toMatchObject({
      ids: ['SHOP-12'],
      title: 'Pays with a saved card',
      comment: 'On staging',
      tags: ['smoke', 'checkout'],
      ignored: false,
    });
    expect(problems).toEqual(['Ignored malformed probara metadata (type "comment")']);
  });

  it('leaves the transport lines of no test out, whatever kind they are', () => {
    const ofTest: ChannelLine[] = [
      { ...REF, type: 'message', message: { type: 'tags', value: ['smoke'] } },
    ];
    const withOthers: ChannelLine[] = [
      { type: 'warning', message: 'probara.tags() takes strings', file: FILE, test: REF.test },
      { type: 'setup', file: FILE },
      { type: 'selection', file: FILE, applied: false, reason: 'no-hook' },
      ...ofTest,
    ];

    expect(detailsOfAll(withOthers)).toEqual(detailsOfAll(ofTest));
  });
});

describe('detailsOf steps', () => {
  it('nests the steps as they ran, and hands out the outermost ones as the case steps', () => {
    const details = detailsOfAll([
      {
        ...REF,
        type: 'step-start',
        step: 'checkout',
        action: 'Check out',
        expected: 'On the payment page',
      },
      { ...REF, type: 'step-start', step: 'pay', parent: 'checkout', action: 'Pay', data: 'card' },
      {
        ...REF,
        type: 'step-end',
        step: 'pay',
        status: 'passed',
        durationMs: 12,
      },
      { ...REF, type: 'step-end', step: 'checkout', status: 'passed', durationMs: 20 },
      { ...REF, type: 'step-start', step: 'receipt', action: 'Print the receipt' },
      { ...REF, type: 'step-end', step: 'receipt', status: 'failed', durationMs: 1 },
    ]);

    expect(details.steps).toEqual([
      {
        action: 'Check out',
        status: 'passed',
        durationMs: 20,
        expected: 'On the payment page',
        steps: [{ action: 'Pay', status: 'passed', durationMs: 12, data: 'card' }],
      },
      { action: 'Print the receipt', status: 'failed', durationMs: 1 },
    ]);
    expect(details.caseSteps).toEqual([
      { action: 'Check out', expected: 'On the payment page' },
      { action: 'Print the receipt' },
    ]);
  });

  it('fails a step whose commands failed before it ended, with no duration', () => {
    const details = detailsOfAll([
      { ...REF, type: 'step-start', step: 'pay', action: 'Pay', expected: 'Paid' },
    ]);

    expect(details.steps).toEqual([
      {
        action: 'Pay',
        status: 'failed',
        error: { message: 'The step had not finished when the test ended' },
        expected: 'Paid',
      },
    ]);
  });

  it('keeps the error of a finished step, and leaves out what its line does not say', () => {
    const details = detailsOfAll([
      { ...REF, type: 'step-start', step: 'pay', action: 'Pay' },
      // A step end the test wrote by hand, without a duration: the details read what is there.
      {
        ...REF,
        type: 'step-end',
        step: 'pay',
        status: 'failed',
        error: { message: 'boom', stack: 'Error: boom\n    at cart.ts:3' },
      } as never,
      // A step that never started, and an end with a status core does not know: neither is a step.
      { ...REF, type: 'step-end', step: 'gone', status: 'failed', durationMs: 1 },
      { ...REF, type: 'step-end', step: 'pay', status: 'lost' } as never,
    ]);

    expect(details.steps).toEqual([
      {
        action: 'Pay',
        status: 'failed',
        error: { message: 'boom', stack: 'Error: boom\n    at cart.ts:3' },
      },
    ]);
    expect(details.caseSteps).toEqual([{ action: 'Pay' }]);
  });
});

describe('detailsOf attachments', () => {
  it('puts a file in the step it was attached in, and the others beside the steps', () => {
    const details = detailsOfAll([
      { ...REF, type: 'step-start', step: 'pay', action: 'Pay' },
      {
        ...REF,
        type: 'attachment',
        step: 'pay',
        name: 'receipt',
        copy: COPY,
        source: '/work/app/receipt.txt',
      },
      { ...REF, type: 'step-end', step: 'pay', status: 'passed', durationMs: 3 },
      {
        ...REF,
        type: 'attachment',
        name: 'console.log',
        copy: 'c4b7d0a1-1111-4222-8333-444444444444',
      },
    ]);

    expect(details.steps).toEqual([
      {
        action: 'Pay',
        status: 'passed',
        durationMs: 3,
        attachments: [
          {
            name: 'receipt',
            fileName: 'receipt.txt',
            contentType: 'text/plain',
            path: join(DIR, 'files', COPY),
            temporary: true,
          },
        ],
      },
    ]);
    expect(details.attachments).toEqual([
      {
        name: 'console.log',
        fileName: 'console.log',
        contentType: 'text/plain',
        path: join(DIR, 'files', 'c4b7d0a1-1111-4222-8333-444444444444'),
        temporary: true,
      },
    ]);
  });

  it('types a named body by its name, a byte body by nothing, and names it by its source', () => {
    const details = detailsOfAll([
      {
        ...REF,
        type: 'attachment',
        name: 'pixel',
        body: 'bytes',
        copy: '1c1e5f2e-0000-4000-8000-000000000001',
      },
      {
        ...REF,
        type: 'attachment',
        name: 'receipt.txt',
        body: 'text',
        copy: '1c1e5f2e-0000-4000-8000-000000000002',
      },
      {
        ...REF,
        type: 'attachment',
        name: ' trace ',
        copy: '1c1e5f2e-0000-4000-8000-000000000003',
        source: '/work/app/build/trace.zip',
      },
    ]);

    expect(details.attachments).toEqual([
      {
        name: 'pixel',
        fileName: 'pixel',
        path: join(DIR, 'files', '1c1e5f2e-0000-4000-8000-000000000001'),
        temporary: true,
      },
      {
        name: 'receipt.txt',
        fileName: 'receipt.txt',
        contentType: 'text/plain',
        path: join(DIR, 'files', '1c1e5f2e-0000-4000-8000-000000000002'),
        temporary: true,
      },
      {
        name: ' trace ',
        fileName: 'trace.zip',
        contentType: 'application/zip',
        path: join(DIR, 'files', '1c1e5f2e-0000-4000-8000-000000000003'),
        temporary: true,
      },
    ]);
  });

  it('reads a copy name as a name of its own, never as a path out of the channel', () => {
    const details = detailsOfAll([
      { ...REF, type: 'attachment', name: 'secrets', copy: '../../etc/passwd' },
      { ...REF, type: 'attachment', copy: '1c1e5f2e-0000-4000-8000-000000000004' } as never,
    ]);

    expect(details.attachments).toEqual([]);
  });
});
