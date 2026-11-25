/**
 * A scripted raw transport for Events lane tests: records every message the
 * client sends and lets the test answer like a server would.
 */
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";

export type Reply = (msg: Record<string, any>, t: ScriptedTransport) => void;

export class ScriptedTransport implements Transport {
  sent: Record<string, any>[] = [];
  onmessage?: Transport["onmessage"];
  onclose?: () => void;
  onerror?: (e: Error) => void;
  sessionId?: string;
  protocolVersion?: string;
  constructor(private readonly reply: Reply) {}
  async start(): Promise<void> {}
  async close(): Promise<void> {
    this.onclose?.();
  }
  async send(message: JSONRPCMessage): Promise<void> {
    const m = message as Record<string, any>;
    this.sent.push(m);
    queueMicrotask(() => this.reply(m, this));
  }
  setProtocolVersion(v: string): void {
    this.protocolVersion = v;
  }
  /** Deliver a server message to the client. */
  emit(message: Record<string, unknown>): void {
    this.onmessage?.(message as JSONRPCMessage);
  }
  result(id: unknown, result: unknown): void {
    this.emit({ jsonrpc: "2.0", id, result });
  }
  error(id: unknown, code: number, message: string, data?: unknown): void {
    this.emit({
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    });
  }
  frame(method: string, subId: string, params: Record<string, unknown>): void {
    this.emit({
      jsonrpc: "2.0",
      method,
      params: {
        ...params,
        _meta: { "io.modelcontextprotocol/subscriptionId": subId },
      },
    });
  }
}

export const NOTE_EVENT = {
  name: "note.created",
  delivery: ["push", "poll"],
  inputSchema: { type: "object" },
  payloadSchema: { type: "object" },
};

export function envelope(n: number, cursor: string | null = `c${n}`) {
  return {
    eventId: `e${n}`,
    name: "note.created",
    timestamp: "2026-11-25T00:00:00.000Z",
    data: { n },
    cursor,
  };
}

export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
