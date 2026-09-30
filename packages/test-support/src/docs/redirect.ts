/**
 * `redirect-fetch.mjs`, for `node --import`: every request of a command the docs tests run goes to
 * the fake Probara in `PROBARA_DOCS_FAKE_URL`, whatever base URL the example names.
 */
export const REDIRECT_FETCH_URL = new URL('./redirect-fetch.mjs', import.meta.url).href;
