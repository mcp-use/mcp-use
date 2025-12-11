import { createContext, useContext, type ReactNode } from "react";
import type { McpConnection, McpPrimitives } from "../types.js";
import { useMcpConnection } from "../hooks/useMcpConnection.js";

export interface MangoContextValue {
  connection: McpConnection | null;
  primitives: McpPrimitives | null;
  isLoading: boolean;
  error: string | null;
  connect: (projectName: string, url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshPrimitives: () => Promise<void>;
}

const MangoContext = createContext<MangoContextValue | undefined>(undefined);

export interface MangoProviderProps {
  children: ReactNode;
}

/**
 * Mango context provider
 */
export function MangoProvider({ children }: MangoProviderProps) {
  const mcpConnection = useMcpConnection();

  return (
    <MangoContext.Provider value={mcpConnection}>
      {children}
    </MangoContext.Provider>
  );
}

/**
 * Hook to use Mango context
 */
export function useMangoContext(): MangoContextValue {
  const context = useContext(MangoContext);
  if (!context) {
    throw new Error("useMangoContext must be used within MangoProvider");
  }
  return context;
}
