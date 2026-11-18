import type { RecorderOptions } from './recorder.js';

/**
 * The recorder options of the script tag's `data-*` attributes (`data-organizations`,
 * `data-api-origin`, `data-blur`, `data-locale`), or `null` when `data-manual` asks it to open
 * nothing by itself. `data-organizations` lists the organization ULIDs separated by spaces or
 * commas; without it the list is empty, and the recorder refuses to start.
 */
export function scriptOptions(
  data: Readonly<Record<string, string | undefined>>,
): RecorderOptions | null {
  if (data['manual'] !== undefined) return null;
  const organizations = (data['organizations'] ?? '')
    .split(/[\s,]+/)
    .filter((organization) => organization !== '');
  const options: RecorderOptions = { organizations };
  const apiOrigin = data['apiOrigin']?.trim();
  if (apiOrigin !== undefined && apiOrigin !== '') options.apiOrigin = apiOrigin;
  const blur = data['blur']?.trim();
  if (blur !== undefined && blur !== '') options.blur = [blur];
  const locale = data['locale'];
  if (locale === 'en' || locale === 'es') options.locale = locale;
  return options;
}
