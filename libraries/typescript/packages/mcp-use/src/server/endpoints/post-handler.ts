/**
 * POST Handler for MCP Messages
 *
 * Handles POST requests to MCP endpoints, including:
 * - Session initialization
 * - Tool calls
 * - SSE streaming
 */

import type { Context } from "hono";
import { runWithContext } from "../context-storage.js";
import { createExpressLikeObjects } from "../transport/index.js";
import type { SessionData } from "../sessions/index.js";
import { validateSession, setupAbortSignal } from "./shared-helpers.js";

/**
 * Handle POST requests for MCP messages
 */
export async function handlePostRequest(
  c: Context,
  sessions: Map<string, SessionData>,
  getOrCreateTransport: (sessionId?: string, isInit?: boolean) => Promise<any>
): Promise<Response> {
  const { expressReq, expressRes, getResponse, isSSEStream, waitForSSEStream } =
    createExpressLikeObjects(c);

  // Get request body
  let body: any = {};
  try {
    body = await c.req.json();
    expressReq.body = body;
  } catch {
    expressReq.body = {};
  }

  // Check if this is an initialization request
  const isInit = body?.method === "initialize";
  const sessionId = c.req.header("mcp-session-id");

  // Get or create transport for this session
  const transport = await getOrCreateTransport(sessionId, isInit);

  // Validate session
  const validationError = validateSession(sessionId, transport, body);
  if (validationError) {
    return c.json(validationError.error, validationError.statusCode);
  }

  // Update session data
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastAccessedAt = Date.now();
    session.context = c;
    session.honoContext = c;
    session.expressRes = expressRes;

    // Extract progressToken from tool call requests
    if (body?.method === "tools/call" && body?.params?._meta?.progressToken) {
      session.progressToken = body.params._meta.progressToken;
      console.log(
        `Received progressToken ${session.progressToken} for tool call: ${body.params?.name}`
      );
    } else {
      // Clear progressToken if not a tool call or no token provided
      session.progressToken = undefined;
      if (body?.method === "tools/call") {
        console.log(
          `No progressToken in tool call request: ${body.params?.name}`
        );
      }
    }
  }

  // Setup abort signal handling
  setupAbortSignal(c, transport);

  // Handle the request within AsyncLocalStorage context
  let streamingResponse: Response | null = null;
  let shouldReturnStream = false;

  await runWithContext(c, async () => {
    // Start handleRequest - it will call writeHead which may create SSE stream
    const handleRequestPromise = transport.handleRequest(
      expressReq,
      expressRes,
      expressReq.body
    );

    // Race between SSE stream creation and request completion
    try {
      // Wait for either SSE stream to be ready or a short timeout
      const sseStream = await Promise.race([
        waitForSSEStream(),
        new Promise<Response | null>((resolve) => {
          setTimeout(() => resolve(null), 50);
        }),
      ]);

      if (sseStream) {
        streamingResponse = sseStream;
        shouldReturnStream = true;
        // Let handleRequest continue in background
        handleRequestPromise.catch(() => {
          // Ignore SSE stream errors (client may have disconnected)
        });
        return;
      } else {
        // Check again if SSE was detected but promise didn't resolve
        if (isSSEStream()) {
          const response = getResponse();
          if (response) {
            streamingResponse = response;
            shouldReturnStream = true;
            handleRequestPromise.catch(() => {
              // Ignore errors (client may have disconnected)
            });
            return;
          }
        }
      }
    } catch {
      // Ignore timeout errors
    }

    // Not SSE or SSE stream not created - wait for request completion
    await new Promise<void>((resolve) => {
      const originalEnd = expressRes.end;
      let ended = false;
      expressRes.end = (chunk?: any, encoding?: any, callback?: any) => {
        if (!ended) {
          originalEnd.call(expressRes, chunk, encoding, callback);
          ended = true;
          resolve();
        }
      };
      // If handleRequest already completed, resolve immediately
      handleRequestPromise.finally(() => {
        if (!ended) {
          expressRes.end();
        }
      });
    });
  });

  // If we have a streaming response (SSE), return it immediately
  if (shouldReturnStream && streamingResponse) {
    return streamingResponse;
  }

  // Check for buffered response (non-SSE)
  const response = getResponse();
  if (response) {
    return response;
  }

  // If no response was written, return empty response
  return c.text("", 200);
}
