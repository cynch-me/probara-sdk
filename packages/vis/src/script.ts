/**
 * The script-tag build of `@probara/vis`: the same API on the global `ProbaraVis`, and, once
 * loaded, the recorder opens by itself when the page's address carries a recording link token.
 * The `<script>` element configures it (`scriptOptions`): `data-organizations` (required: without
 * it nothing opens and the console gets one warning), `data-api-origin`, `data-blur`,
 * `data-locale`, and `data-manual` to open nothing by itself.
 */
import { startRecorderFromUrl } from './index.js';
import { scriptOptions } from './script-options.js';

export * from './index.js';

function autoStart(): void {
  try {
    if (typeof document === 'undefined') return;
    const script = document.currentScript;
    const options = scriptOptions(script === null ? {} : (script as HTMLScriptElement).dataset);
    if (options !== null) startRecorderFromUrl(options);
  } catch {
    // Never break the page that loads it.
  }
}

autoStart();
