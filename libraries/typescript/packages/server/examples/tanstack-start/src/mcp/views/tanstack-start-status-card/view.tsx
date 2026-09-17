import { Image, ThemeProvider, useToolContext } from "mcp-use/react";
import { StatusCard } from "@/components/StatusCard";

/** MCP view compiled independently of the Start application. */
export default function TanStackStartStatusCardView() {
  const tool = useToolContext<"show-status-card">();
  const card = tool.status === "ready" ? tool.toolOutput : undefined;
  return (
    <ThemeProvider>
      <StatusCard
        title={card?.title ?? "MCP view ready"}
        detail={
          card?.detail ??
          (tool.status === "error"
            ? tool.error.message
            : "Waiting for the tool result.")
        }
        logo={
          <Image
            src="/tanstack-start-mark.svg"
            width={48}
            height={48}
            alt="Example mountain mark"
          />
        }
      />
    </ThemeProvider>
  );
}
