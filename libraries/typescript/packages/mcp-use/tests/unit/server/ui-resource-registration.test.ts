import { describe, expect, it } from "vitest";
import { MCPServer } from "../../../src/server/mcp-server.js";
import { runWithContext } from "../../../src/server/context-storage.js";

describe("uiResourceRegistration", () => {
  it("hashes resource _meta.ui.domain for Claude resource reads", async () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    server.uiResource({
      type: "mcpApps",
      name: "domain-widget",
      title: "Domain Widget",
      description: "Widget with a host-specific domain",
      htmlTemplate: "<div>Domain widget</div>",
      metadata: {
        domain: "https://example.com/mcp",
        prefersBorder: true,
      },
    });

    const requestContext = {} as any;
    server.sessions.set("session-1", {
      context: requestContext,
      clientInfo: { name: "claude-desktop", version: "1.0.0" },
    } as any);

    const resourceRegistration = server.registrations.resources.get(
      "domain-widget:ui://widget/domain-widget.html"
    );
    expect(resourceRegistration).toBeDefined();

    const result = await runWithContext(requestContext, () =>
      resourceRegistration!.handler()
    );
    const resource = result.contents[0];

    expect(resource._meta?.ui).toMatchObject({
      domain: "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com",
      prefersBorder: true,
    });
  });
});
