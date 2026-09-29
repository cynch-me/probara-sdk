import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the real tool output under `test/fixtures/`. */
export const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function fixturePath(...parts: string[]): string {
  return join(FIXTURES_DIR, ...parts);
}

export function readFixture(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), 'utf8');
}

/** The XML files of a fixture folder, in name order. */
export function fixtureXmlFiles(...parts: string[]): string[] {
  return readdirSync(fixturePath(...parts))
    .filter((name) => name.endsWith('.xml'))
    .sort()
    .map((name) => fixturePath(...parts, name));
}
