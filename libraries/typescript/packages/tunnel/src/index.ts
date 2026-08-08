/**
 * Tunnel lifecycle shared by the embedded and standalone CLIs.
 *
 * The client connects directly to the relay over WebSocket. No native binary
 * or package-runner subprocess is required.
 */

import http, {
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Default URL for the managed tunnel relay. */
const DEFAULT_TUNNEL_API = "https://api.tunnel.mcp-use.run";
const SETUP_TIMEOUT_MS = 30_000;
const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
const MAX_BODY_FRAME_BYTES = 256 * 1024;
const MAX_BUFFERED_SOCKET_BYTES = 1024 * 1024;
const MAX_LOCAL_REQUESTS = 100;
const KEEPALIVE_INTERVAL_MS = 25_000;
const REATTACH_ATTEMPTS = 5;
const REQUEST_BODY_FRAME = 1;
const RESPONSE_BODY_FRAME = 2;
const PUBLIC_WEBSOCKET_TEXT_FRAME = 3;
const PUBLIC_WEBSOCKET_BINARY_FRAME = 4;
const LOCAL_WEBSOCKET_TEXT_FRAME = 5;
const LOCAL_WEBSOCKET_BINARY_FRAME = 6;
const REQUEST_ID_BYTES = 36;

/**
 * Base URL of the tunnel relay.
 *
 * @remarks
 * Override with `MCP_USE_WS_RELAY` when testing another relay deployment.
 */
export function tunnelApiBase(override?: string): string {
  const value =
    override ?? process.env["MCP_USE_WS_RELAY"] ?? DEFAULT_TUNNEL_API;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Tunnel relay URL must use HTTP or HTTPS");
  }
  return url.toString();
}

/** On-disk shape of `.mcp-use/state/tunnel.json`. */
interface TunnelStateFile {
  /** Last successfully assigned tunnel identifier. */
  subdomain: string;
  /** Reservation authentication value. */
  token?: string;
  /** Relay WebSocket URL for reattaching after a transient disconnect. */
  connect_url?: string;
  /** Stable public URL for the reservation. */
  public_url?: string;
}

interface TunnelReservation {
  tunnel_id: string;
  token: string;
  connect_url: string;
  public_url: string;
}

interface TunnelConnection {
  url: string;
  subdomain: string;
  token: string;
  socket: WebSocket;
  reservation: TunnelReservation;
}

interface LocalRequestState {
  request: ClientRequest;
  response?: IncomingMessage;
}

interface QueuedWebSocketMessage {
  kind:
    | typeof PUBLIC_WEBSOCKET_TEXT_FRAME
    | typeof PUBLIC_WEBSOCKET_BINARY_FRAME;
  body: Buffer;
}

interface LocalWebSocketState {
  socket: WebSocket;
  open: boolean;
  queue: QueuedWebSocketMessage[];
  queuedBytes: number;
}

interface RequestStartMessage {
  type: "request-start";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
}

interface RequestEndMessage {
  type: "request-end" | "cancel";
  requestId: string;
}

interface WebSocketOpenMessage {
  type: "websocket-open";
  requestId: string;
  path: string;
  protocols?: string[];
}

interface WebSocketCloseMessage {
  type: "websocket-close";
  requestId: string;
  code?: number;
  reason?: string;
}

type RelayControlMessage =
  | { type: "auth-required" }
  | { type: "ready"; keepalive?: boolean }
  | { type: "pong" }
  | RequestStartMessage
  | RequestEndMessage
  | WebSocketOpenMessage
  | WebSocketCloseMessage;

/**
 * Minimal tunnel manager surface used by the dev and production CLI paths.
 */
export interface TunnelManager {
  /**
   * Start or attach a tunnel targeting `port`.
   *
   * @param port - Bound local HTTP port to expose.
   * @returns The public origin and assigned tunnel identifier.
   */
  start(port: number): Promise<{ url: string; subdomain: string }>;
  /** Stop the WebSocket relay and release its reservation. */
  stop(): Promise<void>;
  /** Current tunnel public origin URL, or `null` when inactive. */
  status(): { url: string | null };
}

