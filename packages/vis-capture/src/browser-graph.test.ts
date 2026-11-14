/**
 * `@probara/vis-capture` runs on customers' pages and in the browser extension, where no Node
 * built-in exists. A test walks the whole module graph of `index.ts` and fails on the first
 * `node:` specifier, or on any bare specifier: the main entry has no runtime dependencies. rrweb,
 * the only one of the package, is reached from the separate replay entry alone.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capture from './index.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(SRC, 'index.ts');
const REPLAY = join(SRC, 'replay.ts');
const PACKAGE = join(SRC, '..', 'package.json');

/** The specifier of every module a source file names, on one line each or across several. */
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)'([^']+)'/g;

function specifiersOf(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1] ?? '');
}

/** Every source file `entry` reaches through its relative imports, `entry` included. */
function graphOf(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      // `.js` in the specifier is the TypeScript source it stands for.
      if (specifier.startsWith('.'))
        walk(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  };
  walk(entry);
  return [...seen].sort();
}

describe('the module graph of @probara/vis-capture', () => {
  it('imports no Node built-in and no package, anywhere', () => {
    const outside: string[] = [];
    for (const file of graphOf(ENTRY)) {
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) outside.push(`${file.slice(SRC.length + 1)}: ${specifier}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('reaches only the modules of the package', () => {
    expect(graphOf(ENTRY).map((file) => file.slice(SRC.length + 1))).toEqual([
      'blur.ts',
      'console.ts',
      'entries.ts',
      'environment.ts',
      'graphql.ts',
      'index.ts',
      'ndjson.ts',
      'network-body.ts',
      'network.ts',
      'recorder.ts',
      'redact.ts',
      'sanitize.ts',
      'selector.ts',
      'serialize.ts',
      'session.ts',
      'user-events.ts',
      'version.ts',
      'websocket.ts',
    ]);
  });

  it('exports the public API and nothing else', () => {
    expect(Object.keys(capture).sort()).toEqual([
      'AUDIO_BITRATE',
      'BLUR_ATTRIBUTE',
      'CAPTURE_FRAME_RATE',
      'CONSOLE_LEVELS',
      'DEFAULT_BLUR_RADIUS_PX',
      'DEFAULT_BODY_LIMITS',
      'DEFAULT_BUFFER_LIMITS',
      'DEFAULT_INPUT_DEBOUNCE_MS',
      'DEFAULT_TIMESLICE_MS',
      'DEFAULT_USER_EVENT_THROTTLE_MS',
      'DEFAULT_VIDEO_BITRATE_1440P',
      'DIAGNOSTICS_FORMAT_VERSION',
      'GRAPHQL_OPERATION_TYPES',
      'MAX_ARGUMENT_LENGTH',
      'MAX_CAPTURE_HEIGHT',
      'MAX_CAPTURE_WIDTH',
      'MAX_CONSOLE_SOURCE_LENGTH',
      'MAX_CONSOLE_STACK_LENGTH',
      'MAX_MASKED_VALUE_LENGTH',
      'MAX_TARGET_TEXT_LENGTH',
      'MIN_VIDEO_BITRATE',
      'NETWORK_KINDS',
      'REDACTED',
      'SANITIZER_REDACTED',
      'USER_EVENT_TYPES',
      'VERSION',
      'collectEnvironment',
      'createBlurController',
      'createConsoleCapture',
      'createNetworkCapture',
      'createRecordingSession',
      'createUserEventCapture',
      'createVideoRecorder',
      'createWebSocketCapture',
      'cssSelector',
      'displayCaptureConstraints',
      'graphqlHasErrors',
      'graphqlOperation',
      'gzipNdjson',
      'isConsoleEntry',
      'isNetworkEntry',
      'isUserEventEntry',
      'isWebSocketMessageEntry',
      'matchesUrl',
      'parseUserAgent',
      'pickVideoFormat',
      'redactBody',
      'redactHeaders',
      'redactString',
      'sanitizeConsoleEntry',
      'sanitizeNetworkEntry',
      'sanitizeWebSocketEntry',
      'serializeArgument',
      'toNdjson',
      'videoBitrate',
    ]);
  });

  it('declares rrweb as its only runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(PACKAGE, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(manifest['dependencies'] as object)).toEqual(['rrweb']);
    expect(manifest['peerDependencies']).toBeUndefined();
  });

  it('reaches rrweb from the replay entry only, which imports nothing else', () => {
    const packages = graphOf(REPLAY).flatMap((file) =>
      specifiersOf(file).filter((specifier) => !specifier.startsWith('.')),
    );
    expect([...new Set(packages)]).toEqual(['rrweb']);
    expect(graphOf(ENTRY)).not.toContain(REPLAY);
  });
});
