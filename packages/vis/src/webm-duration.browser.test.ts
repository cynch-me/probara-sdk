/**
 * The duration patched into a real WebM recording of Chromium's `MediaRecorder`: the watched copy
 * knows how long it is as soon as its metadata loads, so it can be scrubbed at once, and the
 * recorded chunks (the bytes uploaded) do not change.
 */
import { createVideoRecorder } from '@probara/vis-capture';
import { afterEach, describe, expect, it } from 'vitest';
import { withWebmDuration } from './webm-duration.js';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A 320x180 stream of a canvas that changes every frame, released by the test's cleanup. */
function canvasStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  let frame = 0;
  const timer = setInterval(() => {
    frame += 1;
    context.fillStyle = `hsl(${(frame * 7) % 360} 80% 50%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, 1000 / 30);
  const stream = canvas.captureStream(30);
  cleanups.push(() => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
  });
  return stream;
}

/** The duration a video element reads from `blob` once its metadata loaded. */
async function loadedDuration(blob: Blob): Promise<number> {
  const video = document.createElement('video');
  video.muted = true;
  const url = URL.createObjectURL(blob);
  cleanups.push(() => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  });
  const loaded = new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => {
      resolve();
    });
    video.addEventListener('error', () => {
      reject(new Error('the video could not be loaded'));
    });
  });
  video.src = url;
  await loaded;
  return video.duration;
}

async function bytesOf(chunks: readonly Blob[]): Promise<Uint8Array[]> {
  return Promise.all(chunks.map(async (chunk) => new Uint8Array(await chunk.arrayBuffer())));
}

describe('withWebmDuration on a real recording', () => {
  it('gives the watched WebM a finite duration and leaves the uploaded chunks as recorded', async () => {
    const chunks: Blob[] = [];
    const video = createVideoRecorder(canvasStream(), {
      timesliceMs: 100,
      sink: (chunk) => {
        chunks.push(chunk);
      },
    });
    expect(video.format.container).toBe('webm');
    video.start();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const result = await video.stop();
    expect(chunks.length).toBeGreaterThan(1);
    const recorded = await bytesOf(chunks);

    // As recorded, Chromium's WebM has no duration until it is read to the end.
    expect(await loadedDuration(new Blob(chunks, { type: result.mimeType }))).toBe(
      Number.POSITIVE_INFINITY,
    );

    const watched = await withWebmDuration(chunks, result.durationMs, result.mimeType);
    const duration = await loadedDuration(watched);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeCloseTo(result.durationMs / 1000, 2);
    expect(await bytesOf(chunks)).toEqual(recorded);
    expect(chunks.reduce((sum, chunk) => sum + chunk.size, 0)).toBe(result.size);
  });
});
