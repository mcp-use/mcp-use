import type { App } from "@modelcontextprotocol/ext-apps";

type BridgeTransport = NonNullable<Parameters<App["connect"]>[0]>;

/** In-memory transport pair for driving App ↔ AppBridge without a real iframe. */
export function createPairedTransports(): [BridgeTransport, BridgeTransport] {
  let leftHandler: NonNullable<BridgeTransport["onmessage"]> | undefined;
  let rightHandler: NonNullable<BridgeTransport["onmessage"]> | undefined;

  const left = {
    async start() {},
    async send(message: Parameters<NonNullable<BridgeTransport["send"]>>[0]) {
      rightHandler?.(message);
    },
    async close() {},
  } as BridgeTransport;

  Object.defineProperty(left, "onmessage", {
    get() {
      return leftHandler;
    },
    set(handler: NonNullable<BridgeTransport["onmessage"]> | undefined) {
      leftHandler = handler;
    },
    configurable: true,
  });

  const right = {
    async start() {},
    async send(message: Parameters<NonNullable<BridgeTransport["send"]>>[0]) {
      leftHandler?.(message);
    },
    async close() {},
  } as BridgeTransport;

  Object.defineProperty(right, "onmessage", {
    get() {
      return rightHandler;
    },
    set(handler: NonNullable<BridgeTransport["onmessage"]> | undefined) {
      rightHandler = handler;
    },
    configurable: true,
  });

  return [left, right];
}
