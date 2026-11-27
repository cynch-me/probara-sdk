export function injectedRelease(): string | undefined {
  const injected = (globalThis as { PROBARA_RELEASE?: unknown }).PROBARA_RELEASE;
  if (typeof injected !== 'object' || injected === null) return undefined;
  const id = (injected as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}
