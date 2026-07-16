import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Notification,
} from "@modelcontextprotocol/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SamplingCreateMessageParams,
  SamplingCreateMessageResult,
} from "../core/config.js";
import type {
  McpNotification,
  PendingElicitationRequest,
  PendingSamplingRequest,
} from "./types.js";

const MAX_NOTIFICATIONS = 500;
const REVERSE_REQUEST_TIMEOUT_MS = 5 * 60_000;

type PendingResolver<T> = {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/** Per-server UI queues for notifications, sampling, and elicitation. */
export function useMcpServerQueues(params: {
  serverId: string;
  serverName: string;
  onNotificationReceived?: (notification: McpNotification) => void;
  onSamplingRequest?: (request: PendingSamplingRequest) => void;
  onElicitationRequest?: (request: PendingElicitationRequest) => void;
  onGlobalSamplingRequest?: (
    request: PendingSamplingRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: SamplingCreateMessageResult) => void,
    reject: (requestId: string, error?: string) => void
  ) => void;
  onGlobalElicitationRequest?: (
    request: PendingElicitationRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: ElicitResult) => void,
    reject: (requestId: string, error?: string) => void
  ) => void;
}) {
  const [notifications, setNotifications] = useState<McpNotification[]>([]);
  const [pendingSamplingRequests, setPendingSamplingRequests] = useState<
    PendingSamplingRequest[]
  >([]);
  const [pendingElicitationRequests, setPendingElicitationRequests] = useState<
    PendingElicitationRequest[]
  >([]);
  const samplingCounter = useRef(0);
  const elicitationCounter = useRef(0);
  const samplingResolvers = useRef(
    new Map<string, PendingResolver<SamplingCreateMessageResult>>()
  );
  const elicitationResolvers = useRef(
    new Map<string, PendingResolver<ElicitResult>>()
  );

  const rejectAll = useCallback((reason: string) => {
    for (const resolver of samplingResolvers.current.values()) {
      clearTimeout(resolver.timeout);
      resolver.reject(new Error(reason));
    }
    samplingResolvers.current.clear();
    for (const resolver of elicitationResolvers.current.values()) {
      clearTimeout(resolver.timeout);
      resolver.reject(new Error(reason));
    }
    elicitationResolvers.current.clear();
    setPendingSamplingRequests([]);
    setPendingElicitationRequests([]);
  }, []);

  useEffect(
    () => () => rejectAll("MCP server connection was removed"),
    [rejectAll]
  );

  const onNotification = useCallback(
    (notification: Notification) => {
      const entry: McpNotification = {
        id:
          globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        method: notification.method,
        params: notification.params as Record<string, unknown> | undefined,
        timestamp: Date.now(),
        read: false,
      };
      setNotifications((previous) =>
        [entry, ...previous].slice(0, MAX_NOTIFICATIONS)
      );
      params.onNotificationReceived?.(entry);
    },
    [params.onNotificationReceived]
  );

  const approveSampling = useCallback(
    (id: string, result: SamplingCreateMessageResult) => {
      const resolver = samplingResolvers.current.get(id);
      if (!resolver) return;
      clearTimeout(resolver.timeout);
      samplingResolvers.current.delete(id);
      setPendingSamplingRequests((previous) =>
        previous.filter((request) => request.id !== id)
      );
      resolver.resolve(result);
    },
    []
  );

  const rejectSampling = useCallback((id: string, error?: string) => {
    const resolver = samplingResolvers.current.get(id);
    if (!resolver) return;
    clearTimeout(resolver.timeout);
    samplingResolvers.current.delete(id);
    setPendingSamplingRequests((previous) =>
      previous.filter((request) => request.id !== id)
    );
    resolver.reject(new Error(error ?? "User rejected sampling request"));
  }, []);

  const onSampling = useCallback(
    (requestParams: SamplingCreateMessageParams) =>
      new Promise<SamplingCreateMessageResult>((resolve, reject) => {
        const id = `sampling-${samplingCounter.current++}`;
        const request: PendingSamplingRequest = {
          id,
          request: { method: "sampling/createMessage", params: requestParams },
          timestamp: Date.now(),
          serverName: params.serverName,
        };
        const timeout = setTimeout(
          () => rejectSampling(id, "Sampling request timed out"),
          REVERSE_REQUEST_TIMEOUT_MS
        );
        samplingResolvers.current.set(id, { resolve, reject, timeout });
        setPendingSamplingRequests((previous) => [...previous, request]);
        params.onSamplingRequest?.(request);
        params.onGlobalSamplingRequest?.(
          request,
          params.serverId,
          params.serverName,
          approveSampling,
          rejectSampling
        );
      }),
    [approveSampling, params, rejectSampling]
  );

  const approveElicitation = useCallback((id: string, result: ElicitResult) => {
    const resolver = elicitationResolvers.current.get(id);
    if (!resolver) return;
    clearTimeout(resolver.timeout);
    elicitationResolvers.current.delete(id);
    setPendingElicitationRequests((previous) =>
      previous.filter((request) => request.id !== id)
    );
    resolver.resolve(result);
  }, []);

  const rejectElicitation = useCallback((id: string, error?: string) => {
    const resolver = elicitationResolvers.current.get(id);
    if (!resolver) return;
    clearTimeout(resolver.timeout);
    elicitationResolvers.current.delete(id);
    setPendingElicitationRequests((previous) =>
      previous.filter((request) => request.id !== id)
    );
    resolver.reject(new Error(error ?? "User rejected elicitation request"));
  }, []);

  const onElicitation = useCallback(
    (requestParams: ElicitRequestFormParams | ElicitRequestURLParams) =>
      new Promise<ElicitResult>((resolve, reject) => {
        const id = `elicitation-${elicitationCounter.current++}`;
        const request: PendingElicitationRequest = {
          id,
          request: requestParams,
          timestamp: Date.now(),
          serverName: params.serverName,
        };
        const timeout = setTimeout(
          () => rejectElicitation(id, "Elicitation request timed out"),
          REVERSE_REQUEST_TIMEOUT_MS
        );
        elicitationResolvers.current.set(id, { resolve, reject, timeout });
        setPendingElicitationRequests((previous) => [...previous, request]);
        params.onElicitationRequest?.(request);
        params.onGlobalElicitationRequest?.(
          request,
          params.serverId,
          params.serverName,
          approveElicitation,
          rejectElicitation
        );
      }),
    [approveElicitation, params, rejectElicitation]
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  }, []);
  const markAllNotificationsRead = useCallback(
    () =>
      setNotifications((previous) =>
        previous.map((entry) => ({ ...entry, read: true }))
      ),
    []
  );
  const clearNotifications = useCallback(() => setNotifications([]), []);

  return {
    notifications,
    pendingSamplingRequests,
    pendingElicitationRequests,
    unreadNotificationCount: notifications.filter((entry) => !entry.read)
      .length,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
    approveSampling,
    rejectSampling,
    approveElicitation,
    rejectElicitation,
    onNotification,
    onSampling,
    onElicitation,
    rejectAll,
  };
}
