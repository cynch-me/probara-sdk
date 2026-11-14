/**
 * Reads the files of a ZIP archive (stored or deflated), as Playwright writes its traces, with
 * Node's zlib: enough for a trace, without a dependency. ZIP64 and encrypted archives are refused.
 */
import { inflateRawSync } from 'node:zlib';

/** An archive that cannot be read; the message says why. */
export class ZipError extends Error {
  override readonly name = 'ZipError';
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
/**
 * The most one file of the archive may hold once decompressed. The trace files of a long test run
 * stay far below it, and without a limit a few kilobytes of archive can ask for gigabytes.
 */
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const TOO_LARGE = 'is larger than 128 MiB once decompressed';
/** The end record is 22 bytes, followed by a comment of at most 65535. */
const END_SEARCH_BYTES = 22 + 0xffff;

interface Entry {
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** The files of the archive by name, each read (and inflated) when asked for. */
export interface ZipArchive {
  names(): string[];
  /** The bytes of `name`; `undefined` when the archive has no such file. */
  read(name: string): Buffer | undefined;
}

export function readZip(archive: Buffer): ZipArchive {
  let end = -1;
  for (
    let at = archive.length - 22;
    at >= Math.max(0, archive.length - END_SEARCH_BYTES);
    at -= 1
  ) {
    if (archive.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new ZipError('not a ZIP archive');
  const count = archive.readUInt16LE(end + 10);
  const directorySize = archive.readUInt32LE(end + 12);
  const directoryOffset = archive.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw new ZipError('a ZIP64 archive, which is not supported');
  }
  if (directoryOffset + directorySize > archive.length) {
    throw new ZipError('a truncated ZIP archive');
  }

  const entries = new Map<string, Entry>();
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== DIRECTORY_ENTRY) {
      throw new ZipError('a damaged ZIP archive: its file list is unreadable');
    }
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, {
      flags: archive.readUInt16LE(at + 8),
      method: archive.readUInt16LE(at + 10),
      compressedSize: archive.readUInt32LE(at + 20),
      size: archive.readUInt32LE(at + 24),
      localOffset: archive.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }

  return {
    names: () => [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (entry === undefined) return undefined;
      if ((entry.flags & 1) !== 0) throw new ZipError(`${name} is encrypted`);
      const local = entry.localOffset;
      if (local + 30 > archive.length || archive.readUInt32LE(local) !== LOCAL_HEADER) {
        throw new ZipError(`a damaged ZIP archive: ${name} cannot be found in it`);
      }
      const start =
        local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const data = archive.subarray(start, start + entry.compressedSize);
      if (data.length !== entry.compressedSize) {
        throw new ZipError(`a truncated ZIP archive: ${name} is cut short`);
      }
      // The declared size may lie: it only refuses early, and the inflate limit below decides.
      if (Math.max(entry.size, entry.method === 0 ? data.length : 0) > MAX_ENTRY_BYTES) {
        throw new ZipError(`${name} ${TOO_LARGE}`);
      }
      if (entry.method === 0) return data;
      if (entry.method !== 8) {
        throw new ZipError(
          `${name} is compressed with method ${String(entry.method)}, not deflate`,
        );
      }
      try {
        return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch (error) {
        if (error instanceof RangeError) throw new ZipError(`${name} ${TOO_LARGE}`);
        throw new ZipError(
          `${name} cannot be decompressed (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    },
  };
}
