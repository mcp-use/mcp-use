export type RpcLogEvent = {
  serverId: string;
  direction: "send" | "receive";
  timestamp: string;
  message: unknown;
};
declare class RpcLogBus {
  private readonly emitter;
  private readonly bufferByServer;
  publish(event: RpcLogEvent): void;
  subscribe(
    serverIds: string[],
    listener: (event: RpcLogEvent) => void
  ): () => void;
  getBuffer(serverIds: string[], limit: number): RpcLogEvent[];
  clear(serverIds?: string[]): void;
}
export declare const rpcLogBus: RpcLogBus;
export {};
//# sourceMappingURL=rpc-log-bus.d.ts.map
