/**
 * Raw Streamable HTTP JSON-RPC client. With `profile: "openai"` it emulates
 * ChatGPT (C-openai): `clientInfo.name "openai-mcp/1.0"`, no extension and no
 * `Mcp-Name` header. It also serves as the "unknown client" of E4.
 */
export interface RawClientOptions {
  url: string;
  clientName: string;
  protocolVersion: string;
  headers?: Record<string, string>;
}

export interface JsonRpcResponse {
  status: number;
  headers: Headers;
  body: {
    result?: any;
    error?: { code: number; message: string; data?: unknown };
  };
}

export class RawClient {
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(private readonly options: RawClientOptions) {}

  /** Sends `initialize` then `notifications/initialized`; returns the result. */
  async initialize(capabilities: Record<string, unknown> = {}): Promise<any> {
    const res = await this.request("initialize", {
      protocolVersion: this.options.protocolVersion,
      capabilities,
      clientInfo: { name: this.options.clientName, version: "1.0.0" },
    });
    if (res.body.error)
      throw new Error(`initialize failed: ${res.body.error.message}`);
    this.sessionId = res.headers.get("mcp-session-id") ?? undefined;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return res.body.result;
  }

  /** Sends one JSON-RPC request with optional extra headers. */
  async request(
    method: string,
    params: unknown,
    headers: Record<string, string> = {}
  ): Promise<JsonRpcResponse> {
    return this.post(
      { jsonrpc: "2.0", id: this.nextId++, method, params },
      headers
    );
  }

  private async post(
    message: unknown,
    headers: Record<string, string> = {}
  ): Promise<JsonRpcResponse> {
    const res = await fetch(this.options.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": this.options.protocolVersion,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...this.options.headers,
        ...headers,
      },
      body: JSON.stringify(message),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      body: parseBody(res.headers.get("content-type"), text),
    };
  }
}

function parseBody(
  contentType: string | null,
  text: string
): JsonRpcResponse["body"] {
  if (!text) return {};
  if (contentType?.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    for (const d of data) {
      const parsed = JSON.parse(d);
      if ("result" in parsed || "error" in parsed) return parsed;
    }
    return {};
  }
  return JSON.parse(text);
}
