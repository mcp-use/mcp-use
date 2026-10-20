import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type {
  AnalyticsBatch,
  AnalyticsEvent,
  RemoteConfig,
} from "../../src/types.js";

/** What the mock answers for one request; `undefined` means the default 202. */
export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** One request the mock received. */
export interface ReceivedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

/** A local stand-in for the Manufact ingest edge (`POST /v1/events`, `GET /v1/config`). */
export interface MockIngest {
  /** Origin to pass as `endpoint`. */
  url: string;
  /** Every request received, in order. */
  requests: ReceivedRequest[];
  /** Accepted `POST /v1/events` bodies. */
  batches: AnalyticsBatch[];
  /** Every accepted event, in order. */
  events(): AnalyticsEvent[];
  /** Capture settings returned in every response. */
  config: RemoteConfig;
  /** When true, `GET /v1/config` never answers (a stalled settings fetch). */
  holdConfig: boolean;
  /** Override the reply to the next `POST /v1/events` requests, one per call. */
  replies: MockReply[];
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Start a mock ingest server on an ephemeral port. */
export async function startIngest(
  config: RemoteConfig = { capture_payloads: false, identify_actors: false }
): Promise<MockIngest> {
  const mock: Omit<MockIngest, "url" | "close"> = {
    requests: [],
    batches: [],
    events: () => mock.batches.flatMap((batch) => batch.events),
    config,
    holdConfig: false,
    replies: [],
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const text = await readBody(req);
      let body: unknown;
      try {
        body = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      mock.requests.push({
        method: req.method ?? "GET",
        path,
        authorization: req.headers.authorization,
        body,
      });
      const send = (
        status: number,
        payload: unknown,
        headers: Record<string, string> = {}
      ) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };
      if (req.method === "GET" && path === "/v1/config") {
        if (!mock.holdConfig) send(200, { config: mock.config });
        return;
      }
      if (req.method === "POST" && path === "/v1/events") {
        const reply = mock.replies.shift();
        if (reply !== undefined) {
          send(reply.status, reply.body, reply.headers);
          return;
        }
        const batch = body as AnalyticsBatch;
        mock.batches.push(batch);
        send(202, {
          accepted: batch.events.length,
          rejected: [],
          config: mock.config,
        });
        return;
      }
      send(404, { error: "not_found" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(mock, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}
