import { describe, expect, it } from 'vitest';
import type { ConsoleEntry, NetworkEntry, WebSocketMessageEntry } from './entries.js';
import {
  SANITIZER_REDACTED,
  sanitizeConsoleEntry,
  sanitizeNetworkEntry,
  sanitizeWebSocketEntry,
} from './sanitize.js';

const logEntry: ConsoleEntry = {
  t: 5,
  ts: 1005,
  level: 'warn',
  args: ['user ana@shop.test', 'Bearer abc'],
  stack: 'at checkout (https://shop.test/app.js:1:1)',
};

const request: NetworkEntry = {
  t: 10,
  ts: 1010,
  id: 'r1',
  kind: 'xhr',
  method: 'POST',
  url: 'https://shop.test/login?token=abc',
  status: 200,
  requestHeaders: { authorization: 'Bearer abc', 'x-tenant': 'acme' },
  responseHeaders: { 'set-cookie': 'sid=1', 'content-type': 'application/json' },
  requestBody: {
    text: '{"user":"ana","password":"hunter2"}',
    truncated: false,
    size: 35,
    omitted: null,
  },
  responseBody: {
    text: '{"ok":true,"token":"t-1","name":"Ana"}',
    truncated: false,
    size: 38,
    omitted: null,
  },
  durationMs: 40,
  timing: null,
  error: null,
  graphql: { operationName: 'Login', operationType: 'mutation', hasErrors: false },
};

const message: WebSocketMessageEntry = {
  t: 20,
  ts: 1020,
  socketId: 's1',
  direction: 'sent',
  data: '{"type":"auth","secret":"s-1","room":"7"}',
};

describe('the sanitizer markers', () => {
  it('is the literal PROBARA_SANITIZER_REDACTED', () => {
    expect(SANITIZER_REDACTED).toBe('PROBARA_SANITIZER_REDACTED');
  });
});

