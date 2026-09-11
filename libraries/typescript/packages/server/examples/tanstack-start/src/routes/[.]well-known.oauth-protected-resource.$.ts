import { createFileRoute } from "@tanstack/react-router";
import { handler } from "../mcp/handler.server";

// OAuth discovery lives outside /api/mcp. It returns 404 until server.ts
// configures OAuth, and then exposes the server's resource metadata.
export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")(
  {
    server: {
      handlers: { GET: ({ request }) => handler(request) },
    },
  }
);
