/**
 * Minimal key/value storage abstraction used by OAuthSessionStore.
 *
 * Sync or async return types are both allowed so the browser path
 * (localStorage) stays zero-cost while a future Node/file-backed store
 * can be async.
 *
 * @internal
 */
export interface KVStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
  keys(): Promise<string[]> | string[];
}

/**
 * `KVStore` implementation backed by `globalThis.localStorage`.
 *
 * @internal
 */
export class LocalStorageKVStore implements KVStore {
  get(key: string): string | null {
    return localStorage.getItem(key);
  }

  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }

  keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(k);
    }
    return out;
  }
}
