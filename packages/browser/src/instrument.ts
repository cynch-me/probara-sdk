import type { Mechanism } from '@probara/error-core';

export type InstrumentCapture = (error: unknown, mechanism: Mechanism) => void;

type Callback = (...args: unknown[]) => unknown;

let capture: InstrumentCapture | undefined;
let installed = false;
const listeners = new WeakMap<Callback, Callback>();

function nameOf(callback: Callback): string | undefined {
  return callback.name === '' ? undefined : callback.name;
}

function guarded(callback: Callback, data: Record<string, unknown>): Callback {
  return function (this: unknown, ...args: unknown[]): unknown {
    try {
      return callback.apply(this, args);
    } catch (error) {
      capture?.(error, { type: 'instrument', handled: false, data });
      throw error;
    }
  };
}

function handlerData(fn: string, callback: Callback): Record<string, unknown> {
  const handler = nameOf(callback);
  return handler === undefined ? { function: fn } : { function: fn, handler };
}

function wrapScheduler(name: 'setTimeout' | 'setInterval' | 'requestAnimationFrame'): void {
  const target = window as unknown as Record<string, unknown>;
  const original = target[name];
  if (typeof original !== 'function') return;
  const schedule = original as Callback;
  target[name] = function (this: unknown, callback: unknown, ...rest: unknown[]): unknown {
    const wrapped =
      typeof callback === 'function' ? guarded(callback as Callback, { function: name }) : callback;
    return schedule.call(this, wrapped, ...rest);
  };
}

function wrapEventTarget(): void {
  const prototype = EventTarget.prototype;
  type Listen = (this: EventTarget, type: string, listener: unknown, options?: unknown) => void;
  const add = Object.getOwnPropertyDescriptor(prototype, 'addEventListener')?.value as Listen;
  const remove = Object.getOwnPropertyDescriptor(prototype, 'removeEventListener')?.value as Listen;
  prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (typeof listener !== 'function') {
      add.call(this, type, listener, options);
      return;
    }
    const callback = listener as Callback;
    let wrapped = listeners.get(callback);
    if (wrapped === undefined) {
      wrapped = guarded(callback, handlerData('addEventListener', callback));
      listeners.set(callback, wrapped);
    }
    add.call(this, type, wrapped, options);
  };
  prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    remove.call(this, type, listener, options);
    if (typeof listener !== 'function') return;
    const wrapped = listeners.get(listener as Callback);
    if (wrapped !== undefined) remove.call(this, type, wrapped, options);
  };
}

export function instrumentBrowserApis(onError: InstrumentCapture | undefined): void {
  capture = onError;
  if (installed || onError === undefined) return;
  installed = true;
  wrapScheduler('setTimeout');
  wrapScheduler('setInterval');
  wrapScheduler('requestAnimationFrame');
  wrapEventTarget();
}
