type CacheEntry<T> = { value: T; version: string };

export type Cache = Map<string, CacheEntry<any>>;

export function getOrSetFromCache<T>(
  cache: Cache,
  key: string,
  version: string,
  getValue: () => T
): T {
  if (!cache) {
    return getValue();
  }

  let entry = cache.get(key) as CacheEntry<T> | undefined;

  if (entry?.version === version) {
    return entry.value as T;
  }

  let value = getValue();
  let newEntry: CacheEntry<T> = { value, version };
  cache.set(key, newEntry);
  return value;
}