/** Options shared by embedded and standalone tunnel clients. */
export interface TunnelManagerOptions {
  /** Relay API origin. Defaults to `MCP_USE_WS_RELAY` or the production relay. */
  relayUrl?: string;
  /** Requested stable tunnel identifier. */
  subdomain?: string;
}

const RESPAWN_BACKOFF_INITIAL_MS = 1_000;
const RESPAWN_BACKOFF_MAX_MS = 30_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function tunnelDebug(message: string): void {
  if (process.env["MCP_USE_TUNNEL_DEBUG"] === "1") {
    console.log(`[mcp-use] ${message}`);
  }
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function sanitizeHeaders(
  headers: IncomingHttpHeaders | Record<string, string>,
  request = false
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(name) ||
      (request && (name === "host" || name === "content-length"))
    ) {
      continue;
    }
    sanitized[name] = typeof value === "number" ? String(value) : value;
  }
  return sanitized;
}

function encodeBodyFrame(
  kind:
    | typeof RESPONSE_BODY_FRAME
    | typeof LOCAL_WEBSOCKET_TEXT_FRAME
    | typeof LOCAL_WEBSOCKET_BINARY_FRAME,
  requestId: string,
  body: Uint8Array
): Uint8Array<ArrayBuffer> {
  const id = new TextEncoder().encode(requestId);
  if (id.byteLength !== REQUEST_ID_BYTES) {
    throw new Error("Invalid tunnel request identifier");
  }
  const frame = new Uint8Array(1 + REQUEST_ID_BYTES + body.byteLength);
  frame[0] = kind;
  frame.set(id, 1);
  frame.set(body, 1 + REQUEST_ID_BYTES);
  return frame;
}

function decodeBodyFrame(
  raw: ArrayBuffer
): { kind: number; requestId: string; body: Buffer } | undefined {
  const data = Buffer.from(raw);
  if (data.byteLength < 1 + REQUEST_ID_BYTES) return undefined;
  if (data.byteLength > 1 + REQUEST_ID_BYTES + MAX_BODY_FRAME_BYTES) {
    return undefined;
  }
  const requestId = data.subarray(1, 1 + REQUEST_ID_BYTES).toString("ascii");
  if (!isRequestId(requestId)) return undefined;
  return {
    kind: data[0] ?? 0,
    requestId,
    body: data.subarray(1 + REQUEST_ID_BYTES),
  };
}

function webSocketBinaryPayload(body: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy;
}

async function waitForSocketCapacity(socket: WebSocket): Promise<void> {
  while (
    socket.readyState === WebSocket.OPEN &&
    socket.bufferedAmount > MAX_BUFFERED_SOCKET_BYTES
  ) {
    await sleep(5);
  }
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error("Tunnel socket closed while applying backpressure");
  }
}

function sendControl(socket: WebSocket, message: object): void {
  const serialized = JSON.stringify(message);
  if (Buffer.byteLength(serialized) > MAX_CONTROL_MESSAGE_BYTES) {
    throw new Error("Tunnel control message exceeds 64 KiB");
  }
  socket.send(serialized);
}

async function parseRelayResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: { error?: string } & Partial<T> = {};
  try {
    body = JSON.parse(text) as { error?: string } & Partial<T>;
  } catch {
    // The status-derived message below is safer than reflecting an HTML edge
    // error into the terminal.
  }
  if (!response.ok) {
    throw new Error(
      body.error ?? `Tunnel relay returned HTTP ${response.status}`
    );
  }
  return body as T;
}

async function reserveTunnel(
  relayBase: string,
  subdomain?: string
): Promise<TunnelReservation> {
  const response = await fetch(new URL("/api/tunnels/request", relayBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subdomain === undefined ? {} : { subdomain }),
    signal: AbortSignal.timeout(10_000),
  });
  const reservation = await parseRelayResponse<TunnelReservation>(response);
  if (
    typeof reservation.tunnel_id !== "string" ||
    typeof reservation.token !== "string" ||
    typeof reservation.connect_url !== "string" ||
    typeof reservation.public_url !== "string"
  ) {
    throw new Error("Tunnel relay returned an invalid reservation");
  }
  return reservation;
}

