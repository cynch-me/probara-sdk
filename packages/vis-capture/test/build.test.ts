/**
 * The build: ES modules with their types for npm, and one IIFE file per entry for a script tag:
 * the main one sets the global `ProbaraVisCapture`, the replay one `ProbaraVisCaptureReplay`.
 * The test runs the real build (through `buildWhenStale`: the tests of other packages build this
 * one at the same time, and two tsdown runs in one `dist` delete each other's files), then loads
 * the outputs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildWhenStale, VIS_CAPTURE_BUILD } from '@probara/test-support/build';
import { beforeAll, describe, expect, it } from 'vitest';
import * as source from '../src/index.js';
import * as replaySource from '../src/replay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const IIFE = join(DIST, 'vis-capture.iife.js');
const REPLAY_IIFE = join(DIST, 'vis-capture-replay.iife.js');

/** Runs a script-tag build in an empty global scope and returns the global it set. */
function runIife(path: string, globalName: string): Record<string, unknown> | undefined {
  const code = readFileSync(path, 'utf8');
  expect(code).not.toMatch(/^\s*(import|export)\s/m);
  const context: Record<string, unknown> = {};
  context['globalThis'] = context;
  runInNewContext(code, context);
  return context[globalName] as Record<string, unknown> | undefined;
}

beforeAll(async () => {
  await buildWhenStale(VIS_CAPTURE_BUILD);
}, 120_000);

describe('the build of @probara/vis-capture', () => {
  it('writes an ES module with the exports of the source, and its types', async () => {
    const built = (await import(pathToFileURL(join(DIST, 'index.js')).href)) as object;
    expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort());
    expect(readFileSync(join(DIST, 'index.d.ts'), 'utf8')).toContain('createConsoleCapture');
  });

  it('writes one script-tag file that sets the ProbaraVisCapture global', () => {
    const global = runIife(IIFE, 'ProbaraVisCapture');
    expect(Object.keys(global ?? {}).sort()).toEqual(Object.keys(source).sort());
    expect(global?.['VERSION']).toBe(source.VERSION);
  });

  it('writes the replay entry as its own ES module, with its types, importing the rrweb recorder', async () => {
    const built = (await import(pathToFileURL(join(DIST, 'replay.js')).href)) as object;
    expect(Object.keys(built).sort()).toEqual(Object.keys(replaySource).sort());
    expect(readFileSync(join(DIST, 'replay.d.ts'), 'utf8')).toContain('createReplayRecorder');
    const replay = readFileSync(join(DIST, 'replay.js'), 'utf8');
    expect(replay).toMatch(/from\s*["']@rrweb\/record["']/);
    // The deprecated `rrweb` package is not a dependency: nothing imports it by that name.
    expect(replay).not.toMatch(/from\s*["']rrweb["']/);
  });

  it('keeps rrweb out of the main entry, in both builds', () => {
    expect(readFileSync(join(DIST, 'index.js'), 'utf8')).not.toContain('rrweb');
    expect(readFileSync(IIFE, 'utf8')).not.toContain('rrweb');
  });

  it('writes one script-tag file for the replay, with the rrweb recorder bundled in', () => {
    const global = runIife(REPLAY_IIFE, 'ProbaraVisCaptureReplay');
    expect(Object.keys(global ?? {}).sort()).toEqual(Object.keys(replaySource).sort());
    expect(global?.['REPLAY_CHECKOUT_MS']).toBe(replaySource.REPLAY_CHECKOUT_MS);
  });

  it('ships the licence notices of rrweb and of what it bundles with the replay script', () => {
    const code = readFileSync(REPLAY_IIFE, 'utf8');
    expect(code.startsWith('/*!')).toBe(true);
    expect(code.slice(0, 400)).toMatch(/rrweb .*MIT/);
    expect(code.slice(0, 400)).toContain('THIRD_PARTY_NOTICES.md');
    const notices = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const name of ['rrweb', 'base64-arraybuffer']) {
      expect(notices, name).toContain(`## ${name}`);
    }
    expect(notices).toContain('Copyright (c) 2018 Contributors');
    expect(notices).toContain('Permission is hereby granted, free of charge');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(manifest.files).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('points every path of the package exports at a built file', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, string | Record<string, string>>;
      types: string;
      unpkg: string;
      jsdelivr: string;
    };
    const paths = [manifest.types, manifest.unpkg, manifest.jsdelivr];
    for (const target of Object.values(manifest.exports)) {
      paths.push(...(typeof target === 'string' ? [target] : Object.values(target)));
    }
    for (const path of paths) expect(existsSync(join(ROOT, path)), path).toBe(true);
    expect(manifest.exports['./iife']).toBe('./dist/vis-capture.iife.js');
    expect(manifest.exports['./replay']).toEqual({
      types: './dist/replay.d.ts',
      default: './dist/replay.js',
    });
    expect(manifest.exports['./replay/iife']).toBe('./dist/vis-capture-replay.iife.js');
  });
});
