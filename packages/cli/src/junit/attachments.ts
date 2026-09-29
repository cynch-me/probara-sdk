/** Files a testcase references, and its output as text files. */
import type { AttachmentInput } from '@probara/core';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import type { JUnitTestCase } from './model.js';

const ATTACHMENT_LINE = /^[ \t]*\[\[ATTACHMENT\|(.+?)\]\][ \t]*\r?$/gm;
const ATTACHMENT_PROPERTY = 'probara_attachment';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

/** The paths of `[[ATTACHMENT|path]]` lines and `probara_attachment` properties, once each. */
export function referencedPaths(testcase: JUnitTestCase): string[] {
  const outputs = [
    ...testcase.systemOut,
    ...testcase.systemErr,
    // Playwright and Surefire put each retry's output inside its attempt.
    ...testcase.outcomes.flatMap((outcome) => [...outcome.systemOut, ...outcome.systemErr]),
  ];
  const paths = [
    ...outputs.flatMap((output) =>
      [...output.matchAll(ATTACHMENT_LINE)].map((match) => (match[1] ?? '').trim()),
    ),
    ...testcase.properties
      .filter((property) => property.name === ATTACHMENT_PROPERTY)
      .map((property) => property.value.trim()),
  ];
  return [...new Set(paths.filter((path) => path !== ''))];
}

export interface ResolvedAttachment {
  attachment: AttachmentInput;
  found: boolean;
}

/**
 * An absolute path for a referenced file: relative paths are read against the report's folder,
 * then against the working directory. A file found in neither keeps the report's folder.
 */
export function resolveAttachment(
  path: string,
  reportDir: string,
  cwd: string,
): ResolvedAttachment {
  const nextToReport = resolve(reportDir, path);
  const candidates = isAbsolute(path) ? [path] : [nextToReport, resolve(cwd, path)];
  const found = candidates.find((candidate) => existsSync(candidate));
  const absolute = found ?? nextToReport;
  const contentType = CONTENT_TYPES[extname(absolute).toLowerCase()];
  return {
    attachment: { path: absolute, ...(contentType === undefined ? {} : { contentType }) },
    found: found !== undefined,
  };
}

/** One output stream as text, without attachment lines; `undefined` when nothing is left. */
export function outputText(parts: readonly string[]): string | undefined {
  const text = parts
    .map((part) => part.replace(ATTACHMENT_LINE, ''))
    .join('\n')
    // XML indentation around a CDATA section is not output.
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .trimEnd();
  return text === '' ? undefined : `${text}\n`;
}

export function outputAttachments(testcase: JUnitTestCase): AttachmentInput[] {
  const streams = [
    ['system-out.txt', testcase.systemOut],
    ['system-err.txt', testcase.systemErr],
  ] as const;
  return streams.flatMap(([name, parts]) => {
    const body = outputText(parts);
    return body === undefined ? [] : [{ name, contentType: 'text/plain', body }];
  });
}
