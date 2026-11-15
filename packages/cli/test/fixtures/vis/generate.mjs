/**
 * Writes the Playwright fixtures of `probara vis create --playwright-trace` into the current
 * directory: `recording.webm` (the video Playwright records of the page) and `trace.zip` (its trace,
 * with network but no screenshots, to keep it small). `generate.sh` runs it in a scratch folder
 * under /tmp, so the paths the trace records (the video folder, this script) are generic. It loads
 * the Playwright of `packages/vis-capture`, named by PROBARA_VIS_CAPTURE.
 *
 * The page signs in: it logs to the console, fills an email and a password, and its button sends a
 * fetch with an Authorization header and the password in a JSON body, then navigates. Every run
 * gives new times and a new port; the structure stays the same.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readdir, rename } from 'node:fs/promises';

const require = createRequire(`${process.env.PROBARA_VIS_CAPTURE ?? '.'}/package.json`);
const { chromium } = require('playwright');

const SIGN_IN = `<!doctype html><title>Sign in</title>
<form><input id=email name=email><input id=password type=password name=password>
<button id=go type=button>Sign in</button></form>
<script>
console.log('app ready', { build: 42 });
document.getElementById('go').addEventListener('click', async () => {
  console.warn('signing in');
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-token-123' },
    body: JSON.stringify({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    }),
  });
  const body = await response.json();
  console.error('login failed', body.error);
  location.href = '/done';
});
</script>`;

const server = createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html');
    response.end(SIGN_IN);
  } else if (request.url === '/api/login') {
    request.resume().on('end', () => {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.setHeader('set-cookie', 'session=abc123; HttpOnly');
      response.end(JSON.stringify({ error: 'Invalid password' }));
    });
  } else if (request.url === '/done') {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Done</title><p>Done</p>');
  } else {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${String(server.address().port)}`;

const before = new Set(await readdir('.'));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 320, height: 240 },
  recordVideo: { dir: '.', size: { width: 320, height: 240 } },
});
await context.tracing.start({ screenshots: false, snapshots: true });
const page = await context.newPage();
await page.goto(`${base}/`);
await page.fill('#email', 'ada@example.com');
await page.fill('#password', 'hunter2');
await page.click('#go');
await page.waitForURL(`${base}/done`);
await page.waitForTimeout(300);
await context.tracing.stop({ path: 'trace.zip' });
await context.close();
await browser.close();
server.close();

const [video] = (await readdir('.')).filter((name) => name.endsWith('.webm') && !before.has(name));
await rename(video, 'recording.webm');
