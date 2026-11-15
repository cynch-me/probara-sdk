/**
 * The video recorder over a real stream: a canvas drawn every frame stands in for a captured
 * screen, tab or window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createVideoRecorder, type VideoRecorder, type VideoRecorderOptions } from './recorder.js';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A 640x360 stream of a canvas that changes every frame. */
function canvasStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  let frame = 0;
  const timer = setInterval(() => {
    frame += 1;
    context.fillStyle = `hsl(${(frame * 7) % 360} 80% 50%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '32px sans-serif';
    context.fillText(`frame ${frame}`, 20, 60);
  }, 1000 / 30);
  const stream = canvas.captureStream(30);
  cleanups.push(() => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
  });
  return stream;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function recorder(options: VideoRecorderOptions = {}, stream = canvasStream()): VideoRecorder {
  return createVideoRecorder(stream, { timesliceMs: 100, ...options });
}

describe('createVideoRecorder', () => {
  it('hands chunks to the sink while recording and reports the format, size and duration', async () => {
    const chunks: { size: number; index: number; at: string }[] = [];
    const video = recorder({
      sink: (chunk, index) => {
        chunks.push({ size: chunk.size, index, at: video.state });
      },
    });
    expect(video.state).toBe('inactive');
    // The recorder's clock runs from inside start() to inside stop(), so its duration lies
    // between the time from start() returning to stop() being called and the time from
    // start() being called to stop() returning. Only those two brackets are promised: how long
    // start() itself takes (longer on a loaded machine) is in the outer one and not the inner.
    const beforeStart = performance.now();
    video.start();
    const afterStart = performance.now();
    expect(video.state).toBe('recording');
    await vi.waitFor(() => {
      expect(chunks.length).toBeGreaterThan(1);
    }, 5000);
    expect(chunks[0]?.at).toBe('recording');
    const beforeStop = performance.now();
    const stopping = video.stop();
    const afterStop = performance.now();
    const result = await stopping;

    expect(video.state).toBe('stopped');
    expect(result.reason).toBe('stopped');
    expect(result.mimeType).toBe(video.format.mimeType);
    expect(MediaRecorder.isTypeSupported(result.mimeType)).toBe(true);
    expect(['mp4', 'webm']).toContain(result.container);
    expect(result.chunks).toBe(chunks.length);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
    expect(result.size).toBe(chunks.reduce((sum, chunk) => sum + chunk.size, 0));
    expect(result.size).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(Math.round(beforeStop - afterStart));
    expect(result.durationMs).toBeLessThanOrEqual(Math.round(afterStop - beforeStart));
    expect(result.blob).toBeUndefined();
    expect(result.audioCodec).toBeUndefined();
  });

  it('keeps the video in memory as one blob when no sink is given', async () => {
    const video = recorder();
    video.start();
    await sleep(300);
    const result = await video.stop();
    expect(result.blob?.size).toBe(result.size);
    expect(result.blob?.type).toBe(result.mimeType);
    expect(result.size).toBeGreaterThan(0);
  });

  it('leaves paused time out of the duration', async () => {
    const video = recorder();
    const beforeStart = performance.now();
    video.start();
    const afterStart = performance.now();
    await sleep(300);
    const beforePause = performance.now();
    video.pause();
    const afterPause = performance.now();
    expect(video.state).toBe('paused');
    await sleep(600);
    const beforeResume = performance.now();
    video.resume();
    const afterResume = performance.now();
    expect(video.state).toBe('recording');
    await sleep(300);
    const beforeStop = performance.now();
    const result = await video.stop();
    const afterStop = performance.now();
    // The clock runs from start to pause and from resume to stop; the 600 ms pause never counts,
    // however long the runner takes around each call.
    const recordedAtMost = afterPause - beforeStart + (afterStop - beforeResume);
    const recordedAtLeast = beforePause - afterStart + (beforeStop - afterResume);
    expect(result.durationMs).toBeGreaterThanOrEqual(Math.round(recordedAtLeast));
    expect(result.durationMs).toBeLessThanOrEqual(Math.round(recordedAtMost));
    expect(result.durationMs).toBeLessThan(afterStop - beforeStart - 550);
  });

  it('stops by itself at the maximum duration, not counting paused time, and says why', async () => {
    const video = recorder({ maxDurationMs: 400 });
    video.start();
    await sleep(200);
    video.pause();
    await sleep(400);
    expect(video.state).toBe('paused');
    video.resume();
    const result = await video.result;
    expect(result.reason).toBe('max_duration');
    expect(result.durationMs).toBeGreaterThanOrEqual(380);
    expect(result.durationMs).toBeLessThan(700);
    expect(video.state).toBe('stopped');
  });

  it('stops when the shared screen ends, and says why', async () => {
    const stream = canvasStream();
    const video = recorder({}, stream);
    video.start();
    await sleep(200);
    const track = stream.getVideoTracks()[0];
    if (track === undefined) throw new Error('no video track');
    // What the browser fires when the user clicks "Stop sharing".
    track.dispatchEvent(new Event('ended'));
    const result = await video.result;
    expect(result.reason).toBe('track_ended');
    expect(result.size).toBeGreaterThan(0);
  });

  it('reports a failing sink without losing the recording', async () => {
    const video = recorder({
      sink: (_chunk, index) =>
        index === 0 ? Promise.reject(new Error('upload failed')) : undefined,
    });
    video.start();
    await sleep(300);
    const result = await video.stop();
    expect(result.sinkError).toBeInstanceOf(Error);
    expect(result.size).toBeGreaterThan(0);
    expect(result.reason).toBe('stopped');
  });

  it('returns the same result to every stop, and an empty one when never started', async () => {
    const video = recorder();
    const first = video.stop();
    const second = video.stop();
    expect(first).toBe(second);
    const result = await first;
    expect(result).toMatchObject({ size: 0, durationMs: 0, chunks: 0, reason: 'stopped' });
  });

  it('records the audio of the stream with the audio codec of the format', async () => {
    const stream = canvasStream();
    const audio = new AudioContext();
    // A page gets no sound before a gesture: an audio track without samples holds WebM back.
    const button = document.createElement('button');
    button.textContent = 'Allow sound';
    button.addEventListener('click', () => {
      void audio.resume();
    });
    document.body.append(button);
    cleanups.push(() => {
      button.remove();
    });
    await userEvent.click(button);
    await vi.waitFor(() => {
      expect(audio.state).toBe('running');
    });
    const destination = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator();
    oscillator.connect(destination);
    oscillator.start();
    cleanups.push(() => {
      oscillator.stop();
      void audio.close();
    });
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    const video = recorder({}, stream);
    video.start();
    await sleep(300);
    const result = await video.stop();
    expect(result.audioCodec).toBe(result.container === 'mp4' ? 'aac' : 'opus');
    expect(result.size).toBeGreaterThan(0);
  });

  it('records WebM when the browser can', async () => {
    const video = recorder();
    expect(video.format.container).toBe('webm');
    video.start();
    await sleep(300);
    const result = await video.stop();
    expect(result.container).toBe('webm');
    const head = new Uint8Array(await (result.blob ?? new Blob()).slice(0, 4).arrayBuffer());
    // A WebM file opens with its EBML header.
    expect([...head]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it('records MP4 with H.264 when the browser cannot record WebM, and says why it skipped otherwise', async (context) => {
    const mp4 = 'video/mp4;codecs=avc1.640032,mp4a.40.2';
    context.skip(!MediaRecorder.isTypeSupported(mp4), `this browser cannot record ${mp4}`);
    const isTypeSupported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    const spy = vi
      .spyOn(MediaRecorder, 'isTypeSupported')
      .mockImplementation((type) => !type.startsWith('video/webm') && isTypeSupported(type));
    cleanups.push(() => {
      spy.mockRestore();
    });
    const video = recorder();
    expect(video.format).toMatchObject({ mimeType: mp4, container: 'mp4', videoCodec: 'h264' });
    video.start();
    await sleep(300);
    const result = await video.stop();
    expect(result).toMatchObject({ mimeType: mp4, container: 'mp4', videoCodec: 'h264' });
    const head = new Uint8Array(await (result.blob ?? new Blob()).slice(0, 8).arrayBuffer());
    // An MP4 file opens with its "ftyp" box.
    expect(new TextDecoder().decode(head.subarray(4, 8))).toBe('ftyp');
  });

  it('refuses a stream without a video track', () => {
    expect(() => createVideoRecorder(new MediaStream())).toThrow(TypeError);
  });
});
