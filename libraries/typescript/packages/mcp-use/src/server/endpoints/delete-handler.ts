/**
 * DELETE Handler for Session Cleanup
 *
 * Handles DELETE requests for closing MCP sessions.
 */

import type { Context } from "hono";
import { createExpressLikeObjects } from "../transport/index.js";
import type { SessionData } from "../sessions/index.js";
import { validateSession, setupAbortSignal } from "./shared-helpers.js";

/**
 * Wait for transport.handleRequest to complete and response to be written
 */
function waitForRequestComplete(
  transport: any,
  expressReq: any,
  expressRes: any
): Promise<void> {
  return new Promise<void>((resolve) => {
    const originalEnd = expressRes.end;
    let ended = false;

    expressRes.end = (...args: any[]) => {
      if (!ended) {
        originalEnd.apply(expressRes, args);
        ended = true;
        resolve();
      }
    };

    // Start handling the request
    transport.handleRequest(expressReq, expressRes).finally(() => {
      if (!ended) {
        expressRes.end();
      }
    });
  });
}

/**
 * Handle DELETE requests for session cleanup
 */
export async function handleDeleteRequest(
  c: Context,
  sessions: Map<string, SessionData>,
  getOrCreateTransport: (sessionId?: string, isInit?: boolean) => Promise<any>
): Promise<Response> {
  const { expressReq, expressRes, getResponse } = createExpressLikeObjects(c);

  const sessionId = c.req.header("mcp-session-id");

  // Get transport for this session (DELETE requires session ID)
  const transport = await getOrCreateTransport(sessionId, false);

  // Validate session
  const validationError = validateSession(sessionId, transport);
  if (validationError) {
    return c.json(validationError.error, validationError.statusCode);
  }

  // Setup abort signal handling
  setupAbortSignal(c, transport);

  // Wait for handleRequest to complete and for response to be written
  await waitForRequestComplete(transport, expressReq, expressRes);

  const response = getResponse();
  if (response) {
    return response;
  }

  return c.text("", 200);
}
