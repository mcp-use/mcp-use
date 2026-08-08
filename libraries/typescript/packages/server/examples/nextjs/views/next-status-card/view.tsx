import { Image, ThemeProvider, useToolContext } from "mcp-use/react";

import { StatusCard } from "../../components/StatusCard";

/** MCP App view discovered and bootstrapped automatically by mcp-use. */
export default function NextStatusCardView() {
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
            src="/next-mark.svg"
            width={48}
            height={48}
            alt="Next.js example mark"
          />
        }
      />
    </ThemeProvider>
  );
}
