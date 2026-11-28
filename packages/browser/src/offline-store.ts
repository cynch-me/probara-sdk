import {
  MAX_QUEUED_BYTES,
  MAX_QUEUED_ENVELOPES,
  createMemoryStore,
  type EnvelopeStore,
  type StoredEnvelope,
} from '@probara/error-core';

export const OFFLINE_DATABASE = 'probara-errors';
const STORE = 'envelopes';

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(OFFLINE_DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  return promised(request).then((db) => {
    db.onversionchange = () => {
      db.close();
    };
    return db;
  });
}

function edgeKey(store: IDBObjectStore, direction: 'next' | 'prev'): Promise<number | undefined> {
  return promised(store.openKeyCursor(null, direction)).then((cursor) =>
    cursor === null ? undefined : (cursor.key as number),
  );
}

function isStored(value: unknown): value is StoredEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const { body, categories, attempts } = value as Partial<StoredEnvelope>;
  return body instanceof Uint8Array && Array.isArray(categories) && typeof attempts === 'number';
}

export function createOfflineStore(
  limits: { maxEnvelopes?: number; maxBytes?: number } = {},
): EnvelopeStore {
  const maxEnvelopes = limits.maxEnvelopes ?? MAX_QUEUED_ENVELOPES;
  const maxBytes = limits.maxBytes ?? MAX_QUEUED_BYTES;
  const fallback = createMemoryStore(limits);
  let database: Promise<IDBDatabase> | undefined;

  async function withStore<T>(work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    database ??= openDatabase();
    const db = await database;
    const transaction = db.transaction(STORE, 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      };
    });
    const result = await work(transaction.objectStore(STORE));
    await done;
    return result;
  }

  if (typeof indexedDB === 'undefined') return fallback;

  return {
    push: (entry) =>
      withStore(async (store) => {
        const values = (await promised(store.getAll())).filter(isStored);
        const bytes = values.reduce((sum, value) => sum + value.body.length, 0);
        if (values.length >= maxEnvelopes || bytes + entry.body.length > maxBytes) return false;
        const last = await edgeKey(store, 'prev');
        await promised(store.add(entry, (last ?? 0) + 1));
        return true;
      }).catch(() => fallback.push(entry)),
    unshift: (entry) =>
      withStore(async (store) => {
        const first = await edgeKey(store, 'next');
        await promised(store.add(entry, (first ?? 0) - 1));
      }).catch(() => fallback.unshift(entry)),
    shift: () =>
      withStore(async (store) => {
        const cursor = await promised(store.openCursor());
        if (cursor === null) return undefined;
        const value: unknown = cursor.value;
        await promised(cursor.delete());
        return isStored(value) ? value : undefined;
      })
        .catch(() => undefined)
        .then((entry) => entry ?? fallback.shift()),
  };
}
