/** What is added to every event captured: user, tags, contexts, extra, level, fingerprint, breadcrumbs. */
import type { Breadcrumb, Level, ProbaraEvent, RequestInfo, User } from './types.js';

export interface ScopeData {
  user?: User;
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown>>;
  extra?: Record<string, unknown>;
  level?: Level;
  fingerprint?: string[];
  request?: RequestInfo;
}

const USER_KEYS = ['id', 'username', 'segment', 'email', 'ip_address'] as const;

function userOf(user: User): User {
  const out: User = {};
  for (const key of USER_KEYS) {
    const value = user[key] as unknown;
    if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
  }
  return out;
}

export class Scope {
  #user: User | undefined;
  #tags: Record<string, string> = {};
  #contexts: Record<string, Record<string, unknown>> = {};
  #extra: Record<string, unknown> = {};
  #level: Level | undefined;
  #fingerprint: string[] | undefined;
  #breadcrumbs: Breadcrumb[] = [];
  #request: RequestInfo | undefined;

  constructor(data: ScopeData = {}) {
    if (data.user !== undefined) this.setUser(data.user);
    if (data.tags !== undefined) this.setTags(data.tags);
    for (const [name, context] of Object.entries(data.contexts ?? {}))
      this.setContext(name, context);
    for (const [key, value] of Object.entries(data.extra ?? {})) this.setExtra(key, value);
    if (data.level !== undefined) this.setLevel(data.level);
    if (data.fingerprint !== undefined) this.setFingerprint(data.fingerprint);
    if (data.request !== undefined) this.setRequest(data.request);
  }

  /** Sets the user, or clears it with `null`; `email` and `ip_address` leave only with `sendDefaultPii`. */
  setUser(user: User | null): this {
    this.#user = user === null ? undefined : userOf(user);
    return this;
  }

  setTag(key: string, value: string | number | boolean): this {
    this.#tags[key] = String(value);
    return this;
  }

  setTags(tags: Record<string, string | number | boolean>): this {
    for (const [key, value] of Object.entries(tags)) this.setTag(key, value);
    return this;
  }

  /** Sets a named context, or removes it with `null`. */
  setContext(name: string, context: Record<string, unknown> | null): this {
    if (context === null) Reflect.deleteProperty(this.#contexts, name);
    else this.#contexts[name] = { ...context };
    return this;
  }

  setExtra(key: string, value: unknown): this {
    this.#extra[key] = value;
    return this;
  }

  setExtras(extras: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(extras)) this.setExtra(key, value);
    return this;
  }

  /** Every event captured with this scope gets this level. */
  setLevel(level: Level): this {
    this.#level = level;
    return this;
  }

  /** Groups the events captured with this scope by these parts; `{{ default }}` stands for the usual grouping. */
  setFingerprint(fingerprint: string[]): this {
    this.#fingerprint = [...fingerprint];
    return this;
  }

  /** The request the events captured with this scope happened in, or none with `null`. */
  setRequest(request: RequestInfo | null): this {
    this.#request =
      request === null
        ? undefined
        : {
            ...request,
            ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
          };
    return this;
  }

  /** Keeps `breadcrumb`, and the newest `max` at most. */
  addBreadcrumb(breadcrumb: Breadcrumb, max: number): this {
    this.#breadcrumbs.push(breadcrumb);
    if (this.#breadcrumbs.length > max) this.#breadcrumbs.splice(0, this.#breadcrumbs.length - max);
    return this;
  }

  clearBreadcrumbs(): this {
    this.#breadcrumbs = [];
    return this;
  }

  clone(): Scope {
    const copy = new Scope({
      tags: this.#tags,
      contexts: this.#contexts,
      extra: this.#extra,
      ...(this.#user === undefined ? {} : { user: this.#user }),
      ...(this.#level === undefined ? {} : { level: this.#level }),
      ...(this.#fingerprint === undefined ? {} : { fingerprint: this.#fingerprint }),
      ...(this.#request === undefined ? {} : { request: this.#request }),
    });
    copy.#breadcrumbs = [...this.#breadcrumbs];
    return copy;
  }

  /** `event` with the scope added; what the event sets itself wins, but the scope's level. */
  applyTo(event: ProbaraEvent): ProbaraEvent {
    const out: ProbaraEvent = { ...event };
    const tags = { ...this.#tags, ...event.tags };
    if (Object.keys(tags).length > 0) out.tags = tags;
    const contexts = { ...this.#contexts, ...event.contexts };
    if (Object.keys(contexts).length > 0) out.contexts = contexts;
    const extra = { ...this.#extra, ...event.extra };
    if (Object.keys(extra).length > 0) out.extra = extra;
    const user = event.user ?? this.#user;
    if (user !== undefined) out.user = userOf(user);
    if (this.#level !== undefined) out.level = this.#level;
    const fingerprint = event.fingerprint ?? this.#fingerprint;
    if (fingerprint !== undefined) out.fingerprint = [...fingerprint];
    const request = event.request ?? this.#request;
    if (request !== undefined) out.request = request;
    const breadcrumbs = [...this.#breadcrumbs, ...(event.breadcrumbs?.values ?? [])];
    if (breadcrumbs.length > 0) out.breadcrumbs = { values: breadcrumbs };
    return out;
  }
}
