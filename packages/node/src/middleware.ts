/**
 * Request middleware for Express and Hono: each request runs in a scope of its own, carrying the
 * request (scrubbed), and the errors it throws are sent unless their status is below 500.
 */
import { requestInfo } from './privacy.js';
import { currentClient, sendsDefaultPii } from './sdk.js';

/** The HTTP status an error asks for: `status`, `statusCode` or `status_code`. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode, status_code } = error as Record<string, unknown>;
  for (const value of [status, statusCode, status_code]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

/** Errors without a status, or with a 5xx status, are sent. */
function isServerError(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status >= 500;
}

interface ExpressRequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}

type ExpressNext = (error?: unknown) => void;

function expressUrl(request: ExpressRequestLike): string {
  const host = request.headers['host'];
  const path = request.originalUrl ?? request.url ?? '/';
  return typeof host === 'string' ? `${request.protocol ?? 'http'}://${host}${path}` : path;
}

/** The first Express middleware: runs the rest of the request in a scope of its own. */
export function probaraRequestHandler(): (
  request: ExpressRequestLike,
  response: unknown,
  next: ExpressNext,
) => void {
  return (request, _response, next) => {
    const client = currentClient();
    if (client === undefined) {
      next();
      return;
    }
    client.withIsolationScope((scope) => {
      try {
        scope.setRequest(
          requestInfo(
            request.method ?? 'GET',
            expressUrl(request),
            request.headers,
            sendsDefaultPii(),
          ),
        );
      } catch {
        // A request that cannot be read still runs.
      }
      next();
    });
  };
}

export interface ErrorHandlerOptions {
  /** Whether an error is sent: errors without a status or with a 5xx status unless given. */
  shouldHandleError?: (error: unknown) => boolean;
}

/** The Express error middleware, after the routes: sends the error, then passes it on. */
export function probaraErrorHandler(
  options: ErrorHandlerOptions = {},
): (error: unknown, request: ExpressRequestLike, response: unknown, next: ExpressNext) => void {
  const shouldHandle = options.shouldHandleError ?? isServerError;
  return (error, _request, _response, next) => {
    const client = currentClient();
    if (client !== undefined && shouldHandle(error)) {
      client.captureException(error, { mechanism: { type: 'express', handled: false } });
    }
    next(error);
  };
}

interface HonoContextLike {
  req: { raw: Request };
  error?: Error | undefined;
}

/** The Hono middleware: `app.use(probaraHono())` first; `app.onError` still answers. */
export function probaraHono(
  options: ErrorHandlerOptions = {},
): (context: HonoContextLike, next: () => Promise<void>) => Promise<void> {
  const shouldHandle = options.shouldHandleError ?? isServerError;
  return async (context, next) => {
    const client = currentClient();
    if (client === undefined) {
      await next();
      return;
    }
    await client.withIsolationScope(async (scope) => {
      try {
        const { method, url, headers } = context.req.raw;
        scope.setRequest(requestInfo(method, url, headers, sendsDefaultPii()));
      } catch {
        // A request that cannot be read still runs.
      }
      try {
        await next();
      } catch (error) {
        if (shouldHandle(error)) {
          client.captureException(error, { mechanism: { type: 'hono', handled: false } });
        }
        throw error;
      }
      if (context.error !== undefined && shouldHandle(context.error)) {
        client.captureException(context.error, { mechanism: { type: 'hono', handled: false } });
      }
    });
  };
}
