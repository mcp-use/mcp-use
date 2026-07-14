/**
 * Install a functional in-memory `localStorage` on `globalThis`.
 *
 * Node.js 25+ ships an experimental built-in `localStorage` global that
 * shadows jsdom's implementation but is not functional without the
 * `--localstorage-file` flag (its methods throw / are missing), which breaks
 * browser-oriented unit tests. This replaces it with a spec-compliant
 * in-memory Storage so tests run identically on any Node version.
 *
 * Returns a restore function that puts the original global back.
 */
export function installMemoryLocalStorage(): () => void {
  // Stored items live as enumerable own string properties (so `Object.keys`
  // and `localStorage.x` work like a real Storage); the API methods are
  // non-enumerable so they don't show up in key enumeration.
  const memoryStorage = {} as Storage & Record<string, string>;
  Object.defineProperties(memoryStorage, {
    length: {
      get() {
        return Object.keys(memoryStorage).length;
      },
      enumerable: false,
      configurable: true,
    },
    clear: {
      value() {
        for (const key of Object.keys(memoryStorage)) {
          delete memoryStorage[key];
        }
      },
      enumerable: false,
      configurable: true,
    },
    getItem: {
      value(key: string) {
        return Object.prototype.hasOwnProperty.call(memoryStorage, key)
          ? memoryStorage[key]
          : null;
      },
      enumerable: false,
      configurable: true,
    },
    key: {
      value(index: number) {
        return Object.keys(memoryStorage)[index] ?? null;
      },
      enumerable: false,
      configurable: true,
    },
    removeItem: {
      value(key: string) {
        delete memoryStorage[key];
      },
      enumerable: false,
      configurable: true,
    },
    setItem: {
      value(key: string, value: string) {
        memoryStorage[key] = String(value);
      },
      enumerable: false,
      configurable: true,
    },
  });

  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  };
}
