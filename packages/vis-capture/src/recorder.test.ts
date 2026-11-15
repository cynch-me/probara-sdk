/**
 * The choices of the video recorder that need no browser: the container and codecs, the display
 * capture constraints and the bitrate.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_BITRATE_1440P,
  MIN_VIDEO_BITRATE,
  displayCaptureConstraints,
  pickVideoFormat,
  videoBitrate,
} from './recorder.js';

const supports =
  (...types: string[]) =>
  (type: string): boolean =>
    types.includes(type);

describe('pickVideoFormat', () => {
  it('prefers WebM with VP9 and Opus, then VP8, when the browser can record it', () => {
    const everything = supports(
      'video/mp4;codecs=avc1.640032,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
    );
    expect(pickVideoFormat(everything)).toEqual({
      mimeType: 'video/webm;codecs=vp9,opus',
      container: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    });
    expect(
      pickVideoFormat(supports('video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp8,opus')),
    ).toEqual({
      mimeType: 'video/webm;codecs=vp8,opus',
      container: 'webm',
      videoCodec: 'vp8',
      audioCodec: 'opus',
    });
  });

  it('falls back to MP4 with H.264 and AAC when the browser cannot record WebM', () => {
    expect(pickVideoFormat(supports('video/mp4;codecs=avc1,mp4a.40.2'))).toEqual({
      mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
  });

  it('takes the H.264 profile that holds 1440p first', () => {
    const format = pickVideoFormat(
      supports('video/mp4;codecs=avc1.640032,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2'),
    );
    expect(format?.mimeType).toBe('video/mp4;codecs=avc1.640032,mp4a.40.2');
  });

  it('returns null when the browser can record none of them', () => {
    expect(pickVideoFormat(supports())).toBeNull();
    expect(
      pickVideoFormat(() => {
        throw new Error('no MediaRecorder');
      }),
    ).toBeNull();
  });
});

describe('displayCaptureConstraints', () => {
  it('keeps the native resolution up to 2560x1440 at 30 frames per second, without audio by default', () => {
    expect(displayCaptureConstraints()).toEqual({
      video: { width: { max: 2560 }, height: { max: 1440 }, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
  });

  it('asks for the shared tab or system audio when told to', () => {
    expect(displayCaptureConstraints({ audio: true }).audio).toBe(true);
  });
});

describe('videoBitrate', () => {
  it('is 8 Mbps at 1440p by default and scales with the number of pixels', () => {
    expect(DEFAULT_VIDEO_BITRATE_1440P).toBe(8_000_000);
    expect(videoBitrate(2560, 1440)).toBe(8_000_000);
    expect(videoBitrate(1920, 1080)).toBe(4_500_000);
    expect(videoBitrate(1280, 720)).toBe(2_000_000);
  });

  it('takes another figure for 1440p', () => {
    expect(videoBitrate(1920, 1080, 12_000_000)).toBe(6_750_000);
  });

  it('never goes under the floor, and uses the 1440p figure for an unknown size', () => {
    expect(videoBitrate(320, 240)).toBe(MIN_VIDEO_BITRATE);
    expect(videoBitrate(Number.NaN, 0)).toBe(8_000_000);
  });

  it('does not go over the 1440p figure for a larger capture', () => {
    expect(videoBitrate(3840, 2160)).toBe(8_000_000);
  });
});
