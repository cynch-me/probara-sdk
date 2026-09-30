// Loaded with `node --import` by every command the docs tests run: each request goes to the fake
// Probara of the test, whatever base URL the example names, so no example leaves the machine. The
// request stays the same: a `Request` keeps its method, headers and body (the init of the call wins
// over them, as with fetch itself).
const target = process.env.PROBARA_DOCS_FAKE_URL;
if (target !== undefined && target !== '') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const redirected = `${target}${url.pathname}${url.search}`;
    return realFetch(input instanceof Request ? new Request(redirected, input) : redirected, init);
  };
}
