import { describe, expect, it, vi } from "vitest";
import { MCPConnection } from "../../../src/core/session.js";
import { BaseConnector } from "../../../src/transport/base.js";

describe("Prompt request options", () => {
  it("forwards request options from BaseConnector to the SDK client", async () => {
    const connector = new BaseConnector();
    const prompt = { messages: [] };
    const client = {
      getPrompt: vi.fn().mockResolvedValue(prompt),
    };
    const options = { timeout: 5_000 };
    (connector as any).client = client;

    await expect(
      connector.getPrompt("greeting", { name: "Ada" }, options)
    ).resolves.toBe(prompt);

    expect(client.getPrompt).toHaveBeenCalledWith(
      { name: "greeting", arguments: { name: "Ada" } },
      options
    );
  });

  it("forwards request options from MCPConnection to its connector", async () => {
    const connector = {
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    };
    const connection = new MCPConnection(connector as never);
    const options = { timeout: 5_000 };

    await connection.getPrompt("greeting", { name: "Ada" }, options);

    expect(connector.getPrompt).toHaveBeenCalledWith(
      "greeting",
      { name: "Ada" },
      options
    );
  });
});
