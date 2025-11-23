import { useState, useCallback, createContext, useContext } from "react";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
  ErrorData,
} from "mcp-use";
import { SamplingRequestPanel } from "./SamplingRequestPanel";
import { SamplingResponseDisplay } from "./SamplingResponseDisplay";

interface SamplingRequest {
  id: string;
  params: CreateMessageRequestParams;
  timestamp: number;
  status: "pending" | "approved" | "rejected" | "completed";
  result?: CreateMessageResult | ErrorData;
  modifiedParams?: CreateMessageRequestParams;
}

interface SamplingContextType {
  requests: SamplingRequest[];
  addRequest: (params: CreateMessageRequestParams) => string;
  approveRequest: (id: string, params: CreateMessageRequestParams) => void;
  rejectRequest: (id: string) => void;
  completeRequest: (id: string, result: CreateMessageResult | ErrorData) => void;
  autoApprove: boolean;
  setAutoApprove: (value: boolean) => void;
}

const SamplingContext = createContext<SamplingContextType | undefined>(
  undefined
);

export function useSampling() {
  const context = useContext(SamplingContext);
  if (!context) {
    throw new Error("useSampling must be used within SamplingProvider");
  }
  return context;
}

export function SamplingProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<SamplingRequest[]>([]);
  const [autoApprove, setAutoApprove] = useState(false);

  const addRequest = useCallback((params: CreateMessageRequestParams) => {
    const id = `sampling-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const request: SamplingRequest = {
      id,
      params,
      timestamp: Date.now(),
      status: "pending",
    };
    setRequests((prev) => [request, ...prev]);
    return id;
  }, []);

  const approveRequest = useCallback(
    (id: string, params: CreateMessageRequestParams) => {
      setRequests((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, status: "approved", modifiedParams: params }
            : r
        )
      );
    },
    []
  );

  const rejectRequest = useCallback((id: string) => {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "rejected", result: { code: -1, message: "User rejected sampling request" } as ErrorData }
          : r
      )
    );
  }, []);

  const completeRequest = useCallback(
    (id: string, result: CreateMessageResult | ErrorData) => {
      setRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "completed", result } : r))
      );
    },
    []
  );

  return (
    <SamplingContext.Provider
      value={{
        requests,
        addRequest,
        approveRequest,
        rejectRequest,
        completeRequest,
        autoApprove,
        setAutoApprove,
      }}
    >
      {children}
    </SamplingContext.Provider>
  );
}

export function SamplingPanel() {
  const {
    requests,
    approveRequest,
    rejectRequest,
    autoApprove,
    setAutoApprove,
  } = useSampling();

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const completedRequests = requests
    .filter((r) => r.status === "completed")
    .slice(0, 5); // Show last 5 completed

  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Sampling Requests</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
            className="rounded"
          />
          Auto-approve
        </label>
      </div>

      {pendingRequests.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Pending Requests</h4>
          <SamplingRequestPanel
            requests={pendingRequests}
            onApprove={approveRequest}
            onReject={rejectRequest}
            onEdit={(id, params) => {
              approveRequest(id, params);
            }}
          />
        </div>
      )}

      {completedRequests.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Recent Responses</h4>
          <div className="space-y-2">
            {completedRequests.map((request) => (
              <SamplingResponseDisplay
                key={request.id}
                result={request.result!}
                timestamp={request.timestamp}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

