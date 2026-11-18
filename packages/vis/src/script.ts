/**
 * The script-tag build of `@probara/vis`: the same API on the global `ProbaraVis`. Once loaded,
 * the recorder opens by itself when the page's address carries a recording link token, and with
 * `data-widget-key` the reporter of in-app reporting starts. The `<script>` element configures
 * them (`scriptOptions`, `reporterOptions`): `data-organizations` (required: without it nothing
 * starts and the console gets one warning), `data-api-origin`, `data-blur`, `data-locale`,
 * `data-manual` to open no recorder by itself, `data-widget-key` and `data-launcher`. This build
 * cannot split its code, so the instant replay loads the engine's published replay script.
 */
import { createReporter, startRecorderFromUrl } from './index.js';
import { validOrganizations } from './recorder.js';
import { setReplayLoader } from './replay-loader.js';
import { loadReplayScript } from './replay-script.js';
import { reporterOptions, scriptOptions } from './script-options.js';

export * from './index.js';

function autoStart(): void {
  try {
    if (typeof document === 'undefined') return;
    setReplayLoader(loadReplayScript);
    const script = document.currentScript;
    const data = script === null ? {} : (script as HTMLScriptElement).dataset;
    const reporter = reporterOptions(data);
    if (reporter !== null) createReporter(reporter);
    const options = scriptOptions(data);
    // With a widget key, organizations that are not valid were already warned about, once.
    if (options !== null && (reporter === null || validOrganizations(options) !== null))
      startRecorderFromUrl(options);
  } catch {
    // Never break the page that loads it.
  }
}

autoStart();
