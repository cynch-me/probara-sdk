import type { RecorderOptions } from './recorder.js';
import type { ReporterOptions } from './reporter.js';

type Data = Readonly<Record<string, string | undefined>>;

/** The options the recorder and the reporter both read from the element. */
function sharedOptions(
  data: Data,
): Pick<RecorderOptions, 'organizations' | 'apiOrigin' | 'blur' | 'locale'> {
  const organizations = (data['organizations'] ?? '')
    .split(/[\s,]+/)
    .filter((organization) => organization !== '');
  const options: Pick<RecorderOptions, 'organizations' | 'apiOrigin' | 'blur' | 'locale'> = {
    organizations,
  };
  const apiOrigin = data['apiOrigin']?.trim();
  if (apiOrigin !== undefined && apiOrigin !== '') options.apiOrigin = apiOrigin;
  const blur = data['blur']?.trim();
  if (blur !== undefined && blur !== '') options.blur = [blur];
  const locale = data['locale'];
  if (locale === 'en' || locale === 'es') options.locale = locale;
  return options;
}

/**
 * The recorder options of the script tag's `data-*` attributes (`data-organizations`,
 * `data-api-origin`, `data-blur`, `data-locale`), or `null` when `data-manual` asks it to open
 * nothing by itself. `data-organizations` lists the organization ULIDs separated by spaces or
 * commas; without it the list is empty, and the recorder refuses to start.
 */
export function scriptOptions(data: Data): RecorderOptions | null {
  if (data['manual'] !== undefined) return null;
  return sharedOptions(data);
}

/**
 * The reporter options of the script tag's `data-*` attributes: `data-widget-key`, the attributes
 * the recorder reads, and `data-launcher` (present or `true`: the launcher; `false`: none;
 * `bottom-left` or `bottom-right`: the launcher there). `null` without `data-widget-key`.
 */
export function reporterOptions(data: Data): ReporterOptions | null {
  const widgetKey = data['widgetKey']?.trim();
  if (widgetKey === undefined || widgetKey === '') return null;
  const options: ReporterOptions = { widgetKey, ...sharedOptions(data) };
  const launcher = data['launcher']?.trim();
  if (launcher === 'false') options.launcher = false;
  else if (launcher === 'bottom-left' || launcher === 'bottom-right')
    options.launcher = { position: launcher };
  else if (launcher !== undefined) options.launcher = true;
  return options;
}
