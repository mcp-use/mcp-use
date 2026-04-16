import { describe, it, expect, beforeEach } from "vitest";
import { MCPServer } from "../../../src/server/mcp-server.js";
import { z } from "zod";

describe("Tool Context: supportsUI", () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });
  });

  it("should expose supportsUI=true when client has UI capabilities", async () => {
    let capturedSupportsUI: boolean | undefined;

    server.tool(
      {
        name: "test-tool",
        schema: z.object({}),
      },
      async (_params, ctx) => {
        capturedSupportsUI = ctx.supportsUI;
        return { content: [] };
      }
    );

    const toolHandler = server.registrations.tools.get("test-tool");
    expect(toolHandler).toBeDefined();

    const sessionId = "session-123";
    const sessionData: any = {
      clientCapabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
    };
    server.sessions.set(sessionId, sessionData);

    await toolHandler!.handler({}, {
      _meta: { sessionId }
    } as any);


    const mockContext = { var: {} } as any;
    sessionData.context = mockContext;
    

    const { runWithContext } = await import("../../../src/server/context-storage.js");
    
    await runWithContext(mockContext, async () => {
        await toolHandler!.handler({}, {});
    });

    expect(capturedSupportsUI).toBe(true);
  });

  it("should expose supportsUI=false when client has NO UI capabilities", async () => {
    let capturedSupportsUI: boolean | undefined;

    server.tool(
      {
        name: "test-tool",
        schema: z.object({}),
      },
      async (_params, ctx) => {
        capturedSupportsUI = ctx.supportsUI;
        return { content: [] };
      }
    );

    const toolHandler = server.registrations.tools.get("test-tool");
    const sessionId = "session-456";
    const sessionData: any = {
      clientCapabilities: {
        sampling: {},
      },
    };
    server.sessions.set(sessionId, sessionData);

    const mockContext = { var: {} } as any;
    sessionData.context = mockContext;
    
    const { runWithContext } = await import("../../../src/server/context-storage.js");
    
    await runWithContext(mockContext, async () => {
        await toolHandler!.handler({}, {});
    });

    expect(capturedSupportsUI).toBe(false);
  });
});
