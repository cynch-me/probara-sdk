import { describe, expect, it } from 'vitest';
import {
  SANITIZER_REDACTED,
  sanitizeConsoleEntry,
  sanitizeNetworkEntry,
  sanitizeWebSocketEntry,
  type ConsoleEntry,
  type NetworkEntry,
  type WebSocketMessageEntry,
} from './index.js';

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
  requestBody: { text: '{"user":"ana","password":"hunter2"}', truncated: false, size: 35 },
  responseBody: { text: '{"ok":true,"token":"t-1","name":"Ana"}', truncated: false, size: 38 },
  durationMs: 40,
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
      },
      responseBody: {
        text: '{"ok":true,"token":"PROBARA_REDACTED","name":"<name>"}',
        truncated: false,
        size: 38,
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
      requestBody: { text: SANITIZER_REDACTED, truncated: false, size: 35 },
      // The response stays, redacted by the built-in rules.
      responseHeaders: { 'set-cookie': 'PROBARA_REDACTED', 'content-type': 'application/json' },
    });
    // Derived from the request body, so it goes with it.
    expect(kept && 'graphql' in kept).toBe(false);
    expect(JSON.stringify(kept)).not.toContain('hunter2');
  });

  it('fail closed on the response when it returns an invalid value', () => {
    const kept = sanitizeNetworkEntry(request, {
      responseSanitizer: () => ({ status: 'ok' }) as never,
    });
    expect(kept).toMatchObject({
      responseHeaders: {},
      responseBody: { text: SANITIZER_REDACTED, truncated: false, size: 38 },
      requestHeaders: { authorization: 'PROBARA_REDACTED', 'x-tenant': 'acme' },
    });
    expect(JSON.stringify(kept)).not.toContain('Ana');
  });

  it('keep an omitted body omitted', () => {
    const omitted: NetworkEntry = {
      ...request,
      responseBody: { truncated: false, size: 9_000_000, omitted: 'too_large' },
    };
    const kept = sanitizeNetworkEntry(omitted, { responseSanitizer: (res) => res });
    expect(kept?.responseBody).toEqual({ truncated: false, size: 9_000_000, omitted: 'too_large' });
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
});
