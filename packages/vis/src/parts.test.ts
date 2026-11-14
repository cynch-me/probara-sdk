import { describe, expect, it } from 'vitest';
import { IntakeError } from './intake.js';
import { PartUploadError, createPartUploader } from './parts.js';

const blob = (text: string): Blob => new Blob([text]);

/** Records each part as text, failing the attempts `failures` names (part number -> errors). */
function fakeUpload(failures: Record<number, Error[]> = {}) {
  const parts: [number, string][] = [];
  const attempts: number[] = [];
  const upload = async (partNumber: number, part: Blob): Promise<void> => {
    attempts.push(partNumber);
    const failure = failures[partNumber]?.shift();
    if (failure !== undefined) throw failure;
    parts.push([partNumber, await part.text()]);
  };
  return { upload, parts, attempts };
}

const noWait = (): Promise<void> => Promise.resolve();

describe('createPartUploader', () => {
  it('counts the bytes added so far, sent or not', () => {
    const parts = createPartUploader({ partSize: 4, maxBytes: 100, upload: fakeUpload().upload });
    expect(parts.bytes).toBe(0);
    parts.add(blob('ab'));
    parts.add(blob('cdefg'));
    expect(parts.bytes).toBe(7);
  });

  it('sends parts of exactly the part size while recording, and the rest as the last part', async () => {
    const fake = fakeUpload();
    const parts = createPartUploader({ partSize: 4, maxBytes: 100, upload: fake.upload });
    parts.add(blob('ab'));
    parts.add(blob('cdefghij'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Two whole parts went out before the recording ended.
    expect(fake.parts).toEqual([
      [1, 'abcd'],
      [2, 'efgh'],
    ]);
    parts.add(blob('k'));
    await expect(parts.finish()).resolves.toEqual({ bytes: 11, parts: 3 });
    expect(fake.parts).toEqual([
      [1, 'abcd'],
      [2, 'efgh'],
      [3, 'ijk'],
    ]);
  });

  it('sends no empty last part when the video ends on a part boundary', async () => {
    const fake = fakeUpload();
    const parts = createPartUploader({ partSize: 2, maxBytes: 100, upload: fake.upload });
    parts.add(blob('abcd'));
    await expect(parts.finish()).resolves.toEqual({ bytes: 4, parts: 2 });
    expect(fake.parts.map(([n]) => n)).toEqual([1, 2]);
  });

  it('retries a part that met no answer, a 429 or a 5xx, three attempts in all', async () => {
    const fake = fakeUpload({
      1: [new IntakeError(null, 'network'), new IntakeError(503, null)],
      2: [new IntakeError(429, 'too_many_requests')],
    });
    const parts = createPartUploader({
      partSize: 2,
      maxBytes: 100,
      upload: fake.upload,
      sleep: noWait,
    });
    parts.add(blob('abcd'));
    await expect(parts.finish()).resolves.toEqual({ bytes: 4, parts: 2 });
    expect(fake.attempts).toEqual([1, 1, 1, 2, 2]);
  });

  it('fails at once on a refusal, reports it once and ignores what comes after', async () => {
    const refusal = new IntakeError(404, 'not_found');
    const fake = fakeUpload({ 1: [refusal] });
    const errors: unknown[] = [];
    const parts = createPartUploader({
      partSize: 2,
      maxBytes: 100,
      upload: fake.upload,
      onError: (error) => errors.push(error),
      sleep: noWait,
    });
    parts.add(blob('ab'));
    await expect(parts.finish()).rejects.toBe(refusal);
    parts.add(blob('cd'));
    expect(fake.attempts).toEqual([1]);
    expect(errors).toEqual([refusal]);
    expect(parts.error).toBe(refusal);
  });

  it('gives up on a part after three failed attempts', async () => {
    const down = new IntakeError(500, null);
    const fake = fakeUpload({ 1: [down, down, down] });
    const parts = createPartUploader({
      partSize: 2,
      maxBytes: 100,
      upload: fake.upload,
      sleep: noWait,
    });
    parts.add(blob('ab'));
    await expect(parts.finish()).rejects.toBe(down);
    expect(fake.attempts).toEqual([1, 1, 1]);
  });

  it('fails as soon as the video outgrows the largest upload', async () => {
    const fake = fakeUpload();
    const errors: unknown[] = [];
    const parts = createPartUploader({
      partSize: 4,
      maxBytes: 6,
      upload: fake.upload,
      onError: (error) => errors.push(error),
    });
    parts.add(blob('abcdef'));
    parts.add(blob('g'));
    expect(errors).toEqual([expect.any(PartUploadError)]);
    expect(errors[0]).toMatchObject({ code: 'too_large' });
    await expect(parts.finish()).rejects.toMatchObject({ code: 'too_large' });
  });

  it('refuses to finish a video with no bytes', async () => {
    const parts = createPartUploader({ partSize: 4, maxBytes: 8, upload: fakeUpload().upload });
    await expect(parts.finish()).rejects.toMatchObject({ code: 'empty' });
  });
});
