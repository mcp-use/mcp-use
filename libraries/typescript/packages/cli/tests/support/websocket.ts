type Owner = { defer(cleanup: () => void | Promise<void>): void };

/** Own the socket before waiting for its handshake or first message. */
export function trackWebSocket(
  owner: Owner,
  url: string,
  protocol: string
): WebSocket {
  const socket = new WebSocket(url, protocol);
  owner.defer(() => {
    if (socket.readyState === WebSocket.CLOSED) return;
    return new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
      socket.close();
    });
  });
  return socket;
}

export function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      socket.removeEventListener("close", failed);
    };
    const opened = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("HMR websocket failed to connect"));
    };
    const timer = setTimeout(failed, 10_000);
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", failed, { once: true });
    socket.addEventListener("close", failed, { once: true });
  });
}
