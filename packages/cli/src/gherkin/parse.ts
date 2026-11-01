/** Reads one `.feature` file with the official Gherkin parser; a file that does not parse names where. */
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument } from '@cucumber/messages';
import { featureOf, type GherkinFeature } from './features.js';

/** One syntax error of a file: where it is, and what the parser expected. */
export interface FeatureProblem {
  path: string;
  line: number;
  /** 0 when the parser gives no column. */
  column: number;
  message: string;
}

export type FeatureParse =
  { ok: true; feature: GherkinFeature | undefined } | { ok: false; problems: FeatureProblem[] };

/** The `(line:column): ` the parser puts in front of each message. */
const LOCATION_PREFIX = /^\(\d+:\d+\): /;

interface Located {
  message?: string;
  location?: { line?: number; column?: number };
}

function problemsOf(error: unknown, path: string): FeatureProblem[] {
  const errors = (error as { errors?: unknown }).errors;
  const items: Located[] = Array.isArray(errors) ? (errors as Located[]) : [error as Located];
  return items.map((item) => {
    const text = typeof item.message === 'string' ? item.message : 'the file is not Gherkin';
    const message = text.replace(LOCATION_PREFIX, '');
    return {
      path,
      line: item.location?.line ?? 1,
      column: item.location?.column ?? 0,
      message,
    };
  });
}

/**
 * The Feature of `text`, read as the file at `path`: a file of comments has none, and is no error.
 * Every syntax error comes back with its path, line and column.
 */
export function parseFeature(text: string, path: string): FeatureParse {
  const parser = new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(),
  );
  let document: GherkinDocument;
  try {
    document = parser.parse(text);
  } catch (error) {
    return { ok: false, problems: problemsOf(error, path) };
  }
  return { ok: true, feature: featureOf(document) };
}
