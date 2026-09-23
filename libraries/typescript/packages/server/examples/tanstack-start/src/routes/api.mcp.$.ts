import { createFileRoute } from "@tanstack/react-router";
import { handler } from "../mcp/handler.server";

export const Route = createFileRoute("/api/mcp/$")({
  server: {
    handlers: { ANY: ({ request }) => handler(request) },
  },
});
