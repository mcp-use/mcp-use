import "server-only";
import { headers } from "next/headers";

/** Server-side service shared by the Next.js page and MCP tool. */
export async function getProjectStatus(caller: string) {
  const requestHeaders = await headers();
  const requestContext = requestHeaders.has("user-agent")
    ? "Next.js request context"
    : "standalone MCP context";

  return {
    title: "Shared service ready",
    detail: `${caller} called the shared project service (${requestContext}).`,
  };
}
