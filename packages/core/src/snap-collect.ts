/**
 * The Node side of an adapter's `probaraSnap`: the screenshots of an execution, taken out of the
 * attachments of its result (the description and the PNG the browser handed over, see
 * `snap-transport.ts`) and given the test that took them, as `uploadSnapScreenshots` sends them.
 * They are never result attachments.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { buildAutomationKey } from './automation-key.js';
import type { SnapScreenshotInput } from './snap.js';
import {
  SNAP_CONTENT_TYPE,
  SNAP_IMAGE_CONTENT_TYPE,
  type SnapDescription,
} from './snap-transport.js';
import type { AttachmentInput } from './attachments.js';
import type { TestResultInput } from './result.js';

/** The most a screenshot says about its test: the limits of the Snap API. */
const MAX_TITLE_SEGMENTS = 50;
const MAX_TEXT_LENGTH = 1024;
const MAX_CASE_IDS = 20;

/** What an adapter knows of the execution a result is of. */
export interface SnapExecution {
  /** Zero-based retry of the execution. */
  retry: number;
  /** The root the automation keys are relative to. */
  rootDir?: string | undefined;
  /** The browser the test ran in, such as `chromium`. */
  browser?: string | undefined;
}

function isSnapAttachment({ contentType }: AttachmentInput): boolean {
  return contentType === SNAP_CONTENT_TYPE || contentType === SNAP_IMAGE_CONTENT_TYPE;
}

function textOf({ body, path }: AttachmentInput): string | undefined {
  if (typeof body === 'string') return body;
  if (body !== undefined) return Buffer.from(body).toString('utf8');
  if (path === undefined) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function descriptionOf(attachment: AttachmentInput): SnapDescription | undefined {
  try {
    const parsed = JSON.parse(textOf(attachment) ?? '') as SnapDescription | null;
    return typeof parsed === 'object' && parsed !== null && typeof parsed.name === 'string'
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/** The file of a test as its key names it: relative to the root, with forward slashes. */
function fileOf(file: string, rootDir: string | undefined): string {
  const local = rootDir !== undefined && isAbsolute(file) ? relative(rootDir, file) : file;
  return local.split(sep).join('/').slice(0, MAX_TEXT_LENGTH);
}

/** The test of a screenshot: its key and cases as the report sends them, and the attempt. */
function testOf(
  input: TestResultInput,
  { retry, rootDir }: SnapExecution,
): NonNullable<SnapScreenshotInput['test']> {
  const { identity } = input;
  const ids = [
    ...(input.caseDisplayId === undefined ? [] : [input.caseDisplayId]),
    ...(input.caseDisplayIds ?? []),
  ].slice(0, MAX_CASE_IDS);
  return {
    automationKey:
      input.automationKey ?? buildAutomationKey(identity, rootDir === undefined ? {} : { rootDir }),
    ...(ids.length === 0 ? {} : { caseDisplayIds: ids }),
    titlePath: identity.titlePath
      .slice(0, MAX_TITLE_SEGMENTS)
      .map((segment) => segment.slice(0, MAX_TEXT_LENGTH)),
    ...(identity.file === undefined ? {} : { file: fileOf(identity.file, rootDir) }),
    retry,
  };
}

/**
 * The result without its Snap attachments, and the screenshots they were: each description with the PNG that follows
 * it. A description that cannot be read, or without its PNG, is left out.
 */
export function snapsOf(
  input: TestResultInput,
  execution: SnapExecution,
): { input: TestResultInput; screenshots: SnapScreenshotInput[] } {
  const all = input.attachments ?? [];
  if (!all.some(isSnapAttachment)) return { input, screenshots: [] };
  const test = testOf(input, execution);
  const screenshots: SnapScreenshotInput[] = [];
  for (const [index, attachment] of all.entries()) {
    if (attachment.contentType !== SNAP_CONTENT_TYPE) continue;
    const description = descriptionOf(attachment);
    const image = all[index + 1];
    if (description === undefined || image?.contentType !== SNAP_IMAGE_CONTENT_TYPE) continue;
    if (image.path === undefined && image.body === undefined) continue;
    screenshots.push({
      name: description.name,
      ...(image.path === undefined
        ? { body: typeof image.body === 'string' ? Buffer.from(image.body) : image.body }
        : { path: image.path }),
      ...(execution.browser === undefined ? {} : { browser: execution.browser }),
      ...(description.viewport === undefined ? {} : { viewport: description.viewport }),
      ...(description.colorMode === undefined ? {} : { colorMode: description.colorMode }),
      ...(description.threshold === undefined ? {} : { threshold: description.threshold }),
      test,
    });
  }
  const kept = all.filter((attachment) => !isSnapAttachment(attachment));
  const rest: TestResultInput = { ...input, attachments: kept };
  if (kept.length === 0) delete rest.attachments;
  return { input: rest, screenshots };
}
