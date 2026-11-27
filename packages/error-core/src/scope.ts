/** What is added to every event captured: user, tags, contexts, extra, level, fingerprint, breadcrumbs. */
import type { Breadcrumb, Level, ProbaraEvent, User } from './types.js';

export interface ScopeData {
  user?: User;
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown>>;
  extra?: Record<string, unknown>;
  level?: Level;
  fingerprint?: string[];
}

/** Only the opaque identifiers of `user`: an email or IP address given is dropped. */
function opaqueUser(user: User): User {
  const out: User = {};
  for (const key of ['id', 'username', 'segment'] as const) {
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

  constructor(data: ScopeData = {}) {
    if (data.user !== undefined) this.setUser(data.user);
    if (data.tags !== undefined) this.setTags(data.tags);
    for (const [name, context] of Object.entries(data.contexts ?? {}))
      this.setContext(name, context);
    for (const [key, value] of Object.entries(data.extra ?? {})) this.setExtra(key, value);
    if (data.level !== undefined) this.setLevel(data.level);
    if (data.fingerprint !== undefined) this.setFingerprint(data.fingerprint);
  }

  /** Sets the user, or clears it with `null`; only `id`, `username` and `segment` are kept. */
  setUser(user: User | null): this {
    this.#user = user === null ? undefined : opaqueUser(user);
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
    if (user !== undefined) out.user = opaqueUser(user);
    if (this.#level !== undefined) out.level = this.#level;
    const fingerprint = event.fingerprint ?? this.#fingerprint;
    if (fingerprint !== undefined) out.fingerprint = [...fingerprint];
    const breadcrumbs = [...this.#breadcrumbs, ...(event.breadcrumbs?.values ?? [])];
    if (breadcrumbs.length > 0) out.breadcrumbs = { values: breadcrumbs };
    return out;
  }
}