describe('logSanitizer', () => {
  it('keeps the entry it returns, then applies the built-in redaction', () => {
    const kept = sanitizeConsoleEntry(logEntry, (entry) => ({
      ...entry,
      args: entry.args.map((arg) => arg.replace('ana@shop.test', '<email>')),
    }));
    expect(kept).toEqual({ ...logEntry, args: ['user <email>', 'Bearer PROBARA_REDACTED'] });
  });

  it('drops the entry when it returns null', () => {
    expect(sanitizeConsoleEntry(logEntry, () => null)).toBeNull();
  });

  it('applies only the built-in redaction when there is none', () => {
    expect(sanitizeConsoleEntry(logEntry)?.args).toEqual([
      'user ana@shop.test',
      'Bearer PROBARA_REDACTED',
    ]);
  });

  it('fails closed when it throws or returns something that is not a console entry', () => {
    const closed = {
      t: 5,
      ts: 1005,
      level: 'warn',
      args: ['PROBARA_SANITIZER_REDACTED'],
    };
    expect(
      sanitizeConsoleEntry(logEntry, () => {
        throw new Error('bug in the customer sanitizer');
      }),
    ).toEqual(closed);
    expect(sanitizeConsoleEntry(logEntry, () => ({ args: 'nope' }) as never)).toEqual(closed);
    expect(sanitizeConsoleEntry(logEntry, () => undefined as never)).toEqual(closed);
  });

  it('fails closed when it returns a Promise, without an unhandled rejection', async () => {
    const closed = { t: 5, ts: 1005, level: 'warn', args: [SANITIZER_REDACTED] };
    expect(
      sanitizeConsoleEntry(logEntry, (async () => {
        await Promise.resolve();
        throw new Error('async sanitizer');
      }) as never),
    ).toEqual(closed);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('redacts secrets in the source of an uncaught error', () => {
    const kept = sanitizeConsoleEntry({
      ...logEntry,
      source: 'https://ana:hunter2@shop.test/app.js:10:3',
    });
    expect(kept?.source).toBe('https://ana:PROBARA_REDACTED@shop.test/app.js:10:3');
  });

  it('does not let the sanitizer change the time or the level of the entry', () => {
    const kept = sanitizeConsoleEntry(logEntry, (entry) => ({ ...entry, t: 999, level: 'log' }));
    expect(kept).toMatchObject({ t: 5, ts: 1005, level: 'warn' });
  });
});

describe('requestSanitizer and responseSanitizer', () => {
  it('pass the request and the response, then the built-in redaction runs on both', () => {
    const seen: unknown[] = [];
    const kept = sanitizeNetworkEntry(request, {
      requestSanitizer: (req) => {
        seen.push(req);
        return { ...req, headers: { ...req.headers, 'x-tenant': '<tenant>' } };
      },
      responseSanitizer: (res) => {
        seen.push(res);
        return { ...res, body: res.body?.replace('Ana', '<name>') };
      },
    });
    expect(seen).toEqual([
      {
        url: 'https://shop.test/login?token=abc',
        method: 'POST',
        headers: { authorization: 'Bearer abc', 'x-tenant': 'acme' },
        body: '{"user":"ana","password":"hunter2"}',
      },
      {
        url: 'https://shop.test/login?token=abc',
        status: 200,
        headers: { 'set-cookie': 'sid=1', 'content-type': 'application/json' },
        body: '{"ok":true,"token":"t-1","name":"Ana"}',
      },
    ]);
    expect(kept).toEqual({
      ...request,
      url: 'https://shop.test/login?token=PROBARA_REDACTED',
      requestHeaders: { authorization: 'PROBARA_REDACTED', 'x-tenant': '<tenant>' },
      responseHeaders: { 'set-cookie': 'PROBARA_REDACTED', 'content-type': 'application/json' },
      requestBody: {
        text: '{"user":"ana","password":"PROBARA_REDACTED"}',
        truncated: false,
        size: 35,
        omitted: null,
      },
      responseBody: {
        text: '{"ok":true,"token":"PROBARA_REDACTED","name":"<name>"}',
        truncated: false,
        size: 38,
        omitted: null,
      },
    });
  });

  it('drop the whole entry when either returns null', () => {
    expect(sanitizeNetworkEntry(request, { requestSanitizer: () => null })).toBeNull();
    expect(sanitizeNetworkEntry(request, { responseSanitizer: () => null })).toBeNull();
  });

  it('fail closed on the request: its URL, headers and body are replaced', () => {
    const kept = sanitizeNetworkEntry(request, {
      requestSanitizer: () => {
        throw new Error('boom');
      },
    });
    expect(kept).toMatchObject({
      url: SANITIZER_REDACTED,
      requestHeaders: {},
      requestBody: { text: SANITIZER_REDACTED, truncated: false, size: 35, omitted: null },
      // The response stays, redacted by the built-in rules.
      responseHeaders: { 'set-cookie': 'PROBARA_REDACTED', 'content-type': 'application/json' },
    });
    // Derived from the request body, so it goes with it.
    expect(kept?.graphql).toBeNull();
    expect(JSON.stringify(kept)).not.toContain('hunter2');
  });

  it('fail closed on the response when it returns an invalid value', () => {
    const kept = sanitizeNetworkEntry(request, {
      responseSanitizer: () => ({ status: 'ok' }) as never,
    });
    expect(kept).toMatchObject({
      responseHeaders: {},
      responseBody: { text: SANITIZER_REDACTED, truncated: false, size: 38, omitted: null },
      requestHeaders: { authorization: 'PROBARA_REDACTED', 'x-tenant': 'acme' },
    });
    expect(JSON.stringify(kept)).not.toContain('Ana');
  });

  it('keep an omitted body omitted', () => {
    const omitted: NetworkEntry = {
      ...request,
      responseBody: { text: null, truncated: false, size: 9_000_000, omitted: 'too_large' },
    };
    const kept = sanitizeNetworkEntry(omitted, { responseSanitizer: (res) => res });
    expect(kept?.responseBody).toEqual({
      text: null,
      truncated: false,
      size: 9_000_000,
      omitted: 'too_large',
    });
  });

  it('keep the omitted reason of a body without text when they fail closed', () => {
    const omitted: NetworkEntry = {
      ...request,
      requestBody: { text: null, truncated: false, size: null, omitted: 'stream' },
      responseBody: { text: null, truncated: false, size: 4096, omitted: 'binary' },
    };
    const kept = sanitizeNetworkEntry(omitted, {
      requestSanitizer: () => {
        throw new Error('boom');
      },
      responseSanitizer: () => {
        throw new Error('boom');
      },
    });
    expect(kept?.requestBody).toEqual({
      text: null,
      truncated: false,
      size: null,
      omitted: 'stream',
    });
    expect(kept?.responseBody).toEqual({
      text: null,
      truncated: false,
      size: 4096,
      omitted: 'binary',
    });
  });

  it('ignore text they supply for a body that was omitted, so it never holds text and a reason', () => {
    const omitted: NetworkEntry = {
      ...request,
      requestBody: { text: null, truncated: false, size: 70_000, omitted: 'too_large' },
      responseBody: { text: null, truncated: false, size: 4096, omitted: 'binary' },
    };
    const kept = sanitizeNetworkEntry(omitted, {
      requestSanitizer: (req) => ({ ...req, body: 'made up' }),
      responseSanitizer: (res) => ({ ...res, body: 'made up' }),
    });
    expect(kept?.requestBody).toEqual({
      text: null,
      truncated: false,
      size: 70_000,
      omitted: 'too_large',
    });
    expect(kept?.responseBody).toEqual({
      text: null,
      truncated: false,
      size: 4096,
      omitted: 'binary',
    });
  });

  it('remove the text of a body when they return no body, and add one when there was none', () => {
    const kept = sanitizeNetworkEntry(
      { ...request, responseBody: null },
      {
        requestSanitizer: (req) => ({ ...req, body: undefined }),
        responseSanitizer: (res) => ({ ...res, body: '{"note":"added"}' }),
      },
    );
    expect(kept?.requestBody).toEqual({ text: null, truncated: false, size: 35, omitted: null });
    expect(kept?.responseBody).toEqual({
      text: '{"note":"added"}',
      truncated: false,
      size: 16,
      omitted: null,
    });
  });

  it('fail closed when they return a Promise, without an unhandled rejection', async () => {
    const kept = sanitizeNetworkEntry(request, {
      requestSanitizer: (async () => {
        await Promise.resolve();
        throw new Error('async sanitizer');
      }) as never,
      responseSanitizer: (async (res: unknown) => {
        await Promise.resolve();
        return res;
      }) as never,
    });
    expect(kept).toMatchObject({
      url: SANITIZER_REDACTED,
      requestBody: { text: SANITIZER_REDACTED },
      responseBody: { text: SANITIZER_REDACTED },
    });
    // A rejection left unhandled would fail this test file.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('redact secrets in the error of a failed request', () => {
    const kept = sanitizeNetworkEntry({
      ...request,
      status: null,
      error: 'TypeError: Failed to fetch https://shop.test/?access_token=abc',
    });
    expect(kept?.error).toBe(
      'TypeError: Failed to fetch https://shop.test/?access_token=PROBARA_REDACTED',
    );
  });
});

describe('webSocketSanitizer', () => {
  it('keeps the message it returns, then the built-in redaction runs', () => {
    const kept = sanitizeWebSocketEntry(message, (msg) => ({
      ...msg,
      data: msg.data.replace('"7"', '"<room>"'),
    }));
    expect(kept).toEqual({
      ...message,
      data: '{"type":"auth","secret":"PROBARA_REDACTED","room":"<room>"}',
    });
  });

  it('drops the message when it returns null', () => {
    expect(sanitizeWebSocketEntry(message, () => null)).toBeNull();
  });

  it('fails closed when it throws or returns an invalid value', () => {
    const closed = { ...message, data: SANITIZER_REDACTED };
    expect(
      sanitizeWebSocketEntry(message, () => {
        throw new Error('boom');
      }),
    ).toEqual(closed);
    expect(sanitizeWebSocketEntry(message, () => ({ data: 7 }) as never)).toEqual(closed);
  });

  it('fails closed when it returns a Promise, without an unhandled rejection', async () => {
    expect(
      sanitizeWebSocketEntry(message, (async () => {
        await Promise.resolve();
        throw new Error('async sanitizer');
      }) as never),
    ).toEqual({ ...message, data: SANITIZER_REDACTED });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