async function releaseTunnel(
  relayBase: string,
  state: TunnelStateFile
): Promise<void> {
  if (state.token === undefined) return;
  try {
    await fetch(
      new URL(`/api/tunnels/${encodeURIComponent(state.subdomain)}`, relayBase),
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${state.token}` },
        signal: AbortSignal.timeout(2_000),
      }
    );
  } catch {
    // Expiry provides the final cleanup path when the relay is unreachable.
  }
}

async function connectTunnel(
  port: number,
  reservation: TunnelReservation,
  onUnexpectedClose: (event: CloseEvent) => void
): Promise<TunnelConnection> {
  const socket = new WebSocket(reservation.connect_url);
  socket.binaryType = "arraybuffer";
  const requests = new Map<string, LocalRequestState>();
  const webSockets = new Map<string, LocalWebSocketState>();
  let ready = false;
  let intentionalClose = false;
  let awaitingPong = false;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const failLocalRequest = (requestId: string, error: unknown): void => {
    const state = requests.get(requestId);
    if (state === undefined) return;
    requests.delete(requestId);
    state.request.destroy();
    state.response?.destroy();
    if (socket.readyState === WebSocket.OPEN) {
      try {
        sendControl(socket, {
          type: "response-error",
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Socket closure is already the terminal signal.
      }
    }
  };

  const handleRequestStart = (message: RequestStartMessage): void => {
    if (
      !isRequestId(message.requestId) ||
      requests.has(message.requestId) ||
      requests.size >= MAX_LOCAL_REQUESTS ||
      typeof message.method !== "string" ||
      typeof message.path !== "string" ||
      !message.path.startsWith("/")
    ) {
      socket.close(1008, "Invalid request");
      return;
    }
    const headers = sanitizeHeaders(message.headers, true);
    const forwardedHost = message.headers["x-forwarded-host"];
    if (typeof forwardedHost === "string") headers.host = forwardedHost;
    const localRequest = http.request({
      hostname: "127.0.0.1",
      port,
      method: message.method,
      path: message.path,
      headers,
    });
    const state: LocalRequestState = { request: localRequest };
    requests.set(message.requestId, state);
    localRequest.on("response", (response) => {
      state.response = response;
      void (async (): Promise<void> => {
        sendControl(socket, {
          type: "response-start",
          requestId: message.requestId,
          status: response.statusCode ?? 502,
          headers: sanitizeHeaders(response.headers),
        });
        for await (const chunk of response) {
          const body = Buffer.from(chunk);
          for (
            let offset = 0;
            offset < body.byteLength;
            offset += MAX_BODY_FRAME_BYTES
          ) {
            await waitForSocketCapacity(socket);
            socket.send(
              encodeBodyFrame(
                RESPONSE_BODY_FRAME,
                message.requestId,
                body.subarray(offset, offset + MAX_BODY_FRAME_BYTES)
              )
            );
          }
        }
        if (!requests.has(message.requestId)) return;
        requests.delete(message.requestId);
        sendControl(socket, {
          type: "response-end",
          requestId: message.requestId,
        });
      })().catch((error: unknown) => {
        failLocalRequest(message.requestId, error);
      });
    });
    localRequest.on("error", (error) => {
      failLocalRequest(message.requestId, error);
    });
  };

  const closeLocalWebSocket = (
    requestId: string,
    code = 1000,
    reason = ""
  ): void => {
    const state = webSockets.get(requestId);
    if (state === undefined) return;
    webSockets.delete(requestId);
    try {
      state.socket.close(code, reason.slice(0, 123));
    } catch {
      state.socket.close();
    }
  };

  const sendToLocalWebSocket = (
    requestId: string,
    kind:
      | typeof PUBLIC_WEBSOCKET_TEXT_FRAME
      | typeof PUBLIC_WEBSOCKET_BINARY_FRAME,
    body: Buffer
  ): void => {
    const state = webSockets.get(requestId);
    if (state === undefined) return;
    if (!state.open) {
      if (state.queuedBytes + body.byteLength > MAX_BUFFERED_SOCKET_BYTES) {
        closeLocalWebSocket(requestId, 1009, "WebSocket buffer limit reached");
        sendControl(socket, {
          type: "websocket-error",
          requestId,
          message: "WebSocket buffer limit reached",
        });
        return;
      }
      state.queue.push({ kind, body });
      state.queuedBytes += body.byteLength;
      return;
    }
    state.socket.send(
      kind === PUBLIC_WEBSOCKET_TEXT_FRAME
        ? body.toString("utf8")
        : webSocketBinaryPayload(body)
    );
  };

  const handleWebSocketOpen = (message: WebSocketOpenMessage): void => {
    if (
      !isRequestId(message.requestId) ||
      webSockets.has(message.requestId) ||
      requests.size + webSockets.size >= MAX_LOCAL_REQUESTS ||
      typeof message.path !== "string" ||
      !message.path.startsWith("/") ||
      (message.protocols !== undefined &&
        (!Array.isArray(message.protocols) ||
          message.protocols.some(
            (protocol) =>
              typeof protocol !== "string" ||
              !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(protocol)
          )))
    ) {
      socket.close(1008, "Invalid WebSocket request");
      return;
    }
    const localUrl = new URL(message.path, `ws://127.0.0.1:${port}`);
    if (localUrl.origin !== `ws://127.0.0.1:${port}`) {
      socket.close(1008, "Invalid WebSocket path");
      return;
    }
    const localSocket = new WebSocket(localUrl, message.protocols ?? []);
    localSocket.binaryType = "arraybuffer";
    const state: LocalWebSocketState = {
      socket: localSocket,
      open: false,
      queue: [],
      queuedBytes: 0,
    };
    webSockets.set(message.requestId, state);

    localSocket.addEventListener("open", () => {
      if (webSockets.get(message.requestId) !== state) return;
      state.open = true;
      for (const queued of state.queue) {
        localSocket.send(
          queued.kind === PUBLIC_WEBSOCKET_TEXT_FRAME
            ? queued.body.toString("utf8")
            : webSocketBinaryPayload(queued.body)
        );
      }
      state.queue = [];
      state.queuedBytes = 0;
      sendControl(socket, {
        type: "websocket-ready",
        requestId: message.requestId,
        ...(localSocket.protocol !== "" && { protocol: localSocket.protocol }),
      });
    });
    localSocket.addEventListener("message", (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (typeof event.data === "string") {
        const body = Buffer.from(event.data);
        if (body.byteLength > MAX_BODY_FRAME_BYTES) {
          closeLocalWebSocket(
            message.requestId,
            1009,
            "WebSocket message too large"
          );
          return;
        }
        socket.send(
          encodeBodyFrame(LOCAL_WEBSOCKET_TEXT_FRAME, message.requestId, body)
        );
      } else if (event.data instanceof ArrayBuffer) {
        const body = Buffer.from(event.data);
        if (body.byteLength > MAX_BODY_FRAME_BYTES) {
          closeLocalWebSocket(
            message.requestId,
            1009,
            "WebSocket message too large"
          );
          return;
        }
        socket.send(
          encodeBodyFrame(LOCAL_WEBSOCKET_BINARY_FRAME, message.requestId, body)
        );
      }
    });
    localSocket.addEventListener("close", (event) => {
      if (webSockets.get(message.requestId) !== state) return;
      webSockets.delete(message.requestId);
      if (socket.readyState === WebSocket.OPEN) {
        sendControl(socket, {
          type: "websocket-close",
          requestId: message.requestId,
          code: event.code,
          reason: event.reason,
        });
      }
    });
    localSocket.addEventListener("error", () => {
      if (webSockets.get(message.requestId) !== state) return;
      if (socket.readyState === WebSocket.OPEN) {
        sendControl(socket, {
          type: "websocket-error",
          requestId: message.requestId,
          message: "Local WebSocket connection failed",
        });
      }
    });
  };

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Tunnel setup timed out"));
    }, SETUP_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      sendControl(socket, {
        type: "authenticate",
        token: reservation.token,
      });
    });

    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBodyFrame(event.data);
        if (frame === undefined) {
          socket.close(1003, "Invalid body frame");
          return;
        }
        if (frame.kind === REQUEST_BODY_FRAME) {
          requests.get(frame.requestId)?.request.write(frame.body);
        } else if (
          frame.kind === PUBLIC_WEBSOCKET_TEXT_FRAME ||
          frame.kind === PUBLIC_WEBSOCKET_BINARY_FRAME
        ) {
          sendToLocalWebSocket(frame.requestId, frame.kind, frame.body);
        } else {
          socket.close(1003, "Invalid body frame");
        }
        return;
      }

      if (typeof event.data !== "string") {
        socket.close(1003, "Invalid message");
        return;
      }
      const text = event.data;
      if (Buffer.byteLength(text) > MAX_CONTROL_MESSAGE_BYTES) {
        socket.close(1009, "Control message too large");
        return;
      }
      let message: RelayControlMessage;
      try {
        message = JSON.parse(text) as RelayControlMessage;
      } catch {
        socket.close(1003, "Invalid JSON");
        return;
      }
      if (message.type === "auth-required") return;
      if (message.type === "ready") {
        if (!ready) {
          ready = true;
          clearTimeout(timeout);
          if (message.keepalive === true) {
            keepalive = setInterval(() => {
              if (socket.readyState !== WebSocket.OPEN) return;
              if (awaitingPong) {
                socket.close(1011, "Tunnel keepalive timed out");
                return;
              }
              awaitingPong = true;
              sendControl(socket, { type: "ping" });
            }, KEEPALIVE_INTERVAL_MS);
            keepalive.unref();
          }
          resolve();
        }
        return;
      }
      if (message.type === "pong") {
        awaitingPong = false;
        return;
      }
      if (message.type === "request-start") {
        handleRequestStart(message);
        return;
      }
      if (message.type === "websocket-open") {
        handleWebSocketOpen(message);
        return;
      }
      if (!isRequestId(message.requestId)) {
        socket.close(1008, "Invalid request identifier");
        return;
      }
      const state = requests.get(message.requestId);
      if (message.type === "request-end") {
        state?.request.end();
      } else if (message.type === "cancel" && state !== undefined) {
        requests.delete(message.requestId);
        state.request.destroy();
        state.response?.destroy();
      } else if (message.type === "websocket-close") {
        const code =
          Number.isInteger(message.code) &&
          (message.code ?? 0) >= 1000 &&
          (message.code ?? 0) <= 4999
            ? message.code
            : 1000;
        closeLocalWebSocket(message.requestId, code, message.reason ?? "");
      } else {
        socket.close(1003, "Unsupported message");
      }
    });

    socket.addEventListener(
      "error",
      () => {
        if (!ready) {
          clearTimeout(timeout);
          reject(new Error("Tunnel WebSocket connection failed"));
        }
      },
      { once: true }
    );
  });

  socket.addEventListener("close", (event) => {
    if (keepalive !== undefined) clearInterval(keepalive);
    for (const [requestId, state] of requests) {
      requests.delete(requestId);
      state.request.destroy();
      state.response?.destroy();
    }
    for (const requestId of webSockets.keys()) {
      closeLocalWebSocket(requestId, 1011, "Tunnel disconnected");
    }
    if (!intentionalClose && ready) onUnexpectedClose(event);
  });

  await readyPromise;
  Object.defineProperty(socket, "__mcpUseIntentionalClose", {
    value: (): void => {
      intentionalClose = true;
    },
  });
  return {
    url: reservation.public_url,
    subdomain: reservation.tunnel_id,
    token: reservation.token,
    socket,
    reservation,
  };
}

