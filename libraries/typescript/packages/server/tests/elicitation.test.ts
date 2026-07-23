/**
 * End-to-end coverage for v2 multi-round-trip elicitation over real HTTP.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";

const confirmationSchema = z.object({ confirm: z.boolean() });
const asyncConfirmationSchema = confirmationSchema.superRefine(
  async ({ confirm }, refinement) => {
    await Promise.resolve();
    if (!confirm) {
      refinement.addIssue({
        code: "custom",
        message: "Confirmation is required",
      });
    }
  }
);

describe("elicitation and input_required", () => {
  const seenRequests: Array<{
    mode?: string | undefined;
    message: string;
    url?: string | undefined;
  }> = [];
  const logMessages: Array<{
    level: string;
    data: unknown;
    logger?: string | undefined;
  }> = [];
  const customNotifications: Array<{ status: string }> = [];
  const server = new MCPServer({
    name: "elicitation-test",
    version: "1.0.0",
  });
  let client: Client;
  let asyncFormAttempts = 0;
  let invalidFormAttempts = 0;

  server.tool(
    {
      name: "deploy",
      inputSchema: z.object({ environment: z.string() }),
      outputSchema: z.object({
        environment: z.string(),
        deployed: z.boolean(),
      }),
    },
    async ({ environment }, ctx) => {
      const confirmation = await ctx.elicit(
        "confirm",
        `Deploy to ${environment}?`,
        environment === "async-invalid-first"
          ? asyncConfirmationSchema
          : confirmationSchema
      );
      if (confirmation.status === "required") {
        return confirmation.result;
      }
      if (confirmation.status !== "accept") {
        return {
          content: [
            { type: "text", text: `Deployment ${confirmation.status}` },
          ],
          isError: true,
        };
      }
      if (confirmation.data.confirm !== true) {
        return {
          content: [{ type: "text", text: "Deployment not confirmed" }],
          isError: true,
        };
      }

      const result = { environment, deployed: true };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );

  server.tool({ name: "link-account" }, async (_params, ctx) => {
    const authorization = await ctx.elicit(
      "authorize",
      "Sign in to link your account",
      "https://example.com/authorize"
    );
    if (authorization.status === "required") {
      return authorization.result;
    }
    return {
      content: [
        {
          type: "text",
          text:
            authorization.status === "accept"
              ? "Account linked"
              : "Account not linked",
        },
      ],
      ...(authorization.status !== "accept" ? { isError: true as const } : {}),
    };
  });

  server.tool({ name: "emit-log" }, async (_params, ctx) => {
    await ctx.sendLog("info", { operation: "emit-log" }, "elicitation-test");
    return { content: [{ type: "text", text: "Log sent" }] };
  });

  server.tool({ name: "emit-notification" }, async (_params, ctx) => {
    await ctx.sendNotification("com.example/import-status", {
      status: "started",
    });
    return { content: [{ type: "text", text: "Notification sent" }] };
  });

  beforeAll(async () => {
    const started = await server.listen(0);
    client = new Client(
      { name: "elicitation-test-client", version: "1.0.0" },
      {
        capabilities: { elicitation: { form: {}, url: {} } },
        versionNegotiation: { mode: { pin: "2026-07-28" } },
      }
    );
    client.setRequestHandler("elicitation/create", async (request) => {
      seenRequests.push(request.params);
      if (request.params.mode === "url") {
        return { action: "accept" };
      }
      if (request.params.message === "Deploy to decline?") {
        return { action: "decline" };
      }
      if (request.params.message === "Deploy to invalid-first?") {
        invalidFormAttempts += 1;
        return invalidFormAttempts === 1
          ? { action: "accept", content: { confirm: "yes" } }
          : { action: "accept", content: { confirm: true } };
      }
      if (request.params.message === "Deploy to async-invalid-first?") {
        asyncFormAttempts += 1;
        return asyncFormAttempts === 1
          ? { action: "accept", content: { confirm: false } }
          : { action: "accept", content: { confirm: true } };
      }
      return { action: "accept", content: { confirm: true } };
    });
    client.setNotificationHandler("notifications/message", (notification) => {
      logMessages.push(notification.params);
    });
    client.setNotificationHandler(
      "com.example/import-status",
      { params: z.object({ status: z.string() }) },
      (params) => {
        customNotifications.push(params);
      }
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("round-trips a v1-style form elicitation and returns the final tool result", async () => {
    const result = await client.callTool({
      name: "deploy",
      arguments: { environment: "production" },
    });

    expect(result.structuredContent).toEqual({
      environment: "production",
      deployed: true,
    });
    expect(seenRequests).toContainEqual(
      expect.objectContaining({
        mode: "form",
        message: "Deploy to production?",
      })
    );
  });

  it("round-trips a v1-style URL elicitation", async () => {
    const result = await client.callTool({ name: "link-account" });

    expect(result.content).toContainEqual({
      type: "text",
      text: "Account linked",
    });
    expect(seenRequests).toContainEqual(
      expect.objectContaining({
        mode: "url",
        message: "Sign in to link your account",
        url: "https://example.com/authorize",
      })
    );
  });

  it("sends a custom notification on the originating request", async () => {
    const result = await client.callTool({ name: "emit-notification" });

    expect(result.content).toEqual([
      { type: "text", text: "Notification sent" },
    ]);
    expect(customNotifications).toEqual([{ status: "started" }]);
  });

  it("sends request-scoped logging notifications", async () => {
    const result = await client.callTool({ name: "emit-log" });

    expect(result.content).toContainEqual({ type: "text", text: "Log sent" });
    expect(logMessages).toContainEqual({
      level: "info",
      data: { operation: "emit-log" },
      logger: "elicitation-test",
    });
  });

  it("surfaces a declined elicitation without re-requesting it", async () => {
    const result = await client.callTool({
      name: "deploy",
      arguments: { environment: "decline" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual({
      type: "text",
      text: "Deployment decline",
    });
  });

  it("re-requests form input that fails Standard Schema validation", async () => {
    const result = await client.callTool({
      name: "deploy",
      arguments: { environment: "invalid-first" },
    });

    expect(result.structuredContent).toEqual({
      environment: "invalid-first",
      deployed: true,
    });
    expect(invalidFormAttempts).toBe(2);
  });

  it("awaits asynchronous Standard Schema validation", async () => {
    const result = await client.callTool({
      name: "deploy",
      arguments: { environment: "async-invalid-first" },
    });

    expect(result.structuredContent).toEqual({
      environment: "async-invalid-first",
      deployed: true,
    });
    expect(asyncFormAttempts).toBe(2);
  });
});
