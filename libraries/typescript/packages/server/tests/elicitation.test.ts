/**
 * End-to-end coverage for v2 multi-round-trip elicitation over real HTTP.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  acceptedContent,
  inputRequired,
  inputResponse,
  MCPServer,
} from "../src/index.js";

const confirmationSchema = z.object({ confirm: z.boolean() });
const projectSchema = z.object({ project: z.string() });
const regionSchema = z.object({ region: z.string() });

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
  let batchedToolEntries = 0;
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
      const response = inputResponse(ctx.inputResponses, "confirm");
      if (response.kind === "elicit" && response.action !== "accept") {
        return {
          content: [{ type: "text", text: `Deployment ${response.action}` }],
          isError: true,
        };
      }

      const confirmation = acceptedContent(
        ctx.inputResponses,
        "confirm",
        confirmationSchema
      );

      if (confirmation === undefined) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Deploy to ${environment}?`,
              requestedSchema: confirmationSchema,
            }),
          },
        });
      }
      if (confirmation.confirm !== true) {
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
    const response = inputResponse(ctx.inputResponses, "authorize");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          authorize: inputRequired.elicitUrl({
            message: "Sign in to link your account",
            url: "https://example.com/authorize",
          }),
        },
      });
    }
    return {
      content: [
        {
          type: "text",
          text:
            response.kind === "elicit" && response.action === "accept"
              ? "Account linked"
              : "Account not linked",
        },
      ],
      ...(response.kind !== "elicit" || response.action !== "accept"
        ? { isError: true as const }
        : {}),
    };
  });

  server.tool({ name: "batch-profile" }, async (_params, ctx) => {
    batchedToolEntries += 1;
    const project = acceptedContent(
      ctx.inputResponses,
      "project",
      projectSchema
    );
    const region = acceptedContent(ctx.inputResponses, "region", regionSchema);

    if (project === undefined || region === undefined) {
      return inputRequired({
        inputRequests: {
          project: inputRequired.elicit({
            message: "Project name?",
            requestedSchema: projectSchema,
          }),
          region: inputRequired.elicit({
            message: "Deployment region?",
            requestedSchema: regionSchema,
          }),
        },
      });
    }

    return {
      content: [
        {
          type: "text",
          text: `Provision ${project.project} in ${region.region}`,
        },
      ],
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
      if (request.params.message === "Project name?") {
        return { action: "accept", content: { project: "apollo" } };
      }
      if (request.params.message === "Deployment region?") {
        return { action: "accept", content: { region: "us-west-2" } };
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

  it("round-trips a form input_required result and returns the final tool result", async () => {
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

  it("round-trips a URL input_required result", async () => {
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

  it("fulfills multiple input requests in one round before re-entering the tool", async () => {
    const entriesBefore = batchedToolEntries;
    const requestsBefore = seenRequests.length;

    const result = await client.callTool({ name: "batch-profile" });

    expect(result.content).toContainEqual({
      type: "text",
      text: "Provision apollo in us-west-2",
    });
    expect(batchedToolEntries - entriesBefore).toBe(2);
    expect(seenRequests.slice(requestsBefore)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "form", message: "Project name?" }),
        expect.objectContaining({
          mode: "form",
          message: "Deployment region?",
        }),
      ])
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
});
