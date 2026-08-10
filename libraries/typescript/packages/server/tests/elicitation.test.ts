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
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  isInputRequiredResult,
  MCPServer,
} from "../src/index.js";

const confirmationSchema = z.object({ confirm: z.boolean() });
const projectSchema = z.object({ project: z.string() });
const regionSchema = z.object({ region: z.string() });

type DeployRequestState = {
  phase: "awaiting-confirmation";
  environment: string;
};

const requestStateCodec = createRequestStateCodec<DeployRequestState>({
  key: new Uint8Array(32).fill(7),
  ttlSeconds: 60,
});

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
    requestState: { verify: requestStateCodec.verify },
  });
  let client: Client;
  let manualClient: Client;
  let batchedToolEntries = 0;
  let cancelledBatchRequests = 0;
  let cancelledFormAttempts = 0;
  let invalidFormAttempts = 0;
  let statefulToolEntries = 0;

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
      // This callback starts over for every stateless round. Inspect the current
      // round first so decline/cancel is terminal rather than re-requested.
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

      // Initial and schema-invalid rounds both return input_required.
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

      // Keep side effects after accepted, validated input: this line can run
      // only on the final handler entry.
      const result = { environment, deployed: true };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );

  server.tool({ name: "link-account" }, async (_params, ctx) => {
    // Resolve a retry before asking again; URL accept has no form content.
    const response = inputResponse(ctx.inputResponses, "authorize");
    if (response.kind === "elicit") {
      return {
        content: [
          {
            type: "text",
            text:
              response.action === "accept"
                ? "Authorization page opened"
                : "Account not linked",
          },
        ],
        ...(response.action !== "accept" ? { isError: true as const } : {}),
      };
    }

    return inputRequired({
      inputRequests: {
        authorize: inputRequired.elicitUrl({
          message: "Sign in to link your account",
          url: "https://example.com/authorize",
        }),
      },
    });
  });

  server.tool(
    {
      name: "batch-profile",
      inputSchema: z.object({
        cancel: z.boolean().optional().default(false),
      }),
    },
    async ({ cancel }, ctx) => {
      batchedToolEntries += 1;

      // inputResponses contains only the requests fulfilled for this round.
      // Read every batched response before deciding whether the flow stopped.
      const projectResponse = inputResponse(ctx.inputResponses, "project");
      const regionResponse = inputResponse(ctx.inputResponses, "region");
      const stoppedResponse = [projectResponse, regionResponse].find(
        (response) => response.kind === "elicit" && response.action !== "accept"
      );
      if (
        stoppedResponse?.kind === "elicit" &&
        stoppedResponse.action !== "accept"
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Batch ${stoppedResponse.action}`,
            },
          ],
          isError: true,
        };
      }

      const project = acceptedContent(
        ctx.inputResponses,
        "project",
        projectSchema
      );
      const region = acceptedContent(
        ctx.inputResponses,
        "region",
        regionSchema
      );

      // If either value is missing or invalid, request the complete batch again:
      // accepted values from this round are not implicit state for the next one.
      if (project === undefined || region === undefined) {
        return inputRequired({
          inputRequests: {
            project: inputRequired.elicit({
              message: cancel
                ? "Project name for cancelled batch?"
                : "Project name?",
              requestedSchema: projectSchema,
            }),
            region: inputRequired.elicit({
              message: cancel
                ? "Deployment region for cancelled batch?"
                : "Deployment region?",
              requestedSchema: regionSchema,
            }),
          },
        });
      }

      // Provisioning is safe only after both responses in the batch validate.
      return {
        content: [
          {
            type: "text",
            text: `Provision ${project.project} in ${region.region}`,
          },
        ],
      };
    }
  );

  server.tool(
    {
      name: "stateful-deploy",
      inputSchema: z.object({ environment: z.string() }),
    },
    async ({ environment }, ctx) => {
      statefulToolEntries += 1;
      // Both channels are per-invocation: inputResponses answers this round,
      // while verified requestState carries trusted workflow data across rounds.
      const response = inputResponse(ctx.inputResponses, "stateful-confirm");
      const state = ctx.requestState<DeployRequestState>();

      // A decline or cancellation is terminal even though the handler restarted.
      if (response.kind === "elicit" && response.action !== "accept") {
        return {
          content: [
            { type: "text", text: `Stateful deployment ${response.action}` },
          ],
          isError: true,
        };
      }

      if (
        state !== undefined &&
        (state.phase !== "awaiting-confirmation" ||
          state.environment !== environment)
      ) {
        return {
          content: [
            { type: "text", text: "Confirmation does not match deployment" },
          ],
          isError: true,
        };
      }

      const confirmation = acceptedContent(
        ctx.inputResponses,
        "stateful-confirm",
        confirmationSchema
      );

      // Initial, missing, or schema-invalid rounds request input and mint the
      // stage needed by whichever replica receives the next invocation.
      if (state === undefined || confirmation === undefined) {
        return inputRequired({
          inputRequests: {
            "stateful-confirm": inputRequired.elicit({
              message: `Statefully deploy to ${environment}?`,
              requestedSchema: confirmationSchema,
            }),
          },
          requestState: await requestStateCodec.mint({
            phase: "awaiting-confirmation",
            environment,
          }),
        });
      }

      if (confirmation.confirm !== true) {
        return {
          content: [{ type: "text", text: "Stateful deployment not approved" }],
          isError: true,
        };
      }

      // Side effects would go here, after verified state and validated consent.
      return {
        content: [{ type: "text", text: `Statefully deployed ${environment}` }],
      };
    }
  );

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
      if (request.params.message === "Deploy to cancel?") {
        cancelledFormAttempts += 1;
        return { action: "cancel" };
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
      if (request.params.message === "Project name for cancelled batch?") {
        cancelledBatchRequests += 1;
        return { action: "cancel" };
      }
      if (request.params.message === "Deployment region for cancelled batch?") {
        cancelledBatchRequests += 1;
        return { action: "accept", content: { region: "us-east-1" } };
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
    manualClient = new Client(
      { name: "elicitation-manual-client", version: "1.0.0" },
      {
        capabilities: { elicitation: { form: {}, url: {} } },
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        inputRequired: { autoFulfill: false },
      }
    );
    await manualClient.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );
  });

  afterAll(async () => {
    await manualClient.close();
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
      text: "Authorization page opened",
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

  it("surfaces a cancelled elicitation without re-requesting it", async () => {
    const attemptsBefore = cancelledFormAttempts;
    const result = await client.callTool({
      name: "deploy",
      arguments: { environment: "cancel" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual({
      type: "text",
      text: "Deployment cancel",
    });
    expect(cancelledFormAttempts - attemptsBefore).toBe(1);
  });

  it("fulfills multiple input requests in one round before re-entering the tool", async () => {
    const entriesBefore = batchedToolEntries;
    const requestsBefore = seenRequests.length;

    const result = await client.callTool({
      name: "batch-profile",
      arguments: {},
    });

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

  it("stops a batched flow when one input request is cancelled", async () => {
    const entriesBefore = batchedToolEntries;
    const requestsBefore = cancelledBatchRequests;

    const result = await client.callTool({
      name: "batch-profile",
      arguments: { cancel: true },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual({
      type: "text",
      text: "Batch cancel",
    });
    expect(batchedToolEntries - entriesBefore).toBe(2);
    expect(cancelledBatchRequests - requestsBefore).toBe(2);
  });

  it("round-trips verified requestState across handler entries", async () => {
    const entriesBefore = statefulToolEntries;

    const result = await client.callTool({
      name: "stateful-deploy",
      arguments: { environment: "production" },
    });

    expect(result.content).toContainEqual({
      type: "text",
      text: "Statefully deployed production",
    });
    expect(statefulToolEntries - entriesBefore).toBe(2);
  });

  it("rejects tampered requestState before handler re-entry", async () => {
    const initial = await manualClient.callTool(
      {
        name: "stateful-deploy",
        arguments: { environment: "production" },
      },
      { allowInputRequired: true }
    );

    expect(isInputRequiredResult(initial)).toBe(true);
    if (
      !isInputRequiredResult(initial) ||
      initial.inputRequests === undefined ||
      initial.requestState === undefined
    ) {
      throw new Error("Expected an input_required result with requestState");
    }

    const [responseKey] = Object.keys(initial.inputRequests);
    if (responseKey === undefined) {
      throw new Error("Expected a stateful confirmation response key");
    }

    type RetriedCall = Parameters<Client["callTool"]>[0] & {
      inputResponses: Record<string, unknown>;
      requestState: string;
    };
    const retriedCall: RetriedCall = {
      name: "stateful-deploy",
      arguments: { environment: "production" },
      inputResponses: {
        [responseKey]: {
          action: "accept",
          content: { confirm: true },
        },
      },
      requestState: `${initial.requestState}tampered`,
    };

    await expect(
      manualClient.callTool(retriedCall, { allowInputRequired: true })
    ).rejects.toThrow(/requestState/i);
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
