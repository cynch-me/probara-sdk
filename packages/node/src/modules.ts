import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProbaraEvent } from '@probara/error-core';

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function declared(manifest: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of ['dependencies', 'devDependencies']) {
    const entries = manifest[field];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [name, version] of Object.entries(entries)) {
      if (typeof version === 'string') out[name] = version;
    }
  }
  return out;
}

export function modulesOf(appRoot: string): Record<string, string> {
  const manifest = readJson(join(appRoot, 'package.json'));
  if (manifest === undefined) return {};
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(declared(manifest))) {
    const installed = readJson(join(appRoot, 'node_modules', name, 'package.json'))?.['version'];
    out[name] = typeof installed === 'string' ? installed : range;
  }
  return out;
}

export function createModules(appRoot: string): (event: ProbaraEvent) => ProbaraEvent {
  let modules: Record<string, string> | undefined;
  return (event) => {
    modules ??= modulesOf(appRoot);
    if (event.modules !== undefined || Object.keys(modules).length === 0) return event;
    return { ...event, modules: { ...modules } };
  };
}
