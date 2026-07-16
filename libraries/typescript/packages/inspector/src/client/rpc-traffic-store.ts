import {
  getRpcCoalesceKey,
  mergeRpcTrafficEntry,
  shouldCoalesceWithLast,
} from "./rpc-traffic-coalesce";

export type RpcTrafficSource = "mcp" | "widget";
export type RpcTrafficDirection = "send" | "receive";

export interface RpcTrafficEntry {
  id: string;
  source: RpcTrafficSource;
  serverId: string;
  widgetId?: string;
  direction: RpcTrafficDirection;
  timestamp: string;
  message: unknown;
  /** How many identical notification bursts were merged into this row. */
  repeatCount?: number;
}

export type RpcTrafficInput = Omit<RpcTrafficEntry, "id" | "repeatCount">;

interface RpcTrafficFilter {
  serverIds?: string[];
  sources?: RpcTrafficSource[];
}

export class RpcTrafficStore {
  private entries: RpcTrafficEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 0;
  private emitFrame: number | null = null;

  constructor(private readonly maxEntries = 1000) {}

  publish(entry: RpcTrafficInput): void {
    const last = this.entries[this.entries.length - 1];
    if (
      last &&
      shouldCoalesceWithLast(last, entry, Date.parse(entry.timestamp))
    ) {
      this.entries[this.entries.length - 1] = mergeRpcTrafficEntry(last, entry);
      this.scheduleEmit();
      return;
    }

    this.entries.push({ ...entry, id: `rpc-${++this.nextId}` });
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.scheduleEmit();
  }

  getSnapshot = (): RpcTrafficEntry[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(filter: RpcTrafficFilter = {}): void {
    const serverIds = new Set(filter.serverIds ?? []);
    const sources = new Set(filter.sources ?? []);

    if (serverIds.size === 0 && sources.size === 0) {
      this.entries = [];
    } else {
      this.entries = this.entries.filter(
        (entry) =>
          !(
            (serverIds.size === 0 || serverIds.has(entry.serverId)) &&
            (sources.size === 0 || sources.has(entry.source))
          )
      );
    }
    this.scheduleEmit();
  }

  /** Test helper: whether an entry would coalesce with the previous publish. */
  peekCoalesceKey(entry: RpcTrafficInput): string | null {
    return getRpcCoalesceKey(entry);
  }

  private scheduleEmit(): void {
    if (this.emitFrame !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      this.emit();
      return;
    }
    this.emitFrame = requestAnimationFrame(() => {
      this.emitFrame = null;
      this.emit();
    });
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const rpcTrafficStore = new RpcTrafficStore();
