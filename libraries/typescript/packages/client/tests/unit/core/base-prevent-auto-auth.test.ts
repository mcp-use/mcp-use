import { UnauthorizedError } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { completeOAuthFlow } from "../../../src/auth/flow.js";
import { BaseMCPClient } from "../../../src/core/base.js";

vi.mock("../../../src/auth/flow.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/auth/flow.js")>()),
  completeOAuthFlow: vi.fn(),
}));

describe("BaseMCPClient manual OAuth", () => {
  it("returns the unauthorized result instead of waiting for OAuth", async () => {
    const provider = {
      preventAutoAuth: true,
      redirectUrl: "http://localhost/oauth/callback",
      clientMetadata: {},
    };
    const connector = {
      isConnected: false,
      connect: vi
        .fn()
        .mockRejectedValue(new UnauthorizedError("Authorization required")),
    };

    class TestClient extends BaseMCPClient {
      protected createConnectorFromConfig() {
        return connector as never;
      }

      protected async createDefaultOAuthProvider() {
        return provider as never;
      }
    }

    const client = new TestClient({
      mcpServers: {
        test: {
          url: "https://example.com/mcp",
          authProvider: provider,
        } as never,
      },
    });

    await expect(client.connect("test")).rejects.toThrow(
      "Authorization required"
    );
    expect(completeOAuthFlow).not.toHaveBeenCalled();
  });
});
