/**
 * The duration patched into the watched copy of a WebM recording, over hand-built WebM bytes laid
 * out as `MediaRecorder` writes them: an EBML header, a Segment of unknown size, the Info, the
 * Tracks and Clusters of unknown size.
 */
import { describe, expect, it } from 'vitest';
import { withWebmDuration } from './webm-duration.js';

const bytes = (...parts: (number[] | Uint8Array)[]): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(parts.flatMap((part) => [...part]));
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];
const float64 = (value: number): number[] => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return [...new Uint8Array(view.buffer)];
};
const float32 = (value: number): number[] => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return [...new Uint8Array(view.buffer)];
};
/** An element whose size fits one byte. */
const element = (id: number[], body: number[]): number[] => [...id, 0x80 | body.length, ...body];

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const EBML = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], ascii('webm')));
const SEGMENT = [0x18, 0x53, 0x80, 0x67, ...UNKNOWN];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const TIMECODE_SCALE = (scale: number): number[] =>
  element([0x2a, 0xd7, 0xb1], [(scale >> 16) & 0xff, (scale >> 8) & 0xff, scale & 0xff]);
const MUXING_APP = element([0x4d, 0x80], ascii('Chrome'));
const TRACKS = element([0x16, 0x54, 0xae, 0x6b], element([0xae], [0xd7, 0x81, 0x01]));
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...element([0xe7], [0x00])];
const DURATION = (value: number): number[] => element([0x44, 0x89], float64(value));

async function read(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('withWebmDuration', () => {
  it('adds the duration to the Info of the first chunk and leaves every other byte as it was', async () => {
    const info = [...TIMECODE_SCALE(1_000_000), ...MUXING_APP];
    const first = bytes(EBML, SEGMENT, element(INFO_ID, info), TRACKS, CLUSTER);
    const second = bytes(CLUSTER);
    const chunks = [new Blob([first]), new Blob([second])];

    const watched = await withWebmDuration(chunks, 4321, 'video/webm');

    expect(watched.type).toBe('video/webm');
    expect(await read(watched)).toEqual(
      bytes(EBML, SEGMENT, element(INFO_ID, [...info, ...DURATION(4321)]), TRACKS, CLUSTER, second),
    );
    // The chunks themselves, the bytes uploaded, are untouched.
    expect(await read(chunks[0] as Blob)).toEqual(first);
    expect(await read(chunks[1] as Blob)).toEqual(second);
  });

  it('finds the Info wherever the chunks split the header', async () => {
    const info = [...TIMECODE_SCALE(1_000_000), ...MUXING_APP];
    const recording = bytes(EBML, SEGMENT, element(INFO_ID, info), TRACKS, CLUSTER);
    // MediaRecorder cuts a slice at any write once the timeslice passed: a late first frame leaves
    // one byte of the header in the first chunk.
    const chunks = [1, EBML.length + 6, EBML.length + SEGMENT.length + 3].map(
      (cut, index, cuts) => new Blob([recording.slice(index === 0 ? 0 : cuts[index - 1], cut)]),
    );
    chunks.push(new Blob([recording.slice(EBML.length + SEGMENT.length + 3)]));

    const watched = await withWebmDuration(chunks, 4321, 'video/webm');

    expect(await read(watched)).toEqual(
      bytes(EBML, SEGMENT, element(INFO_ID, [...info, ...DURATION(4321)]), TRACKS, CLUSTER),
    );
  });

  it('replaces a duration already there, whatever its width', async () => {
    const info = [
      ...TIMECODE_SCALE(1_000_000),
      ...element([0x44, 0x89], float32(1)),
      ...MUXING_APP,
    ];
    const first = bytes(EBML, SEGMENT, element(INFO_ID, info), TRACKS);

    const watched = await withWebmDuration([new Blob([first])], 2500, 'video/webm');

    expect(await read(watched)).toEqual(
      bytes(
        EBML,
        SEGMENT,
        element(INFO_ID, [...TIMECODE_SCALE(1_000_000), ...MUXING_APP, ...DURATION(2500)]),
        TRACKS,
      ),
    );
  });

  it('counts the duration in the units of the timecode scale, in milliseconds without one', async () => {
    const scaled = bytes(EBML, SEGMENT, element(INFO_ID, TIMECODE_SCALE(100_000)), TRACKS);
    expect(await read(await withWebmDuration([new Blob([scaled])], 1500, 'video/webm'))).toEqual(
      bytes(
        EBML,
        SEGMENT,
        element(INFO_ID, [...TIMECODE_SCALE(100_000), ...DURATION(15_000)]),
        TRACKS,
      ),
    );

    const unscaled = bytes(EBML, SEGMENT, element(INFO_ID, MUXING_APP), TRACKS);
    expect(await read(await withWebmDuration([new Blob([unscaled])], 1500, 'video/webm'))).toEqual(
      bytes(EBML, SEGMENT, element(INFO_ID, [...MUXING_APP, ...DURATION(1500)]), TRACKS),
    );
  });

  it('keeps the recording as it was when it cannot place the duration safely', async () => {
    const info = element(INFO_ID, [...TIMECODE_SCALE(1_000_000), ...MUXING_APP]);
    const seekHead = element(
      [0x11, 0x4d, 0x9b, 0x74],
      element([0x4d, 0xbb], [0x53, 0xab, 0x81, 0x01]),
    );
    const unchanged = [
      // An MP4 opens with its "ftyp" box.
      bytes([0, 0, 0, 0x18], ascii('ftypmp42'), new Array<number>(12).fill(0)),
      // A seek head points at the positions after the Info, which would move.
      bytes(EBML, SEGMENT, seekHead, info, TRACKS),
      // No Info before the first Cluster.
      bytes(EBML, SEGMENT, TRACKS, CLUSTER),
    ];
    for (const first of unchanged) {
      const rest = bytes(CLUSTER);
      const watched = await withWebmDuration(
        [new Blob([first]), new Blob([rest])],
        1000,
        'video/webm',
      );
      expect(await read(watched)).toEqual(bytes(first, rest));
    }
    // The recording ends inside its Info.
    const cut = bytes(EBML, SEGMENT, info.slice(0, -3));
    expect(await read(await withWebmDuration([new Blob([cut])], 1000, 'video/webm'))).toEqual(cut);
    const whole = bytes(EBML, SEGMENT, info, TRACKS);
    for (const duration of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        await read(await withWebmDuration([new Blob([whole])], duration, 'video/webm')),
      ).toEqual(whole);
    }
    expect((await withWebmDuration([], 1000, 'video/webm')).size).toBe(0);
  });
});
