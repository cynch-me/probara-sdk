/**
 * How the `probara.*` helpers, which run in Playwright's workers, hand metadata to the reporter,
 * which runs in the main process. Case ids travel as `probara_case` annotations (the JUnit import
 * reads them too). Everything else travels as one small attachment per call, named `_probara` and
 * typed {@link METADATA_CONTENT_TYPE}: attachments belong to one attempt (so every retry carries
 * its own), survive blob reports and `merge-reports`, and are never uploaded to Probara.
 * The metadata model and its merge rules are core's; this is the Playwright transport.
 */
import { readMetadataMessages, type AttemptMetadata } from '@probara/core';

export {
  CASE_ANNOTATION,
  type AttemptMetadata,
  type CaseStep,
  type MetadataMessage,
} from '@probara/core';

/** The name of a metadata attachment; terminal reporters skip names that start with `_`. */
export const METADATA_NAME = '_probara';
export const METADATA_CONTENT_TYPE = 'application/vnd.probara.metadata+json';

/** ` [probara:3]`: the end of a step title `probara.step()` made, pointing at its declaration. */
const STEP_MARKER = / \[probara:([1-9]\d{0,8})\]$/;

/** The title `probara.step()` returns for `test.step`: the action and a short reference. */
export function stepTitle(action: string, ref: number): string {
  return `${action} [probara:${ref}]`;
}

/** The action and reference of a step title `probara.step()` made, if it made it. */
export function parseStepTitle(title: string): { action: string; ref: number } | undefined {
  const match = STEP_MARKER.exec(title);
  if (match === null) return undefined;
  return { action: title.slice(0, match.index), ref: Number(match[1]) };
}

export function isMetadataAttachment(attachment: { contentType: string }): boolean {
  return attachment.contentType === METADATA_CONTENT_TYPE;
}

function bodyText(body: Buffer | string | undefined): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : body.toString('utf8');
}

/**
 * The metadata the helpers attached to one attempt, in call order, and why any attachment was
 * left out. A malformed one (not JSON, an unknown type, a value of the wrong shape) never throws.
 */
export function readMetadata(
  attachments: readonly { contentType: string; body?: Buffer | string | undefined }[],
): { metadata: AttemptMetadata; problems: string[] } {
  const messages = attachments.filter(isMetadataAttachment).map((attachment) => {
    try {
      return JSON.parse(bodyText(attachment.body) ?? '') as unknown;
    } catch {
      return undefined;
    }
  });
  return readMetadataMessages(messages);
}