function markIntentionalClose(socket: WebSocket): void {
  const marker = (
    socket as WebSocket & {
      __mcpUseIntentionalClose?: () => void;
    }
  ).__mcpUseIntentionalClose;
  marker?.();
}

/**
 * Create a tunnel manager backed by the managed relay.
 *
 * @param stateFilePath - Absolute `.mcp-use/state/tunnel.json` path.
 * @param options - Optional relay and requested subdomain overrides.
 * @returns A manager shared by CLI startup and Inspector dev controls.
 *
 * @example
 * ```ts
 * const tunnel = createTunnelManager(paths.tunnel);
 * const { url } = await tunnel.start(3000);
 * console.log(url);
 * ```
 */
export function createTunnelManager(
  stateFilePath: string,
  options: TunnelManagerOptions = {}
): TunnelManager {
  const relayBase = tunnelApiBase(options.relayUrl);
  let connection: TunnelConnection | undefined;
  let currentUrl: string | null = null;
  let activePort: number | undefined;
  let intentionalStop = false;
  let respawnInFlight: Promise<void> | undefined;
  let respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;
  let reattachReservation: TunnelReservation | undefined;
  let reattachFailures = 0;

  const loadState = async (): Promise<TunnelStateFile | undefined> => {
    try {
      const content = await readFile(stateFilePath, "utf8");
      const state = JSON.parse(content) as Partial<TunnelStateFile>;
      return typeof state.subdomain === "string"
        ? {
            subdomain: state.subdomain,
            ...(typeof state.token === "string" && { token: state.token }),
            ...(typeof state.connect_url === "string" && {
              connect_url: state.connect_url,
            }),
            ...(typeof state.public_url === "string" && {
              public_url: state.public_url,
            }),
          }
        : undefined;
    } catch {
      return undefined;
    }
  };

  const persistState = async (state: TunnelStateFile): Promise<void> => {
    try {
      await mkdir(dirname(stateFilePath), { recursive: true });
      await writeFile(stateFilePath, JSON.stringify(state, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch (error) {
      console.warn(
        `[mcp-use] failed to save tunnel state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  let scheduleRespawn: () => void = () => {};

  const reservationFromState = (
    state: TunnelStateFile | undefined
  ): TunnelReservation | undefined =>
    state?.token !== undefined &&
    state.connect_url !== undefined &&
    state.public_url !== undefined
      ? {
          tunnel_id: state.subdomain,
          token: state.token,
          connect_url: state.connect_url,
          public_url: state.public_url,
        }
      : undefined;

  const stateFromReservation = (
    reservation: TunnelReservation
  ): TunnelStateFile => ({
    subdomain: reservation.tunnel_id,
    token: reservation.token,
    connect_url: reservation.connect_url,
    public_url: reservation.public_url,
  });

  const persistConnection = async (next: TunnelConnection): Promise<void> => {
    await persistState(stateFromReservation(next.reservation));
  };

  const attach = async (
    port: number,
    reservation: TunnelReservation
  ): Promise<TunnelConnection> =>
    connectTunnel(port, reservation, (event) => {
      connection = undefined;
      currentUrl = null;
      const terminal =
        event.code === 1008 ||
        event.reason === "Tunnel expired" ||
        event.reason === "Tunnel deleted";
      reattachReservation = terminal ? undefined : reservation;
      tunnelDebug(
        `tunnel connection closed (${event.code}${
          event.reason === "" ? "" : `: ${event.reason}`
        }); ${terminal ? "allocating a replacement" : "reattaching"}`
      );
      scheduleRespawn();
    });

  const open = async (
    port: number,
    requestedSubdomain?: string
  ): Promise<TunnelConnection> => {
    console.log(`[mcp-use] starting tunnel for port ${port}…`);
    const reservation = await reserveTunnel(
      relayBase,
      options.subdomain ?? requestedSubdomain
    );
    return attach(port, reservation);
  };

  scheduleRespawn = (): void => {
    if (
      intentionalStop ||
      activePort === undefined ||
      currentUrl !== null ||
      respawnInFlight !== undefined
    ) {
      return;
    }
    respawnInFlight = (async (): Promise<void> => {
      while (
        !intentionalStop &&
        activePort !== undefined &&
        currentUrl === null
      ) {
        try {
          if (
            reattachReservation !== undefined &&
            reattachFailures < REATTACH_ATTEMPTS
          ) {
            try {
              const reattached = await attach(activePort, reattachReservation);
              connection = reattached;
              currentUrl = reattached.url;
              reattachFailures = 0;
              respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;
              await persistConnection(reattached);
              tunnelDebug("tunnel reattached");
              return;
            } catch (error) {
              reattachFailures += 1;
              tunnelDebug(
                `tunnel reattach attempt ${reattachFailures} failed: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
              if (reattachFailures < REATTACH_ATTEMPTS) {
                await sleep(respawnBackoffMs);
                respawnBackoffMs = Math.min(
                  respawnBackoffMs * 2,
                  RESPAWN_BACKOFF_MAX_MS
                );
                continue;
              }
            }
          }

          const saved = await loadState();
          if (saved !== undefined) await releaseTunnel(relayBase, saved);
          reattachReservation = undefined;
          reattachFailures = 0;

          let next: TunnelConnection;
          try {
            next = await open(activePort, saved?.subdomain);
          } catch (error) {
            if (saved?.subdomain === undefined) throw error;
            console.log(
              `[mcp-use] tunnel "${saved.subdomain}" unavailable, requesting a new one…`
            );
            next = await open(activePort);
          }
          connection = next;
          currentUrl = next.url;
          await persistConnection(next);
          respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;
          return;
        } catch (error) {
          console.warn(
            `[mcp-use] tunnel restart failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await sleep(respawnBackoffMs);
          respawnBackoffMs = Math.min(
            respawnBackoffMs * 2,
            RESPAWN_BACKOFF_MAX_MS
          );
        }
      }
    })().finally(() => {
      respawnInFlight = undefined;
    });
  };

  return {
    status(): { url: string | null } {
      return { url: currentUrl };
    },

    async start(port: number): Promise<{ url: string; subdomain: string }> {
      intentionalStop = false;
      activePort = port;
      if (connection !== undefined && currentUrl !== null) {
        return { url: currentUrl, subdomain: connection.subdomain };
      }

      const saved = await loadState();
      let next: TunnelConnection;
      const savedReservation = reservationFromState(saved);
      if (
        savedReservation !== undefined &&
        (options.subdomain === undefined ||
          savedReservation.tunnel_id === options.subdomain)
      ) {
        try {
          next = await attach(port, savedReservation);
        } catch {
          await releaseTunnel(
            relayBase,
            stateFromReservation(savedReservation)
          );
          next = await open(port, savedReservation.tunnel_id).catch(
            async () => {
              console.log(
                `[mcp-use] tunnel "${savedReservation.tunnel_id}" unavailable, requesting a new one…`
              );
              return open(port);
            }
          );
        }
      } else {
        if (saved !== undefined) await releaseTunnel(relayBase, saved);
        try {
          next = await open(port, saved?.subdomain);
        } catch (error) {
          if (saved?.subdomain === undefined) throw error;
          console.log(
            `[mcp-use] tunnel "${saved.subdomain}" unavailable, requesting a new one…`
          );
          next = await open(port);
        }
      }
      connection = next;
      currentUrl = next.url;
      reattachReservation = next.reservation;
      reattachFailures = 0;
      await persistConnection(next);
      return { url: next.url, subdomain: next.subdomain };
    },

    async stop(): Promise<void> {
      intentionalStop = true;
      if (respawnInFlight !== undefined) await respawnInFlight;
      const active = connection;
      const releasable = active?.reservation ?? reattachReservation;
      connection = undefined;
      currentUrl = null;
      activePort = undefined;
      respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;
      reattachReservation = undefined;
      reattachFailures = 0;
      if (releasable !== undefined) {
        await releaseTunnel(relayBase, stateFromReservation(releasable));
      }
      if (active !== undefined) {
        markIntentionalClose(active.socket);
        active.socket.close(1000, "Client shutdown");
      }
    },
  };
}
