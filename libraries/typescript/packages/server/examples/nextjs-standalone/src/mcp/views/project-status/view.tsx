import { ThemeProvider, useToolContext } from "mcp-use/react";

import { StatusCard } from "@/components/StatusCard";

/** View code may reuse browser-safe components, but never Next.js server APIs. */
export default function ProjectStatusView() {
  const tool = useToolContext<"project-status">();
  const status = tool.status === "ready" ? tool.toolOutput : undefined;

  return (
    <ThemeProvider>
      <StatusCard
        title={status?.title ?? "Waiting for the MCP tool"}
        detail={
          status?.detail ??
          (tool.status === "error"
            ? tool.error.message
            : "The shared component is ready.")
        }
      />
    </ThemeProvider>
  );
}
