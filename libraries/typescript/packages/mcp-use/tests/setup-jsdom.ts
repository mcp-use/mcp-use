/**
 * Node 22+ may expose a broken global localStorage (no Storage methods).
 * jsdom can fail to replace it. Provide a minimal in-memory Storage when needed.
 */
function ensureLocalStorage(): void {
  try {
    const ls = globalThis.localStorage;
    if (
      ls &&
      typeof ls.clear === "function" &&
      typeof ls.setItem === "function"
    ) {
      // Real Storage supports Object.keys(localStorage) in browsers — verify enumeration.
      const keys = Object.keys(ls);
      if (keys.length === 0 || typeof ls.getItem === "function") {
        return;
      }
    }
  } catch {
    // Accessing localStorage can throw in some Node builds.
  }

  const store = new Map<string, string>();

  const storage = new Proxy({} as Storage, {
    get(_target, prop) {
      if (prop === "length") return store.size;
      if (prop === "clear") return () => store.clear();
      if (prop === "getItem")
        return (key: string) => (store.has(key) ? store.get(key)! : null);
      if (prop === "setItem")
        return (key: string, value: string) => store.set(key, String(value));
      if (prop === "removeItem") return (key: string) => store.delete(key);
      if (prop === "key")
        return (index: number) => [...store.keys()][index] ?? null;
      if (typeof prop === "string" && store.has(prop)) {
        return store.get(prop);
      }
      return undefined;
    },
    ownKeys() {
      return [...store.keys()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && store.has(prop)) {
        return {
          enumerable: true,
          configurable: true,
          value: store.get(prop),
        };
      }
      return undefined;
    },
  });

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

ensureLocalStorage();
