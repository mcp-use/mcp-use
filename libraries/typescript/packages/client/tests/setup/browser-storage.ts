import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}
