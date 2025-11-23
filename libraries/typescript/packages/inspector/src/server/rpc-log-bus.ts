// Browser-compatible EventEmitter implementation
class SimpleEventEmitter {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(...args);
      } catch (e) {
        console.error("Error in event listener:", e);
      }
    });
  }
}

export type RpcLogEvent = {
  serverId: string;
  direction: "send" | "receive";
  timestamp: string; // ISO
  message: unknown;
};

class RpcLogBus {
  private readonly emitter = new SimpleEventEmitter();
  private readonly bufferByServer = new Map<string, RpcLogEvent[]>();

  publish(event: RpcLogEvent): void {
    const buffer = this.bufferByServer.get(event.serverId) ?? [];
    buffer.push(event);
    // Limit buffer size to prevent memory issues (keep last 1000 events per server)
    if (buffer.length > 1000) {
      buffer.shift();
    }
    this.bufferByServer.set(event.serverId, buffer);
    this.emitter.emit("event", event);
  }

  subscribe(
    serverIds: string[],
    listener: (event: RpcLogEvent) => void,
  ): () => void {
    const filter = new Set(serverIds);
    const handler = (event: RpcLogEvent) => {
      if (filter.size === 0 || filter.has(event.serverId)) listener(event);
    };
    this.emitter.on("event", handler);
    return () => this.emitter.off("event", handler);
  }

  getBuffer(serverIds: string[], limit: number): RpcLogEvent[] {
    const filter = new Set(serverIds);
    const all: RpcLogEvent[] = [];
    for (const [serverId, buf] of this.bufferByServer.entries()) {
      if (filter.size > 0 && !filter.has(serverId)) continue;
      all.push(...buf);
    }
    // Sort by timestamp (most recent first)
    all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    // If limit is 0, return empty array (no replay)
    if (limit === 0) return [];
    // If limit is not finite or negative, return all
    if (!Number.isFinite(limit) || limit < 0) return all;
    return all.slice(0, limit);
  }

  clear(serverIds?: string[]): void {
    if (serverIds && serverIds.length > 0) {
      const filter = new Set(serverIds);
      for (const serverId of filter) {
        this.bufferByServer.delete(serverId);
      }
    } else {
      this.bufferByServer.clear();
    }
  }
}

export const rpcLogBus = new RpcLogBus();

