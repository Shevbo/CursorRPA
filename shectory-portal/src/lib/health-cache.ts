type CacheEntry<T> = { at: number; value: T };

declare global {
  // eslint-disable-next-line no-var
  var __shectoryHealthCache: Map<string, CacheEntry<unknown>> | undefined;
}

function cache(): Map<string, CacheEntry<unknown>> {
  if (!globalThis.__shectoryHealthCache) globalThis.__shectoryHealthCache = new Map();
  return globalThis.__shectoryHealthCache;
}

export async function cachedHealth<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache();
  const hit = c.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  c.set(key, { at: now, value });
  return value;
}

